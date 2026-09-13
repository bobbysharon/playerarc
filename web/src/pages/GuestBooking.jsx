import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, CalendarDays, Clock, MapPin, Check, ChevronLeft, Award, Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { ErrorNote, Spinner, Field } from '../components/ui';
import { titleCase } from '../lib/format';

/**
 * Booking a ground, without an account.
 *
 * Nothing about an athlete is asked for. A name and one way to reach the
 * person is the whole of it, because that is all the club needs to hold a
 * slot — and asking for more would mean storing information with no purpose.
 *
 * Coaches are shown as cards rather than a dropdown: which coach to book comes
 * down to what they specialise in and how long they have done it, and a list
 * of names carries neither.
 */
export default function GuestBooking() {
  const [step, setStep] = useState(1);
  const [sports, setSports] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(null);

  const today = new Date().toISOString().slice(0, 10);
  const [choice, setChoice] = useState({
    sport: null, facility: null, date: today, slot: null, coach: null,
    contact_name: '', contact_phone: '', contact_email: '', party_size: '', notes: '',
  });

  // The booking list, not the full sports configuration — that needs a
  // sign-in and carries nothing a booking form can use.
  useEffect(() => {
    api.get('/booking/sports').then((d) => setSports(d.sports)).catch(setError);
  }, []);

  // Grounds are filtered by the chosen sport, so a cricket square never
  // appears as an option for badminton.
  useEffect(() => {
    if (!choice.sport) return;
    api.get(`/facilities?sport=${choice.sport.id}`).then((d) => setFacilities(d.facilities)).catch(setError);
    api.get(`/booking/coaches?sport=${choice.sport.id}`).then((d) => setCoaches(d.coaches)).catch(() => setCoaches([]));
  }, [choice.sport]);

  const loadSlots = useCallback(() => {
    if (!choice.facility || !choice.date) return;
    setSlots(null);
    api.get(`/booking/availability?facility=${choice.facility.id}&date=${choice.date}`)
      .then(setSlots)
      .catch(setError);
  }, [choice.facility, choice.date]);

  useEffect(() => { if (step === 3) loadSlots(); }, [step, loadSlots]);

  const back = () => { setError(null); setStep((s) => Math.max(1, s - 1)); };
  const go = (n) => { setError(null); setStep(n); };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/booking', {
        facility_id: choice.facility.id,
        sport_id: choice.sport?.id ?? null,
        coach_id: choice.coach?.coachId ?? null,
        booking_date: choice.date,
        start_time: choice.slot.start,
        end_time: choice.slot.end,
        contact_name: choice.contact_name.trim(),
        contact_phone: choice.contact_phone.trim() || null,
        contact_email: choice.contact_email.trim() || null,
        party_size: choice.party_size === '' ? null : Number(choice.party_size),
        notes: choice.notes.trim() || null,
      });
      setConfirmed(r.booking);
    } catch (err) {
      setError(err);
      // A slot taken while the form was open is worth re-reading, not just
      // reporting.
      if (err?.status === 409) { setStep(3); loadSlots(); }
    } finally {
      setBusy(false);
    }
  }

  if (confirmed) return <Confirmation booking={confirmed} />;

  const STEPS = ['Sport', 'Ground', 'Date & time', 'Coach', 'Your details'];

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <header className="text-center mb-7">
          <div className="flex items-center justify-center gap-2.5">
            <Shield size={22} className="text-sky" />
            <h1 className="font-display text-2xl text-ink">Karwan Sports Club</h1>
          </div>
          <p className="text-sm text-ink-400 mt-1">Book a ground — no account needed</p>
        </header>

        {/* Progress */}
        <ol className="flex items-center justify-center gap-1.5 mb-6">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const done = step > n;
            const current = step === n;
            return (
              <li key={label} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => n < step && go(n)}
                  disabled={n >= step}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
                    current ? 'bg-gold-grad text-[#1A1206] font-semibold'
                      : done ? 'text-pitch hover:bg-white/5' : 'text-ink-200'
                  }`}
                >
                  <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                    current ? 'bg-[#1A1206]/20' : done ? 'bg-pitch/20' : 'bg-white/5'
                  }`}>
                    {done ? <Check size={10} /> : n}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
                {n < STEPS.length && <span className="h-px w-3 bg-line" />}
              </li>
            );
          })}
        </ol>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-lift">
          {step > 1 && (
            <button type="button" className="btn-quiet text-xs mb-4" onClick={back}>
              <ChevronLeft size={14} /> Back
            </button>
          )}

          <ErrorNote error={error} />

          {/* 1 — Sport */}
          {step === 1 && (
            <>
              <h2 className="font-display text-xl mb-1">What are you playing?</h2>
              <p className="text-sm text-ink-400 mb-4">Only grounds suited to that sport are offered.</p>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {sports.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setChoice({ ...choice, sport: s, facility: null, coach: null, slot: null }); go(2); }}
                    className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-left hover:border-gold/50 hover:-translate-y-0.5 transition-all"
                  >
                    <span className="h-8 w-1.5 rounded-full" style={{ background: s.color }} />
                    <span className="font-display text-lg text-ink">{s.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 2 — Ground */}
          {step === 2 && (
            <>
              <h2 className="font-display text-xl mb-1">Which ground?</h2>
              <p className="text-sm text-ink-400 mb-4">{choice.sport.name} · {facilities.length} available</p>
              {facilities.length === 0 ? (
                <p className="text-sm text-ink-400 py-6 text-center">
                  No bookable ground is set up for {choice.sport.name} yet. Please contact the club.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {facilities.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => { setChoice({ ...choice, facility: f, slot: null }); go(3); }}
                      className="w-full rounded-xl border border-line px-4 py-3.5 text-left hover:border-gold/50 hover:-translate-y-0.5 transition-all"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="font-display text-lg text-ink block">{f.name}</span>
                          <span className="text-xs text-ink-400 block mt-0.5">{f.description}</span>
                          <span className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-ink-400">
                            <span className="flex items-center gap-1"><MapPin size={11} />{titleCase(f.kind)}</span>
                            <span className="flex items-center gap-1"><Clock size={11} />{f.opens_at}–{f.closes_at}</span>
                            {f.capacity && <span className="flex items-center gap-1"><Users size={11} />{f.capacity}</span>}
                          </span>
                        </span>
                        {f.hourly_rate && (
                          <span className="shrink-0 text-right">
                            <span className="stat-value text-lg block">{f.currency} {f.hourly_rate}</span>
                            <span className="text-[10px] text-ink-400">per hour</span>
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* 3 — Date and time */}
          {step === 3 && (
            <>
              <h2 className="font-display text-xl mb-1">When?</h2>
              <p className="text-sm text-ink-400 mb-4">{choice.facility.name}</p>

              <Field label="Date">
                <input
                  className="input"
                  type="date"
                  min={today}
                  value={choice.date}
                  onChange={(e) => setChoice({ ...choice, date: e.target.value, slot: null })}
                />
              </Field>

              <div className="mt-4">
                {!slots ? <Spinner label="Checking what is free" /> : (
                  <>
                    <p className="label mb-2">
                      {slots.available} of {slots.slots.length} slots free
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {slots.slots.map((s) => (
                        <button
                          key={s.start}
                          type="button"
                          disabled={!s.available}
                          title={s.reason || undefined}
                          onClick={() => { setChoice({ ...choice, slot: s }); go(4); }}
                          className={`rounded-lg border px-2 py-2.5 text-center transition-all ${
                            s.available
                              ? 'border-line hover:border-gold/60 hover:-translate-y-0.5'
                              : 'border-line/50 opacity-40 cursor-not-allowed'
                          }`}
                        >
                          <span className="font-mono text-sm text-ink block">{s.start}</span>
                          <span className="text-[10px] text-ink-400">
                            {s.available ? `to ${s.end}` : s.reason}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-ink-400 mt-3">
                      Slots the club is already using for a fixture or a training session are shown as taken.
                    </p>
                  </>
                )}
              </div>
            </>
          )}

          {/* 4 — Coach */}
          {step === 4 && (
            <>
              <h2 className="font-display text-xl mb-1">Would you like a coach?</h2>
              <p className="text-sm text-ink-400 mb-4">Optional — skip if you are just booking the ground.</p>

              <div className="grid sm:grid-cols-2 gap-3">
                {coaches.map((c) => {
                  const chosen = choice.coach?.specialityId === c.specialityId;
                  return (
                    <button
                      key={c.specialityId}
                      type="button"
                      onClick={() => setChoice({ ...choice, coach: chosen ? null : c })}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        chosen ? 'border-gold/60 bg-gold/10 shadow-glow-sm' : 'border-line hover:border-line-bright hover:-translate-y-0.5'
                      }`}
                    >
                      <span className="flex items-start gap-3">
                        {c.photoUrl ? (
                          <img src={c.photoUrl} alt="" className="h-14 w-14 rounded-xl object-cover shrink-0" />
                        ) : (
                          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gold-grad font-display text-xl text-[#1A1206]">
                            {c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="font-display text-lg text-ink block truncate">{c.name}</span>
                          <span className="text-sm text-gold block truncate">{c.speciality}</span>
                          <span className="flex items-center gap-1 text-[11px] text-ink-400 mt-1">
                            <Award size={11} />
                            {c.yearsExperience} year{c.yearsExperience === 1 ? '' : 's'} in this speciality
                          </span>
                        </span>
                        {chosen && <Check size={18} className="text-gold shrink-0" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              {coaches.length === 0 && (
                <p className="text-sm text-ink-400 py-4 text-center">No coach is bookable for this sport.</p>
              )}

              <div className="flex justify-end gap-2 mt-5">
                <button type="button" className="btn-ghost" onClick={() => { setChoice({ ...choice, coach: null }); go(5); }}>
                  No coach, thanks
                </button>
                <button type="button" className="btn-gold" disabled={!choice.coach} onClick={() => go(5)}>
                  Continue
                </button>
              </div>
            </>
          )}

          {/* 5 — Contact */}
          {step === 5 && (
            <>
              <h2 className="font-display text-xl mb-1">Who is the booking for?</h2>
              <p className="text-sm text-ink-400 mb-4">
                A name and one way to reach you. Nothing else is needed or kept.
              </p>

              <Summary choice={choice} />

              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                <Field label="Name" className="sm:col-span-2">
                  <input className="input" value={choice.contact_name}
                    onChange={(e) => setChoice({ ...choice, contact_name: e.target.value })} />
                </Field>
                <Field label="Phone">
                  <input className="input" value={choice.contact_phone}
                    onChange={(e) => setChoice({ ...choice, contact_phone: e.target.value })} placeholder="+971 50 000 0000" />
                </Field>
                <Field label="Email">
                  <input className="input" type="email" value={choice.contact_email}
                    onChange={(e) => setChoice({ ...choice, contact_email: e.target.value })} placeholder="name@email.com" />
                </Field>
                <Field label="How many playing?">
                  <input className="input font-mono" type="number" min="1" max="60" value={choice.party_size}
                    onChange={(e) => setChoice({ ...choice, party_size: e.target.value })} />
                </Field>
                <Field label="Anything the club should know?" className="sm:col-span-2">
                  <textarea className="input" rows={2} value={choice.notes}
                    onChange={(e) => setChoice({ ...choice, notes: e.target.value })} />
                </Field>
              </div>

              {(() => {
                const blocking = !choice.contact_name.trim()
                  ? 'Give a name for the booking.'
                  : !choice.contact_phone.trim() && !choice.contact_email.trim()
                    ? 'Leave a phone number or an email so the club can reach you.'
                    : null;
                return (
                  <>
                    {blocking && <p className="text-xs text-gold text-right mt-3">{blocking}</p>}
                    <button
                      type="button"
                      className="btn-gold w-full justify-center py-2.5 mt-3"
                      disabled={busy || !!blocking}
                      onClick={submit}
                    >
                      {busy ? 'Confirming…' : 'Confirm booking'}
                    </button>
                  </>
                );
              })()}
            </>
          )}
        </div>

        <p className="text-center text-sm text-ink-400 mt-5">
          Club member? <Link to="/login" className="link">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function Summary({ choice }) {
  return (
    <dl className="rounded-xl border border-line bg-surface-sunken px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
      {[
        ['Sport', choice.sport?.name],
        ['Ground', choice.facility?.name],
        ['Date', choice.date],
        ['Time', choice.slot ? `${choice.slot.start} – ${choice.slot.end}` : null],
        ['Coach', choice.coach ? `${choice.coach.name} · ${choice.coach.speciality}` : 'None'],
        ['Cost', choice.facility?.hourly_rate ? `${choice.facility.currency} ${choice.facility.hourly_rate}` : '—'],
      ].filter(([, v]) => v).map(([label, value]) => (
        <div key={label}>
          <dt className="label">{label}</dt>
          <dd className="text-sm text-ink-700 mt-0.5">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Confirmation({ booking }) {
  return (
    <div className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-pitch/40 bg-pitch/10">
          <Check size={30} className="text-pitch" />
        </span>
        <h1 className="font-display text-3xl text-ink">Booked</h1>
        <p className="text-sm text-ink-400 mt-1.5">
          Keep this reference — it is how you look the booking up or cancel it.
        </p>

        <p className="my-5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 font-mono text-2xl text-gold">
          {booking.reference}
        </p>

        <dl className="rounded-xl border border-line bg-surface px-4 py-3.5 text-left space-y-2.5">
          {[
            ['Ground', booking.facility],
            ['Date', booking.date],
            ['Time', `${booking.start} – ${booking.end}`],
            ['Coach', booking.coach],
            ['Booked by', booking.contactName],
            ['Cost', booking.amount ? `${booking.currency} ${booking.amount}` : null],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-sm text-ink-400">{label}</dt>
              <dd className="text-sm text-ink text-right">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex justify-center gap-2 mt-6">
          <Link to="/book" className="btn-gold"><CalendarDays size={15} /> Book another</Link>
          <Link to="/login" className="btn-ghost">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
