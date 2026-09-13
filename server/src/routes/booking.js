'use strict';
/**
 * Grounds and bookings.
 *
 * Most of this is deliberately public. Someone looking to book a net on
 * Saturday should not need an account, so browsing grounds, coaches and
 * availability, and making a booking, all work unauthenticated.
 *
 * A guest booking stores a name and a contact and nothing else. No athlete
 * record is created or looked up, so booking can never introduce a duplicate
 * athlete — which is exactly why it is kept separate from the athlete portal.
 *
 * Double booking is prevented by the database, not by a check in this file.
 * Two requests for the same slot arriving together would both pass an
 * application-level test; a unique index refuses the second one regardless.
 */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { db, tx } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { asyncHandler, ApiError } = require('../middleware/error');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Time helpers                                                        */
/* ------------------------------------------------------------------ */

/** "17:30" → 1050. Minutes of the day make overlap a comparison. */
function toMinute(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const toClock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const reference = () => `BK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/* ------------------------------------------------------------------ */
/* Sports, for the booking flow                                        */
/* ------------------------------------------------------------------ */

/**
 * The sports a guest can book for. The main `/sports` endpoint needs a
 * sign-in and returns the full configuration — every event type, every
 * derivation rule — none of which a booking form has any use for.
 */
router.get('/booking/sports', (req, res) => {
  const sports = db
    .prepare(`SELECT s.id, s.code, s.name, s.color FROM sports s
              WHERE s.is_active = 1
              AND EXISTS (SELECT 1 FROM facility_sports fs
                          JOIN facilities f ON f.id = fs.facility_id
                          WHERE fs.sport_id = s.id AND f.is_bookable = 1 AND f.is_active = 1)
              ORDER BY s.sort_order, s.name`)
    .all();
  res.json({ sports });
});

/* ------------------------------------------------------------------ */
/* Grounds                                                             */
/* ------------------------------------------------------------------ */

router.get('/facilities', (req, res) => {
  const where = ['f.is_active = 1'];
  const params = [];
  if (req.query.bookable !== 'false') where.push('f.is_bookable = 1');
  if (req.query.sport) {
    where.push('EXISTS (SELECT 1 FROM facility_sports fs WHERE fs.facility_id = f.id AND fs.sport_id = ?)');
    params.push(Number(req.query.sport));
  }

  const facilities = db
    .prepare(`SELECT f.* FROM facilities f WHERE ${where.join(' AND ')} ORDER BY f.kind, f.name`)
    .all(...params)
    .map((f) => ({
      ...f,
      sports: db
        .prepare(`SELECT s.id, s.code, s.name, s.color FROM facility_sports fs
                  JOIN sports s ON s.id = fs.sport_id WHERE fs.facility_id = ?`)
        .all(f.id),
    }));

  res.json({ facilities });
});

/* ------------------------------------------------------------------ */
/* Coaches, as cards                                                   */
/* ------------------------------------------------------------------ */

/**
 * Bookable coaches with the one thing that matters when choosing one: what
 * they specialise in and how long they have done it.
 */
router.get('/booking/coaches', (req, res) => {
  const where = ['cs.bookable = 1', 'c.is_active = 1'];
  const params = [];
  if (req.query.sport) { where.push('(cs.sport_id = ? OR cs.sport_id IS NULL)'); params.push(Number(req.query.sport)); }

  const rows = db
    .prepare(`SELECT cs.id AS speciality_id, cs.speciality, cs.years_experience, cs.hourly_rate, cs.bio, cs.is_primary,
                     c.id AS coach_id, c.full_name, c.photo_url, c.qualification,
                     s.id AS sport_id, s.name AS sport_name, s.color
              FROM coach_specialities cs
              JOIN coaches c ON c.id = cs.coach_id
              LEFT JOIN sports s ON s.id = cs.sport_id
              WHERE ${where.join(' AND ')}
              ORDER BY cs.years_experience DESC, c.full_name`)
    .all(...params);

  res.json({
    coaches: rows.map((r) => ({
      coachId: r.coach_id,
      specialityId: r.speciality_id,
      name: r.full_name,
      photoUrl: r.photo_url,
      speciality: r.speciality,
      yearsExperience: r.years_experience,
      sport: r.sport_name ? { id: r.sport_id, name: r.sport_name, color: r.color } : null,
      hourlyRate: r.hourly_rate,
      bio: r.bio,
      isPrimary: !!r.is_primary,
    })),
  });
});

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

/**
 * What a ground has free on a given day.
 *
 * A slot is unavailable if a booking holds it, or if the club is already
 * using the ground for a fixture or a training session. That second part is
 * why venues had to stop being free text: without it an athlete could book
 * the main ground during the first XI's match.
 */
router.get('/booking/availability', asyncHandler(async (req, res) => {
  const facilityId = Number(req.query.facility);
  const date = String(req.query.date || '');
  if (!facilityId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError(422, 'Choose a ground and a date.');
  }

  const facility = db.prepare('SELECT * FROM facilities WHERE id = ? AND is_active = 1').get(facilityId);
  if (!facility) throw new ApiError(404, 'That ground does not exist.');

  const opens = toMinute(facility.opens_at) ?? 360;
  const closes = toMinute(facility.closes_at) ?? 1320;
  const step = facility.slot_minutes || 60;

  const booked = db
    .prepare(`SELECT start_minute, end_minute, coach_id FROM bookings
              WHERE facility_id = ? AND booking_date = ? AND status = 'confirmed'`)
    .all(facilityId, date);

  // The club's own use of the ground, matched by name.
  const clubUse = [
    ...db.prepare(`SELECT scheduled_at AS at, 180 AS length, 'Match' AS label FROM matches
                   WHERE date(scheduled_at) = ? AND venue = ?`).all(date, facility.name),
    ...db.prepare(`SELECT (session_date || ' ' || COALESCE(start_time,'00:00')) AS at,
                          COALESCE(duration_minutes, 90) AS length, 'Training' AS label
                   FROM training_sessions WHERE session_date = ? AND location = ?`).all(date, facility.name),
  ].map((row) => {
    const time = String(row.at).slice(11, 16);
    const start = toMinute(time) ?? 0;
    return { start, end: start + row.length, label: row.label };
  });

  const overlaps = (start, end) => [
    ...booked.map((b) => ({ start: b.start_minute, end: b.end_minute, label: 'Booked' })),
    ...clubUse,
  ].find((x) => start < x.end && end > x.start);

  const slots = [];
  const now = new Date();
  const isToday = date === now.toISOString().slice(0, 10);
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  for (let start = opens; start + step <= closes; start += step) {
    const end = start + step;
    const clash = overlaps(start, end);
    const past = isToday && start <= minutesNow;
    slots.push({
      start: toClock(start),
      end: toClock(end),
      startMinute: start,
      endMinute: end,
      available: !clash && !past,
      reason: past ? 'Already passed' : clash ? clash.label : null,
    });
  }

  res.json({
    facility: { id: facility.id, name: facility.name, kind: facility.kind, slotMinutes: step, hourlyRate: facility.hourly_rate, currency: facility.currency },
    date,
    slots,
    available: slots.filter((s) => s.available).length,
  });
}));

/* ------------------------------------------------------------------ */
/* Making a booking                                                    */
/* ------------------------------------------------------------------ */

const bookingSchema = z.object({
  facility_id: z.coerce.number().int(),
  sport_id: z.coerce.number().int().optional().nullable(),
  coach_id: z.coerce.number().int().optional().nullable(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  start_time: z.string(),
  end_time: z.string(),
  contact_name: z.string().min(2, 'Give a name for the booking'),
  contact_phone: z.string().optional().nullable(),
  contact_email: z.string().email('Enter a valid email address').optional().nullable().or(z.literal('')),
  party_size: z.coerce.number().int().min(1).max(60).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

/**
 * Book a ground. No account needed.
 *
 * Nothing about an athlete is asked for or stored — a name and a way to reach
 * them is the whole of it.
 */
router.post('/booking', asyncHandler(async (req, res) => {
  const body = bookingSchema.parse(req.body);

  const facility = db.prepare('SELECT * FROM facilities WHERE id = ? AND is_active = 1 AND is_bookable = 1').get(body.facility_id);
  if (!facility) throw new ApiError(404, 'That ground is not available for booking.');

  const start = toMinute(body.start_time);
  const end = toMinute(body.end_time);
  if (start === null || end === null) throw new ApiError(422, 'Times must look like 17:00.');
  if (end <= start) throw new ApiError(422, 'The booking has to end after it starts.');

  const opens = toMinute(facility.opens_at) ?? 0;
  const closes = toMinute(facility.closes_at) ?? 1440;
  if (start < opens || end > closes) {
    throw new ApiError(422, `${facility.name} is open from ${facility.opens_at} to ${facility.closes_at}.`);
  }

  // Not in the past.
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  if (body.booking_date < todayIso) throw new ApiError(422, 'That date has already passed.');
  if (body.booking_date === todayIso && start <= now.getHours() * 60 + now.getMinutes()) {
    throw new ApiError(422, 'That time has already passed today.');
  }

  if (!body.contact_phone && !body.contact_email) {
    throw new ApiError(422, 'Leave a phone number or an email so the club can reach you.');
  }

  // Does the club already need the ground then?
  const clubUse = [
    ...db.prepare('SELECT scheduled_at AS at, 180 AS length FROM matches WHERE date(scheduled_at) = ? AND venue = ?')
      .all(body.booking_date, facility.name),
    ...db.prepare(`SELECT (session_date || ' ' || COALESCE(start_time,'00:00')) AS at, COALESCE(duration_minutes, 90) AS length
                   FROM training_sessions WHERE session_date = ? AND location = ?`)
      .all(body.booking_date, facility.name),
  ].map((row) => {
    const s = toMinute(String(row.at).slice(11, 16)) ?? 0;
    return { start: s, end: s + row.length };
  }).find((x) => start < x.end && end > x.start);
  if (clubUse) throw new ApiError(409, 'The club is using that ground at that time. Please choose another slot.');

  let coach = null;
  if (body.coach_id) {
    coach = db.prepare('SELECT * FROM coaches WHERE id = ?').get(body.coach_id);
    if (!coach) throw new ApiError(404, 'That coach is not available.');
    const busy = db
      .prepare(`SELECT id FROM bookings WHERE coach_id = ? AND booking_date = ? AND status = 'confirmed'
                AND start_minute < ? AND end_minute > ?`)
      .get(coach.id, body.booking_date, end, start);
    if (busy) throw new ApiError(409, `${coach.full_name} is already booked at that time.`);
  }

  const hours = (end - start) / 60;
  const amount = facility.hourly_rate ? Math.round(facility.hourly_rate * hours * 100) / 100 : null;

  let saved;
  try {
    tx(() => {
      // Re-check inside the transaction, then rely on the index below to
      // settle any race that slipped through.
      const clash = db
        .prepare(`SELECT id FROM bookings WHERE facility_id = ? AND booking_date = ? AND status = 'confirmed'
                  AND start_minute < ? AND end_minute > ?`)
        .get(facility.id, body.booking_date, end, start);
      if (clash) throw new ApiError(409, 'That slot has just been taken. Please choose another.');

      const info = db.prepare(`
        INSERT INTO bookings (reference, facility_id, sport_id, coach_id, booking_date, start_time, end_time,
          start_minute, end_minute, booked_by, contact_name, contact_phone, contact_email, party_size, notes,
          amount, currency, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        reference(), facility.id, body.sport_id ?? null, body.coach_id ?? null,
        body.booking_date, toClock(start), toClock(end), start, end,
        req.user ? 'staff' : 'guest',
        body.contact_name, body.contact_phone || null, body.contact_email || null,
        body.party_size ?? null, body.notes ?? null,
        amount, facility.currency, req.user ? req.user.id : null,
      );
      saved = db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (String(err.message).includes('UNIQUE')) throw new ApiError(409, 'That slot has just been taken. Please choose another.');
    throw err;
  }

  audit(req, {
    action: 'create', entity: 'bookings', entityId: saved.id,
    summary: `Booking ${saved.reference}: ${facility.name} on ${saved.booking_date} at ${saved.start_time}`,
  });

  res.status(201).json({
    booking: {
      reference: saved.reference,
      facility: facility.name,
      date: saved.booking_date,
      start: saved.start_time,
      end: saved.end_time,
      coach: coach ? coach.full_name : null,
      amount: saved.amount,
      currency: saved.currency,
      contactName: saved.contact_name,
    },
  });
}));

