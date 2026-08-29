import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, Chip } from '../components/ui';
import { formatDate, titleCase } from '../lib/format';

export default function Tournaments() {
  const { can } = useAuth();
  const [tournaments, setTournaments] = useState(null);
  const [sports, setSports] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setTournaments(null);
    api.get(`/tournaments${status ? `?status=${status}` : ''}`).then((d) => setTournaments(d.tournaments)).catch(setError);
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/sports/meta/seasons').then((d) => setSeasons(d.seasons)).catch(() => {});
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Competition"
        title="Tournaments"
        subtitle="Competitions, their fixtures and the awards that come out of them."
        actions={can('tournaments.write') ? <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Add tournament</button> : null}
      >
        <div className="flex flex-wrap gap-2">
          {['', 'upcoming', 'ongoing', 'completed'].map((s) => (
            <button key={s || 'all'} type="button" onClick={() => setStatus(s)}
              className={`${status === s ? 'chip-active' : 'chip-idle'}`}>
              {s ? titleCase(s) : 'All'}
            </button>
          ))}
        </div>
      </PageHeader>
      <ErrorNote error={error} />
      {!tournaments ? <Spinner label="Loading competitions" /> : (
        <Section>
          <DataTable
            columns={[
              { key: 'name', label: 'Tournament', render: (t) => <Link to={`/tournaments/${t.id}`} className="link">{t.name}</Link> },
              { key: 'sport_name', label: 'Sport' },
              { key: 'season_name', label: 'Season', render: (t) => t.season_name || '—' },
              { key: 'format', label: 'Format', render: (t) => t.format || '—' },
              { key: 'level', label: 'Level', render: (t) => titleCase(t.level) || '—' },
              { key: 'dates', label: 'Dates', render: (t) => `${formatDate(t.start_date)} → ${formatDate(t.end_date)}` },
              { key: 'match_count', label: 'Matches', align: 'right', mono: true },
              { key: 'status', label: 'Status', render: (t) => <Chip tone={t.status}>{titleCase(t.status)}</Chip> },
            ]}
            rows={tournaments}
            empty={{ title: 'No tournaments', message: 'Create a competition to group fixtures, results and awards.' }}
          />
        </Section>
      )}
      <TournamentForm open={creating} onClose={() => setCreating(false)} sports={sports} seasons={seasons} onSaved={load} />
    </>
  );
}

function TournamentForm({ open, onClose, sports, seasons, onSaved }) {
  const [form, setForm] = useState({ name: '', sport_id: '', season_id: '', format: 'League', level: 'club', age_group: '', start_date: '', end_date: '', venue: '', host: '', status: 'upcoming', description: '' });
  const [error, setError] = useState(null);
  useEffect(() => { if (open) setError(null); }, [open]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/tournaments', { ...form, sport_id: Number(form.sport_id), season_id: form.season_id ? Number(form.season_id) : null });
      onSaved(); onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add tournament">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Tournament name"><input className="input" required value={form.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sport">
            <select className="input" required value={form.sport_id} onChange={set('sport_id')}>
              <option value="">Choose</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Season">
            <select className="input" value={form.season_id} onChange={set('season_id')}>
              <option value="">None</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Format"><input className="input" value={form.format} onChange={set('format')} placeholder="League / Knockout" /></Field>
          <Field label="Level">
            <select className="input" value={form.level} onChange={set('level')}>
              {['club', 'district', 'state', 'national', 'international'].map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
            </select>
          </Field>
          <Field label="Start date"><input className="input" type="date" value={form.start_date} onChange={set('start_date')} /></Field>
          <Field label="End date"><input className="input" type="date" value={form.end_date} onChange={set('end_date')} /></Field>
          <Field label="Age group"><input className="input" value={form.age_group} onChange={set('age_group')} placeholder="U18" /></Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={set('status')}>
              {['upcoming', 'ongoing', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </Field>
          <Field label="Venue" className="col-span-2"><input className="input" value={form.venue} onChange={set('venue')} /></Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Add tournament</button>
        </div>
      </form>
    </Modal>
  );
}
