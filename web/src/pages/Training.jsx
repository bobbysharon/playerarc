import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
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
      {!sessions ? <Spinner label="Loading sessions" /> : (
        <Section>
          <DataTable
            columns={[
              { key: 'session_date', label: 'Date', render: (s) => formatDate(s.session_date) },
              { key: 'training_type', label: 'Type', render: (s) => <Link to={`/training/${s.id}`} className="link">{titleCase(s.training_type)}</Link> },
              { key: 'team_name', label: 'Team', render: (s) => s.team_name || s.sport_name },
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
    sport_id: '', team_id: '', coach_id: '', title: '', session_date: new Date().toISOString().slice(0, 10),
    start_time: '17:00', duration_minutes: 90, training_type: 'technical', location: '', objectives: '',
    intensity: 6, exercises: '', skills: '',
  });
  const [error, setError] = useState(null);
  useEffect(() => { if (open) setError(null); }, [open]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const sportTeams = teams.filter((t) => String(t.sport_id) === String(form.sport_id));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/training', {
        ...form,
        sport_id: Number(form.sport_id),
        team_id: form.team_id ? Number(form.team_id) : null,
        coach_id: form.coach_id ? Number(form.coach_id) : null,
        duration_minutes: Number(form.duration_minutes),
        intensity: Number(form.intensity),
        exercises: form.exercises.split('\n').map((s) => s.trim()).filter(Boolean),
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      });
      onSaved(); onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Log training session">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sport">
            <select className="input" required value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value, team_id: '' })}>
              <option value="">Choose</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Team" hint="Attendance is pre-filled from the roster">
            <select className="input" value={form.team_id} onChange={set('team_id')}>
              <option value="">No specific team</option>
              {sportTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
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
          <Field label="Date"><input className="input" type="date" required value={form.session_date} onChange={set('session_date')} /></Field>
          <Field label="Start time"><input className="input" type="time" value={form.start_time} onChange={set('start_time')} /></Field>
          <Field label="Duration (minutes)"><input className="input" type="number" value={form.duration_minutes} onChange={set('duration_minutes')} /></Field>
          <Field label="Intensity (1–10)"><input className="input" type="number" min="1" max="10" value={form.intensity} onChange={set('intensity')} /></Field>
          <Field label="Location" className="col-span-2"><input className="input" value={form.location} onChange={set('location')} /></Field>
          <Field label="Objectives" className="col-span-2"><textarea className="input" rows={2} value={form.objectives} onChange={set('objectives')} /></Field>
          <Field label="Exercises" hint="One per line" className="col-span-2"><textarea className="input" rows={3} value={form.exercises} onChange={set('exercises')} /></Field>
          <Field label="Skills assessed" hint="Comma separated" className="col-span-2"><input className="input" value={form.skills} onChange={set('skills')} /></Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Log session</button>
        </div>
      </form>
    </Modal>
  );
}
