import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Send, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader, Section, Spinner, ErrorNote, Modal, Field, Chip, EmptyState, StatTile,
} from '../components/ui';
import { formatDateTime, playerName, titleCase } from '../lib/format';

const TONE = { normal: 'scheduled', important: 'trial', urgent: 'absent' };

export default function Announcements() {
  const { can } = useAuth();
  const [items, setItems] = useState(null);
  const [sports, setSports] = useState([]);
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => {
    api.get('/announcements').then((d) => setItems(d.announcements)).catch(setError);
  }, []);

  useEffect(() => {
    load();
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
    api.get('/players?pageSize=200').then((d) => setPlayers(d.players)).catch(() => {});
  }, [load]);

  async function remove(id) {
    try { await api.del(`/announcements/${id}`); load(); } catch (err) { setError(err); }
  }

  if (error && !items) return <ErrorNote error={error} />;
  if (!items) return <Spinner label="Loading announcements" />;

  const urgent = items.filter((a) => a.priority === 'urgent').length;

  return (
    <>
      <PageHeader
        eyebrow="Club"
        title="Announcements"
        subtitle="Telling a squad that Saturday moved to seven o'clock, without needing a separate app for it."
        actions={can('training.write') ? <button type="button" className="btn-gold" onClick={() => setComposing(true)}><Send size={14} /> New announcement</button> : null}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatTile label="Active" value={items.length} tone="gold" icon={Megaphone} />
        <StatTile label="Urgent" value={urgent} tone={urgent ? 'alert' : 'ink'} icon={AlertTriangle} />
        <StatTile label="To squads" value={items.filter((a) => a.audience === 'team').length} tone="sky" />
        <StatTile label="Club-wide" value={items.filter((a) => a.audience === 'club').length} tone="violet" />
      </div>

      <ErrorNote error={error} />

      {items.length === 0 ? (
        <Section><EmptyState title="Nothing announced" message="Send a note to the whole club, one sport, a single squad or named athletes." /></Section>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <article key={a.id} className={`card p-4 ${a.priority === 'urgent' ? 'border-alert/40' : a.priority === 'important' ? 'border-gold/40' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <Chip tone={TONE[a.priority]}>{titleCase(a.priority)}</Chip>
                    <Chip tone="inactive">
                      {a.audience === 'team' ? a.team_name
                        : a.audience === 'sport' ? a.sport_name
                          : a.audience === 'players' ? `${a.recipients.length} athlete${a.recipients.length === 1 ? '' : 's'}`
                            : 'Whole club'}
                    </Chip>
                  </div>
                  <h2 className="font-display text-xl leading-tight">{a.title}</h2>
                  <p className="text-sm text-ink-600 mt-1.5 whitespace-pre-line">{a.body}</p>
                  {a.recipients.length > 0 && a.audience === 'players' && (
                    <p className="text-xs text-ink-400 mt-2">
                      To: {a.recipients.map((r) => `${r.first_name} ${r.last_name}`).join(', ')}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-[11px] text-ink-400">{formatDateTime(a.created_at)}</p>
                  {a.author && <p className="text-xs text-ink-400 mt-0.5">{a.author}</p>}
                  {a.expires_at && <p className="text-[11px] text-ink-200 mt-0.5">until {a.expires_at}</p>}
                  {can('training.write') && (
                    <button type="button" className="btn-quiet text-xs mt-1.5 hover:text-alert" onClick={() => remove(a.id)}>
                      <Trash2 size={13} /> Remove
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Compose
        open={composing}
        onClose={() => setComposing(false)}
        sports={sports}
        teams={teams}
        players={players}
        onSaved={load}
      />
    </>
  );
}

function Compose({ open, onClose, sports, teams, players, onSaved }) {
  const BLANK = { title: '', body: '', audience: 'club', sport_id: '', team_id: '', priority: 'normal', expires_at: '' };
  const [form, setForm] = useState(BLANK);
  const [chosen, setChosen] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setForm(BLANK); setChosen([]); setQuery(''); setError(null); } }, [open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggle = (id) => setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  const matched = players.filter((p) => {
    if (!query) return chosen.includes(p.id);
    const q = query.toLowerCase();
    return [p.first_name, p.last_name, p.display_name, p.athlete_id].some((v) => String(v || '').toLowerCase().includes(q));
  }).slice(0, 14);

  const blocking = !form.title.trim() ? 'Give the announcement a title.'
    : !form.body.trim() ? 'Write the message.'
      : form.audience === 'team' && !form.team_id ? 'Choose the squad this is for.'
        : form.audience === 'sport' && !form.sport_id ? 'Choose the sport this is for.'
          : form.audience === 'players' && !chosen.length ? 'Choose at least one athlete.'
            : null;

  async function submit(e) {
    e.preventDefault();
    if (blocking) { setError({ message: blocking }); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post('/announcements', {
        ...form,
        sport_id: form.sport_id ? Number(form.sport_id) : null,
        team_id: form.team_id ? Number(form.team_id) : null,
        expires_at: form.expires_at || null,
        playerIds: chosen,
      });
      onSaved(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New announcement" wide>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Title"><input className="input" value={form.title} onChange={set('title')} placeholder="Saturday session moved to 7am" /></Field>
        <Field label="Message"><textarea className="input" rows={4} value={form.body} onChange={set('body')} /></Field>

        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Send to">
            <select className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              <option value="club">The whole club</option>
              <option value="sport">One sport</option>
              <option value="team">One squad</option>
              <option value="players">Named athletes</option>
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={form.priority} onChange={set('priority')}>
              {['normal', 'important', 'urgent'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </select>
          </Field>
          <Field label="Show until" hint="Leave empty to keep it up">
            <input className="input" type="date" value={form.expires_at} onChange={set('expires_at')} />
          </Field>
        </div>

        {form.audience === 'sport' && (
          <Field label="Sport">
            <select className="input" value={form.sport_id} onChange={set('sport_id')}>
              <option value="">Choose</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}

        {form.audience === 'team' && (
          <Field label="Squad">
            <select className="input" value={form.team_id} onChange={set('team_id')}>
              <option value="">Choose</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}

        {form.audience === 'players' && (
          <Field label="Athletes" hint="Search, then tap to add">
            <input className="input mb-2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or athlete ID" />
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto scroll-thin p-0.5">
              {matched.map((p) => (
                <button key={p.id} type="button" onClick={() => toggle(p.id)} className={chosen.includes(p.id) ? 'chip-active' : 'chip-idle'}>
                  {playerName(p)}
                </button>
              ))}
              {!matched.length && (
                <span className="text-xs text-ink-400 px-1 py-2">
                  {query ? `No athletes match “${query}”.` : 'Search to find athletes.'}
                </span>
              )}
            </div>
            {chosen.length > 0 && <p className="text-xs text-pitch mt-1.5">{chosen.length} selected</p>}
          </Field>
        )}

        <ErrorNote error={error} />
        {blocking && <p className="text-xs text-gold text-right">{blocking}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy || !!blocking}>
            <Send size={14} /> {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
