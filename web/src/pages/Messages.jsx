import { useCallback, useEffect, useState } from 'react';
import { api, DEMO_MODE } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, Modal, Field } from '../components/ui';
import { formatDate } from '../lib/format';

export default function Messages() {
  const { can, user } = useAuth();
  const isRecipient = ['player', 'guardian'].includes(user?.role);
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);
  const [teams, setTeams] = useState([]);
  const [groups, setGroups] = useState([]);
  const [players, setPlayers] = useState([]);

  const load = useCallback(() => {
    if (DEMO_MODE) return;
    setMessages(null);
    const endpoint = isRecipient ? '/messages/inbox' : '/messages/sent?sport=cricket';
    api.get(endpoint).then((d) => setMessages(d.messages)).catch(setError);
  }, [isRecipient]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isRecipient || DEMO_MODE) return;
    api.get('/sports').then((d) => {
      const cricketId = d.sports.find((s) => s.code === 'cricket')?.id;
      if (cricketId) api.get(`/teams?sport=${cricketId}`).then((t) => setTeams(t.teams)).catch(() => {});
    }).catch(() => {});
    api.get('/groups?sport=cricket').then((d) => setGroups(d.groups)).catch(() => {});
    api.get('/players?sport=cricket&limit=500').then((d) => setPlayers(d.players)).catch(() => {});
  }, [isRecipient]);

  async function markRead(id) {
    await api.post(`/messages/${id}/read`, {});
    load();
  }

  if (DEMO_MODE) {
    return (
      <>
        <PageHeader eyebrow="Communication" title="Messages" subtitle="Squad, group and individual messaging — cricket only." />
        <Section>
          <div className="p-6 text-sm text-ink-400">
            Messaging isn't wired into this read-only demo. In the full app, coaches and admins can message a
            squad, a digital group, or an individual cricket player, and players/guardians see it in their inbox.
          </div>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Communication"
        title="Messages"
        subtitle={isRecipient
          ? 'Updates from your coaches — squad announcements and personal notes.'
          : 'Send updates to a squad, a digital group, or an individual athlete. Cricket only, for now.'}
        actions={!isRecipient && can('messages.write') ? <button type="button" className="btn-gold" onClick={() => setComposing(true)}>New message</button> : null}
      />
      <ErrorNote error={error} />
      {!messages ? <Spinner label="Loading messages" /> : (
        <Section>
          {isRecipient ? (
            <DataTable
              columns={[
                { key: 'created_at', label: 'Date', render: (m) => formatDate(m.created_at) },
                { key: 'sender_name', label: 'From' },
                { key: 'subject', label: 'Subject', render: (m) => m.subject || '(no subject)' },
                { key: 'body', label: 'Message' },
                { key: 'read_at', label: 'Status', render: (m) => (m.read_at ? 'Read' : <button className="link text-xs" onClick={() => markRead(m.id)}>Mark as read</button>) },
              ]}
              rows={messages}
              empty={{ title: 'No messages yet', message: 'Updates from your coaches will appear here.' }}
            />
          ) : (
            <DataTable
              columns={[
                { key: 'created_at', label: 'Date', render: (m) => formatDate(m.created_at) },
                { key: 'scope_type', label: 'To', render: (m) => m.team_name || m.group_name || m.player_name || '—' },
                { key: 'subject', label: 'Subject', render: (m) => m.subject || '(no subject)' },
                { key: 'sender_name', label: 'From' },
                { key: 'recipient_count', label: 'Read', align: 'right', mono: true, render: (m) => `${m.read_count}/${m.recipient_count}` },
              ]}
              rows={messages}
              empty={{ title: 'No messages sent yet', message: 'Send your first squad or player update.' }}
            />
          )}
        </Section>
      )}
      <Compose open={composing} onClose={() => setComposing(false)} teams={teams} groups={groups} players={players} onSent={load} />
    </>
  );
}

function Compose({ open, onClose, teams, groups, players, onSent }) {
  const [form, setForm] = useState({ scope_type: 'team', team_id: '', group_id: '', player_id: '', subject: '', body: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setError(null); setForm({ scope_type: 'team', team_id: '', group_id: '', player_id: '', subject: '', body: '' }); } }, [open]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!form.body.trim()) { setError({ message: 'Write a message before sending.' }); return; }
    setBusy(true);
    setError(null);
    try {
      const payload = { scope_type: form.scope_type, subject: form.subject || null, body: form.body };
      if (form.scope_type === 'team') payload.team_id = Number(form.team_id);
      if (form.scope_type === 'group') payload.group_id = Number(form.group_id);
      if (form.scope_type === 'player') payload.player_id = Number(form.player_id);
      await api.post('/messages', payload);
      onSent(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Send a message">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Send to">
          <select className="input" value={form.scope_type} onChange={set('scope_type')}>
            <option value="team">A squad</option>
            <option value="group">A digital group</option>
            <option value="player">An individual player</option>
          </select>
        </Field>
        {form.scope_type === 'team' && (
          <Field label="Squad">
            <select className="input" value={form.team_id} onChange={set('team_id')}>
              <option value="">Choose a squad</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        {form.scope_type === 'group' && (
          <Field label="Digital group">
            <select className="input" value={form.group_id} onChange={set('group_id')}>
              <option value="">Choose a group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
        )}
        {form.scope_type === 'player' && (
          <Field label="Player">
            <select className="input" value={form.player_id} onChange={set('player_id')}>
              <option value="">Choose a player</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.display_name || `${p.first_name} ${p.last_name}`}</option>)}
            </select>
          </Field>
        )}
        <Field label="Subject (optional)"><input className="input" value={form.subject} onChange={set('subject')} /></Field>
        <Field label="Message"><textarea className="input" rows={4} value={form.body} onChange={set('body')} /></Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
        </div>
      </form>
    </Modal>
  );
}
