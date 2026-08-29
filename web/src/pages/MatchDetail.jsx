import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader, Section, Spinner, ErrorNote, DataTable, Tabs, Modal, Field,
  Avatar, Chip, EmptyState,
} from '../components/ui';
import { formatDateTime, playerName, titleCase } from '../lib/format';

export default function MatchDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('scorecard');
  const [editingLineup, setEditingLineup] = useState(false);
  const [editingResult, setEditingResult] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    api.get(`/matches/${id}`).then(setData).catch(setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading match" />;

  const { match: m, sport, lineup, performances } = data;
  const config = sport.config || {};

  return (
    <>
      <PageHeader
        eyebrow={[m.sport_name, m.tournament_name, m.stage].filter(Boolean).join(' · ')}
        title={`${m.home_team_name || 'Karwan'} vs ${m.away_team_name || m.opponent_name || 'Opposition'}`}
        subtitle={[formatDateTime(m.scheduled_at), m.venue, m.format].filter(Boolean).join(' · ')}
        actions={
          <>
            <Chip tone={m.result || m.status}>{titleCase(m.result || m.status)}</Chip>
            {can('matches.write') && <button type="button" className="btn-ghost" onClick={() => setEditingLineup(true)}>Select squad</button>}
            {can('matches.write') && <button type="button" className="btn-gold" onClick={() => setEditingResult(true)}>Match result</button>}
          </>
        }
      />

      {(m.home_score || m.away_score) && (
        <div className="card p-5 mb-5 flex flex-wrap items-center justify-center gap-6 text-center">
          <div>
            <p className="label">{m.home_team_name || 'Karwan'}</p>
            <p className="font-display text-4xl mt-1">{m.home_score || '—'}</p>
          </div>
          <span className="font-display text-2xl text-ink-200">vs</span>
          <div>
            <p className="label">{m.away_team_name || m.opponent_name}</p>
            <p className="font-display text-4xl mt-1">{m.away_score || '—'}</p>
          </div>
          {m.result_summary && <p className="w-full text-sm text-ink-400">{m.result_summary}</p>}
        </div>
      )}

      {notice && (
        <div className="mb-5 rounded-lg border border-pitch/30 bg-pitch/5 px-4 py-3 text-sm text-pitch">
          <p className="font-semibold">{notice.title}</p>
          {notice.items?.length > 0 && <ul className="list-disc pl-5 mt-1">{notice.items.map((i, k) => <li key={k}>{i}</li>)}</ul>}
        </div>
      )}

      <Tabs
        tabs={[
          { key: 'scorecard', label: 'Scorecard', count: performances.length },
          { key: 'squad', label: 'Squad', count: lineup.length },
          { key: 'details', label: 'Match details' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {tab === 'scorecard' && (
          <Scorecard
            match={m}
            config={config}
            lineup={lineup}
            performances={performances}
            editable={can('performances.write')}
            onSaved={(result) => {
              load();
              setNotice({
                title: `Saved statistics for ${result.saved} athlete${result.saved === 1 ? '' : 's'}.`,
                items: result.milestones,
              });
            }}
          />
        )}

        {tab === 'squad' && (
          <Section title="Squad" subtitle={config.squadSize ? `${config.squadSize} in the starting lineup` : undefined}>
            <DataTable
              columns={[
                {
                  key: 'name', label: 'Athlete',
                  render: (r) => (
                    <Link to={`/players/${r.player_id}`} className="flex items-center gap-3">
                      <Avatar player={r} size={32} />
                      <span>
                        <span className="font-medium block">{playerName(r)}</span>
                        <span className="font-mono text-[11px] text-ink-400">{r.athlete_id}</span>
                      </span>
                    </Link>
                  ),
                },
                { key: 'jersey_number', label: 'No.', align: 'right', mono: true, render: (r) => r.jersey_number ?? '—' },
                { key: 'position', label: 'Position', render: (r) => titleCase(r.position || r.default_position) || '—' },
                { key: 'batting_order', label: 'Order', align: 'right', mono: true, render: (r) => r.batting_order ?? '—' },
                { key: 'role', label: 'Role', render: (r) => [r.is_captain && 'Captain', r.is_keeper && 'Keeper', r.is_substitute && 'Substitute'].filter(Boolean).join(', ') || '—' },
              ]}
              rows={lineup}
              empty={{ title: 'No squad selected', message: 'Select the squad before entering statistics.' }}
            />
          </Section>
        )}

        {tab === 'details' && (
          <Section title="Match details">
            <dl className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                ['Sport', m.sport_name], ['Tournament', m.tournament_name || 'Friendly'], ['Season', m.season_name],
                ['Stage', m.stage], ['Format', m.format], ['Scheduled', formatDateTime(m.scheduled_at)],
                ['Venue', m.venue], ['Home team', m.home_team_name], ['Opposition', m.away_team_name || m.opponent_name],
                ['Status', titleCase(m.status)], ['Result', titleCase(m.result)], ['Score', m.home_score ? `${m.home_score} – ${m.away_score}` : null],
                ['Toss', m.toss_winner ? `${m.toss_winner} · ${m.toss_decision || ''}` : null],
                ['Officials', m.officials], ['Notes', m.notes],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="label">{label}</dt>
                  <dd className="text-sm mt-1">{value || <span className="text-ink-200">—</span>}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}
      </div>

      <LineupEditor open={editingLineup} onClose={() => setEditingLineup(false)} match={m} config={config} lineup={lineup} onSaved={load} />
      <ResultEditor open={editingResult} onClose={() => setEditingResult(false)} match={m} lineup={lineup} onSaved={load} />
    </>
  );
}

/**
 * The scorecard renders whatever the sport's configuration declares — no
 * hard-coded cricket or football forms. A field marked for certain positions
 * only appears for athletes in those positions.
 */
function Scorecard({ match, config, lineup, performances, editable, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const fields = config.matchStats || [];
  const groups = config.statGroups || [];

  useEffect(() => {
    const next = {};
    for (const p of lineup) {
      const existing = performances.find((x) => x.player_id === p.player_id);
      next[p.player_id] = existing ? { ...existing.stats } : {};
    }
    setValues(next);
  }, [lineup, performances]);

  const fieldsFor = (player) => {
    const position = player.position || player.default_position;
    return fields.filter((f) => !f.positions || (position && f.positions.includes(position)));
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = lineup.map((p) => ({ player_id: p.player_id, team_id: p.team_id, stats: values[p.player_id] || {} }));
      const result = await api.put(`/matches/${match.id}/performances`, { performances: payload });
      setEdit(false);
      onSaved(result);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  if (!lineup.length) {
    return (
      <Section title="Scorecard">
        <EmptyState title="Select the squad first" message="Statistics can only be entered for athletes named in the match squad." />
      </Section>
    );
  }

  if (!edit) {
    const columns = [
      {
        key: 'name', label: 'Athlete',
        render: (r) => <Link to={`/players/${r.player_id}`} className="link">{playerName(r)}</Link>,
      },
      ...groups.flatMap((g) => {
        const cols = [...fields, ...(config.matchDerived || [])].filter((f) => f.group === g.key && f.type !== 'select' && f.type !== 'text');
        return cols.slice(0, 8).map((f) => ({
          key: f.key, label: f.label, align: 'right', mono: true,
          render: (r) => {
            const v = r.computed?.[f.key];
            if (v === undefined || v === null) return '—';
            if (f.type === 'bool') return v ? 'Yes' : '—';
            return typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v;
          },
        }));
      }),
      { key: 'rating', label: 'Rating', align: 'right', mono: true, render: (r) => r.rating ?? '—' },
    ];

    return (
      <Section
        title="Scorecard"
        subtitle={`${performances.length} of ${lineup.length} athletes have statistics recorded`}
        actions={editable ? <button type="button" className="btn-gold text-xs" onClick={() => setEdit(true)}>Enter statistics</button> : null}
      >
        {performances.length === 0
          ? <EmptyState title="No statistics recorded" message="Enter the match statistics and every athlete's career record updates automatically." />
          : <DataTable columns={columns} rows={performances} empty={{ title: '', message: '' }} />}
      </Section>
    );
  }

  return (
    <Section
      title="Enter match statistics"
      subtitle="Calculated values such as strike rate and pass accuracy are worked out for you"
      actions={
        <>
          <button type="button" className="btn-ghost text-xs" onClick={() => setEdit(false)}>Cancel</button>
          <button type="button" className="btn-gold text-xs" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save statistics'}</button>
        </>
      }
    >
      <div className="p-4 space-y-4">
        <ErrorNote error={error} />
        {lineup.map((p) => {
          const playerFields = fieldsFor(p);
          const v = values[p.player_id] || {};
          const setStat = (key, value) => setValues({ ...values, [p.player_id]: { ...v, [key]: value } });
          return (
            <details key={p.player_id} className="border border-line rounded-lg" open={lineup.length <= 6}>
              <summary className="px-3 py-2.5 cursor-pointer flex items-center gap-3 hover:bg-white/[0.04] rounded-lg">
                <Avatar player={p} size={30} />
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-medium block truncate">{playerName(p)}</span>
                  <span className="text-[11px] text-ink-400">{titleCase(p.position || p.default_position) || 'Position not set'}</span>
                </span>
                {Object.keys(v).length > 0 && <Chip tone="active">Recorded</Chip>}
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-3">
                {groups.map((g) => {
                  const gf = playerFields.filter((f) => f.group === g.key);
                  if (!gf.length) return null;
                  return (
                    <div key={g.key}>
                      <p className="label mb-1.5">{g.label}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                        {gf.map((f) => (
                          <label key={f.key} className="block">
                            <span className="text-[11px] text-ink-400 block mb-1 truncate" title={f.help || f.label}>{f.label}</span>
                            {f.type === 'bool' ? (
                              <label className="flex items-center gap-2 h-9">
                                <input type="checkbox" checked={!!v[f.key]} onChange={(e) => setStat(f.key, e.target.checked ? 1 : 0)} />
                                <span className="text-sm">{v[f.key] ? 'Yes' : 'No'}</span>
                              </label>
                            ) : f.type === 'select' ? (
                              <select className="input py-1.5" value={v[f.key] ?? ''} onChange={(e) => setStat(f.key, e.target.value)}>
                                <option value="">—</option>
                                {(f.options || []).map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
                              </select>
                            ) : (
                              <input
                                className="input py-1.5 font-mono"
                                type="number"
                                step={f.type === 'dec' ? '0.1' : '1'}
                                min={f.min}
                                max={f.max}
                                value={v[f.key] ?? ''}
                                onChange={(e) => setStat(f.key, e.target.value === '' ? '' : Number(e.target.value))}
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setEdit(false)}>Cancel</button>
          <button type="button" className="btn-gold" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save statistics'}</button>
        </div>
      </div>
    </Section>
  );
}

function LineupEditor({ open, onClose, match, config, lineup, onSaved }) {
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const teamId = match.home_team_id;
    if (!teamId) { setCandidates([]); return; }
    api.get(`/teams/${teamId}`).then((d) => {
      setCandidates(d.roster.filter((r) => !r.end_date));
      const next = {};
      lineup.forEach((l) => {
        next[l.player_id] = {
          is_starting: l.is_starting, is_substitute: l.is_substitute, is_captain: l.is_captain,
          is_keeper: l.is_keeper, position: l.position || '', jersey_number: l.jersey_number ?? '',
          batting_order: l.batting_order ?? '', minutes_played: l.minutes_played ?? '',
        };
      });
      setSelected(next);
    }).catch(setError);
  }, [open, match.home_team_id, lineup]);

  const starters = Object.values(selected).filter((s) => s.is_starting && !s.is_substitute).length;

  const toggle = (player) => {
    const next = { ...selected };
    if (next[player.player_id]) delete next[player.player_id];
    else {
      next[player.player_id] = {
        is_starting: 1, is_substitute: 0, is_captain: 0,
        is_keeper: player.position === 'wicket_keeper' || player.position === 'GK' ? 1 : 0,
        position: player.position || '', jersey_number: player.jersey_number ?? '',
        batting_order: '', minutes_played: '',
      };
    }
    setSelected(next);
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const players = Object.entries(selected).map(([playerId, s]) => ({
        player_id: Number(playerId),
        team_id: match.home_team_id,
        is_starting: s.is_starting ? 1 : 0,
        is_substitute: s.is_substitute ? 1 : 0,
        is_captain: s.is_captain ? 1 : 0,
        is_keeper: s.is_keeper ? 1 : 0,
        position: s.position || null,
        jersey_number: s.jersey_number === '' ? null : Number(s.jersey_number),
        batting_order: s.batting_order === '' ? null : Number(s.batting_order),
        minutes_played: s.minutes_played === '' ? null : Number(s.minutes_played),
      }));
      await api.put(`/matches/${match.id}/lineup`, { players });
      onSaved(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Select the squad" wide>
      <div className="space-y-3">
        <p className="text-sm text-ink-400">
          {config.squadSize
            ? `${starters} named in the starting lineup — ${match.sport_name} allows ${config.squadSize}.`
            : `${starters} selected.`}
        </p>
        {!match.home_team_id && <p className="text-sm text-alert">This match has no club team assigned, so there is no roster to pick from.</p>}
        <ul className="border border-line rounded-lg divide-y divide-line max-h-[50vh] overflow-y-auto scroll-thin">
          {candidates.map((c) => {
            const s = selected[c.player_id];
            return (
              <li key={c.player_id} className="px-3 py-2">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={!!s} onChange={() => toggle(c)} />
                  <Avatar player={c} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm block truncate">{playerName(c)}</span>
                    <span className="text-[11px] text-ink-400">{titleCase(c.position) || 'No position set'}</span>
                  </span>
                </div>
                {s && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 pl-9">
                    <label className="text-[11px] text-ink-400">Position
                      <select className="input py-1 mt-0.5" value={s.position} onChange={(e) => setSelected({ ...selected, [c.player_id]: { ...s, position: e.target.value } })}>
                        <option value="">—</option>
                        {(config.positions || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] text-ink-400">Jersey
                      <input className="input py-1 mt-0.5 font-mono" type="number" value={s.jersey_number} onChange={(e) => setSelected({ ...selected, [c.player_id]: { ...s, jersey_number: e.target.value } })} />
                    </label>
                    <label className="text-[11px] text-ink-400">Batting order
                      <input className="input py-1 mt-0.5 font-mono" type="number" value={s.batting_order} onChange={(e) => setSelected({ ...selected, [c.player_id]: { ...s, batting_order: e.target.value } })} />
                    </label>
                    <span className="flex items-end gap-3 text-[11px] text-ink-600 pb-1.5">
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={!!s.is_captain} onChange={(e) => setSelected({ ...selected, [c.player_id]: { ...s, is_captain: e.target.checked ? 1 : 0 } })} /> Captain
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={!!s.is_substitute} onChange={(e) => setSelected({ ...selected, [c.player_id]: { ...s, is_substitute: e.target.checked ? 1 : 0 } })} /> Sub
                      </label>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
          {!candidates.length && <li className="px-3 py-6 text-sm text-ink-400 text-center">No athletes available on this roster.</li>}
        </ul>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-gold" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save squad'}</button>
        </div>
      </div>
    </Modal>
  );
}

function ResultEditor({ open, onClose, match, lineup, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({
        status: match.status, result: match.result || '', home_score: match.home_score || '',
        away_score: match.away_score || '', result_summary: match.result_summary || '',
        player_of_match_id: match.player_of_match_id || '', notes: match.notes || '',
        toss_winner: match.toss_winner || '', toss_decision: match.toss_decision || '', officials: match.officials || '',
      });
      setError(null);
    }
  }, [open, match]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const payload = { ...form };
      payload.player_of_match_id = form.player_of_match_id ? Number(form.player_of_match_id) : null;
      if (!payload.result) delete payload.result;
      if (payload.result === 'win') payload.winner_team_id = match.home_team_id;
      await api.put(`/matches/${match.id}`, payload);
      onSaved(); onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Match result">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className="input" value={form.status || ''} onChange={set('status')}>
              {['scheduled', 'live', 'completed', 'abandoned', 'cancelled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </Field>
          <Field label="Result">
            <select className="input" value={form.result || ''} onChange={set('result')}>
              <option value="">Not decided</option>
              {['win', 'loss', 'draw', 'tie', 'no_result'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </select>
          </Field>
          <Field label={`${match.home_team_name || 'Karwan'} score`}><input className="input font-mono" value={form.home_score || ''} onChange={set('home_score')} placeholder="182/6" /></Field>
          <Field label={`${match.away_team_name || match.opponent_name || 'Opposition'} score`}><input className="input font-mono" value={form.away_score || ''} onChange={set('away_score')} placeholder="178/9" /></Field>
          <Field label="Result summary" className="col-span-2"><input className="input" value={form.result_summary || ''} onChange={set('result_summary')} placeholder="Karwan won by 4 runs" /></Field>
          <Field label="Player of the match" className="col-span-2" hint="Creates an award and a timeline entry for that athlete">
            <select className="input" value={form.player_of_match_id || ''} onChange={set('player_of_match_id')}>
              <option value="">Not awarded</option>
              {lineup.map((l) => <option key={l.player_id} value={l.player_id}>{playerName(l)}</option>)}
            </select>
          </Field>
          <Field label="Toss won by"><input className="input" value={form.toss_winner || ''} onChange={set('toss_winner')} /></Field>
          <Field label="Elected to"><input className="input" value={form.toss_decision || ''} onChange={set('toss_decision')} placeholder="bat / bowl" /></Field>
          <Field label="Officials" className="col-span-2"><input className="input" value={form.officials || ''} onChange={set('officials')} /></Field>
          <Field label="Notes" className="col-span-2"><textarea className="input" rows={2} value={form.notes || ''} onChange={set('notes')} /></Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Save result</button>
        </div>
      </form>
    </Modal>
  );
}
