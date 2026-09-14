import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Users, Trophy, Activity, Crosshair, Radio, Dumbbell, ChevronRight, Target, Flame,
} from 'lucide-react';
import { api } from '../lib/api';
import { PageHeader, Spinner, ErrorNote, EmptyState, Chip } from '../components/ui';
import { formatDate, formatDateTime, titleCase } from '../lib/format';

/**
 * One sport, one screen.
 *
 * Nothing here branches on the sport's name. The panels are chosen from the
 * sport's own configuration — `presentation.charts` says which visuals apply,
 * `periodLabel` says what a period is called, `headline` says which figures
 * lead — so a new sport arrives with a workspace already built.
 *
 * Everything is hand-drawn SVG for the same reason the ball tracker is: the
 * shapes are specific, and a chart library would flatten them into the same
 * four rectangles.
 */

const GOLD = '#F59E0B';
const PITCH = '#10B981';
const SKY = '#38BDF8';
const VIOLET = '#A78BFA';
const ALERT = '#F43F5E';
const INK = '#7A8AA0';

export default function SportWorkspace() {
  const { code } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setData(null);
    setError(null);
    api.get(`/sports/${code}/workspace`).then(setData).catch(setError);
  }, [code]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Opening the sport" />;

  const { sport, presentation, summary, form, teams, leaders, recent, upcoming, analyses, tracking } = data;
  const latest = analyses[0];

  return (
    <>
      <PageHeader
        eyebrow="Sport"
        title={sport.name}
        subtitle={sport.description || `${summary.athletes} athletes across ${summary.squads} squads.`}
        actions={<FormRun form={form} />}
      />

      {/* Headline readouts */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Readout label="Athletes" value={summary.athletes} hint={`${summary.activeAthletes} active`} icon={Users} tone="gold" />
        <Readout label="Squads" value={summary.squads} icon={Users} tone="sky" />
        <Readout label="Matches" value={summary.matchesPlayed} hint={`${summary.wins} won`} icon={Trophy} tone="violet" />
        <Readout label="Scored ball by ball" value={summary.scoredBallByBall} icon={Radio} tone="pitch" />
        <Readout label="Training" value={summary.trainingSessions} hint={summary.attendanceRate != null ? `${summary.attendanceRate}% attendance` : null} icon={Dumbbell} tone="ink" />
        <Readout
          label={presentation.ballBased ? 'Tracked balls' : 'Intensity'}
          value={presentation.ballBased ? summary.trackedDeliveries : (summary.averageIntensity ?? '—')}
          icon={presentation.ballBased ? Crosshair : Flame}
          tone="gold"
        />
      </div>

      {/* The visual the sport asks for */}
      <div className="grid lg:grid-cols-5 gap-5 mt-5">
        <div className="lg:col-span-3">
          <SportVisual presentation={presentation} analysis={latest} sport={sport} />
        </div>
        <div className="lg:col-span-2 space-y-5">
          <SquadPanel teams={teams} sport={sport} />
          {tracking && <TrackingPanel tracking={tracking} />}
        </div>
      </div>

      {/* Leaders, on this sport's own headline figures */}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5 mt-5">
        {leaders.map((group) => <LeaderBoard key={group.key} group={group} />)}
      </div>

      {/* Fixtures */}
      <div className="grid lg:grid-cols-2 gap-5 mt-5">
        <FixtureList title="Recent results" rows={recent} kind="recent" />
        <FixtureList title="Coming up" rows={upcoming} kind="upcoming" />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Form run                                                            */
/* ------------------------------------------------------------------ */

function FormRun({ form }) {
  if (!form?.length) return null;
  const tone = { win: PITCH, loss: ALERT, draw: VIOLET, tie: VIOLET, abandoned: INK, no_result: INK };
  return (
    <span className="flex items-center gap-1.5">
      <span className="hud-label mr-1">Form</span>
      {form.map((r, i) => (
        <span
          key={i}
          title={titleCase(r)}
          className="grid h-6 w-6 place-items-center rounded-md font-mono text-[11px] text-canvas"
          style={{ background: tone[r] || INK }}
        >
          {String(r)[0].toUpperCase()}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The sport's own visual                                              */
/* ------------------------------------------------------------------ */

/**
 * Which visual to draw comes from the sport's `charts` list, so cricket gets
 * an over-by-over read, football and basketball get a shot map, and the racket
 * sports get rally momentum — without this component knowing their names.
 */
function SportVisual({ presentation, analysis, sport }) {
  if (!analysis) {
    return (
      <section className="hud-panel hud-corner p-5 h-full">
        <p className="hud-label relative">Match analysis</p>
        <div className="relative mt-3">
          <EmptyState
            title="Nothing scored ball by ball yet"
            message={`Score a ${sport.name.toLowerCase()} match in the console and the analysis builds itself from the record.`}
          />
        </div>
      </section>
    );
  }

  const charts = presentation.charts || [];
  const period = analysis.periods.find((p) => p.summary) || analysis.periods[0];

  return (
    <section className="hud-panel hud-corner p-5 h-full">
      <header className="flex items-center justify-between mb-3 relative">
        <span className="hud-label flex items-center gap-1.5">
          <Activity size={12} /> Latest scored match
        </span>
        <Link to={`/matches/${analysis.matchId}/analysis`} className="text-[11px] font-mono text-gold hover:underline">
          FULL ANALYSIS <ChevronRight size={11} className="inline" />
        </Link>
      </header>

      <p className="text-sm text-ink-600 relative mb-4">
        vs {analysis.opponent || 'opposition'} · {formatDate(analysis.scheduledAt)}
      </p>

      {charts.includes('manhattan') && period?.overByOver?.length
        ? <Manhattan overs={period.overByOver} worm={period.worm} label={period.label} />
        : charts.includes('shot_map') && period?.shotMap?.length
          ? <ShotMap points={period.shotMap} surface={presentation.surface} />
          : charts.includes('point_progression') && period?.progression?.length
            ? <Progression progression={period.progression} label={period.label} />
            : <SummaryGrid summary={analysis.overall} />}

      {period?.phases?.length > 0 && (
        <div className="mt-4 relative">
          <p className="hud-label mb-2">{presentation.ballBased ? 'Phases' : 'Periods'}</p>
          <div className="flex gap-1.5">
            {period.phases.map((p) => {
              const value = p.runs ?? p.points ?? p.events ?? 0;
              const max = Math.max(...period.phases.map((x) => x.runs ?? x.points ?? x.events ?? 0), 1);
              return (
                <div key={p.key} className="flex-1 text-center">
                  <div className="h-16 flex items-end">
                    <div
                      className="w-full rounded-t bg-gold-grad"
                      style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
                      title={`${p.label}: ${value}`}
                    />
                  </div>
                  <p className="hud-label mt-1 truncate" style={{ fontSize: 9 }}>{p.label}</p>
                  <p className="font-mono text-[11px] text-ink-700">{value}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/** Cricket: runs per over with the cumulative line over the top. */
function Manhattan({ overs, worm, label }) {
  const W = 600;
  const H = 180;
  const max = Math.max(...overs.map((o) => o.runs), 6);
  const barW = W / overs.length;

  const cumulativeMax = worm?.length ? Math.max(...worm.map((w) => w.runs), 1) : 1;
  const line = worm?.length
    ? worm.map((w, i) => `${i === 0 ? 'M' : 'L'} ${(i + 0.5) * barW} ${H - (w.runs / cumulativeMax) * (H - 20) - 8}`).join(' ')
    : null;

  return (
    <div className="relative">
      <p className="hud-label mb-2">{label} — runs per over</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Runs per over">
        <defs>
          <linearGradient id="barGold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOLD} />
            <stop offset="100%" stopColor="#EA580C" />
          </linearGradient>
        </defs>
        {[0.33, 0.66].map((f) => (
          <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} stroke="#1E293B" strokeDasharray="4 6" />
        ))}
        {overs.map((o, i) => {
          const h = Math.max(3, (o.runs / max) * (H - 26));
          return (
            <g key={i}>
              <rect
                x={i * barW + barW * 0.15} y={H - h - 14}
                width={barW * 0.7} height={h} rx="2"
                fill={o.wickets ? ALERT : 'url(#barGold)'}
                opacity={o.wickets ? 0.9 : 0.85}
              >
                <title>{`Over ${o.over}: ${o.runs} runs${o.wickets ? `, ${o.wickets} wicket` : ''}`}</title>
              </rect>
              {i % 3 === 0 && (
                <text x={i * barW + barW / 2} y={H - 3} fill={INK} fontSize="9" textAnchor="middle" fontFamily="IBM Plex Mono">
                  {o.over}
                </text>
              )}
            </g>
          );
        })}
        {line && <path d={line} fill="none" stroke={SKY} strokeWidth="2" opacity="0.85" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="flex justify-center gap-4 mt-1 text-[10px] text-ink-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-gold" />Runs</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-alert" />Wicket over</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-sky" />Cumulative</span>
      </div>
    </div>
  );
}

/** Football, futsal, basketball: where the shots came from. */
function ShotMap({ points, surface }) {
  const basketball = surface === 'basketball';
  return (
    <div className="relative">
      <p className="hud-label mb-2">Shot map — {points.length} shots</p>
      <svg viewBox="0 0 100 100" className="w-full max-w-sm mx-auto" role="img" aria-label="Shot map">
        <defs>
          <filter id="wsGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect x="0" y="0" width="100" height="100" rx="2" fill="#0A0F1C" stroke="#1E293B" />
        {basketball ? (
          <>
            <circle cx="50" cy="95" r="6" fill="none" stroke="#2A3A52" />
            <path d="M12 100 A 40 40 0 0 1 88 100" fill="none" stroke="#2A3A52" strokeDasharray="2 2" />
            <rect x="38" y="80" width="24" height="20" fill="none" stroke="#2A3A52" />
          </>
        ) : (
          <>
            <line x1="50" y1="0" x2="50" y2="100" stroke="#2A3A52" strokeDasharray="2 2" />
            <circle cx="50" cy="50" r="10" fill="none" stroke="#2A3A52" />
            <rect x="0" y="30" width="14" height="40" fill="none" stroke="#2A3A52" />
            <rect x="86" y="30" width="14" height="40" fill="none" stroke="#2A3A52" />
          </>
        )}
        {points.map((p, i) => (
          <circle
            key={i} cx={p.x} cy={p.y} r={p.scored ? 2.6 : 1.8}
            fill={p.scored ? GOLD : 'none'}
            stroke={p.scored ? GOLD : p.onTarget ? SKY : INK}
            strokeWidth="1"
            filter={p.scored ? 'url(#wsGlow)' : undefined}
          >
            <title>{`${p.player || 'Player'}${p.minute ? ` — ${Math.round(p.minute)}'` : ''} · ${p.scored ? 'scored' : p.onTarget ? 'on target' : 'off target'}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-center gap-4 mt-2 text-[10px] text-ink-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gold" />Scored</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-sky" />On target</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-ink-200" />Off target</span>
      </div>
    </div>
  );
}

/** Racket and volleyball: how the lead moved, rally by rally. */
function Progression({ progression, label }) {
  const W = 600;
  const H = 170;
  const leads = progression.map((p) => p.lead);
  const bound = Math.max(Math.abs(Math.min(...leads)), Math.max(...leads), 3);
  const x = (i) => (i / Math.max(progression.length - 1, 1)) * W;
  const y = (lead) => H / 2 - (lead / bound) * (H / 2 - 12);
  const line = progression.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.lead)}`).join(' ');

  return (
    <div className="relative">
      <p className="hud-label mb-2">{label} — how the lead moved</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Lead by rally">
        <defs>
          <linearGradient id="leadWs" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PITCH} stopOpacity="0.45" />
            <stop offset="50%" stopColor={PITCH} stopOpacity="0.05" />
            <stop offset="50%" stopColor={ALERT} stopOpacity="0.05" />
            <stop offset="100%" stopColor={ALERT} stopOpacity="0.4" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#leadWs)" opacity="0.5" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#2A3A52" />
        <path d={line} fill="none" stroke={GOLD} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="text-[10px] text-ink-400 text-center mt-1">
        Above the line is a Karwan lead; below it, the opposition ahead.
      </p>
    </div>
  );
}

/** Anything without a declared visual still gets its figures. */
function SummaryGrid({ summary }) {
  const entries = Object.entries(summary || {})
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .slice(0, 8);
  if (!entries.length) return <p className="text-sm text-ink-400 relative">No figures recorded yet.</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 relative">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-lg bg-surface-sunken/70 px-3 py-2">
          <p className="hud-label truncate">{titleCase(key)}</p>
          <p className="stat-value text-lg mt-0.5">{value}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Side panels                                                         */
/* ------------------------------------------------------------------ */

function SquadPanel({ teams, sport }) {
  return (
    <section className="hud-panel hud-corner p-5">
      <header className="flex items-center justify-between mb-3 relative">
        <span className="hud-label flex items-center gap-1.5"><Users size={12} /> Squads</span>
        <span className="font-mono text-[10px] text-ink-400">{teams.length}</span>
      </header>
      {teams.length === 0 ? (
        <p className="text-sm text-ink-400 relative">No squads set up for {sport.name} yet.</p>
      ) : (
        <ul className="space-y-2 relative">
          {teams.map((t) => {
            const rate = t.played ? Math.round((t.won / t.played) * 100) : null;
            return (
              <li key={t.id}>
                <Link
                  to={`/teams/${t.id}`}
                  className="block rounded-lg border border-line px-3 py-2.5 hover:border-gold/50 transition-colors"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="text-sm text-ink block truncate">{t.name}</span>
                      <span className="hud-label">
                        {[t.age_group, titleCase(t.level), `${t.squad_size} athletes`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="stat-value text-sm block">{rate != null ? `${rate}%` : '—'}</span>
                      <span className="hud-label">{t.played} played</span>
                    </span>
                  </span>
                  {rate != null && (
                    <span className="mt-2 block h-1.5 rounded-full bg-surface-sunken overflow-hidden">
                      <span className="block h-full rounded-full bg-gold-grad" style={{ width: `${rate}%` }} />
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TrackingPanel({ tracking }) {
  const s = tracking.speed;
  const c = tracking.consistency;
  return (
    <section className="hud-panel hud-corner p-5">
      <header className="flex items-center justify-between mb-3 relative">
        <span className="hud-label flex items-center gap-1.5"><Crosshair size={12} /> Ball tracking</span>
        <Link to="/tracking" className="text-[11px] font-mono text-gold hover:underline">
          OPEN <ChevronRight size={11} className="inline" />
        </Link>
      </header>
      <div className="grid grid-cols-2 gap-2 relative">
        <Mini label="Deliveries" value={tracking.deliveries} />
        <Mini label="Sessions" value={tracking.sessions} />
        <Mini label="Average pace" value={s?.averageRelease ? `${s.averageRelease}` : '—'} tone="text-gold" />
        <Mini label="Fastest" value={s?.peakRelease ?? '—'} tone="text-violet" />
        <Mini label="In zone" value={c ? `${c.hitRate}%` : '—'} tone="text-pitch" />
        <Mini label="Hitting stumps" value={tracking.stumpLine ? `${tracking.stumpLine.hittingPercent}%` : '—'} tone="text-sky" />
      </div>
    </section>
  );
}

function LeaderBoard({ group }) {
  const top = group.leaders[0];
  const max = Math.max(...group.leaders.map((l) => Math.abs(l.value)), 1);
  return (
    <section className="hud-panel hud-corner p-4">
      <header className="flex items-center justify-between mb-3 relative">
        <span className="hud-label flex items-center gap-1.5"><Target size={11} /> {group.label}</span>
        {group.lowerIsBetter && <span className="font-mono text-[9px] text-ink-400">LOWER IS BETTER</span>}
      </header>
      <ul className="space-y-2 relative">
        {group.leaders.map((l, i) => (
          <li key={l.player.id}>
            <Link to={`/players/${l.player.id}`} className="flex items-center gap-2.5 group">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded font-mono text-[10px] ${
                i === 0 ? 'bg-gold-grad text-[#1A1206]' : 'bg-surface-sunken text-ink-400'
              }`}>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-sm text-ink-700 group-hover:text-gold block truncate">{l.player.name}</span>
                <span className="block h-1 mt-1 rounded-full bg-surface-sunken overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-gold-grad"
                    style={{ width: `${Math.max(8, (Math.abs(l.value) / max) * 100)}%` }}
                  />
                </span>
              </span>
              <span className="stat-value text-sm shrink-0">{l.value}</span>
            </Link>
          </li>
        ))}
      </ul>
      {top && <p className="hud-label mt-2.5 relative">Leader from {top.matches} matches</p>}
    </section>
  );
}

function FixtureList({ title, rows, kind }) {
  return (
    <section className="hud-panel hud-corner p-5">
      <header className="flex items-center justify-between mb-3 relative">
        <span className="hud-label">{title}</span>
        <span className="font-mono text-[10px] text-ink-400">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-400 relative">Nothing to show.</p>
      ) : (
        <ul className="divide-y divide-line relative">
          {rows.map((m) => (
            <li key={m.id}>
              <Link to={`/matches/${m.id}`} className="flex items-center justify-between gap-3 py-2.5 group">
                <span className="min-w-0">
                  <span className="text-sm text-ink-700 group-hover:text-gold block truncate">
                    {m.team_name || 'Karwan'} vs {m.opponent_name || 'Opposition'}
                  </span>
                  <span className="hud-label">
                    {kind === 'recent' ? formatDate(m.scheduled_at) : formatDateTime(m.scheduled_at)}
                    {m.venue ? ` · ${m.venue}` : ''}
                  </span>
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  {kind === 'recent' && m.result && (
                    <Chip tone={m.result === 'win' ? 'active' : m.result === 'loss' ? 'absent' : 'draw'}>
                      {titleCase(m.result)}
                    </Chip>
                  )}
                  {kind === 'recent' && m.event_count > 0 && (
                    <span className="font-mono text-[10px] text-gold" title="Scored ball by ball">●</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

const TONE = {
  gold: 'text-gold', sky: 'text-sky', violet: 'text-violet',
  pitch: 'text-pitch', ink: 'text-ink', alert: 'text-alert',
};

function Readout({ label, value, hint, icon: Icon, tone = 'ink' }) {
  return (
    <section className="hud-panel p-4">
      <span className="hud-label flex items-center gap-1.5 relative">
        {Icon && <Icon size={11} />} {label}
      </span>
      <p className={`hud-readout text-3xl mt-1.5 relative ${TONE[tone]}`}>{value ?? '—'}</p>
      {hint && <p className="text-[11px] text-ink-400 mt-0.5 relative">{hint}</p>}
    </section>
  );
}

function Mini({ label, value, tone = 'text-ink-700' }) {
  return (
    <span className="block rounded-lg bg-surface-sunken/70 px-2.5 py-2">
      <span className="hud-label block">{label}</span>
      <span className={`font-mono text-sm ${tone}`}>{value}</span>
    </span>
  );
}
