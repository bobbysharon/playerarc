import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { STATUS_STYLES, titleCase, initials, playerName } from '../lib/format';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export function Chip({ children, tone }) {
  const style = STATUS_STYLES[tone] || 'bg-ink-200/20 text-ink-600';
  return <span className={`chip ${style}`}>{children}</span>;
}

export function StatusChip({ status }) {
  return <Chip tone={status}>{titleCase(status)}</Chip>;
}

export function Avatar({ player, size = 40 }) {
  const url = player?.photo_url || player?.photoUrl;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="rounded-full object-cover border border-line shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full bg-ink text-white font-display font-semibold grid place-items-center shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(player?.first_name, player?.last_name) || '—'}
    </span>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-400 py-10 justify-center">
      <span className="h-4 w-4 rounded-full border-2 border-line border-t-gold animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ title, message, action }) {
  return (
    <div className="text-center py-14 px-6">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="text-sm text-ink-400 mt-1 max-w-sm mx-auto">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-alert/30 bg-alert/5 px-3.5 py-3 text-sm text-alert">
      <p className="font-semibold">{error.message}</p>
      {Array.isArray(error.details) && error.details.length > 0 && (
        <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-alert/90">
          {error.details.map((d, i) => (
            <li key={i}>{typeof d === 'string' ? d : `${d.field}: ${d.message}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions, children }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="label mb-1">{eyebrow}</p>}
          <h1 className="font-display text-3xl sm:text-4xl leading-none text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-ink-400 mt-2 max-w-2xl">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint, tone = 'ink', to }) {
  const tones = {
    ink: 'text-ink',
    gold: 'text-gold-dark',
    pitch: 'text-pitch',
    alert: 'text-alert',
  };
  const inner = (
    <>
      <p className="label">{label}</p>
      <p className={`font-display text-3xl leading-none mt-2 ${tones[tone]}`}>{value}</p>
      {hint && <p className="text-xs text-ink-400 mt-1.5">{hint}</p>}
    </>
  );
  const className = 'card p-4 block transition-shadow hover:shadow-lift';
  return to ? <Link to={to} className={className}>{inner}</Link> : <div className={className}>{inner}</div>;
}

export function Section({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">
          <div>
            <h2 className="font-display text-lg leading-none">{title}</h2>
            {subtitle && <p className="text-xs text-ink-400 mt-1">{subtitle}</p>}
          </div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className={`relative bg-white rounded-t-2xl sm:rounded-xl shadow-lift w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[92vh] flex flex-col`}>
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h2 className="font-display text-xl">{title}</h2>
          <button type="button" onClick={onClose} className="btn-quiet px-2 py-1" aria-label="Close">✕</button>
        </header>
        <div className="overflow-y-auto scroll-thin px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="label block mb-1.5">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-ink-400 mt-1">{hint}</span>}
      {error && <span className="block text-xs text-alert mt-1">{error}</span>}
    </label>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="border-b border-line overflow-x-auto scroll-thin">
      <div className="flex gap-1 min-w-max">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`px-3.5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
              active === t.key
                ? 'border-gold text-ink'
                : 'border-transparent text-ink-400 hover:text-ink'
            }`}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 text-xs text-ink-200">{t.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DataTable({ columns, rows, empty, onRowClick, dense = false }) {
  if (!rows.length) {
    return <EmptyState title={empty?.title || 'Nothing here yet'} message={empty?.message || ''} action={empty?.action} />;
  }
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-max">
        <thead className="bg-canvas">
          <tr>{columns.map((c) => <th key={c.key} className={`th ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`${onRowClick ? 'cursor-pointer hover:bg-canvas' : ''} ${dense ? '[&_td]:py-1.5' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`td ${c.align === 'right' ? 'text-right' : ''} ${c.mono ? 'stat-value' : ''}`}>
                  {c.render ? c.render(row) : row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

const AXIS = { stroke: '#9DAEBB', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' };
const TOOLTIP = {
  contentStyle: {
    borderRadius: 8, border: '1px solid #DFE5EA', fontSize: 12,
    fontFamily: 'Inter, sans-serif', boxShadow: '0 8px 28px rgba(14,34,51,0.12)',
  },
};

export function TrendChart({ data, xKey = 'date', series, height = 220, domain }) {
  if (!data?.length) return <EmptyState title="No data yet" message="Records will appear here once they are entered." />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
        <CartesianGrid stroke="#EEF2F5" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} domain={domain || ['auto', 'auto']} />
        <Tooltip {...TOOLTIP} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color || '#0E2233'}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: s.color || '#0E2233' }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BarsChart({ data, xKey, barKey, height = 220, color = '#0E2233', colors }) {
  if (!data?.length) return <EmptyState title="No data yet" message="Records will appear here once they are entered." />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
        <CartesianGrid stroke="#EEF2F5" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP} cursor={{ fill: '#F4F6F8' }} />
        <Bar dataKey={barKey} radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={colors ? colors[i % colors.length] : (d.color || color)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RatingRadar({ components, height = 240 }) {
  if (!components?.length) return null;
  const data = components.map((c) => ({ subject: c.label, score: c.score }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="#DFE5EA" />
        <PolarAngleAxis dataKey="subject" tick={{ ...AXIS, fontFamily: 'Inter, sans-serif', fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Tooltip {...TOOLTIP} />
        <Radar dataKey="score" stroke="#C8952F" fill="#C8952F" fillOpacity={0.28} strokeWidth={2} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Athlete-specific pieces                                             */
/* ------------------------------------------------------------------ */

export function PlayerCard({ player, sports = [], teams = [] }) {
  return (
    <Link to={`/players/${player.id}`} className="card p-4 flex gap-3 hover:shadow-lift transition-shadow">
      <Avatar player={player} size={48} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink truncate">{playerName(player)}</p>
        <p className="font-mono text-[11px] text-ink-400">{player.athlete_id}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <StatusChip status={player.status} />
          {sports.slice(0, 2).map((s) => (
            <span key={s.id || s.sport_id} className="chip bg-canvas text-ink-600">{s.sport_name}</span>
          ))}
        </div>
        {teams.length > 0 && (
          <p className="text-xs text-ink-400 mt-2 truncate">{teams.map((t) => t.name).join(' · ')}</p>
        )}
      </div>
    </Link>
  );
}

/**
 * The career spine: a single vertical rail carrying every event in an
 * athlete's history. It is the one place the whole journey reads top to bottom,
 * so it gets the strongest visual treatment in the product.
 */
export function CareerSpine({ events, compact = false }) {
  if (!events?.length) {
    return <EmptyState title="The journey starts here" message="Registrations, team moves, matches, milestones and awards all land on this rail automatically." />;
  }
  const ICONS = {
    registration: '◆', sport_added: '＋', team_joined: '▲', team_left: '▽', promotion: '⇧',
    match: '●', debut: '★', milestone: '★', achievement: '🏆', assessment: '◈', status_change: '◇', note: '·',
  };
  const byYear = events.reduce((acc, e) => {
    const year = String(e.event_date).slice(0, 4);
    (acc[year] = acc[year] || []).push(e);
    return acc;
  }, {});

  return (
    <div className={compact ? '' : 'pr-2'}>
      {Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).map(([year, items]) => (
        <div key={year} className="relative">
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm py-2 pl-1">
            <span className="font-display text-2xl text-ink-200">{year}</span>
          </div>
          <ol className="relative ml-4 border-l-2 border-line">
            {items.map((e) => (
              <li key={e.id} className="relative pl-6 pb-5">
                <span
                  className={`absolute -left-[9px] top-0.5 grid place-items-center h-4 w-4 rounded-full text-[9px] ${
                    e.importance === 3 ? 'bg-gold text-ink' : e.importance === 2 ? 'bg-ink text-white' : 'bg-line text-ink-400'
                  }`}
                  aria-hidden
                >
                  {ICONS[e.event_type] || '·'}
                </span>
                <p className="text-[11px] font-mono text-ink-400">{e.event_date}</p>
                <p className={`text-sm ${e.importance === 3 ? 'font-semibold text-ink' : 'text-ink-700'}`}>{e.title}</p>
                {e.description && <p className="text-xs text-ink-400 mt-0.5">{e.description}</p>}
                {e.sport_name && (
                  <span className="chip bg-canvas text-ink-600 mt-1.5">{e.sport_name}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

/** Career statistics laid out like a scoreboard, grouped as the sport defines. */
export function StatGrid({ groups }) {
  const filled = groups.filter((g) => g.stats.length);
  if (!filled.length) return null;
  return (
    <div className="space-y-5">
      {filled.map((group) => (
        <div key={group.key}>
          <p className="label mb-2">{group.label}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-px bg-line rounded-lg overflow-hidden border border-line">
            {group.stats.map((s) => (
              <div key={s.key} className="bg-white px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-ink-400 truncate" title={s.label}>{s.label}</p>
                <p className="stat-value text-lg text-ink mt-0.5">{s.display}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RatingDial({ rating, size = 96 }) {
  if (!rating) return null;
  const pct = Math.max(0, Math.min(100, rating.overall));
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="shrink-0" role="img" aria-label={`Performance rating ${pct} out of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF2F5" strokeWidth="8" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#C8952F" strokeWidth="8"
          strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle"
          className="font-display" style={{ fontSize: size * 0.28, fill: '#0E2233' }}>
          {pct}
        </text>
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5">
        {rating.components.map((c2) => (
          <div key={c2.key}>
            <div className="flex justify-between text-[11px] text-ink-400">
              <span className="truncate">{c2.label}</span>
              <span className="stat-value text-ink">{c2.score}</span>
            </div>
            <div className="h-1.5 bg-canvas rounded-full overflow-hidden">
              <div className="h-full bg-ink rounded-full" style={{ width: `${c2.score}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell: sidebar, top bar, global search                              */
/* ------------------------------------------------------------------ */

const NAV = [
  { to: '/', label: 'Dashboard', permission: null, exact: true },
  { to: '/players', label: 'Athletes', permission: 'players.read' },
  { to: '/teams', label: 'Teams', permission: 'teams.read' },
  { to: '/coaches', label: 'Coaches', permission: 'coaches.read' },
  { to: '/tournaments', label: 'Tournaments', permission: 'tournaments.read' },
  { to: '/matches', label: 'Matches', permission: 'matches.read' },
  { to: '/training', label: 'Training', permission: 'training.read' },
  { to: '/assessments', label: 'Assessments', permission: 'assessments.read' },
  { to: '/achievements', label: 'Achievements', permission: 'achievements.read' },
  { to: '/rankings', label: 'Rankings', permission: 'rankings.read' },
  { to: '/reports', label: 'Reports', permission: 'reports.read' },
  { to: '/sports', label: 'Sports', permission: 'sports.read' },
  { to: '/settings', label: 'Settings', permission: null },
];

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return undefined;
    }
    const id = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults(null));
    }, 220);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (path) => {
    navigate(path);
    setQ('');
    setOpen(false);
  };

  const groups = results ? [
    { key: 'players', label: 'Athletes', items: results.players, to: (r) => `/players/${r.id}`, primary: (r) => playerName(r), secondary: (r) => r.athlete_id },
    { key: 'teams', label: 'Teams', items: results.teams, to: (r) => `/teams/${r.id}`, primary: (r) => r.name, secondary: (r) => `${r.sport_name}${r.age_group ? ` · ${r.age_group}` : ''}` },
    { key: 'tournaments', label: 'Tournaments', items: results.tournaments, to: (r) => `/tournaments/${r.id}`, primary: (r) => r.name, secondary: (r) => r.sport_name },
    { key: 'matches', label: 'Matches', items: results.matches, to: (r) => `/matches/${r.id}`, primary: (r) => `${r.home_team_name || 'Karwan'} vs ${r.away_team_name || r.opponent_name || 'TBC'}`, secondary: (r) => r.sport_name },
    { key: 'coaches', label: 'Coaches', items: results.coaches, to: (r) => `/coaches/${r.id}`, primary: (r) => r.full_name, secondary: (r) => titleCase(r.role) },
  ].filter((g) => g.items?.length) : [];

  return (
    <div ref={box} className="relative flex-1 max-w-md">
      <input
        className="input bg-ink-700 border-ink-600 text-white placeholder:text-ink-200 focus:border-gold"
        placeholder="Search athletes, teams, tournaments…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        aria-label="Search"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lift border border-line max-h-[70vh] overflow-y-auto scroll-thin z-50">
          {!groups.length && <p className="px-4 py-6 text-sm text-ink-400 text-center">No matches for “{q}”. Try an athlete ID or a team name.</p>}
          {groups.map((g) => (
            <div key={g.key} className="py-1.5">
              <p className="label px-4 py-1">{g.label}</p>
              {g.items.map((r) => (
                <button
                  key={`${g.key}-${r.id}`}
                  type="button"
                  onClick={() => go(g.to(r))}
                  className="w-full text-left px-4 py-2 hover:bg-canvas flex items-center justify-between gap-3"
                >
                  <span className="text-sm text-ink truncate">{g.primary(r)}</span>
                  <span className="font-mono text-[11px] text-ink-400 shrink-0">{g.secondary(r)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }) {
  const { user, signOut, can } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const items = NAV.filter((n) => !n.permission || can(n.permission) || user?.role === 'player' || user?.role === 'guardian');

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Rail */}
      <aside className="lg:w-56 lg:shrink-0 bg-ink text-white lg:min-h-screen lg:sticky lg:top-0 lg:h-screen flex flex-col">
        <div className="flex items-center justify-between px-4 py-3.5 lg:py-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-lg bg-gold grid place-items-center font-display text-ink text-lg leading-none">P</span>
            <span>
              <span className="font-display text-xl leading-none block">PlayerArc</span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink-200">Karwan Sports Club</span>
            </span>
          </Link>
          <button type="button" className="lg:hidden btn-quiet text-white px-2" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        <nav className={`${menuOpen ? 'block' : 'hidden'} lg:block flex-1 overflow-y-auto scroll-thin px-2 pb-3`}>
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.exact}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium mb-0.5 transition-colors ${
                  isActive ? 'bg-ink-700 text-white border-l-2 border-gold' : 'text-ink-200 hover:text-white hover:bg-ink-700/60'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className={`${menuOpen ? 'block' : 'hidden'} lg:block border-t border-ink-600 px-4 py-3`}>
          <p className="text-sm font-medium truncate">{user?.fullName}</p>
          <p className="text-[11px] text-ink-200">{user?.roleName}</p>
          <button type="button" onClick={async () => { await signOut(); navigate('/login'); }} className="mt-2 text-xs text-gold hover:underline">
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-ink text-white px-4 py-2.5 flex items-center gap-3 sticky top-0 z-40 lg:static">
          <GlobalSearch />
        </header>
        <main className="flex-1 px-4 sm:px-6 py-6 max-w-[1500px] w-full mx-auto">{children}</main>
        <footer className="px-6 py-4 text-[11px] text-ink-400 border-t border-line">
          PlayerArc · the athlete record system of Karwan Sports Club
        </footer>
      </div>
    </div>
  );
}
