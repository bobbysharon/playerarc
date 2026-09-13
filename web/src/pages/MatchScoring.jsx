import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Undo2, Plus, BarChart3, MapPin, Check } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader, Section, Spinner, ErrorNote, Modal, Field, Chip, EmptyState, Avatar,
} from '../components/ui';
import { playerName, titleCase } from '../lib/format';

/**
 * The scoring console.
 *
 * Every button, field and coordinate surface on this page is rendered from the
 * sport's own event configuration, so cricket gets a six-ball over with a
 * wagon-wheel picker and basketball gets a shot chart, without either being
 * written into this component.
 */
export default function MatchScoring() {
  const { id } = useParams();
  const { can } = useAuth();
  const [match, setMatch] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [events, setEvents] = useState([]);
  const [activePeriod, setActivePeriod] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [creatingPeriod, setCreatingPeriod] = useState(false);
  const [detailFor, setDetailFor] = useState(null);   // outcome awaiting extra detail
  const [live, setLive] = useState(null);            // running score, derived from the events
  const feedRef = useRef(null);

  // Who is on the field, kept per event type. A football scorer sets the
  // shooter once and the goalkeeper once; recording a card does not then
  // credit the goal to whoever happened to be selected.
  const [rolesByType, setRolesByType] = useState({});
  const [coords, setCoords] = useState(null);
  const [minute, setMinute] = useState('');

  const load = useCallback(() => {
    api.get(`/matches/${id}`).then(setMatch).catch(setError);
    api.get(`/matches/${id}/analysis`).then(setLive).catch(() => {});
    api.get(`/matches/${id}/periods`).then((d) => {
      setPeriods(d.periods);
      setActivePeriod((cur) => cur ?? d.periods.find((p) => p.status === 'in_progress')?.id ?? d.periods.at(-1)?.id ?? null);
    }).catch(() => {});
    api.get(`/matches/${id}/events`).then((d) => setEvents(d.events)).catch(() => {});
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!match) return <Spinner label="Opening the scoring console" />;

  if (!can('performances.write')) {
    return (
      <Section>
        <EmptyState title="Scoring is restricted" message="Statisticians, sport administrators and directors can record match events." />
      </Section>
    );
  }

  const config = match.sport.config?.events;
  if (!config) {
    return (
      <Section>
        <EmptyState
          title={`${match.match.sport_name} has no event definitions`}
          message="Add an events block to this sport's configuration and the console builds itself from it."
        />
      </Section>
    );
  }

  const lineup = match.lineup;
  const periodEvents = events.filter((e) => e.period_id === activePeriod);
  const ballType = (config.types || []).find((t) => t.isProgress) || config.types[0];
  const current = periods.find((p) => p.id === activePeriod);

  const rolesFor = (typeKey) => rolesByType[typeKey] || { primary: '', secondary: '', tertiary: '' };
  const setRolesFor = (typeKey, next) => setRolesByType({ ...rolesByType, [typeKey]: next });

  async function record(type, outcome, extraPayload = {}, overrideRoles = null) {
    setError(null);
    setNotice(null);
    try {
      const active = overrideRoles || rolesFor(type.key);
      const body = {
        period_id: activePeriod,
        event_type: type.key,
        outcome: outcome?.key ?? null,
        payload: { ...(outcome?.set || {}), ...extraPayload },
        primary_player_id: active.primary ? Number(active.primary) : null,
        secondary_player_id: active.secondary ? Number(active.secondary) : null,
        tertiary_player_id: active.tertiary ? Number(active.tertiary) : null,
        x: coords?.x ?? null,
        y: coords?.y ?? null,
        minute: config.clockBased && minute !== '' ? Number(minute) : null,
      };
      const r = await api.post(`/matches/${id}/events`, body);
      setCoords(null);
      if (r.warning) setNotice({ title: 'Scorecard recomputed', items: [r.warning], tone: 'warn' });
      else if (r.milestones?.length) setNotice({ title: 'Milestone reached', items: r.milestones });
      load();
      setTimeout(() => feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    } catch (err) {
      setError(err);
    }
  }

  async function undoLast() {
    const last = events[events.length - 1];
    if (!last) return;
    try {
      await api.del(`/matches/${id}/events/${last.id}`);
      load();
    } catch (err) { setError(err); }
  }

  const toneClass = {
    ink: 'bg-surface-raised border-line text-ink hover:border-line-bright',
    sky: 'bg-sky/15 border-sky/40 text-sky hover:border-sky',
    violet: 'bg-violet/15 border-violet/40 text-violet hover:border-violet',
    gold: 'bg-gold/15 border-gold/40 text-gold hover:border-gold',
    alert: 'bg-alert/15 border-alert/40 text-alert hover:border-alert',
    pitch: 'bg-pitch/15 border-pitch/40 text-pitch hover:border-pitch',
  };

  return (
    <>
      <PageHeader
        eyebrow={`${match.match.sport_name} · scoring console`}
        title={`${match.match.home_team_name || 'Karwan'} vs ${match.match.away_team_name || match.match.opponent_name || 'Opposition'}`}
        subtitle="Record what happens as it happens. The scorecard, career records and every chart on the analysis screen are built from these events."
        actions={
          <>
            <Link to={`/matches/${id}/analysis`} className="btn-ghost"><BarChart3 size={14} /> Analysis</Link>
            <Link to={`/matches/${id}`} className="btn-ghost">Match record</Link>
            <button type="button" className="btn-ghost" onClick={undoLast} disabled={!events.length}>
              <Undo2 size={14} /> Undo last
            </button>
          </>
        }
      />

      <ErrorNote error={error} />
      {notice && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          notice.tone === 'warn' ? 'border-sky/30 bg-sky/10 text-sky' : 'border-gold/30 bg-gold/10 text-gold'
        }`}>
          <p className="font-semibold">{notice.title}</p>
          <ul className={notice.items.length > 1 ? 'list-disc pl-5 mt-1' : 'mt-1'}>
            {notice.items.map((m, i) => <li key={i} className={notice.items.length > 1 ? '' : 'list-none'}>{m}</li>)}
          </ul>
        </div>
      )}

      {/* Live scoreboard, computed from what has been recorded so far */}
      {live && activePeriod && (() => {
        const innings = live.periods.find((p) => p.period.id === activePeriod);
        if (!innings || !innings.summary) return null;
        const sum = innings.summary;
        const isCricket = innings.kind === 'cricket';
        const striker = isCricket
          ? innings.battingCard.filter((b) => !b.out).sort((a, b) => b.balls - a.balls)[0]
          : null;
        const bowler = isCricket
          ? innings.bowlingCard.slice().sort((a, b) => b.balls - a.balls)[0]
          : null;

        return (
          <div className="card-glow rounded-xl border border-line p-4 mb-5">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <p className="label">{innings.period.label}</p>
                <p className="font-display text-4xl leading-none text-ink mt-1">
                  {isCricket ? `${sum.runs}/${sum.wickets}` : (sum.points ?? sum.pointsFor ?? sum.scores ?? 0)}
                  {isCricket && <span className="text-ink-400 text-xl ml-2">({sum.overs})</span>}
                </p>
              </div>
              {isCricket ? (
                <>
                  <Metric label="Run rate" value={sum.runRate} />
                  <Metric label="Extras" value={sum.extrasTotal} />
                  <Metric label="Boundaries" value={sum.boundaries} />
                  <Metric label="Dot balls" value={`${sum.dotBallPercent}%`} />
                  {sum.target != null && <Metric label="Target" value={sum.target} tone="text-gold" />}
                  {sum.requiredRate != null && <Metric label="Required" value={sum.requiredRate} tone="text-gold" />}
                </>
              ) : (
                <>
                  <Metric label="Events" value={innings.events} />
                  {sum.shots != null && <Metric label="Shots" value={sum.shots} />}
                  {sum.conversion != null && <Metric label="Conversion" value={`${sum.conversion}%`} />}
                  {sum.pointsAgainst != null && <Metric label="Conceded" value={sum.pointsAgainst} />}
                </>
              )}
            </div>

            {isCricket && (striker || bowler) && (
              <div className="flex flex-wrap gap-x-8 gap-y-2 mt-4 pt-3 border-t border-line">
                {striker && (
                  <span className="text-sm">
                    <span className="label mr-2">Batting</span>
                    <span className="text-ink">{striker.name}</span>
                    <span className="stat-value ml-2">{striker.runs}<span className="text-ink-400">({striker.balls})</span></span>
                    <span className="text-ink-400 text-xs ml-2">SR {striker.strikeRate}</span>
                  </span>
                )}
                {bowler && (
                  <span className="text-sm">
                    <span className="label mr-2">Bowling</span>
                    <span className="text-ink">{bowler.name}</span>
                    <span className="stat-value ml-2">{bowler.wickets}/{bowler.runs}</span>
                    <span className="text-ink-400 text-xs ml-2">{bowler.overs} ov · econ {bowler.economy}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Periods */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {periods.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActivePeriod(p.id)}
            className={p.id === activePeriod ? 'chip-active' : 'chip-idle'}
          >
            {p.label}
            <span className="ml-1 opacity-70">{events.filter((e) => e.period_id === p.id).length}</span>
          </button>
        ))}
        <button type="button" className="btn-ghost text-xs" onClick={() => setCreatingPeriod(true)}>
          <Plus size={13} /> New {config.periodNoun || 'period'}
        </button>
      </div>

      {!activePeriod ? (
        <Section>
          <EmptyState
            title={`Open the first ${config.periodNoun || 'period'}`}
            message={`Events are recorded inside a ${config.periodNoun || 'period'}, so ${match.match.sport_name.toLowerCase()} needs one before scoring can start.`}
            action={<button type="button" className="btn-gold" onClick={() => setCreatingPeriod(true)}>New {config.periodNoun || 'period'}</button>}
          />
        </Section>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            {/* Who is involved, for whichever event type is being recorded */}
            {config.clockBased && (
              <Section title="Match clock">
                <div className="p-4 max-w-xs">
                  <Field label="Minute" hint="Applied to every event you record until you change it">
                    <input className="input font-mono" type="number" min="0" max="130" value={minute} onChange={(e) => setMinute(e.target.value)} />
                  </Field>
                </div>
              </Section>
            )}

            {/* The buttons */}
            {(config.types || []).filter((t) => (t.outcomes || []).length).map((type) => (
              <Section key={type.key} title={type.label} subtitle="Name who was involved, then tap an outcome">
                <div className="p-4">
                  <div className="grid sm:grid-cols-3 gap-3 mb-4">
                    {['primary', 'secondary', 'tertiary'].map((role) => {
                      const label = type[`${role}Label`];
                      if (!label) return null;
                      const current = rolesFor(type.key);
                      return (
                        <Field key={role} label={label}>
                          <select
                            className="input"
                            value={current[role]}
                            onChange={(e) => setRolesFor(type.key, { ...current, [role]: e.target.value })}
                          >
                            <option value="">Opposition / not recorded</option>
                            {lineup.map((l) => (
                              <option key={l.player_id} value={l.player_id}>{playerName(l)}</option>
                            ))}
                          </select>
                        </Field>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {type.outcomes.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => (o.key === 'wicket' || o.set?.wicket ? setDetailFor({ type, outcome: o }) : record(type, o))}
                        className={`rounded-xl border px-4 py-3 font-display text-xl min-w-[64px] transition-all hover:-translate-y-0.5 ${toneClass[o.tone] || toneClass.ink}`}
                      >
                        {o.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setDetailFor({ type, outcome: null })}
                      className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ink-400 hover:text-gold hover:border-gold/50"
                    >
                      Full detail…
                    </button>
                  </div>
                </div>
              </Section>
            ))}

            {/* Event types without quick buttons */}
            {(config.types || []).filter((t) => !(t.outcomes || []).length && t.key !== 'note').length > 0 && (
              <Section title="Other events">
                <div className="p-4 flex flex-wrap gap-2">
                  {(config.types || []).filter((t) => !(t.outcomes || []).length && t.key !== 'note').map((t) => (
                    <button key={t.key} type="button" className="btn-ghost" onClick={() => setDetailFor({ type: t, outcome: null })}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {/* Where it happened */}
            {ballType.coordinates && (
              <Section
                title={ballType.coordinates.label}
                subtitle="Tap the surface before recording the event, or skip it"
                actions={coords ? <Chip tone="active">Set</Chip> : null}
              >
                <div className="p-4">
                  <CoordinatePicker surface={config.surface} value={coords} onChange={setCoords} />
                  {coords && (
                    <button type="button" className="btn-quiet text-xs mt-2" onClick={() => setCoords(null)}>Clear</button>
                  )}
                </div>
              </Section>
            )}
          </div>

          {/* Feed */}
          <div className="space-y-5">
            <Section title={current?.label || 'Feed'} subtitle={`${periodEvents.length} events recorded`}>
              <ul ref={feedRef} className="divide-y divide-line max-h-[70vh] overflow-y-auto scroll-thin">
                {[...periodEvents].reverse().map((e) => (
                  <li key={e.id} className={`px-4 py-2.5 ${e.is_void ? 'opacity-40' : ''}`}>
                    <div className="flex items-start gap-2">
                      <span className="font-mono text-[11px] text-gold w-10 shrink-0 pt-0.5">
                        {e.over_number != null ? `${Math.floor(e.over_number)}.${e.ball_in_over}` : (e.minute != null ? `${Math.round(e.minute)}'` : `#${e.sequence}`)}
                      </span>
                      <span className="text-sm text-ink-700 flex-1">{e.commentary}</span>
                    </div>
                  </li>
                ))}
                {!periodEvents.length && (
                  <li className="px-4 py-10 text-center text-sm text-ink-400">
                    Nothing recorded yet. Tap an outcome to start.
                  </li>
                )}
              </ul>
            </Section>
          </div>
        </div>
      )}

      <PeriodForm
        open={creatingPeriod}
        onClose={() => setCreatingPeriod(false)}
        matchId={id}
        config={config}
        existing={periods}
        match={match.match}
        onSaved={(p) => { setActivePeriod(p.id); load(); }}
      />
      <DetailForm
        open={!!detailFor}
        onClose={() => setDetailFor(null)}
        detail={detailFor}
        lineup={lineup}
        roles={detailFor ? rolesFor(detailFor.type.key) : {}}
        onRecord={record}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Coordinates                                                         */
