import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DEMO_MODE } from '../lib/api';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Tabs, Modal, Field, Chip } from '../components/ui';
import { formatDateTime, titleCase } from '../lib/format';

export default function Settings() {
  const { user, can } = useAuth();
  const isAdmin = can('*');
  const [tab, setTab] = useState('account');

  const tabs = [
    { key: 'account', label: 'Your account' },
    ...(isAdmin ? [{ key: 'users', label: 'Users & roles' }] : []),
    ...(can('audit.read') ? [{ key: 'audit', label: 'Audit log' }] : []),
    { key: 'roles', label: 'Permissions' },
    ...(isAdmin ? [{ key: 'data', label: 'Demo data' }] : []),
  ];

  return (
    <>
      <PageHeader eyebrow="Administration" title="Settings" subtitle="Your account, who can do what, and the record of every change made in the platform." />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mt-5">
        {tab === 'account' && <Account user={user} />}
        {tab === 'users' && <Users />}
        {tab === 'audit' && <Audit />}
        {tab === 'roles' && <RolesMatrix />}
        {tab === 'data' && <DemoData />}
      </div>
    </>
  );
}

function Account({ user }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null); setDone(false);
    if (form.newPassword !== form.confirm) {
      setError({ message: 'The new passwords do not match.' });
      return;
    }
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setDone(true);
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) { setError(err); }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Section title="Your account">
        <dl className="p-4 grid grid-cols-2 gap-4">
          {[['Name', user.fullName], ['Email', user.email], ['Role', user.roleName],
            ['Sports in scope', user.sportIds.length || 'All'], ['Teams in scope', user.teamIds.length || 'All']].map(([l, v]) => (
            <div key={l}><dt className="label">{l}</dt><dd className="text-sm mt-1">{v}</dd></div>
          ))}
        </dl>
      </Section>
      <Section title="Change password">
        {DEMO_MODE && (
          <p className="px-4 pt-4 text-sm text-ink-400">
            Passwords are stored by the server, which this browser demonstration does not have.
          </p>
        )}
        <form onSubmit={submit} className="p-4 space-y-3">
          <Field label="Current password"><input className="input" type="password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></Field>
          <Field label="New password" hint="At least 8 characters"><input className="input" type="password" required value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></Field>
          <Field label="Confirm new password"><input className="input" type="password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></Field>
          <ErrorNote error={error} />
          {done && <p className="text-sm text-pitch">Password changed.</p>}
          <button type="submit" className="btn-gold">Change password</button>
        </form>
      </Section>
    </div>
  );
}

function Users() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [sports, setSports] = useState([]);
  const [teams, setTeams] = useState([]);

  const load = useCallback(() => { api.get('/admin/users').then(setData).catch(setError); }, []);
  useEffect(() => {
    load();
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
  }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading users" />;

  return (
    <>
      <Section title="Users" subtitle="Roles decide what a person can do; scopes decide which records they can see"
        actions={<button type="button" className="btn-gold text-xs" onClick={() => setCreating(true)}>Add user</button>}>
        <DataTable
          columns={[
            { key: 'full_name', label: 'Name' },
            { key: 'email', label: 'Email', mono: true },
            { key: 'role_name', label: 'Role' },
            { key: 'scope', label: 'Scope', render: (u) => {
              const bits = [];
              if (u.sportIds.length) bits.push(`${u.sportIds.length} sport${u.sportIds.length > 1 ? 's' : ''}`);
              if (u.teamIds.length) bits.push(`${u.teamIds.length} team${u.teamIds.length > 1 ? 's' : ''}`);
              if (u.playerIds.length) bits.push(`${u.playerIds.length} athlete${u.playerIds.length > 1 ? 's' : ''}`);
              return bits.join(' · ') || 'Club-wide';
            } },
            { key: 'last_login_at', label: 'Last sign-in', render: (u) => (u.last_login_at ? formatDateTime(u.last_login_at) : 'Never') },
            { key: 'status', label: '', render: (u) => <Chip tone={u.status === 'active' ? 'active' : 'inactive'}>{titleCase(u.status)}</Chip> },
          ]}
          rows={data.users}
          empty={{ title: 'No users', message: '' }}
        />
      </Section>
      <UserForm open={creating} onClose={() => setCreating(false)} roles={data.roles} sports={sports} teams={teams} onSaved={load} />
    </>
  );
}

