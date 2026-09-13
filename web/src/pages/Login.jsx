import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Shield, CalendarDays, Eye, EyeOff } from 'lucide-react';
import { api, setToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorNote } from '../components/ui';

/**
 * The sign-in screen.
 *
 * One card, centred, and nothing else on the page. Two audiences arrive here
 * and they are kept apart deliberately: an athlete login is not a staff
 * account, lives in its own table and opens only that athlete's own record, so
 * the two are separate sign-ins rather than one form that guesses.
 *
 * Booking a ground needs no account at all, which is why it sits below the
 * divider as its own route rather than behind the form.
 */
export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState('athlete');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(null);

  const from = location.state?.from?.pathname || '/';

  function switchMode(next) {
    setMode(next);
    setError(null);
    setHint(null);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setHint(null);

    if (!identifier.trim() || !password) {
      setError({ message: 'Enter your email and password.' });
      return;
    }

    setBusy(true);
    try {
      if (mode === 'staff') {
        await signIn(identifier.trim(), password);
        navigate(from, { replace: true });
      } else {
        const r = await api.post('/athlete/login', { email: identifier.trim(), password });
        setToken(r.token);
        window.localStorage.setItem('playerarc.portal', 'athlete');
        navigate('/my', { replace: true });
      }
    } catch (err) {
      setError(err);
      // A staff address typed into the athlete form is a common mistake and
      // worth naming rather than leaving as "incorrect".
      if (err?.status === 401 && mode === 'athlete') {
        setHint('Coaches and club staff should use the Staff tab.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Club */}
        <div className="text-center mb-7">
          <div className="flex items-center justify-center gap-2.5">
            <Shield size={22} className="text-sky" />
            <h1 className="font-display text-2xl text-ink">Karwan Sports Club</h1>
          </div>
          <p className="text-sm text-ink-400 mt-1">
            {mode === 'athlete' ? 'Athlete login' : 'Staff login'}
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-lift">
          {/* Who is signing in */}
          <div
            role="tablist"
            aria-label="Choose the kind of account"
            className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-sunken p-1 mb-5"
          >
            {[['athlete', 'Athlete'], ['staff', 'Staff']].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={mode === key}
                onClick={() => switchMode(key)}
                className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode === key ? 'bg-ink text-canvas' : 'text-ink-400 hover:text-ink-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium text-ink-700 mb-1.5">
                Email or phone
              </label>
              <input
                id="identifier"
                className="input"
                type="text"
                autoComplete="username"
                placeholder="name@email.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  className="input pr-10"
                  type={reveal ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-gold"
                  onClick={() => setReveal(!reveal)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                >
                  {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="text-right">
              <button
                type="button"
                className="text-sm text-sky hover:underline"
                onClick={() => setHint('Passwords are reset by the club — ask a coach or the club office to issue you a new one.')}
              >
                Forgot password?
              </button>
            </div>

            <ErrorNote error={error} />
            {hint && <p className="text-xs text-ink-400">{hint}</p>}

            <button type="submit" className="btn-gold w-full justify-center py-2.5" disabled={busy}>
              {busy ? 'Signing in…' : 'Log in'}
            </button>
          </form>

          {/* Booking needs no account */}
          <div className="relative my-5">
            <span className="absolute inset-0 flex items-center" aria-hidden="true">
              <span className="w-full border-t border-line" />
            </span>
            <span className="relative flex justify-center">
              <span className="bg-surface px-3 text-xs text-ink-400">Booking a ground? No login needed.</span>
            </span>
          </div>

          <Link to="/book" className="btn-ghost w-full justify-center py-2.5">
            <CalendarDays size={16} /> Book now as a guest
          </Link>
        </div>
      </div>
    </div>
  );
}
