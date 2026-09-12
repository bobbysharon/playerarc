import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine,
} from 'recharts';
import { Radio, RefreshCw, Target, Activity } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader, Section, Spinner, ErrorNote, DataTable, Tabs, StatTile, Chip, EmptyState,
} from '../components/ui';
import { formatDateTime, titleCase } from '../lib/format';

const AXIS = { stroke: '#7A8AA0', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' };
const GRID = '#1E293B';
const TOOLTIP = {
  contentStyle: {
    borderRadius: 10, border: '1px solid #2A3A52', background: '#0F172A',
    fontSize: 12, fontFamily: 'Inter, sans-serif', color: '#F8FAFC',
  },
  labelStyle: { color: '#94A3B8' },
};

export default function MatchAnalysis() {
  const { id } = useParams();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('overall');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/matches/${id}/analysis`).then(setData).catch(setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function rebuild() {
    setBusy(true);
    try {
      await api.post(`/matches/${id}/analysis/rebuild`);
      load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Building the match analysis" />;

  if (!data.totalEvents) {
    return (
      <>
        <PageHeader
          eyebrow={data.match.sport}
          title="Match analysis"
          subtitle="Every chart here is built from the delivery-by-delivery record."
          actions={<Link to={`/matches/${id}`} className="btn-ghost">Back to the match</Link>}
        />
        <Section>
          <EmptyState
            title="Nothing recorded ball by ball yet"
            message="Score the match in the capture console and the scorecard, run rate, partnerships, maps and momentum all build themselves from it."
            action={can('performances.write')
              ? <Link to={`/matches/${id}/scoring`} className="btn-gold">Open the scoring console</Link>
              : null}
          />
        </Section>
      </>
    );
  }

  const tabs = [
    { key: 'overall', label: 'Match' },
    ...data.periods.map((p) => ({ key: `p${p.period.id}`, label: p.period.label, count: p.events })),
    { key: 'commentary', label: 'Commentary', count: data.commentary.length },
  ];

  const active = view === 'overall'
    ? data.overall
    : view === 'commentary'
      ? null
      : data.periods.find((p) => `p${p.period.id}` === view);

  return (
    <>
      <PageHeader
        eyebrow={`${data.match.sport} · ${formatDateTime(data.match.scheduledAt)}`}
        title={`${data.match.homeTeam || 'Karwan'} vs ${data.match.opponent || 'Opposition'}`}
        subtitle={`${data.totalEvents} events recorded. Everything below is derived from them — correct one and every figure follows.`}
        actions={
          <>
            <Link to={`/matches/${id}`} className="btn-ghost">Match record</Link>
            {can('performances.write') && (
              <>
                <button type="button" className="btn-ghost" onClick={rebuild} disabled={busy}>
                  <RefreshCw size={14} /> {busy ? 'Rebuilding…' : 'Rebuild scorecard'}
                </button>
                <Link to={`/matches/${id}/scoring`} className="btn-gold"><Radio size={14} /> Scoring console</Link>
              </>
            )}
          </>
        }
      />

      <Tabs tabs={tabs} active={view} onChange={setView} />

      <div className="mt-5">
        {view === 'commentary' && <Commentary entries={data.commentary} />}
        {active && active.kind === 'cricket' && <CricketAnalysis data={active} />}
        {active && active.kind === 'cricket-match' && <CricketMatchTotals data={active} periods={data.periods} />}
        {active && (active.kind === 'clock' || active.kind === 'basketball') && <ClockAnalysis data={active} isBasketball={active.kind === 'basketball'} />}
        {active && active.kind === 'points' && <PointAnalysis data={active} />}
      </div>
    </>
  );
}

/* ================================================================== */
/* Cricket                                                            */
/* ================================================================== */

function CricketAnalysis({ data }) {
  const s = data.summary;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Score" value={`${s.runs}/${s.wickets}`} hint={`${s.overs} overs`} tone="gold" />
        <StatTile label="Run rate" value={s.runRate} tone="pitch" icon={Activity} />
        <StatTile label="Boundaries" value={s.boundaries} hint={`${s.boundaryPercent}% of balls`} tone="sky" />
        <StatTile label="Dot balls" value={s.dotBalls} hint={`${s.dotBallPercent}%`} tone="violet" />
        <StatTile label="Extras" value={s.extrasTotal} hint={s.extras.map((e) => `${e.runs} ${e.type}`).join(', ') || '—'} tone="ink" />
        <StatTile label="Control" value={s.controlPercent != null ? `${s.controlPercent}%` : '—'} hint="balls middled" tone="pitch" icon={Target} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Runs per over" subtitle="Wickets marked in red">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={data.overByOver} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="over" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="runs" radius={[5, 5, 0, 0]}>
                  {data.overByOver.map((o, i) => (
                    <Cell key={i} fill={o.wickets > 0 ? '#F43F5E' : o.runs >= 12 ? '#F59E0B' : '#38BDF8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Scoring progression" subtitle="Cumulative runs against the over count">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={data.worm} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
                <defs>
                  <linearGradient id="wormFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="over" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip {...TOOLTIP} />
                <Area type="monotone" dataKey="runs" stroke="#F59E0B" strokeWidth={2.5} fill="url(#wormFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      <Section title="Batting" subtitle="Built from every delivery faced">
        <DataTable
          columns={[
            {
              key: 'name', label: 'Batter',
              render: (b) => (b.playerId
                ? <Link to={`/players/${b.playerId}`} className="link">{b.name}</Link>
                : <span className="text-ink-400">{b.name} <span className="text-[10px]">opposition</span></span>),
            },
            { key: 'runs', label: 'R', align: 'right', mono: true, render: (b) => `${b.runs}${b.out ? '' : '*'}` },
            { key: 'balls', label: 'B', align: 'right', mono: true },
            { key: 'fours', label: '4s', align: 'right', mono: true },
            { key: 'sixes', label: '6s', align: 'right', mono: true },
            { key: 'strikeRate', label: 'SR', align: 'right', mono: true },
            { key: 'dotPercent', label: 'Dot %', align: 'right', mono: true, render: (b) => `${b.dotPercent}%` },
            { key: 'controlPercent', label: 'Control', align: 'right', mono: true, render: (b) => (b.controlPercent != null ? `${b.controlPercent}%` : '—') },
            { key: 'dismissal', label: 'How out', render: (b) => (b.out ? titleCase(b.dismissal) : <span className="text-pitch">not out</span>) },
          ]}
          rows={data.battingCard}
          empty={{ title: 'No batting recorded', message: '' }}
        />
      </Section>

      <Section title="Bowling" subtitle="Economy, strike rate and dot percentage from the same deliveries">
        <DataTable
          columns={[
            {
              key: 'name', label: 'Bowler',
              render: (b) => (b.playerId
                ? <Link to={`/players/${b.playerId}`} className="link">{b.name}</Link>
                : <span className="text-ink-400">{b.name} <span className="text-[10px]">opposition</span></span>),
            },
            { key: 'overs', label: 'O', align: 'right', mono: true },
            { key: 'maidens', label: 'M', align: 'right', mono: true },
            { key: 'runs', label: 'R', align: 'right', mono: true },
            { key: 'wickets', label: 'W', align: 'right', mono: true },
            { key: 'economy', label: 'Econ', align: 'right', mono: true },
            { key: 'dotPercent', label: 'Dot %', align: 'right', mono: true, render: (b) => `${b.dotPercent}%` },
            { key: 'strikeRate', label: 'SR', align: 'right', mono: true, render: (b) => b.strikeRate ?? '—' },
            { key: 'extras', label: 'Wd/Nb', align: 'right', mono: true, render: (b) => `${b.wides}/${b.noBalls}` },
            { key: 'avgDeviation', label: 'Avg dev.', align: 'right', mono: true, render: (b) => (b.avgDeviation != null ? `${b.avgDeviation}°` : '—') },
          ]}
          rows={data.bowlingCard}
          empty={{ title: 'No bowling recorded', message: '' }}
        />
      </Section>

      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Wagon wheel" subtitle="Where every scoring shot went">
          <div className="p-4"><WagonWheel points={data.wagonWheel} /></div>
        </Section>
        <Section title="Pitch map" subtitle="Runs conceded by length and line">
          <div className="p-4"><PitchMap points={data.pitchMap} /></div>
        </Section>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Section title="Phases">
          <div className="p-4 space-y-3">
            {data.phases.map((p) => (
              <div key={p.key}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-ink-600">{p.label}</span>
                  <span className="stat-value">{p.runs}/{p.wickets} <span className="text-ink-400 text-xs">@{p.runRate}</span></span>
                </div>
                <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gold-grad" style={{ width: `${Math.min((p.runRate / 15) * 100, 100)}%` }} />
                </div>
              </div>
            ))}
            {!data.phases.length && <p className="text-sm text-ink-400">Not enough overs yet.</p>}
          </div>
        </Section>

        <Section title="Partnerships">
          <div className="p-4 space-y-2">
            {data.partnerships.map((p, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-ink-400 truncate">{p.batters.join(' & ') || `Wicket ${p.wicket}`}</span>
                  <span className="stat-value text-xs">{p.runs} ({p.balls}){p.unbroken ? '*' : ''}</span>
                </div>
                <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${p.unbroken ? 'bg-pitch' : 'bg-sky'}`}
                    style={{ width: `${Math.min((p.runs / Math.max(...data.partnerships.map((x) => x.runs), 1)) * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {!data.partnerships.length && <p className="text-sm text-ink-400">No partnerships yet.</p>}
          </div>
        </Section>

        <Section title="Fall of wickets">
          <ul className="divide-y divide-line">
            {data.fallOfWickets.map((f) => (
              <li key={f.wicket} className="px-4 py-2 flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-sm block truncate">{f.player}</span>
                  <span className="text-[11px] text-ink-400">{titleCase(f.dismissal)}{f.bowler ? ` · ${f.bowler}` : ''}</span>
                </span>
                <span className="stat-value text-sm shrink-0">{f.runs}-{f.wicket} <span className="text-ink-400 text-xs">({f.over})</span></span>
              </li>
            ))}
            {!data.fallOfWickets.length && <li className="px-4 py-6 text-sm text-ink-400 text-center">No wickets fallen.</li>}
          </ul>
        </Section>
      </div>

      {data.matchups.length > 0 && (
        <Section title="Head to head" subtitle="Only where both athletes are on the club's books">
          <DataTable
            columns={[
              { key: 'batter', label: 'Batter' },
              { key: 'bowler', label: 'Bowler' },
              { key: 'balls', label: 'Balls', align: 'right', mono: true },
              { key: 'runs', label: 'Runs', align: 'right', mono: true },
              { key: 'dots', label: 'Dots', align: 'right', mono: true },
              { key: 'strikeRate', label: 'SR', align: 'right', mono: true },
              { key: 'dismissals', label: 'Out', align: 'right', mono: true },
            ]}
            rows={data.matchups.slice(0, 12)}
            empty={{ title: '', message: '' }}
          />
        </Section>
      )}
    </div>
  );
}

function CricketMatchTotals({ data, periods }) {
  const s = data.summary;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Innings" value={s.innings} tone="violet" />
        <StatTile label="Runs" value={s.runs} hint={`${s.overs} overs bowled`} tone="gold" />
        <StatTile label="Wickets" value={s.wickets} tone="alert" />
        <StatTile label="Run rate" value={s.runRate} tone="pitch" />
        <StatTile label="Boundaries" value={s.boundaries} tone="sky" />
        <StatTile label="Control" value={s.controlPercent != null ? `${s.controlPercent}%` : '—'} tone="ink" />
      </div>

      <Section title="Innings" subtitle="Per-innings detail is the authoritative view — open a tab above">
        <DataTable
          columns={[
            { key: 'label', label: 'Innings', render: (p) => p.period.label },
            { key: 'batting', label: 'Batting', render: (p) => p.period.teamLabel || 'Karwan' },
            { key: 'score', label: 'Score', mono: true, render: (p) => `${p.summary.runs}/${p.summary.wickets}` },
            { key: 'overs', label: 'Overs', align: 'right', mono: true, render: (p) => p.summary.overs },
            { key: 'rr', label: 'Run rate', align: 'right', mono: true, render: (p) => p.summary.runRate },
            { key: 'dots', label: 'Dot %', align: 'right', mono: true, render: (p) => `${p.summary.dotBallPercent}%` },
            { key: 'boundaries', label: '4s + 6s', align: 'right', mono: true, render: (p) => p.summary.boundaries },
          ]}
          rows={periods}
          empty={{ title: 'No innings recorded', message: '' }}
        />
      </Section>

      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Karwan batting across the match">
          <DataTable
            columns={[
              { key: 'name', label: 'Batter', render: (b) => <Link to={`/players/${b.playerId}`} className="link">{b.name}</Link> },
              { key: 'runs', label: 'R', align: 'right', mono: true, render: (b) => `${b.runs}${b.out ? '' : '*'}` },
              { key: 'balls', label: 'B', align: 'right', mono: true },
              { key: 'strikeRate', label: 'SR', align: 'right', mono: true },
            ]}
            rows={data.battingCard}
            empty={{ title: 'No batting recorded', message: '' }}
          />
        </Section>
        <Section title="Karwan bowling across the match">
          <DataTable
            columns={[
              { key: 'name', label: 'Bowler', render: (b) => <Link to={`/players/${b.playerId}`} className="link">{b.name}</Link> },
              { key: 'overs', label: 'O', align: 'right', mono: true },
              { key: 'runs', label: 'R', align: 'right', mono: true },
              { key: 'wickets', label: 'W', align: 'right', mono: true },
              { key: 'economy', label: 'Econ', align: 'right', mono: true },
            ]}
            rows={data.bowlingCard}
            empty={{ title: 'No bowling recorded', message: '' }}
          />
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Maps                                                                */
/* ------------------------------------------------------------------ */

function WagonWheel({ points }) {
  if (!points?.length) return <EmptyState title="No scoring shots plotted" message="Record where the ball went and it appears here." />;
  const colour = (runs) => (runs === 6 ? '#A78BFA' : runs === 4 ? '#38BDF8' : runs >= 2 ? '#10B981' : '#7A8AA0');
  return (
    <>
      <svg viewBox="0 0 200 200" className="w-full max-w-sm mx-auto" role="img" aria-label="Wagon wheel of scoring shots">
        <circle cx="100" cy="100" r="95" fill="#0A0F1C" stroke="#1E293B" strokeWidth="1.5" />
        <circle cx="100" cy="100" r="60" fill="none" stroke="#1E293B" strokeWidth="1" strokeDasharray="3 3" />
        <rect x="94" y="78" width="12" height="44" rx="2" fill="#16203A" stroke="#2A3A52" />
        {points.map((p, i) => (
          <line
            key={i}
            x1="100" y1="100"
            x2={100 + (p.x - 50) * 1.85} y2={100 - (p.y - 50) * 1.85}
            stroke={colour(p.runs)} strokeWidth={p.runs >= 4 ? 1.8 : 1} opacity={p.runs >= 4 ? 0.95 : 0.5}
          >
            <title>{`${p.batter || 'Batter'} — ${p.runs} run${p.runs === 1 ? '' : 's'}${p.shot ? `, ${p.shot}` : ''} (over ${p.over})`}</title>
          </line>
        ))}
        <circle cx="100" cy="100" r="3" fill="#F59E0B" />
      </svg>
      <div className="flex justify-center gap-3 mt-3 text-[11px]">
        {[['6', '#A78BFA'], ['4', '#38BDF8'], ['2–3', '#10B981'], ['1', '#7A8AA0']].map(([l, c]) => (
          <span key={l} className="flex items-center gap-1 text-ink-400">
            <span className="h-0.5 w-4 rounded" style={{ background: c }} />{l}
          </span>
        ))}
      </div>
    </>
  );
}

function PitchMap({ points }) {
  if (!points?.length) return <EmptyState title="No lengths recorded" message="Record length and line and the map builds itself." />;
  const LENGTHS = ['yorker', 'full toss', 'full', 'good', 'back of a length', 'short'];
  const LINES = ['wide outside off', 'outside off', 'off stump', 'middle', 'leg stump', 'down leg'];

  const grid = LENGTHS.map((length) => LINES.map((line) => {
    const cell = points.filter((p) => p.length === length && p.line === line);
    const devReadings = cell.map((p) => p.deviation).filter((d) => d != null);
    return {
      length, line, balls: cell.length,
      runs: cell.reduce((a, p) => a + p.runs, 0),
      wickets: cell.filter((p) => p.wicket).length,
      avgDeviation: devReadings.length ? Math.round((devReadings.reduce((a, d) => a + d, 0) / devReadings.length) * 10) / 10 : null,
    };
  }));
  const maxRuns = Math.max(...grid.flat().map((c) => c.runs), 1);

  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-max text-[11px]">
        <thead>
          <tr>
            <th className="th" />
            {LINES.map((l) => <th key={l} className="th text-center normal-case tracking-normal">{l.replace('wide outside off', 'wide off')}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, i) => (
            <tr key={LENGTHS[i]}>
              <td className="td text-ink-400 whitespace-nowrap">{LENGTHS[i]}</td>
              {row.map((cell) => (
                <td key={cell.line} className="td text-center p-1">
                  <span
                    className="grid place-items-center h-9 rounded"
                    style={{
                      background: cell.balls
                        ? (cell.wickets ? 'rgba(244,63,94,0.35)' : `rgba(245,158,11,${0.12 + (cell.runs / maxRuns) * 0.6})`)
                        : 'transparent',
                    }}
                    title={cell.balls ? `${cell.balls} balls, ${cell.runs} runs, ${cell.wickets} wickets${cell.avgDeviation != null ? `, avg deviation ${cell.avgDeviation}°` : ''}` : 'no balls here'}
                  >
                    {cell.balls ? (
                      <span className="stat-value text-xs">{cell.runs}{cell.wickets ? <span className="text-alert"> ✕{cell.wickets}</span> : null}</span>
                    ) : <span className="text-ink-200">·</span>}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-ink-400 mt-2">Shading shows runs conceded; red marks where wickets fell.</p>
    </div>
  );
}

/* ================================================================== */
/* Clock sports                                                       */
/* ================================================================== */

function ClockAnalysis({ data, isBasketball }) {
  const s = data.summary;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label={isBasketball ? 'Points' : 'Goals'} value={isBasketball ? s.points : s.scores} tone="gold" />
        <StatTile label="Shots" value={s.shots} hint={`${s.accuracy}% on target`} tone="sky" icon={Target} />
        <StatTile label="Conversion" value={`${s.conversion}%`} tone="pitch" />
        <StatTile label={isBasketball ? 'Turnovers' : 'Saves'} value={isBasketball ? s.turnovers : s.saves} tone="violet" />
        <StatTile label="Fouls" value={s.fouls} tone="ink" />
        <StatTile label="Events" value={s.events} tone="ink" icon={Activity} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Section title={isBasketball ? 'Shot chart' : 'Shot map'} subtitle="Filled markers were scored">
          <div className="p-4"><ShotMap points={data.shotMap} isBasketball={isBasketball} /></div>
        </Section>

        <Section title="Scoring progression">
          <div className="p-4">
            {data.momentum.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={data.momentum} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="minute" tick={AXIS} axisLine={false} tickLine={false} unit="'" />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip {...TOOLTIP} />
                  <Line type="stepAfter" dataKey="score" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 4, fill: '#F59E0B', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="Nothing scored yet" message="The progression appears once a goal or basket is recorded." />}
          </div>
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Activity by phase">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.phases} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="shots" name="Shots" fill="#38BDF8" radius={[5, 5, 0, 0]} />
                <Bar dataKey="scores" name="Scored" fill="#F59E0B" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Contributions" subtitle="Counted straight off the event stream">
          <DataTable
            columns={[
              { key: 'name', label: 'Athlete', render: (c) => <Link to={`/players/${c.playerId}`} className="link">{c.name}</Link> },
              ...['points', 'goals', 'assists', 'shots', 'saves', 'tackle', 'interception', 'defensive_rebounds', 'turnovers', 'fouls']
                .filter((k) => data.contributions.some((c) => c[k]))
                .slice(0, 6)
                .map((k) => ({ key: k, label: titleCase(k), align: 'right', mono: true, render: (c) => c[k] ?? '—' })),
            ]}
            rows={data.contributions.filter((c) => c.playerId).sort((a, b) => (b.points || b.goals || b.shots || 0) - (a.points || a.goals || a.shots || 0))}
            empty={{ title: 'No contributions recorded', message: '' }}
          />
        </Section>
      </div>

      <Section title="Match timeline">
        <ul className="divide-y divide-line max-h-96 overflow-y-auto scroll-thin">
          {data.timeline.map((t) => (
            <li key={t.id} className="px-4 py-2.5 flex items-center gap-3">
              <span className="font-mono text-[11px] text-gold w-10 shrink-0">{t.minute != null ? `${Math.round(t.minute)}'` : '—'}</span>
              <Chip tone={t.outcome === 'goal' || t.outcome?.startsWith('made') ? 'active' : t.type === 'card' ? 'absent' : 'scheduled'}>
                {titleCase(t.outcome || t.type)}
              </Chip>
              <span className="text-sm text-ink-600 min-w-0 flex-1 truncate">{t.player}{t.secondary ? ` · ${t.secondary}` : ''}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function ShotMap({ points, isBasketball }) {
  if (!points?.length) return <EmptyState title="No shots plotted" message="Record shot locations and the map builds itself." />;
  return (
    <>
      <svg viewBox="0 0 100 100" className="w-full max-w-md mx-auto" role="img" aria-label="Shot map">
        <rect x="0" y="0" width="100" height="100" rx="2" fill="#0A0F1C" stroke="#1E293B" />
        {isBasketball ? (
          <>
            <circle cx="50" cy="95" r="6" fill="none" stroke="#2A3A52" />
            <path d="M12 100 A 40 40 0 0 1 88 100" fill="none" stroke="#2A3A52" strokeDasharray="2 2" />
            <rect x="38" y="80" width="24" height="20" fill="none" stroke="#2A3A52" />
          </>
        ) : (
          <>
            <line x1="0" y1="50" x2="100" y2="50" stroke="#2A3A52" strokeDasharray="2 2" />
            <circle cx="50" cy="50" r="10" fill="none" stroke="#2A3A52" />
            <rect x="0" y="30" width="16" height="40" fill="none" stroke="#2A3A52" />
            <rect x="84" y="30" width="16" height="40" fill="none" stroke="#2A3A52" />
          </>
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x} cy={p.y}
            r={p.scored ? 2.6 : 1.8}
            fill={p.scored ? '#F59E0B' : 'none'}
            stroke={p.scored ? '#F59E0B' : p.onTarget ? '#38BDF8' : '#7A8AA0'}
            strokeWidth="1"
            opacity={p.scored ? 1 : 0.75}
          >
            <title>{`${p.player || 'Player'}${p.minute ? ` — ${Math.round(p.minute)}'` : ''}${p.type ? `, ${p.type}` : ''} — ${p.scored ? 'scored' : p.onTarget ? 'on target' : 'off target'}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-center gap-4 mt-3 text-[11px] text-ink-400">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gold" />Scored</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-sky" />On target</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-ink-200" />Off target</span>
      </div>
    </>
  );
}

/* ================================================================== */
/* Point sports                                                       */
/* ================================================================== */

function PointAnalysis({ data }) {
  const s = data.summary;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Points won" value={s.pointsFor} hint={`${s.winPercent}% of rallies`} tone="pitch" />
        <StatTile label="Points lost" value={s.pointsAgainst} tone="alert" />
        <StatTile label="Best run" value={s.longestRunFor} hint="consecutive points" tone="gold" />
        <StatTile label="Run conceded" value={s.longestRunAgainst} tone="ink" />
        <StatTile label="Average rally" value={s.averageRally ?? '—'} hint="shots" tone="sky" />
        <StatTile label="Longest rally" value={s.longestRally ?? '—'} hint="shots" tone="violet" />
      </div>

      <Section title="Momentum" subtitle="How the lead moved, rally by rally">
        <div className="p-4">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.momentum} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
              <defs>
                <linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#F43F5E" stopOpacity={0.35} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="rally" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP} />
              <ReferenceLine y={0} stroke="#2A3A52" />
              <Area type="monotone" dataKey="lead" stroke="#F59E0B" strokeWidth={2} fill="url(#leadFill)" />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-ink-400 mt-2">Above the line is a Karwan lead; below it, the opposition ahead.</p>
        </div>
      </Section>

      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="How points were won and lost">
          <DataTable
            columns={[
              { key: 'reason', label: 'Reason', render: (r) => titleCase(r.reason) },
              { key: 'us', label: 'Won', align: 'right', mono: true },
              { key: 'them', label: 'Lost', align: 'right', mono: true },
              {
                key: 'bar', label: '',
                render: (r) => (
                  <span className="flex h-2 w-28 rounded-full overflow-hidden bg-surface-sunken">
                    <span className="bg-pitch" style={{ width: `${(r.us / Math.max(r.us + r.them, 1)) * 100}%` }} />
                    <span className="bg-alert" style={{ width: `${(r.them / Math.max(r.us + r.them, 1)) * 100}%` }} />
                  </span>
                ),
              },
            ]}
            rows={data.reasons}
            empty={{ title: 'No reasons recorded', message: '' }}
          />
        </Section>

        <Section title="Rally lengths">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.rallyBuckets} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                  {data.rallyBuckets.map((b, i) => <Cell key={i} fill={['#38BDF8', '#10B981', '#F59E0B', '#A78BFA'][i % 4]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Commentary                                                         */
/* ================================================================== */

function Commentary({ entries }) {
  const [filter, setFilter] = useState('');
  const shown = filter ? entries.filter((e) => e.type === filter) : entries;
  const types = [...new Set(entries.map((e) => e.type))];

  return (
    <Section
      title="Ball-by-ball commentary"
      subtitle="Generated from the recorded events, newest first"
      actions={
        <select className="input py-1.5 text-xs w-36" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Everything</option>
          {types.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      }
    >
      <ul className="divide-y divide-line max-h-[70vh] overflow-y-auto scroll-thin">
        {shown.map((e) => (
          <li key={e.id} className={`px-4 py-2.5 flex items-start gap-3 ${e.isVoid ? 'opacity-40' : ''}`}>
            <span className="font-mono text-[11px] text-gold w-12 shrink-0 pt-0.5">
              {e.over || (e.minute != null ? `${Math.round(e.minute)}'` : `#${e.sequence}`)}
            </span>
            <span className="text-sm text-ink-700 flex-1">{e.text}</span>
            {e.isVoid && <Chip tone="inactive">Voided</Chip>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
