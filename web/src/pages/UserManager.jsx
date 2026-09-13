import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UserPlus, KeyRound, Trash2, Pencil, Copy, Check, ShieldAlert, Eye, EyeOff, Sparkles,
} from 'lucide-react';
import { api, DEMO_MODE } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, Chip, StatTile, Tabs, Avatar,
} from '../components/ui';
import { formatDateTime, titleCase } from '../lib/format';

export default function UserManager() {
  const { user: me, can } = useAuth();
  const [data, setData] = useState(null);
  const [sports, setSports] = useState([]);
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // user row, or 'new'
  const [passwordFor, setPasswordFor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [tab, setTab] = useState('accounts');
  const [athleteLogins, setAthleteLogins] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.get('/admin/users').then(setData).catch(setError);
    api.get('/admin/athlete-logins').then(setAthleteLogins).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
    api.get('/coaches').then((d) => setCoaches(d.coaches)).catch(() => {});
    api.get('/players?pageSize=200').then((d) => setPlayers(d.players)).catch(() => {});
  }, [load]);

  if (!can('*')) {
    return (
      <Section>
        <div className="p-10 text-center">
          <ShieldAlert size={28} className="mx-auto text-alert mb-3" />
          <p className="font-display text-xl">User management is restricted</p>
          <p className="text-sm text-ink-400 mt-1">Only a super admin can create accounts or change passwords.</p>
        </div>
      </Section>
    );
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading accounts" />;

  const byRole = {};
  data.users.forEach((u) => { byRole[u.role_name] = (byRole[u.role_name] || 0) + 1; });
  const suspended = data.users.filter((u) => u.status !== 'active').length;
  const neverSignedIn = data.users.filter((u) => !u.last_login_at).length;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="User manager"
        subtitle="Accounts, roles and the records each person can reach. Only the administrator can create, edit or delete users."
        actions={<button type="button" className="btn-gold" onClick={() => setEditing('new')}><UserPlus size={15} /> Add user</button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatTile label="Accounts" value={data.users.length} tone="gold" />
        <StatTile label="Roles in use" value={Object.keys(byRole).length} tone="violet" />
        <StatTile label="Suspended" value={suspended} tone={suspended ? 'alert' : 'ink'} />
        <StatTile label="Never signed in" value={neverSignedIn} tone="sky" />
      </div>

      <Tabs
        tabs={[
          { key: 'accounts', label: 'Accounts', count: data.users.length },
          { key: 'roles', label: 'Roles & permissions', count: data.roles.length },
          { key: 'athletes', label: 'Athlete logins', count: athleteLogins?.total },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {tab === 'athletes' && <AthleteLogins data={athleteLogins} onChanged={load} />}
        {tab === 'accounts' && (
          <Section>
            <DataTable
              columns={[
                {
                  key: 'name',
                  label: 'User',
                  render: (u) => (
                    <span className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold-grad text-[#1A1206] font-display text-sm">
                        {(u.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium block truncate">
                          {u.full_name}
                          {u.id === me.id && <span className="ml-1.5 text-[10px] text-gold">you</span>}
                        </span>
                        <span className="font-mono text-[11px] text-ink-400">{u.email}</span>
                      </span>
                    </span>
                  ),
                },
                { key: 'role_name', label: 'Role', render: (u) => <Chip tone={u.role === 'super_admin' ? 'upcoming' : 'scheduled'}>{u.role_name}</Chip> },
                {
                  key: 'scope',
                  label: 'Can reach',
                  render: (u) => {
                    const bits = [];
                    if (u.sportIds.length) bits.push(`${u.sportIds.length} sport${u.sportIds.length > 1 ? 's' : ''}`);
                    if (u.teamIds.length) bits.push(`${u.teamIds.length} team${u.teamIds.length > 1 ? 's' : ''}`);
                    if (u.players?.length) bits.push(u.players.map((p) => `${p.first_name} ${p.last_name}`).join(', '));
                    return bits.length ? bits.join(' · ') : <span className="text-ink-200">Club-wide</span>;
                  },
                },
                { key: 'coach', label: 'Staff record', render: (u) => (u.coach ? <Link to={`/coaches/${u.coach.id}`} className="link">{u.coach.full_name}</Link> : '—') },
                { key: 'last_login_at', label: 'Last sign-in', render: (u) => (u.last_login_at ? formatDateTime(u.last_login_at) : <span className="text-ink-200">Never</span>) },
                { key: 'status', label: 'Status', render: (u) => <Chip tone={u.status === 'active' ? 'active' : u.status === 'suspended' ? 'absent' : 'trial'}>{titleCase(u.status)}</Chip> },
                {
                  key: 'actions',
                  label: '',
                  align: 'right',
                  render: (u) => (
                    <span className="flex justify-end gap-1">
                      <button type="button" className="btn-quiet px-2 py-1" title="Edit" onClick={() => setEditing(u)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="btn-quiet px-2 py-1" title="Set or reset password" onClick={() => setPasswordFor(u)}>
                        <KeyRound size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn-quiet px-2 py-1 hover:text-alert disabled:opacity-40 disabled:hover:text-ink-400"
                        title={
                          u.id === me.id ? 'You cannot delete your own account'
                            : u.role === 'super_admin' ? 'The administrator account cannot be deleted'
                              : 'Delete'
                        }
                        disabled={u.id === me.id || u.role === 'super_admin'}
                        onClick={() => setConfirmDelete(u)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  ),
                },
              ]}
              rows={data.users}
              empty={{ title: 'No accounts', message: 'Add a user to give someone access.' }}
            />
          </Section>
        )}

        {tab === 'roles' && (
          <Section title="What each role can do" subtitle="Enforced by the API, not only hidden in the interface">
            <div className="p-4 grid md:grid-cols-2 gap-4">
              {data.roles.map((r) => (
                <div key={r.key} className="rounded-lg border border-line p-3.5 bg-white/[0.02]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-display text-lg text-ink">{r.name}</p>
                    <Chip tone="scheduled">{byRole[r.name] || 0} account{(byRole[r.name] || 0) === 1 ? '' : 's'}</Chip>
                  </div>
                  <p className="text-xs text-ink-400 mt-1 mb-2.5">{r.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {r.permissions.map((p) => (
                      <span key={p} className="chip bg-white/5 text-ink-400 border border-line font-mono normal-case tracking-normal">{p}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      <UserForm
        open={!!editing}
        user={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        roles={data.roles}
        sports={sports}
        teams={teams}
        players={players}
        coaches={coaches}
        onSaved={load}
      />
      <PasswordDialog user={passwordFor} onClose={() => setPasswordFor(null)} onSaved={load} />
      <DeleteDialog user={confirmDelete} onClose={() => setConfirmDelete(null)} onSaved={load} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit                                                       */
/* ------------------------------------------------------------------ */

const BLANK = {
  full_name: '', email: '', password: '', role: 'coach', phone: '', status: 'active',
  sportIds: [], teamIds: [], playerIds: [], coachId: '',
};

function UserForm({ open, user, onClose, roles, sports, teams, players, coaches, onSaved }) {
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [playerQuery, setPlayerQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setShowPassword(false);
    setPlayerQuery('');
    setForm(user
      ? {
        full_name: user.full_name, email: user.email, password: '', role: user.role,
        phone: user.phone || '', status: user.status,
        sportIds: user.sportIds || [], teamIds: user.teamIds || [],
        playerIds: user.playerIds || [], coachId: user.coach?.id || '',
      }
      : BLANK);
  }, [open, user]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggle = (key, id) => setForm({
    ...form,
    [key]: form[key].includes(id) ? form[key].filter((x) => x !== id) : [...form[key], id],
  });

  // The administrator account keeps its role. It is what guarantees somebody
  // can always get back in, so it cannot be demoted, suspended or deleted —
  // but its password and details are changed like any other account's.
  const isAdminAccount = !!user && user.role === 'super_admin';
  const role = roles.find((r) => r.key === form.role);
  const needsSports = form.role === 'sport_admin';
  const needsTeams = form.role === 'coach';
  const needsPlayers = form.role === 'player' || form.role === 'guardian';
  const needsCoach = ['coach', 'sport_admin'].includes(form.role);

  const matchedPlayers = players.filter((p) => {
    if (!playerQuery) return form.playerIds.includes(p.id);
    const q = playerQuery.toLowerCase();
    return [p.first_name, p.last_name, p.display_name, p.athlete_id]
      .some((v) => String(v || '').toLowerCase().includes(q));
  }).slice(0, 12);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        full_name: form.full_name,
        email: form.email,
        role: form.role,
        phone: form.phone || null,
        status: form.status,
        sportIds: form.sportIds,
        teamIds: form.teamIds,
        playerIds: form.playerIds,
        coachId: form.coachId ? Number(form.coachId) : null,
      };
      if (user) {
        await api.put(`/admin/users/${user.id}`, payload);
      } else {
        if (!form.password || form.password.length < 8) {
          setError({ message: 'Set a password of at least 8 characters for the new account.' });
          setBusy(false);
          return;
        }
        await api.post('/admin/users', { ...payload, password: form.password });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={user ? `Edit ${user.full_name}` : 'Add user'} wide>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <p className="label mb-2">Account</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Full name"><input className="input" required value={form.full_name} onChange={set('full_name')} /></Field>
            <Field label="Email" hint="Used to sign in"><input className="input" type="email" required value={form.email} onChange={set('email')} /></Field>
            <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
            <Field
              label="Status"
              hint={isAdminAccount ? 'The administrator account stays active' : 'Suspended accounts keep their history but cannot sign in'}
            >
              <select className="input disabled:opacity-60" value={form.status} disabled={isAdminAccount} onChange={set('status')}>
                {['active', 'suspended', 'invited'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </Field>
            {!user && (
              <Field label="Initial password" hint="At least 8 characters. You can change it any time from the key icon." className="sm:col-span-2">
                <div className="relative">
                  <input
                    className="input pr-10"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={form.password}
                    onChange={set('password')}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-gold"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>
            )}
          </div>
        </div>

        <div>
          <p className="label mb-2">Role</p>
          {isAdminAccount && (
            <p className="text-xs text-gold mb-2">
              This is the administrator account. Its role and status are fixed so the club can never be
              locked out; its password can be changed from the key icon at any time.
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              label="Role"
              hint={isAdminAccount ? 'Fixed for the administrator account' : undefined}
            >
              <select
                className="input disabled:opacity-60 disabled:cursor-not-allowed"
                value={form.role}
                disabled={isAdminAccount}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            </Field>
            {needsCoach && (
              <Field label="Link to a staff record" hint="Ties this login to a coach so their sessions and assessments are attributed">
                <select className="input" value={form.coachId} onChange={set('coachId')}>
                  <option value="">Not linked</option>
                  {coaches.map((c) => <option key={c.id} value={c.id}>{c.full_name} — {titleCase(c.role)}</option>)}
                </select>
              </Field>
            )}
          </div>
          {role && <p className="text-xs text-ink-400 mt-2">{role.description}</p>}
        </div>

        {needsSports && (
          <Field label="Sports this administrator can manage" hint="Leave empty and they will see nothing">
            <div className="flex flex-wrap gap-1.5">
              {sports.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle('sportIds', s.id)}
                  className={form.sportIds.includes(s.id) ? 'chip text-white shadow-glow-sm' : 'chip-idle'}
                  style={form.sportIds.includes(s.id) ? { background: s.color } : undefined}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        {needsTeams && (
          <Field label="Teams this coach is responsible for" hint="They see the athletes on these rosters, and no others">
            <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto scroll-thin p-0.5">
              {teams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle('teamIds', t.id)}
                  className={form.teamIds.includes(t.id) ? 'chip-active' : 'chip-idle'}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        {needsPlayers && (
          <Field
            label={form.role === 'guardian' ? 'Children linked to this guardian' : 'Athlete record for this player'}
            hint="Search by name or athlete ID, then tap to link"
          >
            <input className="input mb-2" placeholder="Search athletes" value={playerQuery} onChange={(e) => setPlayerQuery(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto scroll-thin p-0.5">
              {matchedPlayers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle('playerIds', p.id)}
                  className={form.playerIds.includes(p.id) ? 'chip-active' : 'chip-idle'}
                >
                  {p.display_name || `${p.first_name} ${p.last_name}`}
                </button>
              ))}
              {!matchedPlayers.length && <span className="text-xs text-ink-400 px-1 py-2">No athletes match that search.</span>}
            </div>
          </Field>
        )}

        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy}>{busy ? 'Saving…' : user ? 'Save changes' : 'Create account'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Password                                                            */
/* ------------------------------------------------------------------ */

function PasswordDialog({ user, onClose, onSaved }) {
  const [mode, setMode] = useState('generate');
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setMode('generate'); setPassword(''); setMustChange(true);
      setResult(null); setCopied(false); setReveal(false); setError(null);
    }
  }, [user]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { mustChange };
      if (mode === 'set') {
        if (password.length < 8) { setError({ message: 'Use at least 8 characters.' }); setBusy(false); return; }
        body.password = password;
      }
      const r = await api.post(`/admin/users/${user.id}/password`, body);
      setResult(r);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    navigator.clipboard?.writeText(result.password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Modal open={!!user} onClose={onClose} title={user ? `Password — ${user.full_name}` : ''}>
      {!user ? null : result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-pitch/30 bg-pitch/10 px-4 py-3">
            <p className="text-sm font-semibold text-pitch">Password updated.</p>
            <p className="text-xs text-pitch/80 mt-1">
              {result.mustChange
                ? `${user.full_name} will be asked to choose a new one the next time they sign in.`
                : 'They can sign in with this immediately.'}
            </p>
          </div>

          <div>
            <p className="label mb-1.5">Hand this over now — it is not shown again</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 font-mono text-sm text-gold break-all">
                {result.password}
              </code>
              <button type="button" className="btn-ghost shrink-0" onClick={copy}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
            <p className="text-xs text-ink-400 mt-2">
              Once this dialog closes the password is only stored as a hash and nobody — including you — can read it back.
            </p>
          </div>

          <div className="flex justify-end">
            <button type="button" className="btn-gold" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border border-line bg-white/[0.03] px-3.5 py-3 text-xs text-ink-400">
            <p className="font-semibold text-ink-600 mb-1">Existing passwords cannot be displayed.</p>
            <p>
              They are stored as one-way hashes, so there is nothing to read back — that is what stops a single
              database leak exposing every account. You can issue a new password instead.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('generate')}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${mode === 'generate' ? 'border-gold/60 bg-gold/10' : 'border-line hover:border-line-bright'}`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Sparkles size={14} /> Generate</span>
              <span className="text-[11px] text-ink-400 block mt-0.5">A strong one, shown once</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('set')}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${mode === 'set' ? 'border-gold/60 bg-gold/10' : 'border-line hover:border-line-bright'}`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><KeyRound size={14} /> Set my own</span>
              <span className="text-[11px] text-ink-400 block mt-0.5">Type it yourself</span>
            </button>
          </div>

          {mode === 'set' && (
            <Field label="New password" hint="At least 8 characters">
              <div className="relative">
                <input
                  className="input pr-10"
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
          )}

          <label className="flex items-start gap-2.5 text-sm text-ink-600">
            <input type="checkbox" className="mt-0.5" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
            <span>
              Require a change at next sign-in
              <span className="block text-xs text-ink-400">Recommended — the new password stops being shared the moment they set their own.</span>
            </span>
          </label>

          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-gold" disabled={busy}>{busy ? 'Working…' : mode === 'generate' ? 'Generate password' : 'Set password'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function DeleteDialog({ user, onClose, onSaved }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setError(null); }, [user]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/admin/users/${user.id}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!user} onClose={onClose} title={user ? `Delete ${user.full_name}?` : ''}>
      {user && (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            This removes the sign-in account for <span className="font-mono text-ink">{user.email}</span>. Athlete
            records, matches and anything else they entered stay exactly where they are.
          </p>
          <p className="text-sm text-ink-400">
            If they are only leaving temporarily, set the account to <strong className="text-ink">suspended</strong> instead —
            it blocks sign-in and keeps the link to their work intact.
          </p>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-danger" onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Athlete portal logins                                               */
/* ------------------------------------------------------------------ */

/**
 * Athlete logins are deliberately not staff accounts. They live in their own
 * table with no role attached, so one cannot be promoted into a coach or an
 * administrator — there is no field to change. Each opens exactly one thing:
 * that athlete's own record.
 */
function AthleteLogins({ data, onChanged }) {
  const [creating, setCreating] = useState(false);
  const [passwordFor, setPasswordFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [query, setQuery] = useState('');

  if (!data) return <Spinner label="Loading athlete logins" />;

  const rows = query
    ? data.logins.filter((l) => [l.first_name, l.last_name, l.athlete_id, l.email]
      .some((v) => String(v || '').toLowerCase().includes(query.toLowerCase())))
    : data.logins;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Athlete logins" value={data.total} tone="gold" icon={KeyRound} />
        <StatTile label="Active" value={data.logins.filter((l) => l.status === 'active').length} tone="pitch" />
        <StatTile label="Suspended" value={data.logins.filter((l) => l.status !== 'active').length} tone="alert" />
        <StatTile label="Without a login" value={data.athletesWithoutLogin.length} tone="ink" />
      </div>

      <div className="rounded-lg border border-line bg-white/[0.02] px-4 py-3">
        <p className="text-sm text-ink-600">
          These are kept apart from staff accounts on purpose. An athlete login carries no role, so it
          cannot be turned into a coach or an administrator, and it opens nothing but that athlete's own
          record — not the roster, not another athlete.
        </p>
        <p className="text-xs text-ink-400 mt-1.5">
          One login per athlete, enforced by the database. Issuing one never creates a new athlete record.
        </p>
      </div>

      <Section
        title="Athlete logins"
        subtitle={`${rows.length} shown`}
        actions={
          <>
            <input
              className="input py-1.5 text-xs w-48"
              placeholder="Search name, ID or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className="btn-gold" onClick={() => setCreating(true)}>
              <UserPlus size={15} /> Issue login
            </button>
          </>
        }
      >
        <DataTable
          columns={[
            {
              key: 'athlete', label: 'Athlete',
              render: (l) => (
                <span className="flex items-center gap-2.5">
                  <Avatar player={l} size={30} />
                  <span className="min-w-0">
                    <Link to={`/players/${l.player_id}`} className="link block truncate">
                      {l.display_name || `${l.first_name} ${l.last_name}`}
                    </Link>
                    <span className="font-mono text-[11px] text-ink-400">{l.athlete_id}</span>
                  </span>
                </span>
              ),
            },
            { key: 'email', label: 'Sign-in email', mono: true },
            {
              key: 'status', label: 'Status',
              render: (l) => <Chip tone={l.status === 'active' ? 'active' : l.status === 'suspended' ? 'absent' : 'trial'}>{titleCase(l.status)}</Chip>,
            },
            {
              key: 'must_change_password', label: 'Password',
              render: (l) => (l.must_change_password
                ? <span className="text-gold text-xs">Change at next sign-in</span>
                : <span className="text-ink-400 text-xs">Set by the athlete</span>),
            },
            {
              key: 'last_login_at', label: 'Last sign-in',
              render: (l) => (l.last_login_at ? formatDateTime(l.last_login_at) : <span className="text-ink-200">Never</span>),
            },
            {
              key: 'actions', label: '', align: 'right',
              render: (l) => (
                <span className="flex justify-end gap-1">
                  <button type="button" className="btn-quiet px-2 py-1" title="Edit email or status" onClick={() => setEditing(l)}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="btn-quiet px-2 py-1" title="Set or reset password" onClick={() => setPasswordFor(l)}>
                    <KeyRound size={14} />
                  </button>
                  <button type="button" className="btn-quiet px-2 py-1 hover:text-alert" title="Remove the login" onClick={() => setRemoving(l)}>
                    <Trash2 size={14} />
                  </button>
                </span>
              ),
            },
          ]}
          rows={rows}
          empty={{
            title: query ? 'No athlete matches that search' : 'No athlete logins yet',
            message: query ? 'Clear the search to see the rest.' : 'Issue one and that athlete can sign in to view their own record.',
            action: query ? null : <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Issue login</button>,
          }}
        />
      </Section>

      <IssueAthleteLogin open={creating} onClose={() => setCreating(false)} candidates={data.athletesWithoutLogin} onSaved={onChanged} />
      <AthletePassword login={passwordFor} onClose={() => setPasswordFor(null)} onSaved={onChanged} />
      <EditAthleteLogin login={editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      <RemoveAthleteLogin login={removing} onClose={() => setRemoving(null)} onSaved={onChanged} />
    </div>
  );
}

function IssueAthleteLogin({ open, onClose, candidates, onSaved }) {
  const [form, setForm] = useState({ player_id: '', email: '', password: '', mustChange: true });
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ player_id: '', email: '', password: '', mustChange: true });
      setQuery(''); setResult(null); setCopied(false); setError(null);
    }
  }, [open]);

  const matched = candidates.filter((p) => {
    if (!query) return false;
    const q = query.toLowerCase();
    return [p.first_name, p.last_name, p.display_name, p.athlete_id].some((v) => String(v || '').toLowerCase().includes(q));
  }).slice(0, 10);
  const chosen = candidates.find((p) => String(p.id) === String(form.player_id));

  const blocking = !form.player_id ? 'Choose the athlete this login is for.'
    : !form.email.trim() ? 'Enter the email they will sign in with.' : null;

  async function submit(e) {
    e.preventDefault();
    if (blocking) { setError({ message: blocking }); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post('/admin/athlete-logins', {
        player_id: Number(form.player_id),
        email: form.email.trim(),
        password: form.password || undefined,
        mustChange: form.mustChange,
      });
      setResult(r);
      onSaved();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Issue an athlete login">
      {result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-pitch/30 bg-pitch/10 px-4 py-3">
            <p className="text-sm font-semibold text-pitch">Login created.</p>
            <p className="text-xs text-pitch/80 mt-1">
              {result.mustChange
                ? 'They will be asked to choose their own password the first time they sign in.'
                : 'They can sign in with this straight away.'}
            </p>
          </div>
          <div>
            <p className="label mb-1.5">Hand this over now — it is not shown again</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 font-mono text-sm text-gold break-all">
                {result.password}
              </code>
              <button type="button" className="btn-ghost shrink-0"
                onClick={() => navigator.clipboard?.writeText(result.password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
            <p className="text-xs text-ink-400 mt-2">Only a hash is stored, so nobody can read it back afterwards.</p>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-gold" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-ink-400">
            The login attaches to an athlete who already exists. It never creates a new athlete record, and
            an athlete can only ever have one.
          </p>

          {chosen ? (
            <Field label="Athlete">
              <div className="flex items-center gap-2.5 rounded-lg border border-pitch/40 bg-pitch/10 px-3 py-2">
                <span className="min-w-0">
                  <span className="text-sm block truncate">{chosen.display_name || `${chosen.first_name} ${chosen.last_name}`}</span>
                  <span className="font-mono text-[11px] text-ink-400">{chosen.athlete_id}</span>
                </span>
                <button type="button" className="btn-quiet text-xs ml-auto shrink-0"
                  onClick={() => { setForm({ ...form, player_id: '' }); setQuery(''); }}>
                  Change
                </button>
              </div>
            </Field>
          ) : (
            <Field label="Athlete" hint="Only athletes without a login are listed">
              <input className="input mb-2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or athlete ID" />
              <ul className="border border-line rounded-lg max-h-40 overflow-y-auto scroll-thin divide-y divide-line">
                {matched.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="w-full text-left px-3 py-2 hover:bg-white/[0.04] flex items-center gap-2"
                      onClick={() => setForm({
                        ...form,
                        player_id: p.id,
                        email: form.email || `${p.first_name}.${p.last_name}`.toLowerCase().replace(/[^a-z.]/g, '') + '@athlete.playerarc.local',
                      })}>
                      <span className="text-sm">{p.display_name || `${p.first_name} ${p.last_name}`}</span>
                      <span className="font-mono text-[11px] text-ink-400 ml-auto">{p.athlete_id}</span>
                    </button>
                  </li>
                ))}
                {!matched.length && (
                  <li className="px-3 py-6 text-sm text-ink-400 text-center">
                    {query ? `No athlete without a login matches “${query}”.` : 'Search to find an athlete.'}
                  </li>
                )}
              </ul>
            </Field>
          )}

          <Field label="Sign-in email" hint="Must not match a staff account">
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password" hint="Leave empty and a strong one is generated">
            <input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </Field>

          <label className="flex items-start gap-2.5 text-sm text-ink-600">
            <input type="checkbox" className="mt-0.5" checked={form.mustChange} onChange={(e) => setForm({ ...form, mustChange: e.target.checked })} />
            <span>
              Require a change at first sign-in
              <span className="block text-xs text-ink-400">Recommended — the password you hand over stops working once they set their own.</span>
            </span>
          </label>

          <ErrorNote error={error} />
          {blocking && <p className="text-xs text-gold text-right">{blocking}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-gold" disabled={busy || !!blocking}>{busy ? 'Creating…' : 'Issue login'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function AthletePassword({ login, onClose, onSaved }) {
  const [mode, setMode] = useState('generate');
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (login) { setMode('generate'); setPassword(''); setMustChange(true); setResult(null); setCopied(false); setError(null); }
  }, [login]);

  async function submit(e) {
    e.preventDefault();
    if (mode === 'set' && password.length < 8) { setError({ message: 'Use at least 8 characters.' }); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/admin/athlete-logins/${login.id}/password`, {
        ...(mode === 'set' ? { password } : {}),
        mustChange,
      });
      setResult(r);
      onSaved();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={!!login} onClose={onClose} title={login ? `Password — ${login.first_name} ${login.last_name}` : ''}>
      {!login ? null : result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-pitch/30 bg-pitch/10 px-4 py-3">
            <p className="text-sm font-semibold text-pitch">Password updated.</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 font-mono text-sm text-gold break-all">{result.password}</code>
            <button type="button" className="btn-ghost shrink-0"
              onClick={() => navigator.clipboard?.writeText(result.password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>
          <p className="text-xs text-ink-400">Not shown again — only a hash is kept.</p>
          <div className="flex justify-end"><button type="button" className="btn-gold" onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border border-line bg-white/[0.03] px-3.5 py-3 text-xs text-ink-400">
            <p className="font-semibold text-ink-600 mb-1">An existing password cannot be displayed.</p>
            <p>It is stored as a one-way hash, the same as a staff account. You can issue a new one.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('generate')}
              className={`rounded-lg border px-3 py-2.5 text-left ${mode === 'generate' ? 'border-gold/60 bg-gold/10' : 'border-line'}`}>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Sparkles size={14} /> Generate</span>
              <span className="text-[11px] text-ink-400 block mt-0.5">Shown once</span>
            </button>
            <button type="button" onClick={() => setMode('set')}
              className={`rounded-lg border px-3 py-2.5 text-left ${mode === 'set' ? 'border-gold/60 bg-gold/10' : 'border-line'}`}>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><KeyRound size={14} /> Set my own</span>
              <span className="text-[11px] text-ink-400 block mt-0.5">Type it yourself</span>
            </button>
          </div>
          {mode === 'set' && (
            <Field label="New password" hint="At least 8 characters">
              <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
          )}
          <label className="flex items-start gap-2.5 text-sm text-ink-600">
            <input type="checkbox" className="mt-0.5" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
            <span>Require a change at next sign-in</span>
          </label>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-gold" disabled={busy}>{busy ? 'Working…' : mode === 'generate' ? 'Generate password' : 'Set password'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditAthleteLogin({ login, onClose, onSaved }) {
  const [form, setForm] = useState({ email: '', status: 'active' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (login) { setForm({ email: login.email, status: login.status }); setError(null); }
  }, [login]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.put(`/admin/athlete-logins/${login.id}`, form);
      onSaved(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={!!login} onClose={onClose} title={login ? `Edit — ${login.first_name} ${login.last_name}` : ''}>
      {login && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-ink-400">
            An athlete login has no role to change. Only the sign-in address and whether it is active can be
            edited here; their athlete record is edited from their profile.
          </p>
          <Field label="Sign-in email">
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Status" hint="Suspending blocks sign-in and leaves the athlete record untouched">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {['active', 'suspended', 'invited'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
            </select>
          </Field>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-gold" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RemoveAthleteLogin({ login, onClose, onSaved }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setError(null); }, [login]);

  async function remove() {
    setBusy(true); setError(null);
    try {
      await api.del(`/admin/athlete-logins/${login.id}`);
      onSaved(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={!!login} onClose={onClose} title={login ? `Remove login for ${login.first_name} ${login.last_name}?` : ''}>
      {login && (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            This removes their way of signing in. Their athlete record, statistics and history are untouched —
            only the portal access goes.
          </p>
          <p className="text-sm text-ink-400">
            If they are only away for a while, set the login to <strong className="text-ink">suspended</strong> instead.
          </p>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-danger" onClick={remove} disabled={busy}>{busy ? 'Removing…' : 'Remove login'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
