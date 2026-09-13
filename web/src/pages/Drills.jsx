import { useCallback, useEffect, useState } from 'react';
import { Dumbbell, Clock, Users, Package, Plus, ListChecks } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, Tabs, Chip, StatTile, EmptyState,
} from '../components/ui';
import { titleCase } from '../lib/format';

const CATEGORIES = ['warm_up', 'technical', 'tactical', 'fitness', 'strength', 'skills',
  'match_practice', 'recovery', 'fielding', 'goalkeeping'];

export default function Drills() {
  const { can } = useAuth();
  const [tab, setTab] = useState('library');
  const [drills, setDrills] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [sports, setSports] = useState([]);
  const [filters, setFilters] = useState({ sport: '', category: '', q: '' });
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) q.set(k, v); });
    setDrills(null);
    api.get(`/drills?${q}`).then((d) => setDrills(d.drills)).catch(setError);
    api.get('/session-templates').then((d) => setTemplates(d.templates)).catch(() => {});
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/sports').then((d) => setSports(d.sports)).catch(() => {}); }, []);

  const byCategory = {};
  (drills || []).forEach((d) => { byCategory[d.category] = (byCategory[d.category] || 0) + 1; });

  return (
    <>
      <PageHeader
        eyebrow="Development"
        title="Drill library"
        subtitle="Drills written once and reused, and session plans built from them — so a coach stops retyping the same warm-up every week."
        actions={can('training.write') ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => setPlanning(true)}><ListChecks size={14} /> New session plan</button>
            <button type="button" className="btn-gold" onClick={() => setCreating(true)}><Plus size={14} /> Add drill</button>
          </>
        ) : null}
      >
        <div className="grid sm:grid-cols-3 gap-3 max-w-2xl">
          <Field label="Search">
            <input className="input" placeholder="Name, skill or description" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </Field>
          <Field label="Sport">
            <select className="input" value={filters.sport} onChange={(e) => setFilters({ ...filters, sport: e.target.value })}>
              <option value="">All sports</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select className="input" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
          </Field>
        </div>
      </PageHeader>

      {drills && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatTile label="Drills" value={drills.length} tone="gold" icon={Dumbbell} />
          <StatTile label="Session plans" value={templates.length} tone="violet" icon={ListChecks} />
          <StatTile label="Categories" value={Object.keys(byCategory).length} tone="sky" />
          <StatTile label="Times run" value={drills.reduce((a, d) => a + d.times_used, 0)} tone="pitch" />
        </div>
      )}

      <Tabs
        tabs={[
          { key: 'library', label: 'Drills', count: drills?.length },
          { key: 'plans', label: 'Session plans', count: templates.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <ErrorNote error={error} />
      <div className="mt-5">
        {tab === 'library' && (!drills ? <Spinner label="Loading drills" /> : (
          <Section>
            <DataTable
              columns={[
                { key: 'name', label: 'Drill', render: (d) => <button type="button" className="link" onClick={() => setViewing(d)}>{d.name}</button> },
                { key: 'category', label: 'Category', render: (d) => <Chip tone="scheduled">{titleCase(d.category)}</Chip> },
                { key: 'sport_name', label: 'Sport', render: (d) => d.sport_name || 'Any sport' },
                { key: 'skill_focus', label: 'Focus', render: (d) => d.skill_focus || '—' },
                { key: 'age_groups', label: 'Age groups', render: (d) => d.age_groups || 'All' },
                { key: 'duration_minutes', label: 'Minutes', align: 'right', mono: true, render: (d) => d.duration_minutes ?? '—' },
                { key: 'players', label: 'Players', align: 'right', mono: true, render: (d) => (d.players_min ? `${d.players_min}–${d.players_max ?? '+'}` : '—') },
                { key: 'times_used', label: 'Run', align: 'right', mono: true },
              ]}
              rows={drills}
              empty={{
                title: 'No drills match those filters',
                message: 'Add a drill and it becomes available to every session plan.',
                action: can('training.write') ? <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Add drill</button> : null,
              }}
            />
          </Section>
        ))}

        {tab === 'plans' && (
          templates.length === 0
            ? <Section><EmptyState title="No session plans yet" message="A plan is an ordered set of drills with timings — build one and a coach can run a full session from it." /></Section>
            : (
              <div className="grid md:grid-cols-2 gap-5">
                {templates.map((t) => (
                  <Section key={t.id} title={t.name} subtitle={[t.sport_name, t.age_group, `${t.duration_minutes} min`].filter(Boolean).join(' · ')}>
                    <div className="p-4">
                      {t.objectives && <p className="text-sm text-ink-400 mb-3">{t.objectives}</p>}
                      <ol className="space-y-2">
                        {t.drills.map((d, i) => (
                          <li key={d.id} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2">
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold/15 text-gold font-mono text-xs">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="text-sm block">{d.name}</span>
                              <span className="text-[11px] text-ink-400">{titleCase(d.category)}{d.skill_focus ? ` · ${d.skill_focus}` : ''}</span>
                            </span>
                            <span className="stat-value text-xs shrink-0">{d.duration_minutes ?? '—'}m</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </Section>
                ))}
              </div>
            )
        )}
      </div>

      <DrillDetail drill={viewing} onClose={() => setViewing(null)} />
      <DrillForm open={creating} onClose={() => setCreating(false)} sports={sports} onSaved={load} />
      <PlanForm open={planning} onClose={() => setPlanning(false)} sports={sports} drills={drills || []} onSaved={load} />
    </>
  );
}

function DrillDetail({ drill, onClose }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (!drill) { setDetail(null); return; }
    api.get(`/drills/${drill.id}`).then(setDetail).catch(() => setDetail({ drill }));
  }, [drill]);

  if (!drill) return null;
  const d = detail?.drill || drill;

  return (
    <Modal open={!!drill} onClose={onClose} title={d.name} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Chip tone="scheduled">{titleCase(d.category)}</Chip>
          {d.sport_name && <Chip tone="upcoming">{d.sport_name}</Chip>}
          {d.difficulty && d.difficulty !== 'all' && <Chip tone="trial">{titleCase(d.difficulty)}</Chip>}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          {[[Clock, 'Duration', d.duration_minutes ? `${d.duration_minutes} min` : '—'],
            [Users, 'Players', d.players_min ? `${d.players_min}–${d.players_max ?? '+'}` : 'Any'],
            [Package, 'Equipment', d.equipment || 'None']].map(([Icon, label, value]) => (
              <div key={label} className="rounded-lg border border-line px-3 py-2.5">
                <p className="label flex items-center gap-1.5"><Icon size={12} /> {label}</p>
                <p className="text-sm mt-1">{value}</p>
              </div>
          ))}
        </div>

        {d.description && (
          <div><p className="label mb-1">How it runs</p><p className="text-sm text-ink-600">{d.description}</p></div>
        )}
        {d.coaching_points && (
          <div>
            <p className="label mb-1">Coaching points</p>
            <ul className="text-sm text-ink-600 space-y-1">
              {String(d.coaching_points).split('\n').filter(Boolean).map((line, i) => (
                <li key={i} className="flex gap-2"><span className="text-gold">•</span>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {d.progressions && (
          <div><p className="label mb-1">Making it harder</p><p className="text-sm text-ink-600">{d.progressions}</p></div>
        )}
        {detail?.sessions?.length > 0 && (
          <div>
            <p className="label mb-1.5">Recently run in</p>
            <ul className="text-sm text-ink-400 space-y-1">
              {detail.sessions.slice(0, 6).map((s) => (
                <li key={s.id}>{s.session_date} — {s.team_name || titleCase(s.training_type)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DrillForm({ open, onClose, sports, onSaved }) {
  const BLANK = {
    name: '', sport_id: '', category: 'technical', skill_focus: '', age_groups: '',
    difficulty: 'all', duration_minutes: 20, players_min: '', players_max: '',
    equipment: '', description: '', coaching_points: '', progressions: '', video_url: '',
  };
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setForm(BLANK); setError(null); } }, [open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const blocking = !form.name.trim() ? 'Give the drill a name.' : null;

  async function submit(e) {
    e.preventDefault();
    if (blocking) { setError({ message: blocking }); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post('/drills', {
        ...form,
        sport_id: form.sport_id ? Number(form.sport_id) : null,
        duration_minutes: form.duration_minutes === '' ? null : Number(form.duration_minutes),
        players_min: form.players_min === '' ? null : Number(form.players_min),
        players_max: form.players_max === '' ? null : Number(form.players_max),
      });
      onSaved(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a drill" wide>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name"><input className="input" value={form.name} onChange={set('name')} placeholder="Throwdowns — front foot drive" /></Field>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Sport" hint="Leave empty if it suits any sport">
            <select className="input" value={form.sport_id} onChange={set('sport_id')}>
              <option value="">Any sport</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select className="input" value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
          </Field>
          <Field label="Difficulty">
            <select className="input" value={form.difficulty} onChange={set('difficulty')}>
              {['all', 'beginner', 'intermediate', 'advanced'].map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
            </select>
          </Field>
          <Field label="Skill focus" className="sm:col-span-2"><input className="input" value={form.skill_focus} onChange={set('skill_focus')} placeholder="front foot drive, timing" /></Field>
          <Field label="Age groups" hint="Comma separated"><input className="input" value={form.age_groups} onChange={set('age_groups')} placeholder="U16,U18,Senior" /></Field>
          <Field label="Duration (minutes)"><input className="input font-mono" type="number" value={form.duration_minutes} onChange={set('duration_minutes')} /></Field>
          <Field label="Players (min)"><input className="input font-mono" type="number" value={form.players_min} onChange={set('players_min')} /></Field>
          <Field label="Players (max)"><input className="input font-mono" type="number" value={form.players_max} onChange={set('players_max')} /></Field>
          <Field label="Equipment" className="sm:col-span-3"><input className="input" value={form.equipment} onChange={set('equipment')} /></Field>
        </div>
        <Field label="How it runs"><textarea className="input" rows={3} value={form.description} onChange={set('description')} /></Field>
        <Field label="Coaching points" hint="One per line"><textarea className="input" rows={4} value={form.coaching_points} onChange={set('coaching_points')} /></Field>
        <Field label="Making it harder"><textarea className="input" rows={2} value={form.progressions} onChange={set('progressions')} /></Field>
        <ErrorNote error={error} />
        {blocking && <p className="text-xs text-gold text-right">{blocking}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy || !!blocking}>{busy ? 'Saving…' : 'Add drill'}</button>
        </div>
      </form>
    </Modal>
  );
}

function PlanForm({ open, onClose, sports, drills, onSaved }) {
  const [form, setForm] = useState({ name: '', sport_id: '', training_type: 'technical', age_group: '', duration_minutes: 75, objectives: '' });
  const [chosen, setChosen] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: '', sport_id: '', training_type: 'technical', age_group: '', duration_minutes: 75, objectives: '' });
      setChosen([]); setError(null);
    }
  }, [open]);

  const toggle = (id) => setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const available = drills.filter((d) => !form.sport_id || !d.sport_id || String(d.sport_id) === String(form.sport_id));
  const blocking = !form.name.trim() ? 'Give the plan a name.' : !chosen.length ? 'Choose at least one drill.' : null;

  async function submit(e) {
    e.preventDefault();
    if (blocking) { setError({ message: blocking }); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post('/session-templates', {
        ...form,
        sport_id: form.sport_id ? Number(form.sport_id) : null,
        duration_minutes: Number(form.duration_minutes),
        drills: chosen.map((id) => ({ drill_id: id })),
      });
      onSaved(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New session plan" wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Plan name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cricket — batting technique" /></Field>
          <Field label="Sport">
            <select className="input" value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value })}>
              <option value="">Any sport</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Age group"><input className="input" value={form.age_group} onChange={(e) => setForm({ ...form, age_group: e.target.value })} placeholder="U16" /></Field>
          <Field label="Total minutes"><input className="input font-mono" type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></Field>
        </div>
        <Field label="Objectives"><textarea className="input" rows={2} value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} /></Field>
        <Field label="Drills" hint="Tap to add, in the order they will run">
          <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto scroll-thin p-0.5">
            {available.map((d) => (
              <button key={d.id} type="button" onClick={() => toggle(d.id)} className={chosen.includes(d.id) ? 'chip-active' : 'chip-idle'}>
                {chosen.includes(d.id) && <span className="font-mono">{chosen.indexOf(d.id) + 1}.</span>} {d.name}
              </button>
            ))}
          </div>
        </Field>
        <ErrorNote error={error} />
        {blocking && <p className="text-xs text-gold text-right">{blocking}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy || !!blocking}>{busy ? 'Saving…' : 'Create plan'}</button>
        </div>
      </form>
    </Modal>
  );
}