/* ------------------------------------------------------------------ */

/** One figure on the live scoreboard. */
function Metric({ label, value, tone = 'text-ink' }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={`stat-value text-xl mt-0.5 ${tone}`}>{value}</p>
    </div>
  );
}

function CoordinatePicker({ surface, value, onChange }) {
  const handle = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onChange({
      x: Math.round(((e.clientX - rect.left) / rect.width) * 100),
      y: Math.round(((e.clientY - rect.top) / rect.height) * 100),
    });
  };

  const isCricket = surface === 'cricket';

  return (
    <svg
      viewBox="0 0 100 100"
      onClick={handle}
      className="w-full max-w-xs mx-auto cursor-crosshair rounded-lg"
      role="img"
      aria-label="Pick where it happened"
    >
      {isCricket ? (
        <>
          <circle cx="50" cy="50" r="48" fill="#0A0F1C" stroke="#1E293B" strokeWidth="1" />
          <circle cx="50" cy="50" r="30" fill="none" stroke="#1E293B" strokeDasharray="2 2" />
          <rect x="47" y="39" width="6" height="22" rx="1" fill="#16203A" stroke="#2A3A52" strokeWidth="0.5" />
        </>
      ) : surface === 'basketball' ? (
        <>
          <rect x="0" y="0" width="100" height="100" rx="2" fill="#0A0F1C" stroke="#1E293B" />
          <circle cx="50" cy="95" r="6" fill="none" stroke="#2A3A52" />
          <path d="M12 100 A 40 40 0 0 1 88 100" fill="none" stroke="#2A3A52" strokeDasharray="2 2" />
          <rect x="38" y="80" width="24" height="20" fill="none" stroke="#2A3A52" />
        </>
      ) : (
        <>
          <rect x="0" y="0" width="100" height="100" rx="2" fill="#0A0F1C" stroke="#1E293B" />
          <line x1="50" y1="0" x2="50" y2="100" stroke="#2A3A52" strokeDasharray="2 2" />
          <circle cx="50" cy="50" r="10" fill="none" stroke="#2A3A52" />
          <rect x="0" y="30" width="14" height="40" fill="none" stroke="#2A3A52" />
          <rect x="86" y="30" width="14" height="40" fill="none" stroke="#2A3A52" />
        </>
      )}
      {value && (
        <>
          <circle cx={value.x} cy={value.y} r="3" fill="#F59E0B" />
          <circle cx={value.x} cy={value.y} r="6" fill="none" stroke="#F59E0B" strokeOpacity="0.4" />
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Full-detail entry                                                   */
/* ------------------------------------------------------------------ */

function DetailForm({ open, onClose, detail, lineup, roles, onRecord }) {
  const [values, setValues] = useState({});
  const [who, setWho] = useState({ primary: '', secondary: '', tertiary: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !detail) return;
    const defaults = {};
    for (const f of detail.type.fields || []) {
      if (f.default !== undefined) defaults[f.key] = f.default;
    }
    setValues({ ...defaults, ...(detail.outcome?.set || {}) });
    // Start from whoever is already selected for this event type, so the
    // common case needs no extra clicks.
    setWho({ primary: roles?.primary || '', secondary: roles?.secondary || '', tertiary: roles?.tertiary || '' });
  }, [open, detail, roles]);

  if (!detail) return null;
  const { type, outcome } = detail;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    await onRecord(type, outcome, values, who);
    setBusy(false);
    onClose();
  }

  const set = (key, v) => setValues({ ...values, [key]: v });

  return (
    <Modal open={open} onClose={onClose} title={`${type.label}${outcome ? ` — ${outcome.label}` : ''}`} wide>
      <form onSubmit={submit} className="space-y-4">
        {['primary', 'secondary', 'tertiary'].some((r) => type[`${r}Label`]) && (
          <div>
            <p className="label mb-2">Who was involved</p>
            <div className="grid sm:grid-cols-3 gap-3">
              {['primary', 'secondary', 'tertiary'].map((role) => {
                const label = type[`${role}Label`];
                if (!label) return null;
                return (
                  <Field key={role} label={label}>
                    <select className="input" value={who[role]} onChange={(e) => setWho({ ...who, [role]: e.target.value })}>
                      <option value="">Opposition / not recorded</option>
                      {lineup.map((l) => <option key={l.player_id} value={l.player_id}>{playerName(l)}</option>)}
                    </select>
                  </Field>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(type.fields || []).filter((f) => !f.derived).map((f) => (
            <Field key={f.key} label={f.label} hint={f.help}>
              {f.type === 'bool' ? (
                <label className="flex items-center gap-2 h-9">
                  <input type="checkbox" checked={!!values[f.key]} onChange={(e) => set(f.key, e.target.checked ? 1 : 0)} />
                  <span className="text-sm">{values[f.key] ? 'Yes' : 'No'}</span>
                </label>
              ) : f.type === 'select' ? (
                <select className="input" value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {(f.options || []).map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
                </select>
              ) : f.type === 'text' ? (
                <input className="input" value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input
                  className="input font-mono"
                  type="number"
                  step={f.type === 'dec' ? '0.1' : '1'}
                  min={f.min}
                  max={f.max}
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value === '' ? '' : Number(e.target.value))}
                />
              )}
            </Field>
          ))}
        </div>

        {/* Which batter was dismissed — the one field a wicket always needs */}
        {values.wicket ? (
          <Field label="Batter dismissed" hint="Defaults to the striker">
            <select className="input" value={values.dismissed_player_id ?? who.primary ?? ''} onChange={(e) => set('dismissed_player_id', e.target.value)}>
              <option value="">Striker</option>
              {lineup.map((l) => <option key={l.player_id} value={l.player_id}>{playerName(l)}</option>)}
            </select>
          </Field>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy}>
            <Check size={14} /> {busy ? 'Recording…' : 'Record event'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

function PeriodForm({ open, onClose, matchId, config, existing, match, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = existing.length + 1;
    const label = config.periodLabel === 'Innings'
      ? `${next === 1 ? '1st' : next === 2 ? '2nd' : `${next}th`} innings`
      : `${config.periodLabel} ${next}`;
    setForm({
      sequence: next,
      label,
      weBat: next % 2 === 1,
      planned_length: config.ballBased ? 20 : config.pointBased ? (config.pointsPerSet || 21) : 45,
      target: '',
    });
    setError(null);
  }, [open, existing, config]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { period } = await api.post(`/matches/${matchId}/periods`, {
        sequence: Number(form.sequence),
        label: form.label,
        team_id: form.weBat ? match.home_team_id : null,
        team_label: form.weBat ? null : (match.opponent_name || 'Opposition'),
        opponent_label: form.weBat ? (match.opponent_name || 'Opposition') : null,
        planned_length: form.planned_length === '' ? null : Number(form.planned_length),
        target: form.target === '' ? null : Number(form.target),
        status: 'in_progress',
      });
      onSaved(period);
      onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const lengthLabel = config.ballBased ? 'Overs' : config.pointBased ? 'Points to win' : 'Minutes';

  return (
    <Modal open={open} onClose={onClose} title={`New ${config.periodNoun || 'period'}`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Label"><input className="input" required value={form.label || ''} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <Field label="Order"><input className="input font-mono" type="number" min="1" value={form.sequence || 1} onChange={(e) => setForm({ ...form, sequence: e.target.value })} /></Field>
          <Field label={lengthLabel}><input className="input font-mono" type="number" value={form.planned_length ?? ''} onChange={(e) => setForm({ ...form, planned_length: e.target.value })} /></Field>
          {config.ballBased && (
            <Field label="Target" hint="Runs to chase, if this is the second innings">
              <input className="input font-mono" type="number" value={form.target ?? ''} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            </Field>
          )}
        </div>
        <label className="flex items-start gap-2.5 text-sm text-ink-600">
          <input type="checkbox" className="mt-0.5" checked={!!form.weBat} onChange={(e) => setForm({ ...form, weBat: e.target.checked })} />
          <span>
            {config.ballBased ? 'Karwan are batting' : 'Karwan are the side in possession'}
            <span className="block text-xs text-ink-400">
              This decides which side the athlete records belong to. Statistics only ever credit Karwan players.
            </span>
          </span>
        </label>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy}>{busy ? 'Opening…' : `Open ${config.periodNoun || 'period'}`}</button>
        </div>
      </form>
    </Modal>
  );
}
