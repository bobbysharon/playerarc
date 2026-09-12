import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, Avatar, Tabs } from '../components/ui';
import { formatDate, playerName, titleCase } from '../lib/format';

export default function Assessments() {
  const { can } = useAuth();
  const [tab, setTab] = useState('records');
  const [assessments, setAssessments] = useState(null);
  const [criteria, setCriteria] = useState([]);
  const [sports, setSports] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.get('/assessments').then((d) => setAssessments(d.assessments)).catch(setError);
    api.get('/assessments/criteria').then((d) => setCriteria(d.criteria)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/coaches').then((d) => setCoaches(d.coaches)).catch(() => {});
  }, [load]);

  return (
    <>
      <PageHeader
        eyebrow="Development"
        title="Assessments"
        subtitle="Structured reviews across physical, technical, tactical and behavioural criteria. Every review is kept, so progression is visible over years."
        actions={can('assessments.write') ? <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Record assessment</button> : null}
      />
      <Tabs
        tabs={[{ key: 'records', label: 'Assessments', count: assessments?.length }, { key: 'criteria', label: 'Criteria', count: criteria.length }]}
        active={tab}
        onChange={setTab}
      />
      <ErrorNote error={error} />
      <div className="mt-5">
        {tab === 'records' && (!assessments ? <Spinner label="Loading assessments" /> : (
          <Section>
            <DataTable
              columns={[
                { key: 'assessment_date', label: 'Date', render: (a) => formatDate(a.assessment_date) },
                {
                  key: 'player', label: 'Athlete',
                  render: (a) => (
                    <Link to={`/players/${a.player_id}`} className="flex items-center gap-2.5">
                      <Avatar player={a} size={30} />
                      <span>
                        <span className="font-medium block">{playerName(a)}</span>
                        <span className="font-mono text-[11px] text-ink-400">{a.athlete_id}</span>
                      </span>
                    </Link>
                  ),
                },
                { key: 'sport_name', label: 'Sport' },
                { key: 'cycle', label: 'Review', render: (a) => a.cycle || '—' },
                { key: 'age_group', label: 'Age group', render: (a) => a.age_group || '—' },
                { key: 'coach_name', label: 'Assessed by', render: (a) => a.coach_name || '—' },
                { key: 'overall_score', label: 'Score', align: 'right', mono: true, render: (a) => a.overall_score ?? '—' },
              ]}
              rows={assessments}
              empty={{ title: 'No assessments recorded', message: 'Record a review to begin tracking development.' }}
            />
          </Section>
        ))}

        {tab === 'criteria' && (
          <Section title="Assessment criteria" subtitle="Criteria can apply to every sport, or to one sport and age group">
            <DataTable
              columns={[
                { key: 'name', label: 'Criterion' },
                { key: 'category', label: 'Category', render: (c) => titleCase(c.category) },
                { key: 'sport_name', label: 'Sport', render: (c) => c.sport_name || 'All sports' },
                { key: 'age_group', label: 'Age group', render: (c) => c.age_group || 'All' },
                { key: 'scale', label: 'Scale', mono: true, render: (c) => `${c.scale_min}–${c.scale_max}` },
                { key: 'weight', label: 'Weight', align: 'right', mono: true },
                { key: 'description', label: 'Description', render: (c) => c.description || '—' },
              ]}
              rows={criteria}
              empty={{ title: 'No criteria configured', message: '' }}
            />
          </Section>
        )}
      </div>

      <AssessmentForm open={creating} onClose={() => setCreating(false)} sports={sports} coaches={coaches} onSaved={load} />
    </>
  );
}

