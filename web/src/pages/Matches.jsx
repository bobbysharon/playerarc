import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, Chip } from '../components/ui';
import { formatDateTime, titleCase } from '../lib/format';

export default function Matches() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [matches, setMatches] = useState(null);
  const [sports, setSports] = useState([]);
  const [teams, setTeams] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const sport = params.get('sport') || '';
  const status = params.get('status') || '';
  const tournament = params.get('tournament') || '';

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (sport) q.set('sport', sport);
    if (status) q.set('status', status);
    if (tournament) q.set('tournament', tournament);
    setMatches(null);
    api.get(`/matches?${q}`).then((d) => setMatches(d.matches)).catch(setError);
  }, [sport, status, tournament]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
    api.get('/tournaments').then((d) => setTournaments(d.tournaments)).catch(() => {});
    api.get('/sports/meta/seasons').then((d) => setSeasons(d.seasons)).catch(() => {});
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Competition"
        title="Matches"
        subtitle="Fixtures and results across every sport. Enter a scorecard and each athlete's career record updates with it."
        actions={can('matches.write') ? <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Add match</button> : null}
      >
        <div className="grid sm:grid-cols-3 gap-3 max-w-3xl">
          <Field label="Sport">
            <select className="input" value={sport} onChange={(e) => setParam('sport', e.target.value)}>
              <option value="">All sports</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">Any status</option>
              {['scheduled', 'live', 'completed', 'abandoned', 'cancelled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </Field>
          <Field label="Tournament">
            <select className="input" value={tournament} onChange={(e) => setParam('tournament', e.target.value)}>
              <option value="">All competitions</option>
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </div>
      </PageHeader>

      <ErrorNote error={error} />
      {!matches ? <Spinner label="Loading fixtures" /> : (
        <Section>
          <DataTable
            columns={[
              { key: 'scheduled_at', label: 'Date', render: (m) => formatDateTime(m.scheduled_at) },
              { key: 'sport_name', label: 'Sport' },
              { key: 'fixture', label: 'Fixture', render: (m) => <Link to={`/matches/${m.id}`} className="link">{m.home_team_name || 'Karwan'} vs {m.away_team_name || m.opponent_name || 'TBC'}</Link> },
              { key: 'tournament_name', label: 'Competition', render: (m) => m.tournament_name || 'Friendly' },
              { key: 'venue', label: 'Venue', render: (m) => m.venue || '—' },
              { key: 'score', label: 'Score', mono: true, render: (m) => m.home_score ? `${m.home_score} – ${m.away_score}` : '—' },
              { key: 'performance_count', label: 'Scorecard', align: 'right', mono: true, render: (m) => m.performance_count || '—' },
              { key: 'status', label: '', render: (m) => m.result ? <Chip tone={m.result}>{titleCase(m.result)}</Chip> : <Chip tone={m.status}>{titleCase(m.status)}</Chip> },
            ]}
            rows={matches}
            empty={{ title: 'No matches found', message: 'Add a fixture to start recording results and statistics.' }}
          />
        </Section>
      )}

      <MatchForm open={creating} onClose={() => setCreating(false)} sports={sports} teams={teams} tournaments={tournaments} seasons={seasons} onSaved={load} />
    </>
  );
}

function MatchForm({ open, onClose, sports, teams, tournaments, seasons, onSaved }) {
  const [form, setForm] = useState({
    sport_id: '', tournament_id: '', season_id: '', home_team_id: '', opponent_name: '',
    scheduled_at: '', venue: '', stage: '', format: '', match_type: 'team', is_home: 1, status: 'scheduled',
  });
  const [error, setError] = useState(null);
  useEffect(() => { if (open) setError(null); }, [open]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const sport = sports.find((s) => String(s.id) === String(form.sport_id));
  const sportTeams = teams.filter((t) => String(t.sport_id) === String(form.sport_id));
  const sportTournaments = tournaments.filter((t) => String(t.sport_id) === String(form.sport_id));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        ...form,
        sport_id: Number(form.sport_id),
        tournament_id: form.tournament_id ? Number(form.tournament_id) : null,
        season_id: form.season_id ? Number(form.season_id) : null,
        home_team_id: form.home_team_id ? Number(form.home_team_id) : null,
        scheduled_at: form.scheduled_at.replace('T', 'T'),
      };
      await api.post('/matches', payload);
      onSaved(); onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add match">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sport">
            <select className="input" required value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value, home_team_id: '', tournament_id: '', format: '' })}>
              <option value="">Choose</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Format">
            <select className="input" value={form.format} onChange={set('format')}>
              <option value="">Not set</option>
              {(sport?.config?.matchFormats || []).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Karwan team">
            <select className="input" value={form.home_team_id} onChange={set('home_team_id')}>
              <option value="">Choose a team</option>
              {sportTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Opposition" hint="Type the visiting club's name"><input className="input" value={form.opponent_name} onChange={set('opponent_name')} /></Field>
          <Field label="Date and time"><input className="input" type="datetime-local" required value={form.scheduled_at} onChange={set('scheduled_at')} /></Field>
          <Field label="Venue"><input className="input" value={form.venue} onChange={set('venue')} /></Field>
          <Field label="Tournament">
            <select className="input" value={form.tournament_id} onChange={set('tournament_id')}>
              <option value="">Friendly</option>
              {sportTournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Season">
            <select className="input" value={form.season_id} onChange={set('season_id')}>
              <option value="">None</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Stage"><input className="input" value={form.stage} onChange={set('stage')} placeholder="Group / Semi-final" /></Field>
          <Field label="Match type">
            <select className="input" value={form.match_type} onChange={set('match_type')}>
              {['team', 'singles', 'doubles'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Add match</button>
        </div>
      </form>
    </Modal>
  );
}
