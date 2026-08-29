import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader, Section, Spinner, ErrorNote, Avatar, StatusChip, DataTable,
  Modal, Field, EmptyState,
} from '../components/ui';
import { ageFrom, formatDate, playerName, titleCase } from '../lib/format';

const BLANK = {
  first_name: '', last_name: '', display_name: '', dob: '', gender: 'male', nationality: '',
  registration_date: new Date().toISOString().slice(0, 10), status: 'active',
  phone: '', email: '', address: '', city: '', country: '',
  emergency_name: '', emergency_phone: '', emergency_relation: '',
  guardian_name: '', guardian_phone: '', guardian_email: '',
  height_cm: '', weight_kg: '', preferred_hand: 'right', preferred_foot: 'right',
  visibility: 'club', bio: '',
};

export default function Players() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [sports, setSports] = useState([]);
  const [teams, setTeams] = useState([]);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('table');
  const [creating, setCreating] = useState(params.get('new') === '1');

  const q = params.get('q') || '';
  const sport = params.get('sport') || '';
  const team = params.get('team') || '';
  const status = params.get('status') || '';
  const ageGroup = params.get('ageGroup') || '';
  const level = params.get('level') || '';
  const position = params.get('position') || '';
  const sort = params.get('sort') || 'name';
  const page = Number(params.get('page') || 1);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: '25', sort });
    for (const [k, v] of Object.entries({ q, sport, team, status, ageGroup, level, position })) if (v) query.set(k, v);
    setData(null);
    api.get(`/players?${query}`).then(setData).catch(setError);
  }, [q, sport, team, status, ageGroup, level, position, sort, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
    api.get('/players/filters/options').then(setOptions).catch(() => {});
  }, []);

  const columns = [
    {
      key: 'name',
      label: 'Athlete',
      render: (p) => (
        <span className="flex items-center gap-3">
          <Avatar player={p} size={36} />
          <span className="min-w-0">
            <span className="font-medium block truncate">{playerName(p)}</span>
            <span className="font-mono text-[11px] text-ink-400">{p.athlete_id}</span>
          </span>
        </span>
      ),
    },
    { key: 'sports', label: 'Sports', render: (p) => p.sports.length ? p.sports.map((s) => s.sport_name).join(', ') : <span className="text-ink-200">Not registered</span> },
    { key: 'teams', label: 'Current teams', render: (p) => p.teams.length ? p.teams.map((t) => t.name).join(', ') : <span className="text-ink-200">Unassigned</span> },
    { key: 'position', label: 'Position', render: (p) => titleCase(p.sports.find((s) => s.is_primary)?.position || p.sports[0]?.position || '') || '—' },
    { key: 'age', label: 'Age', align: 'right', mono: true, render: (p) => ageFrom(p.dob) ?? '—' },
    { key: 'status', label: 'Status', render: (p) => <StatusChip status={p.status} /> },
    { key: 'registration_date', label: 'Registered', align: 'right', mono: true, render: (p) => formatDate(p.registration_date) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Athlete records"
        title="Athletes"
        subtitle="Every athlete holds one permanent record, whatever sport, team or age group they move through."
        actions={
          <>
            <div className="flex rounded-lg border border-line overflow-hidden">
              {['table', 'cards'].map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={`px-3 py-2 text-xs font-semibold ${view === v ? 'bg-ink text-white' : 'bg-white text-ink-400'}`}>
                  {titleCase(v)}
                </button>
              ))}
            </div>
            {can('reports.export') && (
              <button type="button" className="btn-ghost" onClick={() => api.download('/export/players.xlsx', 'karwan-athletes.xlsx')}>
                Export Excel
              </button>
            )}
            {can('players.write') && <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Register athlete</button>}
          </>
        }
      />

      <Section className="mb-5">
        <div className="p-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Search" className="md:col-span-2">
            <input className="input" placeholder="Name or athlete ID" value={q} onChange={(e) => setParam('q', e.target.value)} />
          </Field>
          <Field label="Sport">
            <select className="input" value={sport} onChange={(e) => setParam('sport', e.target.value)}>
              <option value="">All sports</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Team">
            <select className="input" value={team} onChange={(e) => setParam('team', e.target.value)}>
              <option value="">All teams</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">Any status</option>
              {(options?.statuses || []).map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </Field>
          <Field label="Age group">
            <select className="input" value={ageGroup} onChange={(e) => setParam('ageGroup', e.target.value)}>
              <option value="">Any age group</option>
              {(options?.ageGroups || []).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Playing level">
            <select className="input" value={level} onChange={(e) => setParam('level', e.target.value)}>
              <option value="">Any level</option>
              {(options?.levels || []).map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
            </select>
          </Field>
          <Field label="Sort by">
            <select className="input" value={sort} onChange={(e) => setParam('sort', e.target.value)}>
              <option value="name">Name</option>
              <option value="athlete_id">Athlete ID</option>
              <option value="registered">Registration date</option>
              <option value="status">Status</option>
              <option value="dob">Date of birth</option>
            </select>
          </Field>
        </div>
      </Section>

      <ErrorNote error={error} />

      {!data ? <Spinner label="Loading athletes" /> : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-ink-400">
              <span className="stat-value text-ink">{data.total}</span> athlete{data.total === 1 ? '' : 's'}
              {(q || sport || team || status || ageGroup || level) && ' matching your filters'}
            </p>
            {(q || sport || team || status || ageGroup || level) && (
              <button type="button" className="btn-quiet text-xs" onClick={() => setParams({}, { replace: true })}>Clear filters</button>
            )}
          </div>

          {view === 'table' ? (
            <Section>
              <DataTable
                columns={columns}
                rows={data.players}
                onRowClick={(p) => navigate(`/players/${p.id}`)}
                empty={{
                  title: 'No athletes match those filters',
                  message: 'Widen the search, or register a new athlete to start their record.',
                  action: can('players.write') ? <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Register athlete</button> : null,
                }}
              />
            </Section>
          ) : data.players.length === 0 ? (
            <Section><EmptyState title="No athletes match those filters" message="Widen the search to see more of the club." /></Section>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {data.players.map((p) => (
                <Link key={p.id} to={`/players/${p.id}`} className="card p-4 flex gap-3 hover:shadow-lift transition-shadow">
                  <Avatar player={p} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold block truncate">{playerName(p)}</span>
                    <span className="font-mono text-[11px] text-ink-400 block">{p.athlete_id}</span>
                    <span className="flex flex-wrap gap-1.5 mt-2">
                      <StatusChip status={p.status} />
                      {p.sports.slice(0, 2).map((s) => (
                        <span key={s.id} className="chip bg-canvas text-ink-600">{s.sport_name}</span>
                      ))}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}

          {data.pages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-5">
              <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>Previous</button>
              <span className="text-sm text-ink-400 font-mono">{page} / {data.pages}</span>
              <button type="button" className="btn-ghost" disabled={page >= data.pages} onClick={() => setParam('page', String(page + 1))}>Next</button>
            </div>
          )}
        </>
      )}

      <RegisterAthlete open={creating} onClose={() => { setCreating(false); setParam('new', ''); }} sports={sports} onSaved={load} />
    </>
  );
}

function RegisterAthlete({ open, onClose, sports, onSaved }) {
  const [form, setForm] = useState(BLANK);
  const [sportId, setSportId] = useState('');
  const [position, setPosition] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setForm(BLANK); setError(null); setSportId(''); setPosition(''); } }, [open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const chosen = sports.find((s) => String(s.id) === String(sportId));
  const positions = chosen?.config?.positions || [];

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
      const { player } = await api.post('/players', payload);
      if (sportId) {
        await api.post(`/players/${player.id}/sports`, {
          sport_id: Number(sportId), is_primary: 1, position: position || null,
          joined_date: form.registration_date,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Register athlete" wide>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <p className="label mb-2">Identity</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="First name"><input className="input" required value={form.first_name} onChange={set('first_name')} /></Field>
            <Field label="Last name"><input className="input" required value={form.last_name} onChange={set('last_name')} /></Field>
            <Field label="Display name" hint="Shown on team sheets"><input className="input" value={form.display_name} onChange={set('display_name')} /></Field>
            <Field label="Date of birth"><input className="input" type="date" value={form.dob} onChange={set('dob')} /></Field>
            <Field label="Gender">
              <select className="input" value={form.gender} onChange={set('gender')}>
                <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
              </select>
            </Field>
            <Field label="Nationality"><input className="input" value={form.nationality} onChange={set('nationality')} /></Field>
            <Field label="Registration date"><input className="input" type="date" value={form.registration_date} onChange={set('registration_date')} /></Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={set('status')}>
                {['active', 'trial', 'inactive', 'injured'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </Field>
            <Field label="Record visibility" hint="Public records appear on public profiles">
              <select className="input" value={form.visibility} onChange={set('visibility')}>
                {['club', 'public', 'staff', 'private'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div>
          <p className="label mb-2">First sport</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Sport" hint="More sports can be added later — the athlete keeps one record">
              <select className="input" value={sportId} onChange={(e) => { setSportId(e.target.value); setPosition(''); }}>
                <option value="">Add later</option>
                {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Position">
              <select className="input" value={position} onChange={(e) => setPosition(e.target.value)} disabled={!positions.length}>
                <option value="">Not set</option>
                {positions.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div>
          <p className="label mb-2">Contact</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
            <Field label="City"><input className="input" value={form.city} onChange={set('city')} /></Field>
            <Field label="Address" className="sm:col-span-2"><input className="input" value={form.address} onChange={set('address')} /></Field>
            <Field label="Country"><input className="input" value={form.country} onChange={set('country')} /></Field>
          </div>
        </div>

        <div>
          <p className="label mb-2">Emergency &amp; guardian</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Emergency contact"><input className="input" value={form.emergency_name} onChange={set('emergency_name')} /></Field>
            <Field label="Emergency phone"><input className="input" value={form.emergency_phone} onChange={set('emergency_phone')} /></Field>
            <Field label="Relationship"><input className="input" value={form.emergency_relation} onChange={set('emergency_relation')} /></Field>
            <Field label="Guardian name" hint="Required for athletes under 18"><input className="input" value={form.guardian_name} onChange={set('guardian_name')} /></Field>
            <Field label="Guardian phone"><input className="input" value={form.guardian_phone} onChange={set('guardian_phone')} /></Field>
            <Field label="Guardian email"><input className="input" type="email" value={form.guardian_email} onChange={set('guardian_email')} /></Field>
          </div>
        </div>

        <div>
          <p className="label mb-2">Physical</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Height (cm)"><input className="input" type="number" step="0.1" value={form.height_cm} onChange={set('height_cm')} /></Field>
            <Field label="Weight (kg)"><input className="input" type="number" step="0.1" value={form.weight_kg} onChange={set('weight_kg')} /></Field>
            <Field label="Preferred hand">
              <select className="input" value={form.preferred_hand} onChange={set('preferred_hand')}>
                <option value="right">Right</option><option value="left">Left</option><option value="both">Both</option>
              </select>
            </Field>
            <Field label="Preferred foot">
              <select className="input" value={form.preferred_foot} onChange={set('preferred_foot')}>
                <option value="right">Right</option><option value="left">Left</option><option value="both">Both</option>
              </select>
            </Field>
          </div>
        </div>

        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy}>{busy ? 'Registering…' : 'Register athlete'}</button>
        </div>
      </form>
    </Modal>
  );
}
