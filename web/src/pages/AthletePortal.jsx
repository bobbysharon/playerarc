import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, LogOut, Trophy, CalendarDays, Dumbbell, KeyRound, Users, MapPin,
} from 'lucide-react';
import { api, setToken } from '../lib/api';
import { Spinner, ErrorNote, Chip, StatTile, Field, Modal } from '../components/ui';
import { formatDate, formatDateTime, titleCase } from '../lib/format';

/**
 * The athlete portal: one athlete's own record, and nothing else.
 *
 * It sits outside the staff shell on purpose. There is no navigation to the
 * roster, to other athletes or to any club screen, because an athlete login
 * cannot reach those routes anyway — the page matches what the credential can
 * actually do rather than offering links that would fail.
 */
export default function AthletePortal() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('record');
  const [changing, setChanging] = useState(false);

  const load = useCallback(() => {
    api.get('/athlete/me')
      .then((d) => {
        setProfile(d.athlete);
        // An issued password has to be replaced before anything is shown.
        if (d.athlete.mustChangePassword) setChanging(true);
      })
      .catch(() => {
        // Not an athlete session — send them back to sign in rather than
        // showing an error for a page they should not be on.
        setToken(null);
        window.localStorage.removeItem('playerarc.portal');
        navigate('/login', { replace: true });
      });
    api.get('/athlete/record').then(setData).catch(setError);
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  function signOut() {
    setToken(null);
    window.localStorage.removeItem('playerarc.portal');
    navigate('/login', { replace: true });
  }

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-sm text-center">
          <ErrorNote error={error} />
          <button type="button" className="btn-ghost mt-4" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  if (!data || !profile) return <div className="min-h-screen grid place-items-center"><Spinner label="Loading your record" /></div>;

  const { athlete, summary, careers, teams, upcoming, sessions, achievements, timeline } = data;
  const current = teams.filter((t) => !t.end_date);

  const TABS = [
    ['record', 'My record'],
    ['fixtures', `Coming up${upcoming.length ? ` (${upcoming.length})` : ''}`],
    ['training', 'Training'],
    ['honours', `Honours${achievements.length ? ` (${achievements.length})` : ''}`],
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto max-w-4xl px-5 py-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 min-w-0">
            <Shield size={20} className="text-sky shrink-0" />
            <span className="min-w-0">
              <span className="font-display text-lg text-ink block truncate">Karwan Sports Club</span>
              <span className="text-[11px] text-ink-400">Athlete portal</span>
            </span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <button type="button" className="btn-quiet text-xs" onClick={() => setChanging(true)}>
              <KeyRound size={13} /> Password
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={signOut}>
              <LogOut size={13} /> Sign out
            </button>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-6">
        {/* Who they are */}
        <div className="flex flex-wrap items-center gap-5 mb-6">
          {athlete.photoUrl ? (
            <img src={athlete.photoUrl} alt="" className="h-20 w-20 rounded-2xl object-cover" />
          ) : (
            <span className="grid h-20 w-20 place-items-center rounded-2xl bg-gold-grad font-display text-3xl text-[#1A1206]">
              {athlete.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </span>
          )}
          <div className="min-w-0">
            <p className="font-mono text-xs text-gold">{athlete.athleteId}</p>
            <h1 className="font-display text-3xl text-ink leading-none mt-1">{athlete.name}</h1>
            <div className="flex flex-wrap gap-2 mt-2.5">
              <Chip tone={athlete.status === 'active' ? 'active' : 'inactive'}>{titleCase(athlete.status)}</Chip>
              {current.map((t) => <Chip key={t.id} tone="scheduled">{t.name}</Chip>)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
          <StatTile label="Matches" value={summary.matches} tone="gold" />
          <StatTile label="Wins" value={summary.wins} hint={`${summary.winRate}%`} tone="pitch" />
          <StatTile label="Sports" value={summary.sports} tone="sky" />
          <StatTile label="Awards" value={summary.awards} tone="violet" icon={Trophy} />
          <StatTile label="Tournaments" value={summary.tournaments} tone="ink" />
          <StatTile label="Rating" value={summary.rating ?? '—'} tone="gold" />
        </div>

        <div className="flex gap-1.5 overflow-x-auto scroll-thin border-b border-line mb-5">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`shrink-0 border-b-2 px-3.5 py-2.5 text-sm transition-colors ${
                tab === key ? 'border-gold text-gold' : 'border-transparent text-ink-400 hover:text-ink-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'record' && (
          <div className="space-y-5">
            {careers.filter((c) => c.matchesPlayed > 0).map((c) => (
              <section key={c.sport.id} className="card p-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="h-5 w-1 rounded-full" style={{ background: c.sport.color }} />
                  <h2 className="font-display text-xl text-ink">{c.sport.name}</h2>
                  <span className="text-sm text-ink-400">{c.matchesPlayed} appearances</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-line rounded-lg overflow-hidden border border-line">
                  {c.headline.map((h) => (
                    <div key={h.key} className="bg-surface px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-ink-400 truncate">{h.label}</p>
                      <p className="stat-value text-lg mt-0.5">{h.display}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {teams.length > 0 && (
              <section className="card p-4">
                <h2 className="font-display text-xl text-ink mb-3 flex items-center gap-2">
                  <Users size={18} className="text-sky" /> My squads
                </h2>
                <ul className="space-y-2">
                  {teams.map((t, i) => (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="text-sm text-ink block truncate">{t.name}</span>
                        <span className="text-xs text-ink-400">
                          {[t.sport_name, t.age_group, t.role !== 'player' ? titleCase(t.role) : null,
                            t.jersey_number ? `#${t.jersey_number}` : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-ink-400 shrink-0">
                        {formatDate(t.start_date)} → {t.end_date ? formatDate(t.end_date) : 'present'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {timeline.length > 0 && (
              <section className="card p-4">
                <h2 className="font-display text-xl text-ink mb-3">My journey</h2>
                <ol className="relative ml-3 border-l-2 border-line">
                  {timeline.slice(0, 15).map((t, i) => (
                    <li key={i} className="relative pl-6 pb-4">
                      <span className={`absolute -left-[9px] top-1 h-4 w-4 rounded-full ${t.importance === 3 ? 'bg-gold-grad' : 'bg-surface-raised border border-line'}`} />
                      <p className="font-mono text-[11px] text-ink-400">{t.event_date}</p>
                      <p className="text-sm text-ink">{t.title}</p>
                      {t.description && <p className="text-xs text-ink-400 mt-0.5">{t.description}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}

        {tab === 'fixtures' && (
          <section className="card p-4">
            <h2 className="font-display text-xl text-ink mb-3 flex items-center gap-2">
              <CalendarDays size={18} className="text-gold" /> Coming up
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-400 py-6 text-center">Nothing scheduled at the moment.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((m) => (
                  <li key={m.id} className="rounded-lg border border-line px-3.5 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-ink">{m.team_name || 'Karwan'} vs {m.opponent_name || 'Opposition'}</p>
                        <p className="text-xs text-ink-400 mt-0.5 flex items-center gap-1.5">
                          {m.sport_name}{m.venue && <><MapPin size={11} />{m.venue}</>}
                        </p>
                      </div>
                      <p className="font-mono text-[11px] text-gold shrink-0">{formatDateTime(m.scheduled_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'training' && (
          <section className="card p-4">
            <h2 className="font-display text-xl text-ink mb-3 flex items-center gap-2">
              <Dumbbell size={18} className="text-pitch" /> Training
            </h2>
            {sessions.length === 0 ? (
              <p className="text-sm text-ink-400 py-6 text-center">No training recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3.5 py-2.5">
                    <span className="min-w-0">
                      <span className="text-sm text-ink block truncate">{s.title || titleCase(s.training_type)}</span>
                      <span className="text-xs text-ink-400">
                        {[s.sport_name, s.location, s.start_time].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <Chip tone={s.status === 'present' ? 'active' : s.status === 'absent' ? 'absent' : 'trial'}>
                        {titleCase(s.status)}
                      </Chip>
                      <span className="font-mono text-[11px] text-ink-400">{formatDate(s.session_date)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'honours' && (
          <section className="card p-4">
            <h2 className="font-display text-xl text-ink mb-3 flex items-center gap-2">
              <Trophy size={18} className="text-gold" /> Honours
            </h2>
            {achievements.length === 0 ? (
              <p className="text-sm text-ink-400 py-6 text-center">No awards recorded yet.</p>
            ) : (
              <ul className="grid sm:grid-cols-2 gap-2">
                {achievements.map((a, i) => (
                  <li key={i} className="rounded-lg border border-line px-3.5 py-3">
                    <p className="text-sm text-ink">{a.title}</p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      {[a.sport_name, titleCase(a.level)].filter(Boolean).join(' · ')} · {formatDate(a.awarded_date)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      <ChangePassword
        open={changing}
        required={profile.mustChangePassword}
        onClose={() => setChanging(false)}
        onDone={load}
      />
    </div>
  );
}

function ChangePassword({ open, required, onClose, onDone }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setForm({ currentPassword: '', newPassword: '', confirm: '' }); setError(null); }
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (form.newPassword.length < 8) { setError({ message: 'Use at least 8 characters.' }); return; }
    if (form.newPassword !== form.confirm) { setError({ message: 'The two new passwords do not match.' }); return; }
    setBusy(true);
    try {
      await api.post('/athlete/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      onDone();
      onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={required ? () => {} : onClose} title="Choose a password">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-400">
          {required
            ? 'The club issued the password you just used. Pick your own to carry on — nobody else will know it.'
            : 'Set a new password for your account.'}
        </p>
        <Field label={required ? 'The password you were given' : 'Current password'}>
          <input className="input" type="password" autoComplete="current-password"
            value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <input className="input" type="password" autoComplete="new-password"
            value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
        <Field label="Confirm new password">
          <input className="input" type="password" autoComplete="new-password"
            value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          {!required && <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>}
          <button type="submit" className="btn-gold" disabled={busy}>{busy ? 'Saving…' : 'Set my password'}</button>
        </div>
      </form>
    </Modal>
  );
}