function AssessmentForm({ open, onClose, sports, coaches, onSaved }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [player, setPlayer] = useState(null);
  const [form, setForm] = useState({
    sport_id: '', assessed_by: '', assessment_date: new Date().toISOString().slice(0, 10),
    cycle: 'Quarterly review', age_group: '', summary: '', recommendation: '', next_review_date: '',
  });
  const [criteria, setCriteria] = useState([]);
  const [scores, setScores] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Results are loaded as soon as the dialog opens, so the list of athletes is
  // visible without having to guess that typing is required.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      api.get(`/players?q=${encodeURIComponent(q)}&pageSize=8`).then((d) => setResults(d.players)).catch(() => {});
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!form.sport_id) { setCriteria([]); return; }
    api.get(`/assessments/criteria?sport=${form.sport_id}`).then((d) => {
      setCriteria(d.criteria);
      setScores(Object.fromEntries(d.criteria.map((c) => [c.id, ''])));
    }).catch(() => {});
  }, [form.sport_id]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...form,
        player_id: player.id,
        sport_id: Number(form.sport_id),
        assessed_by: form.assessed_by ? Number(form.assessed_by) : null,
        next_review_date: form.next_review_date || null,
        scores: Object.entries(scores)
          .filter(([, v]) => v !== '')
          .map(([criteria_id, score]) => ({ criteria_id: Number(criteria_id), score: Number(score) })),
      };
      await api.post('/assessments', payload);
      onSaved(); onClose(); setPlayer(null); setQ('');
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const scored = Object.values(scores).filter((v) => v !== '' && v !== null && v !== undefined).length;
  const blocking = !player
    ? 'Choose an athlete to continue.'
    : !form.sport_id
      ? 'Choose a sport to load its assessment criteria.'
      : scored === 0
        ? 'Score at least one criterion.'
        : null;

  const byCategory = ['physical', 'technical', 'tactical', 'behavioural']
    .map((cat) => ({ cat, items: criteria.filter((c) => c.category === cat) }))
    .filter((g) => g.items.length);

  return (
    <Modal open={open} onClose={onClose} title="Record assessment" wide>
      <form onSubmit={submit} className="space-y-4">
        {player ? (
          <Field label="Athlete">
            <div className="flex items-center gap-2.5 rounded-lg border border-pitch/40 bg-pitch/10 px-3 py-2">
              <Avatar player={player} size={28} />
              <span className="min-w-0">
                <span className="text-sm block truncate">{playerName(player)}</span>
                <span className="font-mono text-[11px] text-ink-400">{player.athlete_id}</span>
              </span>
              <button
                type="button"
                className="btn-quiet text-xs ml-auto shrink-0"
                onClick={() => { setPlayer(null); setQ(''); }}
              >
                Change
              </button>
            </div>
          </Field>
        ) : (
          <>
            <Field label="Athlete" hint="Tap a name below to choose who this assessment is for">
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or athlete ID" />
            </Field>
            <ul className="border border-line rounded-lg max-h-44 overflow-y-auto scroll-thin divide-y divide-line">
              {results.map((p) => (
                <li key={p.id}>
                  <button type="button" className="w-full text-left px-3 py-2 hover:bg-white/[0.04] flex items-center gap-2"
                    onClick={() => {
                      setPlayer(p); setQ('');
                      const primary = p.sports.find((s) => s.is_primary) || p.sports[0];
                      if (primary) setForm((f) => ({ ...f, sport_id: String(primary.sport_id) }));
                    }}>
                    <Avatar player={p} size={26} />
                    <span className="text-sm">{playerName(p)}</span>
                    <span className="font-mono text-[11px] text-ink-400 ml-auto">{p.athlete_id}</span>
                  </button>
                </li>
              ))}
              {!results.length && (
                <li className="px-3 py-6 text-sm text-ink-400 text-center">
                  {q ? `No athletes match “${q}”.` : 'Loading athletes…'}
                </li>
              )}
            </ul>
          </>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Sport">
            <select className="input" required value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value })}>
              <option value="">Choose</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Assessed by">
            <select className="input" value={form.assessed_by} onChange={(e) => setForm({ ...form, assessed_by: e.target.value })}>
              <option value="">Not recorded</option>
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </Field>
          <Field label="Date"><input className="input" type="date" required value={form.assessment_date} onChange={(e) => setForm({ ...form, assessment_date: e.target.value })} /></Field>
          <Field label="Review cycle"><input className="input" value={form.cycle} onChange={(e) => setForm({ ...form, cycle: e.target.value })} /></Field>
          <Field label="Age group"><input className="input" value={form.age_group} onChange={(e) => setForm({ ...form, age_group: e.target.value })} placeholder="U16" /></Field>
          <Field label="Next review"><input className="input" type="date" value={form.next_review_date} onChange={(e) => setForm({ ...form, next_review_date: e.target.value })} /></Field>
        </div>

        {byCategory.map((g) => (
          <div key={g.cat}>
            <p className="label mb-2">{titleCase(g.cat)}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.items.map((c) => (
                <label key={c.id} className="block">
                  <span className="text-[11px] text-ink-400 block mb-1 truncate" title={c.description}>{c.name}</span>
                  <input
                    className="input py-1.5 font-mono"
                    type="number" step="0.1" min={c.scale_min} max={c.scale_max}
                    placeholder={`${c.scale_min}–${c.scale_max}`}
                    value={scores[c.id] ?? ''}
                    onChange={(e) => setScores({ ...scores, [c.id]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}

        <Field label="Summary"><textarea className="input" rows={2} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
        <Field label="Recommendation"><textarea className="input" rows={2} value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} /></Field>

        <ErrorNote error={error} />
        {blocking && <p className="text-xs text-gold text-right">{blocking}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy || !!blocking}>{busy ? 'Saving…' : 'Record assessment'}</button>
        </div>
      </form>
    </Modal>
  );
}
