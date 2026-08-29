import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, Field, DataTable, StatTile, EmptyState, Tabs } from '../components/ui';
import { formatDate, titleCase } from '../lib/format';

const REPORTS = [
  { key: 'player', label: 'Player report', description: 'A complete sporting history for one athlete: career statistics in every sport, teams, assessments, awards and timeline.' },
  { key: 'team', label: 'Team report', description: 'Squad performance, match record and training attendance for one team.' },
  { key: 'tournament', label: 'Tournament report', description: 'Results, participating athletes and awards from one competition.' },
  { key: 'sport', label: 'Sport report', description: 'Participation and structure across a single sport.' },
  { key: 'coach', label: 'Coach report', description: 'Teams, athletes, sessions and assessments recorded by one coach.' },
];

export default function Reports() {
  const { can } = useAuth();
  const [kind, setKind] = useState('player');
  const [options, setOptions] = useState({ players: [], teams: [], tournaments: [], sports: [], coaches: [] });
  const [target, setTarget] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/players?pageSize=200').then((d) => d.players).catch(() => []),
      api.get('/teams').then((d) => d.teams).catch(() => []),
      api.get('/tournaments').then((d) => d.tournaments).catch(() => []),
      api.get('/sports').then((d) => d.sports).catch(() => []),
      api.get('/coaches').then((d) => d.coaches).catch(() => []),
    ]).then(([players, teams, tournaments, sports, coaches]) => setOptions({ players, teams, tournaments, sports, coaches }));
  }, []);

  useEffect(() => { setTarget(''); setData(null); }, [kind]);

  function run() {
    if (!target) return;
    setData(null); setError(null);
    api.get(`/reports/${kind}/${target}`).then(setData).catch(setError);
  }

  const list = {
    player: options.players.map((p) => ({ id: p.id, label: `${p.athlete_id} — ${p.display_name || `${p.first_name} ${p.last_name}`}` })),
    team: options.teams.map((t) => ({ id: t.id, label: `${t.name} (${t.sport_name})` })),
    tournament: options.tournaments.map((t) => ({ id: t.id, label: t.name })),
    sport: options.sports.map((s) => ({ id: s.id, label: s.name })),
    coach: options.coaches.map((c) => ({ id: c.id, label: c.full_name })),
  }[kind];

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Reports"
        subtitle="Build a report, read it here, and export the club roster to CSV or Excel or an athlete's career to PDF."
        actions={can('reports.export') ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => api.download('/export/players.csv', 'karwan-athletes.csv')}>Export CSV</button>
            <button type="button" className="btn-ghost" onClick={() => api.download('/export/players.xlsx', 'karwan-athletes.xlsx')}>Export Excel</button>
          </>
        ) : null}
      />

      <Tabs tabs={REPORTS.map((r) => ({ key: r.key, label: r.label }))} active={kind} onChange={setKind} />

      <Section className="mt-5 mb-5">
        <div className="p-4">
          <p className="text-sm text-ink-400 mb-3">{REPORTS.find((r) => r.key === kind)?.description}</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={titleCase(kind)} className="flex-1 min-w-[240px]">
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose</option>
                {list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>
            <button type="button" className="btn-primary" onClick={run} disabled={!target}>Build report</button>
            {kind === 'player' && target && can('reports.export') && (
              <button type="button" className="btn-gold" onClick={() => api.download(`/export/player/${target}.pdf`, 'career-report.pdf')}>Download PDF</button>
            )}
          </div>
        </div>
      </Section>

      <ErrorNote error={error} />
      {target && !data && !error && <Spinner label="Building report" />}
      {data && kind === 'player' && <PlayerReport data={data} />}
      {data && kind === 'team' && <TeamReport data={data} />}
      {data && kind === 'tournament' && <TournamentReport data={data} />}
      {data && kind === 'sport' && <SportReport data={data} />}
      {data && kind === 'coach' && <CoachReport data={data} />}
    </>
  );
}

