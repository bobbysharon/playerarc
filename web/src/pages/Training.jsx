import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, DEMO_MODE } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, StatTile } from '../components/ui';
import { formatDate, titleCase } from '../lib/format';

const TYPES = ['technical', 'tactical', 'fitness', 'strength', 'skills', 'match_practice', 'recovery', 'video_analysis'];

export default function Training() {
  const { can } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [sports, setSports] = useState([]);
  const [teams, setTeams] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [team, setTeam] = useState('');
  const [type, setType] = useState('');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (team) q.set('team', team);
    if (type) q.set('type', type);
    setSessions(null);
    api.get(`/training?${q}`).then((d) => setSessions(d.sessions)).catch(setError);
  }, [team, type]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
    api.get('/coaches').then((d) => setCoaches(d.coaches)).catch(() => {});
  }, []);

  const attended = sessions?.reduce((a, s) => a + s.attended, 0) || 0;
  const invited = sessions?.reduce((a, s) => a + s.invited, 0) || 0;

  return (
    <>
      <PageHeader
        eyebrow="Development"
        title="Training"
        subtitle="Sessions, attendance and coach notes. Attendance feeds each athlete's record and the club's development picture."
        actions={can('training.write') ? <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Log session</button> : null}
      >
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
          <Field label="Team">
            <select className="input" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">All teams</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </Field>
        </div>
      </PageHeader>

      {sessions && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatTile label="Sessions" value={sessions.length} />
          <StatTile label="Attendances" value={attended} />
          <StatTile label="Attendance rate" value={invited ? `${Math.round((attended / invited) * 1000) / 10}%` : '—'} tone="pitch" />
          <StatTile label="Minutes trained" value={sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0)} />
        </div>
      )}

      <ErrorNote error={error} />
      {can('drills.write') || can('groups.write') ? (DEMO_MODE ? null : <CricketAcademyPanel sports={sports} />) : null}
      {!sessions ? <Spinner label="Loading sessions" /> : (
        <Section>
          <DataTable
            columns={[
              { key: 'session_date', label: 'Date', render: (s) => formatDate(s.session_date) },
              { key: 'training_type', label: 'Type', render: (s) => <Link to={`/training/${s.id}`} className="link">{titleCase(s.training_type)}</Link> },
              { key: 'team_name', label: 'Team / Group', render: (s) => s.team_name || s.group_name || s.sport_name },
              { key: 'coach_name', label: 'Coach', render: (s) => s.coach_name || '—' },
              { key: 'location', label: 'Location', render: (s) => s.location || '—' },
              { key: 'duration_minutes', label: 'Minutes', align: 'right', mono: true },
              { key: 'attendance', label: 'Attendance', align: 'right', mono: true, render: (s) => `${s.attended}/${s.invited}` },
            ]}
            rows={sessions}
            empty={{ title: 'No sessions logged', message: 'Record a session to start tracking attendance and coach notes.' }}
          />
        </Section>
      )}

      <SessionForm open={creating} onClose={() => setCreating(false)} sports={sports} teams={teams} coaches={coaches} onSaved={load} />
    </>
  );
}

