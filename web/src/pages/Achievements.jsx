import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field, Avatar, Chip } from '../components/ui';
import { formatDate, playerName, titleCase } from '../lib/format';

const CATEGORIES = ['match', 'tournament', 'season', 'academy', 'selection', 'representative', 'milestone', 'coach_award'];

export default function Achievements() {
  const { can } = useAuth();
  const [achievements, setAchievements] = useState(null);
  const [sports, setSports] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [category, setCategory] = useState('');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setAchievements(null);
    api.get(`/achievements${category ? `?category=${category}` : ''}`).then((d) => setAchievements(d.achievements)).catch(setError);
  }, [category]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/tournaments').then((d) => setTournaments(d.tournaments)).catch(() => {});
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Recognition"
        title="Achievements"
        subtitle="Awards, selections and milestones. Each one lands on the athlete's record and their career timeline."
        actions={can('achievements.write') ? <button type="button" className="btn-gold" onClick={() => setCreating(true)}>Record award</button> : null}
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setCategory('')} className={`chip ${category === '' ? 'bg-ink text-white' : 'bg-white border border-line text-ink-600'}`}>All</button>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={`chip ${category === c ? 'bg-ink text-white' : 'bg-white border border-line text-ink-600'}`}>
              {titleCase(c)}
            </button>
          ))}
        </div>
      </PageHeader>
      <ErrorNote error={error} />
      {!achievements ? <Spinner label="Loading awards" /> : (
        <Section>
          <DataTable
            columns={[
              { key: 'awarded_date', label: 'Date', render: (a) => formatDate(a.awarded_date) },
              { key: 'title', label: 'Award' },
              {
                key: 'player', label: 'Athlete',
                render: (a) => (
                  <Link to={`/players/${a.player_id}`} className="flex items-center gap-2.5">
                    <Avatar player={a} size={28} />
                    <span className="font-medium">{playerName(a)}</span>
                  </Link>
                ),
              },
              { key: 'category', label: 'Category', render: (a) => titleCase(a.category) },
              { key: 'level', label: 'Level', render: (a) => <Chip tone={a.level === 'club' ? 'inactive' : 'upcoming'}>{titleCase(a.level)}</Chip> },
              { key: 'sport_name', label: 'Sport', render: (a) => a.sport_name || '—' },
              { key: 'tournament_name', label: 'Competition', render: (a) => a.tournament_name || '—' },
            ]}
            rows={achievements}
            empty={{ title: 'No awards recorded', message: 'Player of the Match awards are created automatically when match results are entered.' }}
          />
        </Section>
      )}
      <AwardForm open={creating} onClose={() => setCreating(false)} sports={sports} tournaments={tournaments} onSaved={load} />
    </>
  );
}

function AwardForm({ open, onClose, sports, tournaments, onSaved }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [player, setPlayer] = useState(null);
  const [form, setForm] = useState({
    title: '', category: 'tournament', level: 'club', sport_id: '', tournament_id: '',
    awarded_date: new Date().toISOString().slice(0, 10), description: '',
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => api.get(`/players?q=${encodeURIComponent(q)}&pageSize=8`).then((d) => setResults(d.players)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q, open]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/achievements', {
        ...form,
        player_id: player.id,
        sport_id: form.sport_id ? Number(form.sport_id) : null,
        tournament_id: form.tournament_id ? Number(form.tournament_id) : null,
      });
      onSaved(); onClose(); setPlayer(null); setQ('');
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record an award">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Athlete">
          <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setPlayer(null); }} placeholder="Name or athlete ID" />
        </Field>
        {!player && q && (
          <ul className="border border-line rounded-lg max-h-40 overflow-y-auto scroll-thin divide-y divide-line">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-canvas text-sm" onClick={() => { setPlayer(p); setQ(playerName(p)); }}>
                  {playerName(p)} <span className="font-mono text-[11px] text-ink-400 ml-2">{p.athlete_id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Award title"><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Player of the Tournament" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select>
          </Field>
          <Field label="Level">
            <select className="input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
              {['club', 'district', 'state', 'national', 'international'].map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
            </select>
          </Field>
          <Field label="Sport">
            <select className="input" value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value })}>
              <option value="">Not sport specific</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Tournament">
            <select className="input" value={form.tournament_id} onChange={(e) => setForm({ ...form, tournament_id: e.target.value })}>
              <option value="">None</option>
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Date awarded" className="col-span-2"><input className="input" type="date" required value={form.awarded_date} onChange={(e) => setForm({ ...form, awarded_date: e.target.value })} /></Field>
        </div>
        <Field label="Description"><textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={!player}>Record award</button>
        </div>
      </form>
    </Modal>
  );
}