/**
 * Look a booking up by its reference. The reference is the credential, which
 * is why nothing sensitive is stored against a booking in the first place.
 */
router.get('/booking/:reference', asyncHandler(async (req, res) => {
  const row = db
    .prepare(`SELECT b.*, f.name AS facility_name, f.location_note, s.name AS sport_name, c.full_name AS coach_name
              FROM bookings b JOIN facilities f ON f.id = b.facility_id
              LEFT JOIN sports s ON s.id = b.sport_id LEFT JOIN coaches c ON c.id = b.coach_id
              WHERE b.reference = ?`)
    .get(String(req.params.reference).toUpperCase());
  if (!row) throw new ApiError(404, 'No booking found with that reference.');

  res.json({
    booking: {
      reference: row.reference,
      facility: row.facility_name,
      where: row.location_note,
      sport: row.sport_name,
      coach: row.coach_name,
      date: row.booking_date,
      start: row.start_time,
      end: row.end_time,
      status: row.status,
      contactName: row.contact_name,
      amount: row.amount,
      currency: row.currency,
    },
  });
}));

/** Cancel with the reference and the contact it was made with. */
router.post('/booking/:reference/cancel', asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM bookings WHERE reference = ?').get(String(req.params.reference).toUpperCase());
  if (!row) throw new ApiError(404, 'No booking found with that reference.');
  if (row.status === 'cancelled') throw new ApiError(409, 'That booking is already cancelled.');

  const body = z.object({
    contact: z.string().min(3, 'Confirm the phone or email the booking was made with'),
    reason: z.string().max(300).optional().nullable(),
  }).parse(req.body);

  const matches = req.user
    || [row.contact_phone, row.contact_email]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().replace(/\s/g, '') === body.contact.toLowerCase().replace(/\s/g, ''));
  if (!matches) throw new ApiError(403, 'That does not match the contact the booking was made with.');

  db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now'),
              cancel_reason = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(body.reason ?? null, row.id);

  audit(req, { action: 'update', entity: 'bookings', entityId: row.id, summary: `Booking ${row.reference} cancelled` });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Staff view                                                          */
