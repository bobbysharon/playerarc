import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gauge, Crosshair, Target, Cpu, Radio, Activity, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { PageHeader, Spinner, ErrorNote, EmptyState, Chip } from '../components/ui';
import { formatDate, playerName, titleCase } from '../lib/format';

/**
 * The ball-tracking screen, built as an instrument panel rather than a set of
 * tables. Every graphic is an SVG drawn from the session's own numbers — no
 * chart library, because the shapes here are specific: a pitch seen in
 * perspective, a stump tower, a dial that has to read like a speed gun.
 */

const GOLD = '#F59E0B';
const PITCH = '#10B981';
const SKY = '#38BDF8';
const VIOLET = '#A78BFA';
const ALERT = '#F43F5E';
const INK = '#7A8AA0';

export default function Tracking() {
  const [sessions, setSessions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [focus, setFocus] = useState('all');   // 'all' or a bowler id

  const load = useCallback(() => {
    api.get('/tracking/sessions').then((d) => {
      setSessions(d.sessions);
      setSelected((cur) => cur ?? d.sessions[0]?.id ?? null);
    }).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetail(null);
    setFocus('all');
    api.get(`/tracking/sessions/${selected}`).then(setDetail).catch(setError);
  }, [selected]);

  if (error && !sessions) return <ErrorNote error={error} />;
  if (!sessions) return <Spinner label="Connecting to the tracker" />;

  if (!sessions.length) {
    return (
      <>
        <PageHeader eyebrow="Analysis" title="Ball tracking" />
        <div className="hud-panel p-10">
          <EmptyState
            title="No tracked sessions yet"
            message="A tracking session measures every delivery to the centimetre — where it pitched, how fast it left the hand, and whether it would have hit the stumps."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Ball tracking"
        subtitle="Every delivery measured against a calibrated pitch. Nothing here is stored — it is all read off the measurements."
      />

      <SessionRail sessions={sessions} selected={selected} onSelect={setSelected} />

      {!detail ? (
        <div className="mt-5"><Spinner label="Reading deliveries" /></div>
      ) : (
        <Console detail={detail} focus={focus} setFocus={setFocus} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Session rail                                                        */
/* ------------------------------------------------------------------ */

function SessionRail({ sessions, selected, onSelect }) {
  return (
    <div className="flex gap-2.5 overflow-x-auto scroll-thin pb-2 -mx-1 px-1">
      {sessions.map((s) => {
        const active = s.id === selected;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            className={`relative shrink-0 w-52 text-left rounded-xl border px-3.5 py-3 transition-all ${
              active
                ? 'border-gold/60 bg-gold/10 shadow-glow-sm -translate-y-0.5'
                : 'border-line bg-surface hover:border-line-bright hover:-translate-y-0.5'
            }`}
          >
            <span className="flex items-center gap-1.5 mb-1">
              {s.mode === 'bowling_machine'
                ? <Cpu size={12} className="text-violet" />
                : <Radio size={12} className={active ? 'text-gold hud-pulse' : 'text-ink-400'} />}
              <span className="hud-label">{formatDate(s.session_date)}</span>
            </span>
            <span className={`text-sm block truncate ${active ? 'text-ink' : 'text-ink-600'}`}>{s.title}</span>
            <span className="flex items-center justify-between mt-1.5">
              <span className="font-mono text-[11px] text-ink-400">{s.delivery_count} balls</span>
              <span className={`text-[10px] font-mono ${s.calibrated ? 'text-pitch' : 'text-alert'}`}>
                {s.calibrated ? 'CAL' : 'UNCAL'}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Console                                                             */
/* ------------------------------------------------------------------ */

function Console({ detail, focus, setFocus }) {
  const { session, bowlers, targets } = detail;

  // Focusing on one bowler re-reads every panel from their deliveries alone.
  const deliveries = useMemo(
    () => (focus === 'all' ? detail.deliveries : detail.deliveries.filter((d) => d.bowler_id === focus)),
    [detail.deliveries, focus],
  );

  const view = useMemo(() => {
    if (focus === 'all') return detail.summary;
    const b = bowlers.find((x) => x.player.id === focus);
    return {
      deliveries: deliveries.length,
      speed: b?.speed ?? null,
      consistency: b?.consistency ?? null,
      stumpLine: b?.stumpLine ?? null,
      pitchMap: localPitchMap(deliveries),
    };
  }, [focus, detail.summary, bowlers, deliveries]);

  const activeTargets = focus === 'all' ? targets : targets.filter((t) => t.player_id === focus);

  return (
    <div className="mt-5 space-y-5">
      <div className="grid md:grid-cols-3 gap-5">
        <SpeedDial speed={view.speed} />
        <ConsistencyRing consistency={view.consistency} />
        <StumpTower stumps={view.stumpLine} deliveries={deliveries} />
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3">
          <PitchView deliveries={deliveries} targets={activeTargets} session={session} />
        </div>
        <div className="lg:col-span-2 space-y-5">
          <ZoneHeat map={view.pitchMap} />
          <CalibrationCard session={session} />
        </div>
      </div>

      <SpeedRibbon deliveries={deliveries} />

      <BowlerRail bowlers={bowlers} focus={focus} setFocus={setFocus} total={detail.deliveries.length} />
    </div>
  );
}

/** The pitch map for a filtered subset, computed the way the API does. */
function localPitchMap(deliveries) {
  const points = deliveries
    .filter((d) => d.pitch_x_cm != null && d.pitch_y_cm != null)
    .map((d) => ({
      x: d.pitch_x_cm, y: d.pitch_y_cm,
      lengthZone: d.length_zone, lineZone: d.line_zone,
      runs: d.runs, wicket: !!d.wicket, inTarget: d.in_target,
    }));

  const grid = [];
  const lengths = [...new Set(points.map((p) => p.lengthZone).filter(Boolean))];
  const lines = [...new Set(points.map((p) => p.lineZone).filter(Boolean))];
  for (const L of lengths) {
    for (const N of lines) {
      const cell = points.filter((p) => p.lengthZone === L && p.lineZone === N);
      if (!cell.length) continue;
      grid.push({
        lengthZone: L, lineZone: N, balls: cell.length,
        runs: cell.reduce((a, p) => a + (p.runs || 0), 0),
        wickets: cell.filter((p) => p.wicket).length,
      });
    }
  }
  return { points, grid };
}

/* ------------------------------------------------------------------ */
/* Speed dial                                                          */
/* ------------------------------------------------------------------ */

function SpeedDial({ speed }) {
  if (!speed) return <PanelEmpty title="Release speed" message="No speeds recorded for this selection." />;

  const MIN = 60;
  const MAX = 160;
  const clamp = (v) => Math.min(MAX, Math.max(MIN, v ?? MIN));
  const angleFor = (v) => -210 + ((clamp(v) - MIN) / (MAX - MIN)) * 240;
  const polar = (deg, r) => {
    const rad = (deg * Math.PI) / 180;
    return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
  };
  const arc = (from, to, r) => {
    const [x1, y1] = polar(from, r);
    const [x2, y2] = polar(to, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };

  const avgAngle = angleFor(speed.averageRelease);
  const peakAngle = angleFor(speed.peakRelease);
  const [nx, ny] = polar(avgAngle, 62);

  return (
    <section className="hud-panel hud-corner p-5">
      <header className="flex items-center justify-between mb-1 relative">
        <span className="hud-label flex items-center gap-1.5"><Gauge size={12} /> Release speed</span>
        <span className="font-mono text-[10px] text-ink-400">KPH</span>
      </header>

      <svg viewBox="0 0 200 150" className="w-full relative" role="img"
        aria-label={`Average release speed ${speed.averageRelease} kilometres per hour`}>
        <defs>
          <linearGradient id="dialArc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={SKY} />
            <stop offset="55%" stopColor={GOLD} />
            <stop offset="100%" stopColor={ALERT} />
          </linearGradient>
          <filter id="dialGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <path d={arc(-210, 30, 72)} fill="none" stroke="#16203A" strokeWidth="14" strokeLinecap="round" />
        <path d={arc(-210, avgAngle, 72)} fill="none" stroke="url(#dialArc)" strokeWidth="14"
          strokeLinecap="round" filter="url(#dialGlow)" />

        {[60, 80, 100, 120, 140, 160].map((v) => {
          const a = angleFor(v);
          const [x1, y1] = polar(a, 58);
          const [x2, y2] = polar(a, 63);
          const [lx, ly] = polar(a, 49);
          return (
            <g key={v}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth="1" />
              <text x={lx} y={ly + 2.5} fill={INK} fontSize="7" textAnchor="middle" fontFamily="IBM Plex Mono">{v}</text>
            </g>
          );
        })}

        {speed.peakRelease != null && (() => {
          const [px1, py1] = polar(peakAngle, 65);
          const [px2, py2] = polar(peakAngle, 79);
          return (
            <line x1={px1} y1={py1} x2={px2} y2={py2} stroke={VIOLET} strokeWidth="2.5" strokeLinecap="round">
              <title>Fastest: {speed.peakRelease} kph</title>
            </line>
          );
        })()}

        <line x1="100" y1="100" x2={nx} y2={ny} stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" filter="url(#dialGlow)" />
        <circle cx="100" cy="100" r="5" fill="#0F172A" stroke={GOLD} strokeWidth="2" />

        <text x="100" y="128" textAnchor="middle" className="hud-readout" fill="#F8FAFC" fontSize="30" fontFamily="Barlow Condensed">
          {speed.averageRelease ?? '—'}
        </text>
        <text x="100" y="140" textAnchor="middle" fill={INK} fontSize="7.5" fontFamily="IBM Plex Mono" letterSpacing="1.5">AVERAGE</text>
      </svg>

      <div className="grid grid-cols-3 gap-2 mt-2 relative">
        <Readout label="Peak" value={speed.peakRelease} tone="text-violet" />
        <Readout label="Spread" value={speed.spread != null ? `±${speed.spread}` : '—'} tone="text-ink-600" />
        <Readout label="Off pitch" value={speed.averageOffPitch} tone="text-sky" />
      </div>

      {speed.paceConsistency != null && (
        <div className="mt-3 relative">
          <div className="flex justify-between hud-label mb-1">
            <span>Pace consistency</span>
            <span className="font-mono text-gold">{speed.paceConsistency}</span>
          </div>
          <Bar value={speed.paceConsistency} />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Consistency ring                                                    */
/* ------------------------------------------------------------------ */

function ConsistencyRing({ consistency }) {
  if (!consistency) return <PanelEmpty title="Consistency" message="No target zone was set for these deliveries." />;

  const R = 60;
  const C = 2 * Math.PI * R;
  const innerR = R - 16;
  const innerC = 2 * Math.PI * innerR;
  const hit = consistency.hitRate ?? 0;
  const tight = consistency.tightness ?? 0;

  return (
    <section className="hud-panel hud-corner p-5">
      <header className="flex items-center justify-between mb-1 relative">
        <span className="hud-label flex items-center gap-1.5"><Target size={12} /> Consistency</span>
        <span className="font-mono text-[10px] text-ink-400">{consistency.aimed} AIMED</span>
      </header>

      <svg viewBox="0 0 200 150" className="w-full relative" role="img"
        aria-label={`${hit} per cent of deliveries landed in the target zone`}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={PITCH} />
            <stop offset="100%" stopColor={SKY} />
          </linearGradient>
          <filter id="ringGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g transform="translate(100 75)">
          <circle r={R} fill="none" stroke="#16203A" strokeWidth="11" />
          <circle
            r={R} fill="none" stroke="url(#ringGrad)" strokeWidth="11" strokeLinecap="round"
            strokeDasharray={`${(hit / 100) * C} ${C}`} transform="rotate(-90)" filter="url(#ringGlow)"
          />

          <circle r={innerR} fill="none" stroke="#16203A" strokeWidth="6" />
          <circle
            r={innerR} fill="none" stroke={GOLD} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${(tight / 100) * innerC} ${innerC}`} transform="rotate(-90)" opacity="0.85"
          />

          <text y="4" textAnchor="middle" className="hud-readout" fill="#F8FAFC" fontSize="34" fontFamily="Barlow Condensed">{hit}%</text>
          <text y="18" textAnchor="middle" fill={INK} fontSize="7.5" fontFamily="IBM Plex Mono" letterSpacing="1.4">IN ZONE</text>
        </g>
      </svg>

      <div className="grid grid-cols-3 gap-2 relative">
        <Readout label="Avg miss" value={`${consistency.averageMissCm}cm`} tone="text-gold" />
        <Readout label="Best run" value={consistency.bestRun} tone="text-pitch" />
        <Readout label="Score" value={consistency.score} tone="text-ink" />
      </div>
      <p className="text-[11px] text-ink-400 mt-3 relative">
        The outer ring is how often the zone was hit; the inner one is how close the misses came.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stump tower                                                         */
/* ------------------------------------------------------------------ */

function StumpTower({ stumps, deliveries }) {
  if (!stumps) return <PanelEmpty title="At the stumps" message="No stump readings recorded." />;

  const share = (key) => stumps.breakdown.find((b) => b.key === key)?.count ?? 0;
  const maxHit = Math.max(share('off'), share('middle'), share('leg'), share('bails'), 1);

  const swarm = deliveries
    .filter((d) => d.stump_x_cm != null)
    .map((d) => ({ x: d.stump_x_cm, hit: d.hits_stumps === 1 }));

  const STUMP_X = { leg: 74, middle: 96, off: 118 };

  return (
    <section className="hud-panel hud-corner p-5">
      <header className="flex items-center justify-between mb-1 relative">
        <span className="hud-label flex items-center gap-1.5"><Crosshair size={12} /> At the stumps</span>
        <span className="font-mono text-[10px] text-pitch">{stumps.hittingPercent}% HITTING</span>
      </header>

      <svg viewBox="0 0 200 150" className="w-full relative" role="img"
        aria-label={`${stumps.hittingPercent} per cent of deliveries would hit the stumps`}>
        <defs>
          <filter id="stumpGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <rect x="70" y="28" width="52" height="3" rx="1.5" fill={GOLD} opacity={0.3 + (share('bails') / maxHit) * 0.7} />

        {Object.entries(STUMP_X).map(([key, x]) => {
          const intensity = share(key) / maxHit;
          return (
            <g key={key}>
              <rect
                x={x - 4} y="31" width="8" height="60" rx="2"
                fill={PITCH} fillOpacity={0.12 + intensity * 0.8}
                stroke={intensity > 0.55 ? PITCH : '#2A3A52'} strokeWidth="1"
                filter={intensity > 0.55 ? 'url(#stumpGlow)' : undefined}
              >
                <title>{`${key}: ${share(key)} deliveries`}</title>
              </rect>
              <text x={x} y="100" fill={INK} fontSize="6.5" textAnchor="middle" fontFamily="IBM Plex Mono">{key.toUpperCase()}</text>
              <text x={x} y="110" fill="#F8FAFC" fontSize="9" textAnchor="middle" fontFamily="Barlow Condensed">{share(key)}</text>
            </g>
          );
        })}

        <line x1="10" y1="130" x2="190" y2="130" stroke="#1E293B" strokeWidth="1" />
        <rect x="70" y="125" width="52" height="10" fill={PITCH} fillOpacity="0.08" stroke={PITCH} strokeOpacity="0.3" strokeDasharray="2 2" />
        {swarm.map((s, i) => (
          <circle
            key={i}
            cx={96 + Math.max(-86, Math.min(86, s.x * 1.9))}
            cy={130 + ((i % 5) - 2)}
            r="1.5"
            fill={s.hit ? PITCH : INK}
            fillOpacity={s.hit ? 0.9 : 0.4}
          />
        ))}
        <text x="100" y="146" fill={INK} fontSize="6" textAnchor="middle" fontFamily="IBM Plex Mono" letterSpacing="1">
          LINE AT THE STUMPS
        </text>
      </svg>

      <div className="grid grid-cols-3 gap-2 relative">
        <Readout label="Hitting" value={stumps.hitting} tone="text-pitch" />
        <Readout label="Assessed" value={stumps.assessed} tone="text-ink-600" />
        <Readout label="Offset" value={`${stumps.averageStumpOffsetCm}cm`} tone="text-gold" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pitch, drawn in perspective                                         */
/* ------------------------------------------------------------------ */

function PitchView({ deliveries, targets, session }) {
  const points = deliveries.filter((d) => d.pitch_x_cm != null && d.pitch_y_cm != null);
  if (!points.length) {
    return <PanelEmpty title="Where it pitched" message="No pitching points recorded for this selection." tall />;
  }

  // A trapezoid, so the pitch reads as receding towards the bowler.
  const NEAR_HALF = 78;
  const FAR_HALF = 30;
  const TOP = 16;
  const BOTTOM = 250;
  const MAX_Y = 1250;

  const project = (xCm, yCm) => {
    const t = Math.min(1, Math.max(0, yCm / MAX_Y));
    const y = BOTTOM - t * (BOTTOM - TOP);
    const half = NEAR_HALF - t * (NEAR_HALF - FAR_HALF);
    return [100 + (xCm / 150) * half, y];
  };

  const colour = (d) => (d.wicket ? ALERT : (d.runs ?? 0) >= 4 ? SKY : d.in_target === 1 ? PITCH : GOLD);

  const BANDS = [[180, 'YORKER'], [400, 'FULL'], [700, 'GOOD'], [1000, 'BACK'], [MAX_Y, 'SHORT']];

  return (
    <section className="hud-panel hud-corner p-5 h-full">
      <header className="flex items-center justify-between mb-2 relative">
        <span className="hud-label flex items-center gap-1.5"><Activity size={12} /> Where it pitched</span>
        <span className="font-mono text-[10px] text-ink-400">{points.length} PLOTTED · CM</span>
      </header>

      <div className="relative">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-16 hud-sweep"
          style={{ background: 'linear-gradient(to bottom, rgba(245,158,11,0.16), transparent)' }} />

        <svg viewBox="0 0 200 270" className="w-full max-w-md mx-auto" role="img" aria-label="Pitch map, in perspective">
          <defs>
            <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0A0F1C" />
              <stop offset="100%" stopColor="#101B2E" />
            </linearGradient>
            <filter id="pointGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="1.6" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <polygon
            points={`${100 - NEAR_HALF},${BOTTOM} ${100 + NEAR_HALF},${BOTTOM} ${100 + FAR_HALF},${TOP} ${100 - FAR_HALF},${TOP}`}
            fill="url(#turf)" stroke="#1E293B" strokeWidth="1"
          />

          {BANDS.map(([to, label]) => {
            const [lx, ly] = project(-150, to);
            const [rx] = project(150, to);
            return (
              <g key={label}>
                <line x1={lx} y1={ly} x2={rx} y2={ly} stroke="#1E293B" strokeDasharray="2 3" />
                <text x={lx + 3} y={ly - 2} fill={INK} fontSize="5" fontFamily="IBM Plex Mono" letterSpacing="0.8">{label}</text>
              </g>
            );
          })}

          {targets.filter((t) => t.x_min_cm != null).map((t, i) => {
            const [x1, y1] = project(t.x_min_cm, t.y_max_cm);
            const [x2] = project(t.x_max_cm, t.y_max_cm);
            const [x3, y3] = project(t.x_max_cm, t.y_min_cm);
            const [x4] = project(t.x_min_cm, t.y_min_cm);
            return (
              <polygon key={i} points={`${x1},${y1} ${x2},${y1} ${x3},${y3} ${x4},${y3}`}
                fill={PITCH} fillOpacity="0.11" stroke={PITCH} strokeOpacity="0.5" strokeDasharray="3 2">
                <title>{t.name}</title>
              </polygon>
            );
          })}

          {[-11.43, 0, 11.43].map((cm, i) => {
            const [x, y] = project(cm, 0);
            return <rect key={i} x={x - 1.6} y={y - 16} width="3.2" height="16" rx="1" fill="#16203A" stroke={GOLD} strokeWidth="0.6" />;
          })}
          <rect
            x={project(-13, 0)[0]} y={project(0, 0)[1] - 17.5}
            width={project(13, 0)[0] - project(-13, 0)[0]} height="1.6" rx="0.8" fill={GOLD} opacity="0.8"
          />

          {points.map((d, i) => {
            const [x, y] = project(d.pitch_x_cm, d.pitch_y_cm);
            const big = d.wicket || (d.runs ?? 0) >= 4;
            return (
              <circle
                key={d.id ?? i}
                cx={x} cy={y} r={big ? 2.6 : 1.9}
                fill={colour(d)} fillOpacity={d.in_target === 1 ? 0.95 : 0.6}
                filter={big ? 'url(#pointGlow)' : undefined}
                className="hud-dot"
                style={{ animationDelay: `${Math.min(i * 6, 700)}ms` }}
              >
                <title>
                  {`${titleCase(d.length_zone)} / ${titleCase(d.line_zone)} — ${d.pitch_x_cm}cm across, ${d.pitch_y_cm}cm from the stumps`
                    + `${d.release_speed_kph ? ` · ${d.release_speed_kph} kph` : ''}`
                    + `${d.in_target === 1 ? ' · in the zone'
                      : d.distance_from_target_cm != null ? ` · ${d.distance_from_target_cm}cm out` : ''}`}
                </title>
              </circle>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap justify-center gap-3 mt-2 text-[10px] relative">
        {[['In zone', PITCH], ['Outside it', GOLD], ['Boundary', SKY], ['Wicket', ALERT]].map(([label, c]) => (
          <span key={label} className="flex items-center gap-1.5 text-ink-400">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} />{label}
          </span>
        ))}
      </div>
      {session.mode === 'bowling_machine' && (
        <p className="text-[11px] text-violet text-center mt-2 relative">
          Bowling machine · {session.machine_make} at {session.machine_speed_kph} kph
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Zone heat grid                                                      */
/* ------------------------------------------------------------------ */

const LENGTHS = ['yorker', 'full', 'good', 'back_of_length', 'short'];
const LINES = ['down_leg', 'leg_stump', 'middle_stump', 'off_stump', 'outside_off', 'wide_outside_off'];
const SHORT_LINE = {
  down_leg: 'LEG', leg_stump: 'LS', middle_stump: 'MS',
  off_stump: 'OS', outside_off: '4TH', wide_outside_off: 'WIDE',
};

function ZoneHeat({ map }) {
  const cells = map?.grid ?? [];
  if (!cells.length) return <PanelEmpty title="Zone grid" message="Not enough plotted deliveries." />;

  const max = Math.max(...cells.map((c) => c.balls), 1);
  const cellFor = (L, N) => cells.find((c) => c.lengthZone === L && c.lineZone === N);

  return (
    <section className="hud-panel hud-corner p-5">
      <header className="flex items-center justify-between mb-3 relative">
        <span className="hud-label">Zone grid</span>
        <span className="font-mono text-[10px] text-ink-400">BALLS PER ZONE</span>
      </header>

      <div className="relative overflow-x-auto scroll-thin">
        <table className="w-full min-w-max border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th />
              {LINES.map((n) => <th key={n} className="hud-label pb-1" style={{ fontSize: 9 }}>{SHORT_LINE[n]}</th>)}
            </tr>
          </thead>
          <tbody>
            {LENGTHS.map((L) => (
              <tr key={L}>
                <td className="hud-label pr-1 whitespace-nowrap" style={{ fontSize: 9 }}>
                  {L === 'back_of_length' ? 'BACK' : L.toUpperCase()}
                </td>
                {LINES.map((N) => {
                  const cell = cellFor(L, N);
                  const heat = cell ? cell.balls / max : 0;
                  return (
                    <td key={N}>
                      <span
                        className="grid place-items-center h-9 w-full rounded-md"
                        style={{
                          background: cell
                            ? (cell.wickets
                              ? `rgba(244,63,94,${0.25 + heat * 0.5})`
                              : `rgba(245,158,11,${0.08 + heat * 0.62})`)
                            : 'rgba(255,255,255,0.02)',
                          boxShadow: heat > 0.7 ? `0 0 12px rgba(245,158,11,${heat * 0.45})` : undefined,
                        }}
                        title={cell ? `${cell.balls} balls, ${cell.runs} runs, ${cell.wickets} wickets` : 'nothing here'}
                      >
                        {cell ? (
                          <span className="font-mono text-[11px] text-ink leading-none">
                            {cell.balls}{cell.wickets > 0 && <span className="text-alert">✕</span>}
                          </span>
                        ) : <span className="text-ink-200 text-[10px]">·</span>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Speed ribbon                                                        */
/* ------------------------------------------------------------------ */

function SpeedRibbon({ deliveries }) {
  const series = deliveries.filter((d) => d.release_speed_kph != null);
  if (series.length < 3) return null;

  const W = 1000;
  const H = 150;
  const speeds = series.map((d) => d.release_speed_kph);
  const min = Math.min(...speeds) - 4;
  const max = Math.max(...speeds) + 4;
  const x = (i) => (i / Math.max(series.length - 1, 1)) * W;
  const y = (v) => H - ((v - min) / (max - min)) * (H - 20) - 10;

  const line = series.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.release_speed_kph)}`).join(' ');
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const hasOffPitch = series.every((d) => d.speed_off_pitch_kph != null);
  const offLine = hasOffPitch
    ? series.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.speed_off_pitch_kph)}`).join(' ')
    : null;

  return (
    <section className="hud-panel hud-corner p-5">
      <header className="flex items-center justify-between mb-2 relative">
        <span className="hud-label">Ball by ball</span>
        <span className="flex items-center gap-3 font-mono text-[10px]">
          <span className="text-gold">— RELEASE</span>
          {offLine && <span className="text-sky">-- OFF THE PITCH</span>}
        </span>
      </header>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full relative" preserveAspectRatio="none" role="img"
        aria-label="Release speed, ball by ball">
        <defs>
          <linearGradient id="ribbonFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOLD} stopOpacity="0.4" />
            <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} stroke="#1E293B" strokeDasharray="4 6" />
        ))}
        <path d={area} fill="url(#ribbonFill)" />
        <path d={line} fill="none" stroke={GOLD} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        {offLine && <path d={offLine} fill="none" stroke={SKY} strokeWidth="1.6" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
        {series.map((d, i) => (d.wicket ? (
          <circle key={i} cx={x(i)} cy={y(d.release_speed_kph)} r="5" fill={ALERT}>
            <title>Wicket at {d.release_speed_kph} kph</title>
          </circle>
        ) : null))}
      </svg>

      <div className="flex justify-between hud-label mt-1 relative">
        <span>Ball 1</span>
        <span className="text-ink-600 font-mono">{min.toFixed(0)}–{max.toFixed(0)} kph</span>
        <span>Ball {series.length}</span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Bowler rail                                                         */
/* ------------------------------------------------------------------ */

function BowlerRail({ bowlers, focus, setFocus, total }) {
  if (!bowlers.length) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <span className="hud-label">Bowlers — tap one to re-read every panel above</span>
        {focus !== 'all' && (
          <button type="button" className="btn-quiet text-xs" onClick={() => setFocus('all')}>
            Clear filter <ChevronRight size={12} />
          </button>
        )}
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setFocus('all')}
          className={`hud-panel p-4 text-left transition-all ${focus === 'all' ? 'border-gold/60 shadow-glow-sm' : 'hover:-translate-y-0.5'}`}
        >
          <span className="hud-label relative block">Whole session</span>
          <span className="hud-readout text-3xl block mt-1 text-ink relative">{total}</span>
          <span className="text-[11px] text-ink-400 relative">deliveries</span>
        </button>

        {bowlers.map((b) => {
          const active = focus === b.player.id;
          const score = b.consistency?.score ?? 0;
          return (
            <button
              key={b.player.id}
              type="button"
              onClick={() => setFocus(active ? 'all' : b.player.id)}
              className={`hud-panel p-4 text-left transition-all ${active ? 'border-gold/60 shadow-glow-sm' : 'hover:-translate-y-0.5'}`}
            >
              <span className="flex items-start justify-between gap-2 relative">
                <span className="min-w-0">
                  <span className="text-sm text-ink block truncate">{playerName(b.player)}</span>
                  <span className="hud-label">{b.deliveries} balls</span>
                </span>
                <span className="hud-readout text-2xl text-gold shrink-0">{b.speed?.averageRelease ?? '—'}</span>
              </span>

              <span className="grid grid-cols-3 gap-1.5 mt-3 relative">
                <MiniStat label="Zone" value={b.consistency ? `${b.consistency.hitRate}%` : '—'} />
                <MiniStat label="Stumps" value={b.stumpLine ? `${b.stumpLine.hittingPercent}%` : '—'} />
                <MiniStat label="Peak" value={b.speed?.peakRelease ?? '—'} />
              </span>

              <span className="block mt-2.5 relative"><Bar value={score} /></span>
              <span className="flex justify-between hud-label mt-1 relative">
                <span>Consistency</span>
                <span className="font-mono text-gold">{score || '—'}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-ink-400 mt-3">
        Pick a bowler and the dial, the ring, the stumps and the pitch all re-read from their deliveries alone.
        <Link to="/players" className="link ml-1">Open an athlete record</Link> for the trend across every session.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

function CalibrationCard({ session }) {
  return (
    <section className="hud-panel hud-corner p-5">
      <header className="flex items-center justify-between mb-3 relative">
        <span className="hud-label">Scene calibration</span>
        <Chip tone={session.calibrated ? 'active' : 'absent'}>
          {session.calibrated ? titleCase(session.calibration_method) : 'Not calibrated'}
        </Chip>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 relative">
        {[
          ['Pitch length', `${session.pitch_length_cm} cm`],
          ['Pitch width', `${session.pitch_width_cm} cm`],
          ['Stump width', `${session.stump_width_cm} cm`],
          ['Stump height', `${session.stump_height_cm} cm`],
          ['Crease to stumps', `${session.crease_to_stump_cm} cm`],
          ['Measured by', titleCase(session.source)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="hud-label">{label}</dt>
            <dd className="font-mono text-sm text-ink-700 mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[11px] text-ink-400 mt-3 relative">
        A centimetre means nothing without the frame it was measured in, so each session carries its own.
        {session.provider ? ` Supplied by ${session.provider}.` : ''}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function Readout({ label, value, tone = 'text-ink' }) {
  return (
    <div className="rounded-lg bg-surface-sunken/70 px-2 py-1.5 text-center">
      <p className="hud-label">{label}</p>
      <p className={`font-mono text-sm mt-0.5 ${tone}`}>{value ?? '—'}</p>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <span className="block rounded bg-surface-sunken/70 px-1.5 py-1 text-center">
      <span className="hud-label block" style={{ fontSize: 9 }}>{label}</span>
      <span className="font-mono text-[11px] text-ink-700">{value}</span>
    </span>
  );
}

function Bar({ value }) {
  return (
    <span className="block h-1.5 rounded-full bg-surface-sunken overflow-hidden">
      <span className="block h-full rounded-full bg-gold-grad" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </span>
  );
}

function PanelEmpty({ title, message, tall = false }) {
  return (
    <section className={`hud-panel p-5 ${tall ? 'h-full' : ''}`}>
      <p className="hud-label relative">{title}</p>
      <p className="text-sm text-ink-400 mt-3 relative">{message}</p>
    </section>
  );
}
