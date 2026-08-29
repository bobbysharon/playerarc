import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, StatTile, Chip, Tabs } from '../components/ui';
import { titleCase } from '../lib/format';

export default function Sports() {
  const { can } = useAuth();
  const [sports, setSports] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [addingSeason, setAddingSeason] = useState(false);

  const load = useCallback(() => {
    api.get('/sports').then((d) => setSports(d.sports)).catch(setError);
    api.get('/sports/meta/seasons').then((d) => setSeasons(d.seasons)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Sports"
        subtitle="Each sport defines its own positions, match statistics, career calculations and rating model. Adding a sport does not require rebuilding the platform."
        actions={can('seasons.write') ? <button type="button" className="btn-ghost" onClick={() => setAddingSeason(true)}>Add season</button> : null}
      />
      <ErrorNote error={error} />
      {!sports ? <Spinner label="Loading sports" /> : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-5">
            {sports.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s)}
                className="card relative overflow-hidden p-4 text-left transition-all hover:shadow-lift hover:border-line-bright hover:-translate-y-0.5"
                style={{ borderTop: `3px solid ${s.color}` }}
              >
                <span
                  className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full blur-2xl opacity-40"
                  style={{ background: s.color }}
                />
                <div className="relative flex items-center gap-2.5 mb-3">
                  <span
                    className="h-9 w-9 rounded-xl grid place-items-center font-display text-lg text-white"
                    style={{ background: s.color, boxShadow: `0 0 18px ${s.color}66` }}
                  >
                    {s.name[0]}
                  </span>
                  <span className="min-w-0">
                    <span className="font-display text-lg leading-none block">{s.name}</span>
                    <span className="text-[11px] text-ink-400">{titleCase(s.category)} sport</span>
                  </span>
                </div>
                <div className="relative grid grid-cols-3 gap-2 text-center">
                  {[['Athletes', s.counts.players], ['Teams', s.counts.teams], ['Matches', s.counts.matches]].map(([l, v]) => (
                    <span key={l} className="block">
                      <span className="stat-value text-lg block">{v}</span>
                      <span className="text-[10px] uppercase tracking-wide text-ink-400">{l}</span>
                    </span>
                  ))}
                </div>
                <p className="relative text-xs text-ink-400 mt-3">
                  {(s.config?.matchStats || []).length} match statistics · {(s.config?.career || []).length} career calculations
                </p>
              </button>
            ))}
          </div>

          <Section title="Seasons">
            <DataTable
              columns={[
                { key: 'name', label: 'Season' },
                { key: 'sport_name', label: 'Sport', render: (s) => s.sport_name || 'All sports' },
                { key: 'start_date', label: 'Start' },
                { key: 'end_date', label: 'End' },
                { key: 'is_current', label: '', render: (s) => s.is_current ? <Chip tone="active">Current</Chip> : null },
              ]}
              rows={seasons}
              empty={{ title: 'No seasons defined', message: 'Seasons group teams, tournaments and matches for reporting.' }}
            />
          </Section>
        </>
      )}

      <SportConfig sport={selected} onClose={() => setSelected(null)} />
      <SeasonForm open={addingSeason} onClose={() => setAddingSeason(false)} sports={sports || []} onSaved={load} />
    </>
  );
}