function PlayerReport({ data }) {
  const p = data.player;
  return (
    <div className="space-y-5">
      <Section title={`${p.display_name || `${p.first_name} ${p.last_name}`} — ${p.athlete_id}`} subtitle={`Registered ${formatDate(p.registration_date)} · ${titleCase(p.status)}`}>
        <div className="p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatTile label="Matches" value={data.summary.matches} />
          <StatTile label="Wins" value={`${data.summary.wins}`} hint={`${data.summary.winRate}%`} />
          <StatTile label="Tournaments" value={data.summary.tournaments} />
          <StatTile label="Awards" value={data.summary.awards} tone="gold" />
          <StatTile label="Sports" value={data.summary.sports} />
          <StatTile label="Rating" value={data.summary.rating ?? '—'} tone="pitch" />
        </div>
      </Section>
      {data.careers.filter((c) => c.matchesPlayed).map((c) => (
        <Section key={c.sport.id} title={`${c.sport.name} career`}>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-px bg-line border border-line rounded-lg overflow-hidden">
            {c.career.entries.map((s) => (
              <div key={s.key} className="bg-surface px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-ink-400 truncate">{s.label}</p>
                <p className="stat-value text-base">{s.display}</p>
              </div>
            ))}
          </div>
        </Section>
      ))}
      <Section title="Team history">
        <DataTable
          columns={[
            { key: 'team_name', label: 'Team' },
            { key: 'sport_name', label: 'Sport' },
            { key: 'age_group', label: 'Age group', render: (r) => r.age_group || '—' },
            { key: 'period', label: 'Period', render: (r) => `${formatDate(r.start_date)} → ${r.end_date ? formatDate(r.end_date) : 'present'}` },
          ]}
          rows={data.teams}
          empty={{ title: 'No team history', message: '' }}
        />
      </Section>
      <Section title="Achievements">
        <DataTable
          columns={[
            { key: 'awarded_date', label: 'Date', render: (a) => formatDate(a.awarded_date) },
            { key: 'title', label: 'Award' },
            { key: 'category', label: 'Category', render: (a) => titleCase(a.category) },
            { key: 'sport_name', label: 'Sport', render: (a) => a.sport_name || '—' },
          ]}
          rows={data.achievements}
          empty={{ title: 'No awards', message: '' }}
        />
      </Section>
    </div>
  );
}

function TeamReport({ data }) {
  return (
    <div className="space-y-5">
      <Section title={data.team.name} subtitle={`${data.team.sport_name} · ${data.team.age_group || ''}`}>
        <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile label="Played" value={data.record.played} />
          <StatTile label="Won" value={data.record.won} tone="pitch" />
          <StatTile label="Lost" value={data.record.lost} tone="alert" />
          <StatTile label="Win rate" value={`${data.record.winRate}%`} />
          <StatTile label="Attendance" value={`${data.attendanceRate}%`} />
        </div>
      </Section>
      <Section title="Squad performance">
        <DataTable
          columns={[
            { key: 'name', label: 'Athlete', render: (r) => <Link to={`/players/${r.playerId}`} className="link">{r.name}</Link> },
            { key: 'role', label: 'Role', render: (r) => titleCase(r.role) },
            { key: 'matches', label: 'Matches', align: 'right', mono: true },
            ...(data.players[0]?.headline || []).map((h, i) => ({
              key: `h${i}`, label: h.label, align: 'right', mono: true, render: (r) => r.headline[i]?.display ?? '—',
            })),
            { key: 'rating', label: 'Rating', align: 'right', mono: true, render: (r) => r.rating ?? '—' },
          ]}
          rows={data.players}
          empty={{ title: 'No squad data', message: '' }}
        />
      </Section>
    </div>
  );
}

