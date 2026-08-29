import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, StatTile, Chip } from '../components/ui';
import { formatDate, titleCase } from '../lib/format';

export default function Coaches() {
  const { id } = useParams();
  return id ? <CoachDetail id={id} /> : <CoachList />;
}

function CoachList() {
  const { can } = useAuth();
  const [coaches, setCoaches] = useState(null);
  const [sports, setSports] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.get('/coaches').then((d) => setCoaches(d.coaches)).catch(setError);
  }, []);
  useEffect(() => { load(); api.get('/sports').then((d) => setSports(d.sports)).catch(() => {}); }, [load]);

  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title="Coaches"
        subtitle="Coaching staff across the club, the teams they lead and the development work they record."
        actions={can('coaches.write') ? <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Add coach</button> : null}
      />
      <ErrorNote error={error} />
      {!coaches ? <Spinner label="Loading staff" /> : (
        <Section>
          <DataTable
            columns={[
              { key: 'full_name', label: 'Coach', render: (c) => <Link to={`/coaches/${c.id}`} className="link">{c.full_name}</Link> },
              { key: 'role', label: 'Role', render: (c) => titleCase(c.role) },
              { key: 'sport_name', label: 'Sport', render: (c) => c.sport_name || 'All sports' },
              { key: 'qualification', label: 'Qualification', render: (c) => c.qualification || '—' },
              { key: 'team_count', label: 'Teams', align: 'right', mono: true },
              { key: 'session_count', label: 'Sessions', align: 'right', mono: true },
              { key: 'is_active', label: '', render: (c) => <Chip tone={c.is_active ? 'active' : 'inactive'}>{c.is_active ? 'Active' : 'Inactive'}</Chip> },
            ]}
            rows={coaches}
            empty={{ title: 'No coaches yet', message: 'Add coaching staff so training and assessments can be attributed.' }}
          />
        </Section>
      )}
      <CoachForm open={creating} onClose={() => setCreating(false)} sports={sports} onSaved={load} />
    </>
  );
}

function CoachDetail({ id }) {
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/coaches/${id}`).then(setData).catch(setError);
    api.get(`/reports/coach/${id}`).then(setReport).catch(() => {});
  }, [id]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading coach" />;
  const c = data.coach;

  return (
    <>
      <PageHeader
        eyebrow={c.sport_name || 'All sports'}
        title={c.full_name}
        subtitle={[titleCase(c.role), c.qualification, c.joined_date && `Joined ${formatDate(c.joined_date)}`].filter(Boolean).join(' · ')}
        actions={<Link to="/coaches" className="btn-ghost">All coaches</Link>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatTile label="Teams" value={data.teams.length} />
        <StatTile label="Athletes" value={data.playerCount} />
        <StatTile label="Sessions" value={report?.sessionCount ?? data.sessions.length} />
        <StatTile label="Attendance" value={`${report?.attendanceRate ?? 0}%`} tone="pitch" />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Teams">
          <DataTable
            columns={[
              { key: 'name', label: 'Team', render: (t) => <Link to={`/teams/${t.id}`} className="link">{t.name}</Link> },
              { key: 'sport_name', label: 'Sport' },
              { key: 'age_group', label: 'Age group', render: (t) => t.age_group || '—' },
            ]}
            rows={data.teams}
            empty={{ title: 'No teams assigned', message: '' }}
          />
        </Section>
        <Section title="Recent training">
          <DataTable
            columns={[
              { key: 'session_date', label: 'Date', render: (s) => formatDate(s.session_date) },
              { key: 'training_type', label: 'Type', render: (s) => <Link to={`/training/${s.id}`} className="link">{titleCase(s.training_type)}</Link> },
              { key: 'team_name', label: 'Team', render: (s) => s.team_name || '—' },
            ]}
            rows={data.sessions}
            empty={{ title: 'No sessions recorded', message: '' }}
          />
        </Section>
        <Section title="Assessments recorded" className="lg:col-span-2">
          <DataTable
            columns={[
              { key: 'assessment_date', label: 'Date', render: (a) => formatDate(a.assessment_date) },
              { key: 'player', label: 'Athlete', render: (a) => <Link to={`/players/${a.player_id}`} className="link">{a.first_name} {a.last_name}</Link> },
              { key: 'cycle', label: 'Review', render: (a) => a.cycle || '—' },
              { key: 'overall_score', label: 'Score', align: 'right', mono: true, render: (a) => a.overall_score ?? '—' },
            ]}
            rows={data.assessments}
            empty={{ title: 'No assessments recorded', message: '' }}
          />
        </Section>
      </div>
    </>
  );
}

function CoachForm({ open, onClose, sports, onSaved }) {
  const [form, setForm] = useState({ full_name: '', sport_id: '', role: 'head_coach', qualification: '', phone: '', email: '', joined_date: '' });
  const [error, setError] = useState(null);
  useEffect(() => { if (open) setError(null); }, [open]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/coaches', { ...form, sport_id: form.sport_id ? Number(form.sport_id) : null });
      onSaved(); onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add coach">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Full name"><input className="input" required value={form.full_name} onChange={set('full_name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sport">
            <select className="input" value={form.sport_id} onChange={set('sport_id')}>
              <option value="">All sports</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Role">
            <select className="input" value={form.role} onChange={set('role')}>
              {['head_coach', 'assistant_coach', 'academy_coach', 'specialist', 'fitness_trainer', 'physio'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </select>
          </Field>
          <Field label="Qualification" className="col-span-2"><input className="input" value={form.qualification} onChange={set('qualification')} placeholder="UEFA B Licence" /></Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
          <Field label="Joined" className="col-span-2"><input className="input" type="date" value={form.joined_date} onChange={set('joined_date')} /></Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Add coach</button>
        </div>
      </form>
    </Modal>
  );
}