function SportConfig({ sport, onClose }) {
  const [tab, setTab] = useState('stats');
  useEffect(() => { setTab('stats'); }, [sport]);
  if (!sport) return null;
  const c = sport.config || {};

  return (
    <Modal open={!!sport} onClose={onClose} title={`${sport.name} configuration`} wide>
      <Tabs
        tabs={[
          { key: 'stats', label: 'Match statistics', count: (c.matchStats || []).length },
          { key: 'career', label: 'Career record', count: (c.career || []).length },
          { key: 'positions', label: 'Positions', count: (c.positions || []).length },
          { key: 'rating', label: 'Rating model' },
          { key: 'boards', label: 'Leaderboards', count: (c.leaderboards || []).length },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-4">
        {tab === 'stats' && (
          <DataTable
            columns={[
              { key: 'label', label: 'Statistic' },
              { key: 'key', label: 'Field', mono: true },
              { key: 'group', label: 'Group', render: (f) => titleCase(f.group) },
              { key: 'type', label: 'Type', render: (f) => titleCase(f.type) },
              { key: 'range', label: 'Allowed range', mono: true, render: (f) => (f.min !== undefined ? `${f.min}–${f.max}` : '—') },
              { key: 'positions', label: 'Positions', render: (f) => f.positions ? f.positions.join(', ') : 'All' },
            ]}
            rows={c.matchStats || []}
            empty={{ title: 'No statistics configured', message: '' }}
          />
        )}
        {tab === 'career' && (
          <DataTable
            columns={[
              { key: 'label', label: 'Career statistic' },
              { key: 'group', label: 'Group', render: (f) => titleCase(f.group) },
              { key: 'how', label: 'Calculated as', mono: true, render: (f) => f.formula || `${titleCase(f.agg || '')}${f.field ? ` of ${f.field}` : ''}${f.whenFormula ? ` where ${f.whenFormula}` : ''}` },
              { key: 'format', label: 'Format', render: (f) => f.format || 'int' },
            ]}
            rows={c.career || []}
            empty={{ title: 'No career calculations', message: '' }}
          />
        )}
        {tab === 'positions' && (
          <DataTable
            columns={[{ key: 'label', label: 'Position' }, { key: 'key', label: 'Code', mono: true }, { key: 'group', label: 'Unit', render: (p) => titleCase(p.group) || '—' }]}
            rows={c.positions || []}
            empty={{ title: 'No positions configured', message: '' }}
          />
        )}
        {tab === 'rating' && (
          <>
            <p className="text-sm text-ink-400 mb-3">
              Each component returns 0–100 and is combined by weight. Formulas are stored as configuration, not code — no single
              rating formula is applied across sports.
            </p>
            <DataTable
              columns={[
                { key: 'label', label: 'Component' },
                { key: 'weight', label: 'Weight', align: 'right', mono: true, render: (r) => `${Math.round(r.weight * 100)}%` },
                { key: 'formula', label: 'Formula', mono: true },
              ]}
              rows={c.ratingModel?.components || []}
              empty={{ title: 'No rating model', message: '' }}
            />
          </>
        )}
        {tab === 'boards' && (
          <DataTable
            columns={[
              { key: 'label', label: 'Leaderboard' },
              { key: 'metric', label: 'Metric', mono: true },
              { key: 'order', label: 'Order', render: (b) => (b.order === 'asc' ? 'Lowest first' : 'Highest first') },
              { key: 'qualifier', label: 'Qualification', render: (b) => (b.qualifier ? `Minimum ${b.qualifier.min} ${b.qualifier.metric}` : 'None') },
            ]}
            rows={c.leaderboards || []}
            empty={{ title: 'No leaderboards configured', message: '' }}
          />
        )}
      </div>
    </Modal>
  );
}

function SeasonForm({ open, onClose, sports, onSaved }) {
  const [form, setForm] = useState({ name: '', sport_id: '', start_date: '', end_date: '', is_current: 0 });
  const [error, setError] = useState(null);
  useEffect(() => { if (open) setError(null); }, [open]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/sports/meta/seasons', { ...form, sport_id: form.sport_id ? Number(form.sport_id) : null });
      onSaved(); onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add season">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Season name"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="2026–27" /></Field>
        <Field label="Sport" hint="Leave empty for a club-wide season">
          <select className="input" value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value })}>
            <option value="">All sports</option>
            {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><input className="input" type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="End date"><input className="input" type="date" required value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.is_current} onChange={(e) => setForm({ ...form, is_current: e.target.checked ? 1 : 0 })} />
          This is the current season
        </label>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Add season</button>
        </div>
      </form>
    </Modal>
  );
}