function TournamentReport({ data }) {
  return (
    <div className="space-y-5">
      <Section title={data.tournament.name} subtitle={`${data.tournament.sport_name} · ${formatDate(data.tournament.start_date)} → ${formatDate(data.tournament.end_date)}`}>
        <div className="p-4 grid grid-cols-3 gap-3">
          <StatTile label="Matches" value={data.matches.length} />
          <StatTile label="Athletes" value={data.players.length} />
          <StatTile label="Awards" value={data.awards.length} tone="gold" />
        </div>
      </Section>
      <Section title="Athlete statistics">
        <DataTable
          columns={[
            { key: 'name', label: 'Athlete', render: (r) => <Link to={`/players/${r.playerId}`} className="link">{r.name}</Link> },
            { key: 'matches', label: 'Matches', align: 'right', mono: true },
            ...(data.players[0]?.stats || []).map((s, i) => ({
              key: `s${i}`, label: s.label, align: 'right', mono: true, render: (r) => r.stats[i]?.display ?? '—',
            })),
          ]}
          rows={data.players}
          empty={{ title: 'No performances recorded', message: '' }}
        />
      </Section>
    </div>
  );
}

function SportReport({ data }) {
  return (
    <div className="space-y-5">
      <Section title={data.sport.name}>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Athletes" value={data.players.length} />
          <StatTile label="Teams" value={data.teams.length} />
          <StatTile label="Matches" value={data.matches} />
          <StatTile label="Tournaments" value={data.tournaments} />
        </div>
      </Section>
      <Section title="Positions">
        <DataTable
          columns={[{ key: 'position', label: 'Position', render: (r) => titleCase(r.position) }, { key: 'count', label: 'Athletes', align: 'right', mono: true }]}
          rows={data.positionSplit}
          empty={{ title: 'No positions recorded', message: '' }}
        />
      </Section>
      <Section title="Registered athletes">
        <DataTable
          columns={[
            { key: 'athlete_id', label: 'Athlete ID', mono: true },
            { key: 'name', label: 'Name', render: (r) => <Link to={`/players/${r.id}`} className="link">{r.first_name} {r.last_name}</Link> },
            { key: 'position', label: 'Position', render: (r) => titleCase(r.position) || '—' },
            { key: 'playing_level', label: 'Level', render: (r) => titleCase(r.playing_level) || '—' },
            { key: 'status', label: 'Status', render: (r) => titleCase(r.status) },
          ]}
          rows={data.players}
          empty={{ title: 'No athletes registered', message: '' }}
        />
      </Section>
    </div>
  );
}

function CoachReport({ data }) {
  return (
    <div className="space-y-5">
      <Section title={data.coach.full_name} subtitle={titleCase(data.coach.role)}>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Teams" value={data.teams.length} />
          <StatTile label="Athletes" value={data.players.length} />
          <StatTile label="Sessions" value={data.sessionCount} />
          <StatTile label="Attendance" value={`${data.attendanceRate}%`} tone="pitch" />
        </div>
      </Section>
      <Section title="Athletes under this coach">
        <DataTable
          columns={[
            { key: 'athlete_id', label: 'Athlete ID', mono: true },
            { key: 'name', label: 'Name', render: (r) => <Link to={`/players/${r.id}`} className="link">{r.first_name} {r.last_name}</Link> },
            { key: 'status', label: 'Status', render: (r) => titleCase(r.status) },
          ]}
          rows={data.players}
          empty={{ title: 'No athletes assigned', message: '' }}
        />
      </Section>
      <Section title="Assessments recorded">
        <DataTable
          columns={[
            { key: 'assessment_date', label: 'Date', render: (a) => formatDate(a.assessment_date) },
            { key: 'player', label: 'Athlete', render: (a) => `${a.first_name} ${a.last_name}` },
            { key: 'cycle', label: 'Review', render: (a) => a.cycle || '—' },
            { key: 'overall_score', label: 'Score', align: 'right', mono: true, render: (a) => a.overall_score ?? '—' },
          ]}
          rows={data.assessments}
          empty={{ title: 'No assessments recorded', message: '' }}
        />
      </Section>
    </div>
  );
}
