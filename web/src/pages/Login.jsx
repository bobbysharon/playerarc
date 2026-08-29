import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { DEMO_MODE } from '../lib/api';
import { ErrorNote, Field } from '../components/ui';

const DEMO_ACCOUNTS = [
  ['admin@karwansc.com', 'Super Admin — everything'],
  ['director@karwansc.com', 'Sports Director — all sports'],
  ['cricket.admin@karwansc.com', 'Sport Administrator — cricket only'],
  ['coach.cricket@karwansc.com', 'Coach — assigned teams only'],
  ['stats@karwansc.com', 'Statistician — match records'],
  ['player@karwansc.com', 'Player — own record'],
  ['parent@karwansc.com', 'Parent — linked child'],
];

export default function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('admin@karwansc.com');
  const [password, setPassword] = useState('Karwan@2026');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from?.pathname || '/'} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* The thesis panel: one athlete, every sport, the whole journey. */}
      <div className="relative overflow-hidden px-8 sm:px-12 py-12 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-line">
        <span className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-gold/20 blur-3xl" />
        <span className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-violet/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <span className="h-11 w-11 rounded-xl bg-gold-grad grid place-items-center font-display text-[#1A1206] text-2xl leading-none shadow-glow">P</span>
          <div>
            <p className="font-display text-2xl leading-none bg-gold-grad bg-clip-text text-transparent">PlayerArc</p>
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-400">Karwan Sports Club</p>
          </div>
        </div>

        <div className="relative py-12">
          <h1 className="font-display text-5xl sm:text-6xl leading-[0.95] max-w-md text-ink">
            One athlete.<br />
            <span className="bg-gold-grad bg-clip-text text-transparent">Every sport.</span><br />
            The whole journey.
          </h1>
          <p className="text-ink-400 mt-6 max-w-md text-sm leading-relaxed">
            Every player carries one permanent record — through cricket and football, from the U16 academy
            to the senior side, across every match, training session, assessment and award.
          </p>
          <ol className="mt-8 flex flex-wrap gap-x-2 gap-y-2 text-[11px] uppercase tracking-wider text-ink-400">
            {['Player', 'Sports', 'Teams', 'Training', 'Matches', 'Performance', 'Assessment', 'Timeline'].map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                {i > 0 && <span className="text-gold">→</span>}
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="relative text-[11px] text-ink-200">Athlete records &amp; performance management</p>
      </div>

      {/* Sign in */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-3xl">Sign in</h2>
          <p className="text-sm text-ink-400 mt-1">
            {DEMO_MODE ? 'Pick any account below to explore the platform.' : 'Use your Karwan Sports Club account.'}
          </p>

          {DEMO_MODE && (
            <div className="mt-4 rounded-lg border border-gold/30 bg-gold/10 px-3.5 py-3 text-xs text-gold">
              <p className="font-semibold mb-1">This is a browser demonstration.</p>
              <p>
                Everything runs in this page — the full interface, the seeded club, real career
                statistics and role permissions. Changes you make are kept until you reload, and
                sign-in is not secured. Run PlayerArc locally for the real server, database and
                Excel and PDF reports.
              </p>
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Email">
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            </Field>
            <Field label="Password">
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </Field>
            <ErrorNote error={error} />
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-8 card p-4">
            <p className="label mb-2">Demonstration accounts</p>
            <p className="text-xs text-ink-400 mb-3">Password for all: <span className="font-mono">Karwan@2026</span>. Each role sees a different slice of the club.</p>
            <ul className="space-y-1">
              {DEMO_ACCOUNTS.map(([addr, note]) => (
                <li key={addr}>
                  <button
                    type="button"
                    onClick={() => { setEmail(addr); setPassword('Karwan@2026'); }}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-white/5 group transition-colors"
                  >
                    <span className="font-mono text-[11px] text-ink block group-hover:text-gold transition-colors">{addr}</span>
                    <span className="text-[11px] text-ink-400">{note}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