/* ------------------------------------------------------------------ */

router.get('/bookings', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.date) { where.push('b.booking_date = ?'); params.push(req.query.date); }
  if (req.query.from) { where.push('b.booking_date >= ?'); params.push(req.query.from); }
  if (req.query.facility) { where.push('b.facility_id = ?'); params.push(Number(req.query.facility)); }
  if (req.query.status) { where.push('b.status = ?'); params.push(req.query.status); }

  const bookings = db
    .prepare(`SELECT b.*, f.name AS facility_name, s.name AS sport_name, c.full_name AS coach_name
              FROM bookings b JOIN facilities f ON f.id = b.facility_id
              LEFT JOIN sports s ON s.id = b.sport_id LEFT JOIN coaches c ON c.id = b.coach_id
              WHERE ${where.join(' AND ')}
              ORDER BY b.booking_date DESC, b.start_minute LIMIT 300`)
    .all(...params);

  res.json({
    bookings,
    total: bookings.length,
    upcoming: bookings.filter((b) => b.status === 'confirmed' && b.booking_date >= new Date().toISOString().slice(0, 10)).length,
  });
});

router.put('/bookings/:id', requirePermission('matches.write'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!row) throw new ApiError(404, 'That booking does not exist.');
  const body = z.object({
    status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).optional(),
    notes: z.string().optional().nullable(),
    cancel_reason: z.string().optional().nullable(),
  }).parse(req.body);

  const sets = Object.keys(body).map((k) => `${k} = ?`);
  if (sets.length) {
    db.prepare(`UPDATE bookings SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(body), row.id);
  }
  audit(req, { action: 'update', entity: 'bookings', entityId: row.id, summary: `Booking ${row.reference} updated` });
  res.json({ ok: true });
}));

module.exports = router;
module.exports.toMinute = toMinute;
