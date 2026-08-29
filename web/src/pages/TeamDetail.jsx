import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader, Section, Spinner, ErrorNote, DataTable, Tabs, StatTile, Modal,
  Field, Avatar, Chip, StatusChip, EmptyState,
} from '../components/ui';
import { formatDate, formatDateTime, playerName, titleCase } from '../lib/format';

export default function TeamDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('roster');
  const [adding, setAdding] = useState(false);
  const [editingMember, setEditingMember] = useState(null);

  const load = useCallback(() => {
    api.get(`/teams/${id}`).then(setData).catch(setError);
    api.get(`/reports/team/${id}`).then(setReport).catch(() => setReport(null));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading squad" />;

  const { team, roster, matches, training, record } = data;
  const current = roster.filter((r) => !r.end_date);
  const past = roster.filter((r) => r.end_date);

  return (
    <>
      <PageHeader
        eyebrow={`${team.sport_name}${team.season_name ? ` · ${team.season_name}` : ''}`}
        title={team.name}
        subtitle={[team.age_group, titleCase(team.level), team.coach_name && `Coached by ${team.coach_name}`, team.home_venue].filter(Boolean).join(' · ')}
        actions={can('teams.write') ? <button type="button" className="btn-gold" onClick={() => setAdding(true)}>Add athlete</button> : null}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatTile label="Squad" value={current.length} hint={`${past.length} former`} />
        <StatTile label="Played" value={record.played} />
        <StatTile label="Won" value={record.won} tone="pitch" />
        <StatTile label="Lost" value={record.lost} tone="alert" />
        <StatTile label="Attendance" value={`${report?.attendanceRate ?? 0}%`} hint="training" />
      </div>

      <Tabs
        tabs={[
          { key: 'roster', label: 'Roster', count: current.length },
          { key: 'performance', label: 'Squad performance' },
          { key: 'matches', label: 'Fixtures & results', count: matches.length },
          { key: 'training', label: 'Training', count: training.length },
          { key: 'history', label: 'Roster history', count: past.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {tab === 'roster' && (
          <Section>
            <DataTable
              columns={[
                {
                  key: 'name', label: 'Athlete',
                  render: (r) => (
                    <Link to={`/players/${r.player_id}`} className="flex items-center gap-3">
                      <Avatar player={r} size={34} />
                      <span>
                        <span className="font-medium block">{playerName(r)}</span>
                        <span className="font-mono text-[11px] text-ink-400">{r.athlete_id}</span>
                      </span>
                    </Link>
                  ),
                },
                { key: 'jersey_number', label: 'No.', align: 'right', mono: true, render: (r) => r.jersey_number ?? '—' },
                { key: 'position', label: 'Position', render: (r) => titleCase(r.position) || '—' },
                { key: 'role', label: 'Role', render: (r) => r.role === 'player' ? '—' : <Chip tone="upcoming">{titleCase(r.role)}</Chip> },
                { key: 'start_date', label: 'Since', render: (r) => formatDate(r.start_date) },
                { key: 'player_status', label: 'Status', render: (r) => <StatusChip status={r.player_status} /> },
                ...(can('teams.write') ? [{
                  key: 'actions', label: '', align: 'right',
                  render: (r) => <button type="button" className="btn-quiet text-xs" onClick={() => setEditingMember(r)}>Manage</button>,
                }] : []),
              ]}
              rows={current}
              empty={{ title: 'No athletes on this roster', message: 'Add athletes to build the squad. They keep their existing record.' }}
            />
          </Section>
        )}

        {tab === 'performance' && (
          <Section title="Squad performance" subtitle="Career statistics for this sport, for every athlete on the roster">
            <DataTable
              columns={[
                { key: 'name', label: 'Athlete', render: (r) => <Link to={`/players/${r.playerId}`} className="link">{r.name}</Link> },
                { key: 'matches', label: 'Matches', align: 'right', mono: true },
                ...(report?.players?.[0]?.headline || []).map((h, i) => ({
                  key: `h${i}`, label: h.label, align: 'right', mono: true,
                  render: (r) => r.headline[i]?.display ?? '—',
                })),
                { key: 'rating', label: 'Rating', align: 'right', mono: true, render: (r) => r.rating ?? '—' },
              ]}
              rows={(report?.players || []).filter((p) => p.active)}
              empty={{ title: 'No performance data', message: 'Enter match statistics to populate squad performance.' }}
            />
          </Section>
        )}

        {tab === 'matches' && (
          <Section>
            <DataTable
              columns={[
                { key: 'scheduled_at', label: 'Date', render: (m) => formatDateTime(m.scheduled_at) },
                { key: 'fixture', label: 'Fixture', render: (m) => <Link to={`/matches/${m.id}`} className="link">{m.home_team_name || 'Karwan'} vs {m.away_team_name || m.opponent_name}</Link> },
                { key: 'tournament_name', label: 'Competition', render: (m) => m.tournament_name || 'Friendly' },
                { key: 'venue', label: 'Venue', render: (m) => m.venue || '—' },
                { key: 'score', label: 'Score', mono: true, render: (m) => m.home_score ? `${m.home_score} – ${m.away_score}` : '—' },
                { key: 'result', label: 'Result', render: (m) => m.result ? <Chip tone={m.result}>{titleCase(m.result)}</Chip> : <Chip tone={m.status}>{titleCase(m.status)}</Chip> },
              ]}
              rows={matches}
              empty={{ title: 'No fixtures', message: 'Schedule a match to begin the season record.' }}
            />
          </Section>
        )}

        {tab === 'training' && (
          <Section>
            <DataTable
              columns={[
                { key: 'session_date', label: 'Date', render: (t) => formatDate(t.session_date) },
                { key: 'training_type', label: 'Type', render: (t) => <Link to={`/training/${t.id}`} className="link">{titleCase(t.training_type)}</Link> },
                { key: 'coach_name', label: 'Coach', render: (t) => t.coach_name || '—' },
                { key: 'duration_minutes', label: 'Minutes', align: 'right', mono: true },
                { key: 'attendance', label: 'Attendance', align: 'right', mono: true, render: (t) => `${t.attended}/${t.invited}` },
              ]}
              rows={training}
              empty={{ title: 'No sessions recorded', message: 'Log a training session to start tracking attendance.' }}
            />
          </Section>
        )}

        {tab === 'history' && (
          <Section title="Former squad members" subtitle="Closed memberships are kept permanently">
            <DataTable
              columns={[
                { key: 'name', label: 'Athlete', render: (r) => <Link to={`/players/${r.player_id}`} className="link">{playerName(r)}</Link> },
                { key: 'jersey_number', label: 'No.', align: 'right', mono: true, render: (r) => r.jersey_number ?? '—' },
                { key: 'period', label: 'Period', render: (r) => `${formatDate(r.start_date)} → ${formatDate(r.end_date)}` },
                { key: 'status', label: 'Left as', render: (r) => <Chip tone="inactive">{titleCase(r.status)}</Chip> },
              ]}
              rows={past}
              empty={{ title: 'No former members', message: 'Athletes who move on will remain listed here.' }}
            />
          </Section>
        )}
      </div>

      <AddToRoster open={adding} onClose={() => setAdding(false)} team={team} onSaved={load} />
      <ManageMembership member={editingMember} onClose={() => setEditingMember(null)} teamId={team.id} onSaved={load} />
    </>
  );
}

function AddToRoster({ open, onClose, team, onSaved }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ role: 'player', jersey_number: '', start_date: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => {
      api.get(`/players?q=${encodeURIComponent(q)}&pageSize=8`).then((d) => setResults(d.players)).catch(() => {});
    }, 200);
    return () => clearTimeout(id);
  }, [q, open]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/teams/${team.id}/members`, {
        player_id: selected.id,
        role: form.role,
        jersey_number: form.jersey_number === '' ? null : Number(form.jersey_number),
        start_date: form.start_date,
      });
      onSaved(); onClose(); setSelected(null); setQ('');
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add an athlete to ${team.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Find an athlete" hint="Registering for the team also registers them for this sport">
          <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setSelected(null); }} placeholder="Name or athlete ID" />
        </Field>
        {!selected && (
          <ul className="border border-line rounded-lg max-h-56 overflow-y-auto scroll-thin divide-y divide-line">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => { setSelected(p); setQ(playerName(p)); }} className="w-full text-left px-3 py-2 hover:bg-white/[0.04] flex items-center gap-2">
                  <Avatar player={p} size={28} />
                  <span className="min-w-0">
                    <span className="text-sm block truncate">{playerName(p)}</span>
                    <span className="font-mono text-[11px] text-ink-400">{p.athlete_id}</span>
                  </span>
                </button>
              </li>
            ))}
            {!results.length && <li className="px-3 py-4 text-sm text-ink-400 text-center">No athletes found.</li>}
          </ul>
        )}
        {selected && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {['player', 'captain', 'vice_captain', 'wicket_keeper', 'goalkeeper'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
              </select>
            </Field>
            <Field label="Jersey number"><input className="input" type="number" value={form.jersey_number} onChange={(e) => setForm({ ...form, jersey_number: e.target.value })} /></Field>
            <Field label="Start date" className="col-span-2"><input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          </div>
        )}
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={!selected}>Add to roster</button>
        </div>
      </form>
    </Modal>
  );
}

function ManageMembership({ member, onClose, teamId, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  useEffect(() => {
    if (member) setForm({ role: member.role, jersey_number: member.jersey_number ?? '', end_date: '', status: 'promoted' });
    setError(null);
  }, [member]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.put(`/teams/${teamId}/members/${member.id}`, {
        role: form.role,
        jersey_number: form.jersey_number === '' ? null : Number(form.jersey_number),
        end_date: form.end_date || null,
        status: form.end_date ? form.status : 'active',
      });
      onSaved(); onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={!!member} onClose={onClose} title={member ? `Manage ${playerName(member)}` : ''}>
      {member && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {['player', 'captain', 'vice_captain', 'wicket_keeper', 'goalkeeper'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
              </select>
            </Field>
            <Field label="Jersey number"><input className="input" type="number" value={form.jersey_number} onChange={(e) => setForm({ ...form, jersey_number: e.target.value })} /></Field>
          </div>
          <div className="border-t border-line pt-3">
            <p className="label mb-2">End this membership</p>
            <p className="text-xs text-ink-400 mb-2">The roster entry is closed, not deleted — it stays on the athlete's team history.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="End date"><input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
              <Field label="Reason">
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {['promoted', 'ended', 'transferred'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-gold">Save</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
