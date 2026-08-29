import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { PageHeader, Section, Spinner, ErrorNote, Field, Avatar, EmptyState } from '../components/ui';

export default function Rankings() {
  const [sports, setSports] = useState([]);
  const [teams, setTeams] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [sport, setSport] = useState('');
  const [filters, setFilters] = useState({ season: '', tournament: '', team: '', ageGroup: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/sports').then((d) => {
      setSports(d.sports);
      if (d.sports.length) setSport(String(d.sports[0].id));
    }).catch(setError);
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
    api.get('/sports/meta/seasons').then((d) => setSeasons(d.seasons)).catch(() => {});
    api.get('/tournaments').then((d) => setTournaments(d.tournaments)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!sport) return;
    setData(null);
    setError(null);
    const q = new URLSearchParams({ sport });
    Object.entries(filters).forEach(([k, v]) => { if (v) q.set(k, v); });
    api.get(`/rankings?${q}`).then(setData).catch(setError);
  }, [sport, filters]);
  useEffect(() => { load(); }, [load]);

  const sportTeams = teams.filter((t) => String(t.sport_id) === String(sport));
  const sportTournaments = tournaments.filter((t) => String(t.sport_id) === String(sport));

  return (
    <>
      <PageHeader
        eyebrow="Performance"
        title="Rankings"
        subtitle="Leaderboards are built per sport, using that sport's own statistics. Cricket runs are never ranked against basketball points."
      >
        <div className="flex flex-wrap gap-2 mb-3">
          {sports.map((s) => (
            <button key={s.id} type="button" onClick={() => setSport(String(s.id))}
              className={`${String(s.id) === sport ? 'chip text-white shadow-glow-sm' : 'chip-idle'}`}
              style={String(s.id) === sport ? { background: s.color } : undefined}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-4xl">
          <Field label="Season">
            <select className="input" value={filters.season} onChange={(e) => setFilters({ ...filters, season: e.target.value })}>
              <option value="">All seasons</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Tournament">
            <select className="input" value={filters.tournament} onChange={(e) => setFilters({ ...filters, tournament: e.target.value })}>
              <option value="">All competitions</option>
              {sportTournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Team">
            <select className="input" value={filters.team} onChange={(e) => setFilters({ ...filters, team: e.target.value })}>
              <option value="">All teams</option>
              {sportTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Age group">
            <select className="input" value={filters.ageGroup} onChange={(e) => setFilters({ ...filters, ageGroup: e.target.value })}>
              <option value="">All age groups</option>
              {[...new Set(sportTeams.map((t) => t.age_group).filter(Boolean))].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
        </div>
      </PageHeader>

      <ErrorNote error={error} />
      {!data ? <Spinner label="Building leaderboards" /> : !data.boards.length ? (
        <Section><EmptyState title="No statistics for these filters" message="Leaderboards appear once match performances are recorded for this sport." /></Section>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {data.boards.map((b) => (
            <Section key={b.key} title={b.label} subtitle={b.qualifier || undefined}>
              <ol className="divide-y divide-line">
                {b.entries.map((e) => (
                  <li key={e.playerId}>
                    <Link to={`/players/${e.playerId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04]">
                      <span className={`font-display text-lg w-6 text-center ${e.rank === 1 ? 'text-gold' : 'text-ink-200'}`}>{e.rank}</span>
                      <Avatar player={{ photo_url: e.photoUrl, first_name: e.name.split(' ')[0], last_name: e.name.split(' ')[1] }} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium block truncate">{e.name}</span>
                        <span className="font-mono text-[11px] text-ink-400">{e.athleteId}</span>
                      </span>
                      <span className="stat-value text-base">{e.display}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