function SessionForm({ open, onClose, sports, teams, coaches, onSaved }) {
  const [form, setForm] = useState({
    sport_id: '', team_id: '', group_id: '', coach_id: '', title: '', session_date: new Date().toISOString().slice(0, 10),
    start_time: '17:00', duration_minutes: 90, training_type: 'technical', location: '', objectives: '',
    intensity: 6, exercises: '', skills: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState([]);
  const [drills, setDrills] = useState([]);
  useEffect(() => { if (open) setError(null); }, [open]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const sportTeams = teams.filter((t) => String(t.sport_id) === String(form.sport_id));
  const isCricket = sports.find((s) => String(s.id) === String(form.sport_id))?.code === 'cricket';

  useEffect(() => {
    if (!isCricket || DEMO_MODE) { setGroups([]); setDrills([]); return; }
    api.get('/groups?sport=cricket').then((d) => setGroups(d.groups)).catch(() => setGroups([]));
    api.get('/drills?sport=cricket').then((d) => setDrills(d.drills)).catch(() => setDrills([]));
  }, [isCricket]);

  function addDrill(drill) {
    const line = `${drill.name} (${drill.skill_group}${drill.duration_minutes ? `, ${drill.duration_minutes} min` : ''})`;
    setForm((f) => ({ ...f, exercises: f.exercises ? `${f.exercises}\n${line}` : line }));
  }

  const blocking = !form.sport_id
    ? 'Choose a sport before logging the session.'
    : !form.session_date
      ? 'Set the date of the session.'
      : null;

  async function submit(e) {
    e.preventDefault();
    if (blocking) { setError({ message: blocking }); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post('/training', {
        ...form,
        sport_id: Number(form.sport_id),
        team_id: form.team_id ? Number(form.team_id) : null,
        group_id: form.group_id ? Number(form.group_id) : null,
        coach_id: form.coach_id ? Number(form.coach_id) : null,
        duration_minutes: Number(form.duration_minutes),
        intensity: Number(form.intensity),
        exercises: form.exercises.split('\n').map((s) => s.trim()).filter(Boolean),
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      });
      onSaved(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Log training session">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sport">
            <select className="input" value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value, team_id: '' })}>
              <option value="">Choose a sport</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Team" hint="Attendance is pre-filled from the roster">
            <select className="input" value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value, group_id: e.target.value ? '' : form.group_id })}>
              <option value="">No specific team</option>
              {sportTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {isCricket && (
            <Field label="Digital group" hint="Cricket only — a training group instead of a full squad">
              <select className="input" value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value, team_id: e.target.value ? '' : form.team_id })}>
                <option value="">No specific group</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.memberCount})</option>)}
              </select>
            </Field>
          )}
          <Field label="Coach">
            <select className="input" value={form.coach_id} onChange={set('coach_id')}>
              <option value="">Unassigned</option>
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className="input" value={form.training_type} onChange={set('training_type')}>
              {TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </Field>
          <Field label="Date"><input className="input" type="date" value={form.session_date} onChange={set('session_date')} /></Field>
          <Field label="Start time"><input className="input" type="time" value={form.start_time} onChange={set('start_time')} /></Field>
          <Field label="Duration (minutes)"><input className="input" type="number" value={form.duration_minutes} onChange={set('duration_minutes')} /></Field>
          <Field label="Intensity (1–10)"><input className="input" type="number" min="1" max="10" value={form.intensity} onChange={set('intensity')} /></Field>
          <Field label="Location" className="col-span-2"><input className="input" value={form.location} onChange={set('location')} /></Field>
          <Field label="Objectives" className="col-span-2"><textarea className="input" rows={2} value={form.objectives} onChange={set('objectives')} /></Field>
          <Field label="Exercises" hint="One per line" className="col-span-2">
            <textarea className="input" rows={3} value={form.exercises} onChange={set('exercises')} />
            {isCricket && drills.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {drills.map((d) => (
                  <button type="button" key={d.id} onClick={() => addDrill(d)}
                    className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/70 hover:border-gold/50 hover:text-gold">
                    + {d.name}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field label="Skills assessed" hint="Comma separated" className="col-span-2"><input className="input" value={form.skills} onChange={set('skills')} /></Field>
        </div>
        <ErrorNote error={error} />
        {blocking && <p className="text-xs text-gold text-right">{blocking}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy || !!blocking}>{busy ? 'Saving…' : 'Log session'}</button>
        </div>
      </form>
    </Modal>
  );
}

const SKILL_GROUPS = ['batting', 'bowling', 'fielding', 'wicket_keeping', 'fitness'];

/**
 * Ludimos-style academy management, cricket only: a reusable drill library
 * and "digital groups" (training groups that aren't full match squads).
 * Collapsed by default so it stays out of the way on the main Training view.
 */
function CricketAcademyPanel({ sports }) {
  const { can } = useAuth();
  const isCricketClub = sports.some((s) => s.code === 'cricket');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('drills');
  const [drills, setDrills] = useState(null);
  const [groups, setGroups] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    api.get('/drills?sport=cricket').then((d) => setDrills(d.drills)).catch(setError);
    api.get('/groups?sport=cricket').then((d) => setGroups(d.groups)).catch(setError);
  }, []);
  useEffect(() => { if (open) refresh(); }, [open, refresh]);
  useEffect(() => { if (open && tab === 'groups') api.get('/players?sport=cricket&limit=500').then((d) => setPlayers(d.players)).catch(() => {}); }, [open, tab]);

  if (!isCricketClub) return null;

  return (
    <Section className="mb-5">
      <div className="p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <div>
          <p className="font-semibold text-white">Cricket academy tools</p>
          <p className="text-xs text-white/50">Drill library and digital groups — cricket only</p>
        </div>
        <span className="text-white/40 text-sm">{open ? 'Hide' : 'Manage'}</span>
      </button>
      {open && (
        <div className="mt-4">
          <div className="flex gap-2 mb-3">
            <button type="button" className={tab === 'drills' ? 'btn-gold' : 'btn-ghost'} onClick={() => setTab('drills')}>Drill library</button>
            <button type="button" className={tab === 'groups' ? 'btn-gold' : 'btn-ghost'} onClick={() => setTab('groups')}>Digital groups</button>
          </div>
          <ErrorNote error={error} />
          {tab === 'drills' ? (
            <DrillLibrary drills={drills} canWrite={can('drills.write')} onChanged={refresh} />
          ) : (
            <GroupManager groups={groups} players={players} canWrite={can('groups.write')} onChanged={refresh} />
          )}
        </div>
      )}
      </div>
    </Section>
  );
}

function DrillLibrary({ drills, canWrite, onChanged }) {
  const [form, setForm] = useState({ name: '', skill_group: 'batting', duration_minutes: 15, description: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function add(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api.post('/drills', { ...form, duration_minutes: Number(form.duration_minutes) || null });
      setForm({ name: '', skill_group: 'batting', duration_minutes: 15, description: '' });
      onChanged();
    } finally { setBusy(false); }
  }
  async function remove(id) { if (confirm('Remove this drill?')) { await api.del(`/drills/${id}`); onChanged(); } }

  if (!drills) return <Spinner label="Loading drills" />;
  return (
    <div className="space-y-3">
      {canWrite && (
        <form onSubmit={add} className="grid sm:grid-cols-4 gap-2 items-end bg-white/[0.03] p-3 rounded-lg">
          <Field label="Drill name"><input className="input" value={form.name} onChange={set('name')} /></Field>
          <Field label="Skill group">
            <select className="input" value={form.skill_group} onChange={set('skill_group')}>
              {SKILL_GROUPS.map((g) => <option key={g} value={g}>{titleCase(g)}</option>)}
            </select>
          </Field>
          <Field label="Duration (min)"><input className="input" type="number" value={form.duration_minutes} onChange={set('duration_minutes')} /></Field>
          <button className="btn-gold" disabled={busy}>{busy ? 'Adding…' : 'Add drill'}</button>
          <Field label="Description / coaching points" className="sm:col-span-4"><input className="input" value={form.description} onChange={set('description')} /></Field>
        </form>
      )}
      <DataTable
        columns={[
          { key: 'name', label: 'Drill' },
          { key: 'skill_group', label: 'Skill', render: (d) => titleCase(d.skill_group) },
          { key: 'duration_minutes', label: 'Minutes', align: 'right', mono: true, render: (d) => d.duration_minutes || '—' },
          { key: 'description', label: 'Notes', render: (d) => d.description || '—' },
          ...(canWrite ? [{ key: 'actions', label: '', align: 'right', render: (d) => <button className="link text-xs" onClick={() => remove(d.id)}>Remove</button> }] : []),
        ]}
        rows={drills}
        empty={{ title: 'No drills yet', message: 'Add batting, bowling and fielding drills to build a reusable library.' }}
      />
    </div>
  );
}

function GroupManager({ groups, players, canWrite, onChanged }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await api.post('/groups', { name }); setName(''); onChanged(); } finally { setBusy(false); }
  }
  async function remove(id) { if (confirm('Remove this group?')) { await api.del(`/groups/${id}`); onChanged(); } }
  async function toggleMember(group, playerId, isMember) {
    if (isMember) await api.del(`/groups/${group.id}/members/${playerId}`);
    else await api.post(`/groups/${group.id}/members`, { player_id: playerId });
    onChanged();
  }

  if (!groups) return <Spinner label="Loading groups" />;
  return (
    <div className="space-y-4">
      {canWrite && (
        <form onSubmit={add} className="flex gap-2">
          <input className="input" placeholder="e.g. U16 Fast Bowlers" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-gold" disabled={busy}>{busy ? 'Creating…' : 'New group'}</button>
        </form>
      )}
      {groups.length === 0 && <p className="text-sm text-white/50">No digital groups yet — create one to organise training outside full squads.</p>}
      {groups.map((g) => (
        <details key={g.id} className="rounded-lg border border-white/10 p-3">
          <summary className="cursor-pointer flex items-center justify-between">
            <span className="font-medium text-white">{g.name} <span className="text-white/40 text-xs">({g.memberCount} players)</span></span>
            {canWrite && <button type="button" className="link text-xs" onClick={(e) => { e.preventDefault(); remove(g.id); }}>Remove</button>}
          </summary>
          {canWrite && (
            <div className="mt-3 max-h-48 overflow-y-auto grid sm:grid-cols-2 gap-1 text-sm">
              {players.map((p) => {
                const isMember = (g.members || []).some((m) => m.id === p.id);
                return (
                  <label key={p.id} className="flex items-center gap-2 text-white/70">
                    <input type="checkbox" checked={isMember} onChange={() => toggleMember(g, p.id, isMember)} />
                    {p.display_name || `${p.first_name} ${p.last_name}`}
                  </label>
                );
              })}
            </div>
          )}
        </details>
      ))}
    </div>
  );
}