function UserForm({ open, onClose, roles, sports, teams, onSaved }) {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'coach', phone: '', sportIds: [], teamIds: [] });
  const [error, setError] = useState(null);
  useEffect(() => { if (open) setError(null); }, [open]);

  const toggle = (key, id) => setForm({
    ...form,
    [key]: form[key].includes(id) ? form[key].filter((x) => x !== id) : [...form[key], id],
  });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/admin/users', form);
      onSaved(); onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add user">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name"><input className="input" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Password" hint="At least 8 characters"><input className="input" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-xs text-ink-400">{roles.find((r) => r.key === form.role)?.description}</p>

        {form.role === 'sport_admin' && (
          <Field label="Sports in scope">
            <div className="flex flex-wrap gap-1.5">
              {sports.map((s) => (
                <button key={s.id} type="button" onClick={() => toggle('sportIds', s.id)}
                  className={`${form.sportIds.includes(s.id) ? 'chip-active' : 'chip-idle'}`}>
                  {s.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        {form.role === 'coach' && (
          <Field label="Teams in scope">
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto scroll-thin">
              {teams.map((t) => (
                <button key={t.id} type="button" onClick={() => toggle('teamIds', t.id)}
                  className={`${form.teamIds.includes(t.id) ? 'chip-active' : 'chip-idle'}`}>
                  {t.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Add user</button>
        </div>
      </form>
    </Modal>
  );
}

function Audit() {
  const [logs, setLogs] = useState(null);
  const [entity, setEntity] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    setLogs(null);
    api.get(`/admin/audit?limit=200${entity ? `&entity=${entity}` : ''}`).then((d) => setLogs(d.logs)).catch(setError);
  }, [entity]);

  if (error) return <ErrorNote error={error} />;

  return (
    <Section title="Audit log" subtitle="Every sign-in, change and export is recorded"
      actions={
        <select className="input py-1.5 text-xs w-40" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All records</option>
          {['players', 'matches', 'match_performances', 'teams', 'team_memberships', 'training_sessions', 'assessments', 'achievements', 'users', 'sports'].map((x) => (
            <option key={x} value={x}>{titleCase(x)}</option>
          ))}
        </select>
      }>
      {!logs ? <Spinner label="Loading audit log" /> : (
        <DataTable
          dense
          columns={[
            { key: 'created_at', label: 'When', render: (l) => formatDateTime(l.created_at) },
            { key: 'user_email', label: 'User', mono: true, render: (l) => l.user_email || 'system' },
            { key: 'action', label: 'Action', render: (l) => <Chip tone={l.action === 'delete' ? 'absent' : l.action === 'login_failed' ? 'absent' : 'active'}>{titleCase(l.action)}</Chip> },
            { key: 'entity', label: 'Record', render: (l) => `${titleCase(l.entity)}${l.entity_id ? ` #${l.entity_id}` : ''}` },
            { key: 'summary', label: 'Detail', render: (l) => l.summary || '—' },
          ]}
          rows={logs}
          empty={{ title: 'No entries', message: '' }}
        />
      )}
    </Section>
  );
}

function RolesMatrix() {
  const [roles, setRoles] = useState(null);
  useEffect(() => { api.get('/auth/roles').then((d) => setRoles(d.roles)).catch(() => {}); }, []);
  if (!roles) return <Spinner label="Loading roles" />;
  return (
    <Section title="Roles and permissions" subtitle="Permissions are enforced by the API, not only hidden in the interface">
      <div className="p-4 grid md:grid-cols-2 gap-4">
        {roles.map((r) => (
          <div key={r.key} className="border border-line rounded-lg p-3">
            <p className="font-display text-lg">{r.name}</p>
            <p className="text-xs text-ink-400 mb-2">{r.description}</p>
            <div className="flex flex-wrap gap-1">
              {r.permissions.map((p) => <span key={p} className="chip bg-canvas text-ink-600 font-mono">{p}</span>)}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DemoData() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function clear() {
    setBusy(true); setError(null);
    try {
      const d = await api.post('/admin/demo-data/clear');
      setResult(d.removed);
      setConfirming(false);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Section title="Demonstration data">
      <div className="p-4 space-y-3 max-w-2xl">
        <p className="text-sm text-ink-400">
          The sample club — athletes, teams, matches, training and assessments — is flagged as demonstration data.
          Clearing it removes only those records. Anything entered as a real record stays exactly where it is.
        </p>
        {result && (
          <div className="rounded-lg border border-pitch/30 bg-pitch/5 px-4 py-3 text-sm text-pitch">
            <p className="font-semibold">Demo data cleared.</p>
            <p>{Object.entries(result).map(([k, v]) => `${v} ${k}`).join(', ')}</p>
          </div>
        )}
        <ErrorNote error={error} />
        {confirming ? (
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn-danger" onClick={clear} disabled={busy}>
              {busy ? 'Clearing…' : 'Yes, clear demonstration data'}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-ghost" onClick={() => setConfirming(true)}>Clear demonstration data</button>
        )}
      </div>
    </Section>
  );
}
