import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, Chip } from '../components/ui';
import { titleCase } from '../lib/format';

export default function Teams() {
  const { can } = useAuth();
  const [teams, setTeams] = useState(null);
  const [sports, setSports] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [sport, setSport] = useState('');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setTeams(null);
    api.get(`/teams${sport ? `?sport=${sport}` : ''}`).then((d) => setTeams(d.teams)).catch(setError);
  }, [sport]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/coaches').then((d) => setCoaches(d.coaches)).catch(() => {});
    api.get('/sports/meta/seasons').then((d) => setSeasons(d.seasons)).catch(() => {});
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Squads"
        title="Teams"
        subtitle="Squads by sport, age group and season. Rosters keep their history — a player who moves up stays on the record of the team they left."
        actions={can('teams.write') ? <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Create team</button> : null}
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSport('')} className={`${sport === '' ? 'chip-active' : 'chip-idle'}`}>All sports</button>
          {sports.map((s) => (
            <button key={s.id} type="button" onClick={() => setSport(String(s.id))}
              className={`${String(s.id) === sport ? 'chip text-white shadow-glow-sm' : 'chip-idle'}`}
              style={String(s.id) === sport ? { background: s.color } : undefined}>
              {s.name}
            </button>
          ))}
        </div>
      </PageHeader>

      <ErrorNote error={error} />
      {!teams ? <Spinner label="Loading teams" /> : (
        <Section>
          <DataTable
            columns={[
              { key: 'name', label: 'Team', render: (t) => <Link to={`/teams/${t.id}`} className="link">{t.name}</Link> },
              { key: 'sport_name', label: 'Sport' },
              { key: 'age_group', label: 'Age group', render: (t) => t.age_group || '—' },
              { key: 'level', label: 'Level', render: (t) => titleCase(t.level) },
              { key: 'season_name', label: 'Season', render: (t) => t.season_name || '—' },
              { key: 'coach_name', label: 'Head coach', render: (t) => t.coach_name || '—' },
              { key: 'squad_size', label: 'Squad', align: 'right', mono: true },
              { key: 'match_count', label: 'Matches', align: 'right', mono: true },
              { key: 'is_active', label: '', render: (t) => <Chip tone={t.is_active ? 'active' : 'inactive'}>{t.is_active ? 'Active' : 'Archived'}</Chip> },
            ]}
            rows={teams}
            empty={{ title: 'No teams yet', message: 'Create a squad to start assigning athletes and fixtures.' }}
          />
        </Section>
      )}

      <TeamForm open={creating} onClose={() => setCreating(false)} sports={sports} coaches={coaches} seasons={seasons} onSaved={load} />
    </>
  );
}

function TeamForm({ open, onClose, sports, coaches, seasons, onSaved }) {
  const [form, setForm] = useState({ name: '', code: '', sport_id: '', age_group: 'Senior', gender: 'male', level: 'senior', season_id: '', head_coach_id: '', home_venue: '' });
  const [error, setError] = useState(null);
  useEffect(() => { if (open) setError(null); }, [open]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const payload = { ...form, sport_id: Number(form.sport_id) };
      ['season_id', 'head_coach_id'].forEach((k) => { payload[k] = form[k] ? Number(form[k]) : null; });
      await api.post('/teams', payload);
      onSaved(); onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create team">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Team name"><input className="input" required value={form.name} onChange={set('name')} placeholder="Karwan Cricket U16" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Short code"><input className="input" value={form.code} onChange={set('code')} placeholder="KCU16" /></Field>
          <Field label="Sport">
            <select className="input" required value={form.sport_id} onChange={set('sport_id')}>
              <option value="">Choose</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Age group"><input className="input" value={form.age_group} onChange={set('age_group')} placeholder="U16" /></Field>
          <Field label="Gender">
            <select className="input" value={form.gender} onChange={set('gender')}>
              {['male', 'female', 'mixed'].map((g) => <option key={g} value={g}>{titleCase(g)}</option>)}
            </select>
          </Field>
          <Field label="Level">
            <select className="input" value={form.level} onChange={set('level')}>
              {['academy', 'development', 'senior', 'representative', 'recreational'].map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
            </select>
          </Field>
          <Field label="Season">
            <select className="input" value={form.season_id} onChange={set('season_id')}>
              <option value="">None</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Head coach">
            <select className="input" value={form.head_coach_id} onChange={set('head_coach_id')}>
              <option value="">Unassigned</option>
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </Field>
          <Field label="Home venue"><input className="input" value={form.home_venue} onChange={set('home_venue')} /></Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Create team</button>
        </div>
      </form>
    </Modal>
  );
}
