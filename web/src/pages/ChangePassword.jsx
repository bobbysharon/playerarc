import { useState } from 'react';
import { KeyRound, Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorNote, Field } from '../components/ui';

/**
 * Shown instead of the app when an administrator has issued a password and
 * flagged it to be changed. There is no way past it other than choosing a new
 * password, which is the point: a password that was read aloud or sent in a
 * message stops working the moment the person sets their own.
 */
export default function ChangePassword() {
  const { user, refresh, signOut } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (form.newPassword.length < 8) {
      setError({ message: 'Use at least 8 characters.' });
      return;
    }
    if (form.newPassword !== form.confirm) {
      setError({ message: 'The two new passwords do not match.' });
      return;
    }
    if (form.newPassword === form.currentPassword) {
      setError({ message: 'Choose something different from the password you were given.' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <span className="h-11 w-11 rounded-xl bg-gold-grad grid place-items-center text-[#1A1206] shadow-glow">
            <KeyRound size={20} />
          </span>
          <div>
            <p className="font-display text-2xl leading-none text-ink">Choose a password</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-ink-400">{user?.email}</p>
          </div>
        </div>

        <p className="text-sm text-ink-400 mb-5">
          An administrator issued the password you just used. Pick your own to carry on — nobody else will know it.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <Field label="The password you were given">
            <input
              className="input"
              type="password"
              required
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              autoComplete="current-password"
            />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <div className="relative">
              <input
                className="input pr-10"
                type={reveal ? 'text' : 'password'}
                required
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-gold"
                onClick={() => setReveal(!reveal)}
                aria-label={reveal ? 'Hide password' : 'Show password'}
              >
                {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>
          <Field label="Confirm new password">
            <input
              className="input"
              type="password"
              required
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              autoComplete="new-password"
            />
          </Field>

          <ErrorNote error={error} />
          <button type="submit" className="btn-gold w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Set my password'}
          </button>
          <button type="button" className="btn-quiet w-full" onClick={signOut}>
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
}
