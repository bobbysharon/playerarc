import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Section, Spinner, ErrorNote, Avatar, Chip, StatTile, EmptyState } from '../components/ui';
import { formatDate, playerName, titleCase } from '../lib/format';

const STATUSES = ['present', 'late', 'absent', 'excused', 'injured'];

export default function TrainingDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    api.get(`/training/${id}`).then((d) => {
      setData(d);
      setRows(d.attendance.map((a) => ({ ...a })));
    }).catch(setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading session" />;
  const s = data.session;

  const update = (playerId, patch) => setRows(rows.map((r) => (r.player_id === playerId ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.put(`/training/${id}/attendance`, {
        attendance: rows.map((r) => ({
          player_id: r.player_id,
          status: r.status,
          performance_score: r.performance_score === '' || r.performance_score == null ? null : Number(r.performance_score),
          effort_score: r.effort_score === '' || r.effort_score == null ? null : Number(r.effort_score),
          coach_notes: r.coach_notes || null,
          areas_for_improvement: r.areas_for_improvement || null,
        })),
      });
      setSaved(true);
      load();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length;

  return (
    <>
      <PageHeader
        eyebrow={[s.sport_name, s.team_name].filter(Boolean).join(' · ')}
        title={`${titleCase(s.training_type)} session`}
        subtitle={[formatDate(s.session_date), s.start_time, `${s.duration_minutes} minutes`, s.location, s.coach_name].filter(Boolean).join(' · ')}
        actions={can('training.write') ? <button type="button" className="btn-gold" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save attendance'}</button> : null}
      />

      {saved && <div className="mb-4 rounded-lg border border-pitch/30 bg-pitch/5 px-4 py-2.5 text-sm text-pitch">Attendance saved.</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatTile label="Invited" value={rows.length} />
        <StatTile label="Attended" value={present} tone="pitch" />
        <StatTile label="Attendance" value={rows.length ? `${Math.round((present / rows.length) * 1000) / 10}%` : '—'} />
        <StatTile label="Intensity" value={s.intensity ? `${s.intensity}/10` : '—'} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Section title="Session plan">
          <div className="p-4 space-y-4 text-sm">
            <div>
              <p className="label mb-1">Objectives</p>
              <p>{s.objectives || <span className="text-ink-200">None recorded</span>}</p>
            </div>
            <div>
              <p className="label mb-1">Exercises</p>
              {s.exercises?.length
                ? <ul className="list-disc pl-4 space-y-0.5">{s.exercises.map((e, i) => <li key={i}>{e}</li>)}</ul>
                : <p className="text-ink-200">None recorded</p>}
            </div>
            <div>
              <p className="label mb-1">Skills assessed</p>
              <div className="flex flex-wrap gap-1.5">
                {s.skills?.length ? s.skills.map((k, i) => <span key={i} className="chip bg-white/5 text-ink-400 border border-line">{k}</span>) : <span className="text-ink-200">None recorded</span>}
              </div>
            </div>
            <div>
              <p className="label mb-1">Coach notes</p>
              <p>{s.coach_notes || <span className="text-ink-200">None recorded</span>}</p>
            </div>
            <div>
              <p className="label mb-1">Areas for improvement</p>
              <p>{s.areas_for_improvement || <span className="text-ink-200">None recorded</span>}</p>
            </div>
          </div>
        </Section>

        <Section title="Attendance" subtitle="Mark the exceptions — everyone starts as present" className="lg:col-span-2">
          {!rows.length ? (
            <EmptyState title="No athletes on this sheet" message="Sessions attached to a team are pre-filled from the roster." />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.player_id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar player={r} size={32} />
                    <Link to={`/players/${r.player_id}`} className="min-w-0 flex-1">
                      <span className="text-sm font-medium block truncate hover:underline">{playerName(r)}</span>
                      <span className="font-mono text-[11px] text-ink-400">{r.athlete_id}</span>
                    </Link>
                    {can('training.write') ? (
                      <>
                        <select className="input py-1.5 w-32" value={r.status} onChange={(e) => update(r.player_id, { status: e.target.value })}>
                          {STATUSES.map((st) => <option key={st} value={st}>{titleCase(st)}</option>)}
                        </select>
                        <label className="text-[11px] text-ink-400">Performance
                          <input className="input py-1.5 w-20 font-mono" type="number" step="0.1" min="0" max="10"
                            value={r.performance_score ?? ''} onChange={(e) => update(r.player_id, { performance_score: e.target.value })} />
                        </label>
                        <label className="text-[11px] text-ink-400">Effort
                          <input className="input py-1.5 w-20 font-mono" type="number" step="0.1" min="0" max="10"
                            value={r.effort_score ?? ''} onChange={(e) => update(r.player_id, { effort_score: e.target.value })} />
                        </label>
                      </>
                    ) : (
                      <>
                        <Chip tone={r.status}>{titleCase(r.status)}</Chip>
                        <span className="stat-value text-sm">{r.performance_score ?? '—'}</span>
                      </>
                    )}
                  </div>
                  {can('training.write') && (
                    <input
                      className="input mt-2 py-1.5 text-sm"
                      placeholder="Coach note for this athlete"
                      value={r.coach_notes ?? ''}
                      onChange={(e) => update(r.player_id, { coach_notes: e.target.value })}
                    />
                  )}
                  {!can('training.write') && r.coach_notes && <p className="text-xs text-ink-400 mt-1 pl-11">{r.coach_notes}</p>}
                </li>
              ))}
            </ul>
          )}
          <ErrorNote error={error} />
          {can('training.write') && rows.length > 0 && (
            <div className="px-4 py-3 border-t border-line flex justify-end">
              <button type="button" className="btn-gold" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save attendance'}</button>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
