import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Spinner, ErrorNote, Avatar, StatusChip, Section, Tabs, StatTile, Modal, Field,
  CareerSpine, StatGrid, RatingDial, TrendChart, DataTable, EmptyState, Chip,
} from '../components/ui';
import { ageFrom, formatDate, formatDateTime, playerName, titleCase } from '../lib/format';

export default function PlayerProfile() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [careers, setCareers] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [activity, setActivity] = useState(null);
  const [development, setDevelopment] = useState(null);
  const [benchmarks, setBenchmarks] = useState(null);
  const [showcase, setShowcase] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [addingSport, setAddingSport] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const [assigningTeam, setAssigningTeam] = useState(false);
  const [assigningStaff, setAssigningStaff] = useState(false);
  const [sports, setSports] = useState([]);
  const [teams, setTeams] = useState([]);
  const [coaches, setCoaches] = useState([]);

  const load = useCallback(() => {
    setError(null);
    api.get(`/players/${id}`).then(setProfile).catch(setError);
    api.get(`/players/${id}/stats`).then((d) => setCareers(d.careers)).catch(() => setCareers([]));
    api.get(`/players/${id}/timeline`).then((d) => setTimeline(d.events)).catch(() => setTimeline([]));
    api.get(`/players/${id}/activity?limit=6`).then(setActivity).catch(() => setActivity(null));
    api.get(`/assessments/player/${id}/development`).then(setDevelopment).catch(() => setDevelopment(null));
    api.get(`/players/${id}/benchmarks`).then(setBenchmarks).catch(() => setBenchmarks(null));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/sports').then((d) => setSports(d.sports)).catch(() => {});
    api.get('/teams').then((d) => setTeams(d.teams)).catch(() => {});
    api.get('/coaches').then((d) => setCoaches(d.coaches)).catch(() => {});
  }, []);

  if (error) return <ErrorNote error={error} />;
  if (!profile) return <Spinner label="Opening athlete record" />;

  const p = profile.player;
  const s = profile.summary;
  const primarySport = profile.sports.find((x) => x.is_primary) || profile.sports[0];
  const currentTeams = profile.teamHistory.filter((t) => !t.end_date);

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'statistics', label: 'Statistics', count: careers?.length },
    { key: 'development', label: 'Development' },
    { key: 'timeline', label: 'Career timeline', count: timeline?.length },
    { key: 'teams', label: 'Teams', count: profile.teamHistory.length },
    { key: 'achievements', label: 'Achievements', count: profile.achievements.length },
    { key: 'profile', label: 'Profile & records' },
  ];

  return (
    <>
      {/* Jersey plate header — the identity block that anchors the record */}
      <div className="card overflow-hidden mb-5">
        <div className="relative overflow-hidden px-5 py-5 flex flex-wrap items-center gap-5 bg-surface-grad border-b border-line">
          <span className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-gold/15 blur-3xl" />
          <Avatar player={p} size={80} />
          <div className="relative min-w-0 flex-1">
            <p className="font-mono text-xs text-gold tracking-wider">{p.athlete_id}</p>
            <h1 className="font-display text-4xl sm:text-5xl leading-none mt-1">{playerName(p)}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <StatusChip status={p.status} />
              {profile.sports.map((sp) => (
                <span key={sp.id} className="chip" style={{ background: `${sp.color}22`, color: sp.color }}>
                  {sp.sport_name}{sp.is_primary ? ' · primary' : ''}
                </span>
              ))}
              {primarySport?.position && <span className="chip bg-white/[0.07] text-ink-400 border border-line">{titleCase(primarySport.position)}</span>}
              {currentTeams.map((t) => (
                <Link key={t.id} to={`/teams/${t.team_id}`} className="chip bg-white/[0.07] text-ink border border-line hover:border-gold/50 hover:text-gold transition-colors">{t.team_name}</Link>
              ))}
            </div>
          </div>
          <div className="relative flex gap-2">
            {can('reports.export') && (
              <button type="button" className="btn-ghost" onClick={() => api.download(`/export/player/${id}.pdf`, `${p.athlete_id}-career-report.pdf`)}>
                Career report
              </button>
            )}
            {can('players.write') && <button type="button" className="btn-ghost" onClick={() => setShowcase(true)}>Showcase</button>}
            {can('players.write') && <button type="button" className="btn-gold" onClick={() => setEditing(true)}>Edit record</button>}
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 divide-x divide-line border-t border-line">
          {[
            ['Matches', s.matches],
            ['Wins', `${s.wins}`, `${s.winRate}% win rate`],
            ['Tournaments', s.tournaments],
            ['Awards', s.awards],
            ['Sports', s.sports],
            ['Attendance', `${s.attendanceRate}%`, `${s.trainingAttended}/${s.trainingSessions} sessions`],
            ['Rating', s.rating ?? '—', s.rating ? 'out of 100' : 'no data yet'],
          ].map(([label, value, hint]) => (
            <div key={label} className="px-3 py-3">
              <p className="label">{label}</p>
              <p className="font-display text-2xl leading-none mt-1">{value}</p>
              {hint && <p className="text-[10px] text-ink-400 mt-1">{hint}</p>}
            </div>
          ))}
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-5">
        {tab === 'overview' && (
          <div className="grid lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">
              {careers?.filter((c) => c.matchesPlayed > 0).map((c) => (
                <Section key={c.sport.id} title={`${c.sport.name} — career`} subtitle={`${c.matchesPlayed} recorded appearances`}
                  actions={<button type="button" className="btn-quiet text-xs" onClick={() => setTab('statistics')}>Full statistics</button>}>
                  <div className="p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-line rounded-lg overflow-hidden border border-line mb-4">
                      {c.headline.map((h) => (
                        <div key={h.key} className="bg-surface px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-wide text-ink-400 truncate">{h.label}</p>
                          <p className="stat-value text-xl mt-0.5">{h.display}</p>
                        </div>
                      ))}
                    </div>
                    {c.rating && <RatingDial rating={c.rating} />}
                  </div>
                </Section>
              ))}

              {(!careers || careers.every((c) => !c.matchesPlayed)) && (
                <Section title="Career statistics">
                  <EmptyState title="No appearances recorded yet" message="Statistics build automatically as match performances are entered." />
                </Section>
              )}

              <Section title="Recent activity">
                <div className="divide-y divide-line">
                  {activity?.matches?.slice(0, 4).map((m) => (
                    <Link key={m.id} to={`/matches/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04]">
                      <span className="h-8 w-1 rounded-full shrink-0" style={{ background: m.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium block truncate">
                          {m.sport_name} vs {m.opponent_name || m.away_team_name || 'opposition'}
                        </span>
                        <span className="text-xs text-ink-400">{m.tournament_name || 'Friendly'} · {m.venue || 'Venue not recorded'}</span>
                      </span>
                      {m.is_motm ? <Chip tone="upcoming">Player of the match</Chip> : m.result && <Chip tone={m.result}>{titleCase(m.result)}</Chip>}
                      <span className="font-mono text-[11px] text-ink-400 shrink-0 hidden sm:block">{formatDate(m.scheduled_at)}</span>
                    </Link>
                  ))}
                  {activity?.training?.slice(0, 3).map((t) => (
                    <Link key={`t${t.id}`} to={`/training/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04]">
                      <span className="min-w-0 flex-1">
                        <span className="text-sm block truncate">{titleCase(t.training_type)} training · {t.team_name || t.sport_name}</span>
                        {t.coach_notes && <span className="text-xs text-ink-400 truncate block">{t.coach_notes}</span>}
                      </span>
                      <Chip tone={t.status}>{titleCase(t.status)}</Chip>
                      <span className="font-mono text-[11px] text-ink-400 shrink-0 hidden sm:block">{formatDate(t.session_date)}</span>
                    </Link>
                  ))}
                  {!activity?.matches?.length && !activity?.training?.length && (
                    <EmptyState title="No activity recorded" message="Matches, training and assessments appear here as they are entered." />
                  )}
                </div>
              </Section>
            </div>

            <div className="space-y-5">
              <Section title="Career timeline" subtitle="Newest first"
                actions={can('players.write') ? <button type="button" className="btn-quiet text-xs" onClick={() => setAddingNote(true)}>Add entry</button> : null}>
                <div className="p-4 max-h-[520px] overflow-y-auto scroll-thin">
                  <CareerSpine events={(timeline || []).slice(0, 25)} compact />
                </div>
              </Section>

              <Section title="Achievements">
                {profile.achievements.length === 0
                  ? <EmptyState title="No awards yet" message="Awards recorded against matches and tournaments appear here." />
                  : (
                    <ul className="divide-y divide-line">
                      {profile.achievements.slice(0, 6).map((a) => (
                        <li key={a.id} className="px-4 py-3 flex items-start gap-3">
                          <span className="text-gold text-lg leading-none">🏆</span>
                          <span className="min-w-0 flex-1">
                            <span className="text-sm font-medium block">{a.title}</span>
                            <span className="text-xs text-ink-400">{[a.sport_name, a.tournament_name].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className="font-mono text-[11px] text-ink-400">{formatDate(a.awarded_date)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
              </Section>
            </div>
          </div>
        )}

        {tab === 'statistics' && (
          <div className="space-y-5">
            {careers?.length === 0 && <Section><EmptyState title="Not registered for any sport" message="Add a sport to begin recording performances." /></Section>}
            {careers?.map((c) => (
              <Section key={c.sport.id} title={`${c.sport.name}`} subtitle={`${c.matchesPlayed} appearances recorded`}>
                <div className="p-4 space-y-5">
                  {c.matchesPlayed === 0 ? (
                    <EmptyState title="No performances recorded" message={`Statistics appear here once ${c.sport.name.toLowerCase()} match data is entered.`} />
                  ) : (
                    <>
                      <StatGrid groups={c.career.groups} />
                      {c.rating && (
                        <div className="grid md:grid-cols-2 gap-5 pt-2 border-t border-line">
                          <div>
                            <p className="label mb-2">Performance rating</p>
                            <RatingDial rating={c.rating} />
                            <p className="text-xs text-ink-400 mt-3">
                              Each sport uses its own weighted model. Weights are configurable in Sports settings.
                            </p>
                          </div>
                          <div>
                            <p className="label mb-2">Match log</p>
                            <div className="max-h-64 overflow-y-auto scroll-thin border border-line rounded-lg">
                              <DataTable
                                dense
                                columns={[
                                  { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
                                  { key: 'opponent', label: 'Opponent', render: (r) => r.opponent || '—' },
                                  { key: 'summary', label: 'Key numbers', render: (r) => summariseMatch(c.sport.code, r.computed) },
                                  { key: 'result', label: '', render: (r) => r.result ? <Chip tone={r.result}>{titleCase(r.result)}</Chip> : null },
                                ]}
                                rows={c.performances.slice().reverse()}
                                empty={{ title: 'No matches', message: '' }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Section>
            ))}
          </div>
        )}

        {tab === 'development' && (
          <div className="grid lg:grid-cols-3 gap-5">
            <Section title="Overall assessment trend" subtitle="Every review is kept — nothing is overwritten" className="lg:col-span-2">
              <div className="p-4">
                {development?.overallTrend?.length ? (
                  <TrendChart
                    data={development.overallTrend.map((d) => ({ date: d.date.slice(0, 7), score: d.value }))}
                    series={[{ key: 'score', label: 'Overall score', color: '#F59E0B' }]}
                    domain={[0, 10]}
                    height={240}
                  />
                ) : <EmptyState title="No assessments recorded" message="Coaches can record a structured assessment from the Assessments page." />}
              </div>
            </Section>

            <Section
              title="Against the age group"
              subtitle={benchmarks ? `Measured against ${benchmarks.ageGroup} standards` : 'Loading'}
              className="lg:col-span-3"
            >
              {!benchmarks || (!benchmarks.career.length && !benchmarks.assessment.length) ? (
                <EmptyState
                  title="No benchmarks apply yet"
                  message="Benchmarks compare an athlete against the standard for their age group. Add them under Assessments, or record more matches so there is something to measure."
                />
              ) : (
                <div className="p-4 space-y-5">
                  {benchmarks.career.length > 0 && (
                    <div>
                      <p className="label mb-2">Match record</p>
                      <div className="space-y-2.5">
                        {benchmarks.career.map((c) => <BenchmarkRow key={`${c.sportId}-${c.metric}`} item={c} />)}
                      </div>
                    </div>
                  )}
                  {benchmarks.assessment.length > 0 && (
                    <div>
                      <p className="label mb-2">Assessment{benchmarks.assessedOn ? ` — ${formatDate(benchmarks.assessedOn)}` : ''}</p>
                      <div className="space-y-2.5">
                        {benchmarks.assessment.map((c) => <BenchmarkRow key={c.metric} item={c} />)}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-ink-400">
                    A number on its own says little — twenty-four runs an innings is excellent at under-14 and
                    modest for a senior. These read each figure against the standard for the group this athlete
                    actually plays in.
                  </p>
                </div>
              )}
            </Section>

            <Section title="Current profile" subtitle="Latest score per category">
              <div className="p-4 space-y-3">
                {development?.byCategory?.length ? development.byCategory.map((c) => (
                  <div key={c.category}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{titleCase(c.category)}</span>
                      <span className="stat-value">{c.average ?? '—'}<span className="text-ink-200 text-xs">/10</span></span>
                    </div>
                    <div className="h-2 bg-canvas rounded-full overflow-hidden">
                      <div className="h-full bg-pitch rounded-full" style={{ width: `${((c.average || 0) / 10) * 100}%` }} />
                    </div>
                  </div>
                )) : <p className="text-sm text-ink-400">No assessment data yet.</p>}
              </div>
            </Section>

            {development?.criteria?.length > 0 && (
              <Section title="Criterion progression" subtitle="First recorded score against the most recent" className="lg:col-span-3">
                <DataTable
                  columns={[
                    { key: 'name', label: 'Criterion' },
                    { key: 'category', label: 'Category', render: (r) => titleCase(r.category) },
                    { key: 'first', label: 'First', align: 'right', mono: true, render: (r) => r.first ?? '—' },
                    { key: 'latest', label: 'Latest', align: 'right', mono: true, render: (r) => r.latest ?? '—' },
                    {
                      key: 'change', label: 'Change', align: 'right',
                      render: (r) => r.change == null ? '—' : (
                        <span className={`stat-value ${r.change > 0 ? 'text-pitch' : r.change < 0 ? 'text-alert' : 'text-ink-400'}`}>
                          {r.change > 0 ? '+' : ''}{r.change}
                        </span>
                      ),
                    },
                    {
                      key: 'spark', label: 'Progression',
                      render: (r) => (
                        <span className="flex items-end gap-0.5 h-6">
                          {r.points.map((pt, i) => (
                            <span key={i} className="w-1.5 rounded-sm bg-gradient-to-t from-gold-dark to-gold" style={{ height: `${Math.max(8, (pt.value / r.scaleMax) * 100)}%` }} title={`${pt.date}: ${pt.value}`} />
                          ))}
                        </span>
                      ),
                    },
                  ]}
                  rows={development.criteria}
                  empty={{ title: 'No criteria scored', message: '' }}
                />
              </Section>
            )}

            <Section title="Assessment history" className="lg:col-span-3">
              <DataTable
                columns={[
                  { key: 'assessment_date', label: 'Date', render: (r) => formatDate(r.assessment_date) },
                  { key: 'cycle', label: 'Review', render: (r) => r.cycle || '—' },
                  { key: 'sport_name', label: 'Sport' },
                  { key: 'coach_name', label: 'Assessed by', render: (r) => r.coach_name || '—' },
                  { key: 'overall_score', label: 'Score', align: 'right', mono: true, render: (r) => r.overall_score ?? '—' },
                  { key: 'summary', label: 'Summary', render: (r) => r.summary || '—' },
                ]}
                rows={development?.assessments?.slice().reverse() || []}
                empty={{ title: 'No assessments yet', message: 'Structured reviews will build a development history here.' }}
              />
            </Section>
          </div>
        )}

        {tab === 'timeline' && (
          <Section title="Career timeline" subtitle="Registrations, team moves, matches, milestones, assessments and awards"
            actions={can('players.write') ? <button type="button" className="btn-gold text-xs" onClick={() => setAddingNote(true)}>Add entry</button> : null}>
            <div className="p-5 max-h-[70vh] overflow-y-auto scroll-thin">
              <CareerSpine events={timeline || []} />
            </div>
          </Section>
        )}

        {tab === 'teams' && (
          <div className="space-y-5">
            <Section
              title="Team history"
              subtitle="Historical memberships are closed, never deleted"
              actions={can('teams.write') ? <button type="button" className="btn-gold text-xs" onClick={() => setAssigningTeam(true)}>Assign to team</button> : null}
            >
              <DataTable
                columns={[
                  { key: 'team_name', label: 'Team', render: (r) => <Link to={`/teams/${r.team_id}`} className="link">{r.team_name}</Link> },
                  { key: 'sport_name', label: 'Sport' },
                  { key: 'age_group', label: 'Age group', render: (r) => r.age_group || '—' },
                  { key: 'role', label: 'Role', render: (r) => titleCase(r.role) },
                  { key: 'jersey_number', label: 'Jersey', align: 'right', mono: true, render: (r) => r.jersey_number ?? '—' },
                  { key: 'period', label: 'Period', render: (r) => `${formatDate(r.start_date)} → ${r.end_date ? formatDate(r.end_date) : 'present'}` },
                  { key: 'status', label: 'Status', render: (r) => <Chip tone={r.end_date ? 'inactive' : 'active'}>{r.end_date ? titleCase(r.status) : 'Current'}</Chip> },
                ]}
                rows={profile.teamHistory}
                empty={{ title: 'No team history', message: 'Add this athlete to a team roster to begin the record.' }}
              />
            </Section>


            <Section
              title="Coaches & trainers"
              subtitle="Staff assigned to this athlete directly, alongside whoever runs their team"
              actions={can('players.write') ? <button type="button" className="btn-gold text-xs" onClick={() => setAssigningStaff(true)}>Assign staff</button> : null}
            >
              <DataTable
                columns={[
                  { key: 'coach_name', label: 'Staff member', render: (r) => <Link to={`/coaches/${r.coach_id}`} className="link">{r.coach_name}</Link> },
                  { key: 'role', label: 'Assigned as', render: (r) => titleCase(r.role) },
                  { key: 'sport_name', label: 'Sport', render: (r) => r.sport_name || '—' },
                  { key: 'qualification', label: 'Qualification', render: (r) => r.qualification || '—' },
                  { key: 'period', label: 'Period', render: (r) => `${formatDate(r.start_date)} → ${r.end_date ? formatDate(r.end_date) : 'present'}` },
                  { key: 'status', label: '', render: (r) => <Chip tone={r.end_date ? 'inactive' : 'active'}>{r.end_date ? 'Ended' : 'Current'}</Chip> },
                  ...(can('players.write') ? [{
                    key: 'actions', label: '', align: 'right',
                    render: (r) => (r.end_date ? null : (
                      <button
                        type="button"
                        className="btn-quiet text-xs"
                        onClick={async () => {
                          await api.put(`/players/${id}/staff/${r.id}`, { end_date: new Date().toISOString().slice(0, 10) });
                          load();
                        }}
                      >
                        End
                      </button>
                    )),
                  }] : []),
                ]}
                rows={profile.staff || []}
                empty={{ title: 'No staff assigned', message: 'Assign a coach, trainer or physio to follow this athlete personally.' }}
              />
            </Section>

            <Section title="Sports registered"
              actions={can('players.write') ? <button type="button" className="btn-gold text-xs" onClick={() => setAddingSport(true)}>Add sport</button> : null}>
              <DataTable
                columns={[
                  { key: 'sport_name', label: 'Sport' },
                  { key: 'is_primary', label: 'Primary', render: (r) => r.is_primary ? <Chip tone="active">Primary</Chip> : '—' },
                  { key: 'position', label: 'Position', render: (r) => titleCase(r.position) || '—' },
                  { key: 'playing_level', label: 'Level', render: (r) => titleCase(r.playing_level) || '—' },
                  { key: 'jersey_number', label: 'Jersey', align: 'right', mono: true, render: (r) => r.jersey_number ?? '—' },
                  { key: 'joined_date', label: 'Since', render: (r) => formatDate(r.joined_date) },
                ]}
                rows={profile.sports}
                empty={{ title: 'Not registered for a sport', message: 'Add a sport so performances can be recorded.' }}
              />
            </Section>

            {profile.attributeHistory.length > 0 && (
              <Section title="Change history" subtitle="Position, level and jersey changes are kept as a record">
                <DataTable
                  columns={[
                    { key: 'effective_date', label: 'Date', render: (r) => formatDate(r.effective_date) },
                    { key: 'sport_name', label: 'Sport', render: (r) => r.sport_name || '—' },
                    { key: 'attribute', label: 'Field', render: (r) => titleCase(r.attribute) },
                    { key: 'old_value', label: 'From', render: (r) => titleCase(r.old_value) || '—' },
                    { key: 'new_value', label: 'To', render: (r) => titleCase(r.new_value) || '—' },
                  ]}
                  rows={profile.attributeHistory}
                  empty={{ title: 'No changes recorded', message: '' }}
                />
              </Section>
            )}
          </div>
        )}

        {tab === 'achievements' && (
          <Section title="Achievements and awards">
            <DataTable
              columns={[
                { key: 'awarded_date', label: 'Date', render: (r) => formatDate(r.awarded_date) },
                { key: 'title', label: 'Award' },
                { key: 'category', label: 'Category', render: (r) => titleCase(r.category) },
                { key: 'level', label: 'Level', render: (r) => titleCase(r.level) },
                { key: 'sport_name', label: 'Sport', render: (r) => r.sport_name || '—' },
                { key: 'tournament_name', label: 'Competition', render: (r) => r.tournament_name || '—' },
              ]}
              rows={profile.achievements}
              empty={{ title: 'No awards recorded', message: 'Player of the Match awards are created automatically when match results are entered.' }}
            />
          </Section>
        )}

        {tab === 'profile' && (
          <div className="grid lg:grid-cols-3 gap-5">
            <Section title="Athlete details" className="lg:col-span-2">
              <dl className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  ['Athlete ID', p.athlete_id],
                  ['Full name', `${p.first_name} ${p.last_name}`],
                  ['Date of birth', p.dob ? `${formatDate(p.dob)} (${ageFrom(p.dob)})` : '—'],
                  ['Gender', titleCase(p.gender)],
                  ['Nationality', p.nationality],
                  ['Registered', formatDate(p.registration_date)],
                  ['Height', p.height_cm ? `${p.height_cm} cm` : '—'],
                  ['Weight', p.weight_kg ? `${p.weight_kg} kg` : '—'],
                  ['Preferred hand', titleCase(p.preferred_hand)],
                  ['Preferred foot', titleCase(p.preferred_foot)],
                  ['Record visibility', titleCase(p.visibility)],
                  ['Phone', p.phone],
                  ['Email', p.email],
                  ['Address', [p.address, p.city, p.country].filter(Boolean).join(', ')],
                  ['Emergency contact', p.emergency_name ? `${p.emergency_name} · ${p.emergency_phone || ''}` : null],
                  ['Guardian', p.guardian_name ? `${p.guardian_name} · ${p.guardian_phone || ''}` : null],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="label">{label}</dt>
                    <dd className="text-sm mt-1">{value || <span className="text-ink-200">—</span>}</dd>
                  </div>
                ))}
              </dl>
              {p._redacted && (
                <p className="px-4 pb-4 text-xs text-ink-400">
                  Contact and guardian details are restricted. Your role can see squad and performance information only.
                </p>
              )}
            </Section>

            <div className="space-y-5">
              <Section title="Status history">
                <ul className="divide-y divide-line">
                  {profile.statusHistory.map((h) => (
                    <li key={h.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <span>
                        <StatusChip status={h.status} />
                        {h.reason && <span className="text-xs text-ink-400 block mt-1">{h.reason}</span>}
                      </span>
                      <span className="font-mono text-[11px] text-ink-400">
                        {formatDate(h.effective_from)}{h.effective_to ? ` → ${formatDate(h.effective_to)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>

              {can('documents.read') && (
                <Section title="Documents" subtitle="Restricted to staff roles">
                  {profile.documents.length === 0
                    ? <EmptyState title="No documents on file" message="Registration forms, ID and consent documents can be attached to this record." />
                    : (
                      <ul className="divide-y divide-line">
                        {profile.documents.map((d) => (
                          <li key={d.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                            <span className="min-w-0">
                              <span className="text-sm block truncate">{d.title}</span>
                              <span className="text-[11px] text-ink-400">{titleCase(d.doc_type)}{d.expiry_date ? ` · expires ${formatDate(d.expiry_date)}` : ''}</span>
                            </span>
                            <button type="button" className="btn-quiet text-xs" onClick={() => api.download(`/media/documents/${d.id}/file`, d.title)}>Open</button>
                          </li>
                        ))}
                      </ul>
                    )}
                </Section>
              )}

              <Section title="Media">
                {profile.media.length === 0
                  ? <EmptyState title="No media" message="Photos, highlights and certificates can be attached to this athlete." />
                  : (
                    <ul className="divide-y divide-line">
                      {profile.media.map((m) => (
                        <li key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                          <span className="text-sm truncate">{m.title}</span>
                          <Chip tone={m.is_approved ? 'active' : 'trial'}>{m.is_approved ? 'Approved' : 'Pending'}</Chip>
                        </li>
                      ))}
                    </ul>
                  )}
              </Section>
            </div>
          </div>
        )}
      </div>

      <EditPlayer open={editing} onClose={() => setEditing(false)} player={p} onSaved={load} />
      <AddSport open={addingSport} onClose={() => setAddingSport(false)} playerId={id} sports={sports} existing={profile.sports} onSaved={load} />
      <AddTimelineNote open={addingNote} onClose={() => setAddingNote(false)} playerId={id} sports={profile.sports} onSaved={load} />
      <AssignTeam
        open={assigningTeam}
        onClose={() => setAssigningTeam(false)}
        playerId={id}
        teams={teams}
        current={currentTeams}
        onSaved={load}
      />
      <ShowcaseControl open={showcase} onClose={() => setShowcase(false)} player={p} onSaved={load} />
      <AssignStaff
        open={assigningStaff}
        onClose={() => setAssigningStaff(false)}
        playerId={id}
        coaches={coaches}
        sports={profile.sports}
        onSaved={load}
      />
    </>
  );
}

/** Sport-appropriate one-line summary of a single match. */
function summariseMatch(code, c) {
  if (!c) return '—';
  const bits = [];
  if (code === 'cricket') {
    if (c.batted) bits.push(`${c.runs}${c.not_out ? '*' : ''} (${c.balls_faced})`);
    if (c.bowled_spell) bits.push(`${c.wickets}/${c.runs_conceded}`);
    if (c.catches) bits.push(`${c.catches} ct`);
  } else if (code === 'football' || code === 'futsal') {
    if (c.goals) bits.push(`${c.goals} goal${c.goals > 1 ? 's' : ''}`);
    if (c.assists) bits.push(`${c.assists} assist${c.assists > 1 ? 's' : ''}`);
    if (c.saves) bits.push(`${c.saves} saves`);
    bits.push(`${c.minutes}'`);
  } else if (code === 'basketball') {
    bits.push(`${c.points} pts`, `${c.rebounds} reb`, `${c.assists} ast`);
  } else {
    bits.push(`${c.sets_won}–${c.sets_lost} sets`);
    if (c.points_scored) bits.push(`${c.points_scored} pts`);
  }
  return bits.join(' · ') || '—';
}

function EditPlayer({ open, onClose, player, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setForm({ ...player }); setError(null); } }, [open, player]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fields = ['first_name', 'last_name', 'display_name', 'dob', 'gender', 'nationality', 'status',
        'phone', 'email', 'address', 'city', 'country', 'emergency_name', 'emergency_phone', 'emergency_relation',
        'guardian_name', 'guardian_phone', 'guardian_email', 'height_cm', 'weight_kg', 'preferred_hand',
        'preferred_foot', 'visibility', 'bio'];
      const payload = {};
      fields.forEach((f) => { if (form[f] !== undefined && form[f] !== null) payload[f] = form[f]; });
      if (form.status !== player.status) payload.status_reason = form.status_reason || null;
      await api.put(`/players/${player.id}`, payload);
      onSaved();
      onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit athlete record" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="First name"><input className="input" value={form.first_name || ''} onChange={set('first_name')} /></Field>
          <Field label="Last name"><input className="input" value={form.last_name || ''} onChange={set('last_name')} /></Field>
          <Field label="Display name"><input className="input" value={form.display_name || ''} onChange={set('display_name')} /></Field>
          <Field label="Date of birth"><input className="input" type="date" value={form.dob || ''} onChange={set('dob')} /></Field>
          <Field label="Nationality"><input className="input" value={form.nationality || ''} onChange={set('nationality')} /></Field>
          <Field label="Status" hint="Changes are added to the status history">
            <select className="input" value={form.status || 'active'} onChange={set('status')}>
              {['active', 'inactive', 'injured', 'on_loan', 'suspended', 'retired', 'alumni', 'trial'].map((s) => (
                <option key={s} value={s}>{titleCase(s)}</option>
              ))}
            </select>
          </Field>
          {form.status !== player.status && (
            <Field label="Reason for change" className="sm:col-span-2 lg:col-span-3">
              <input className="input" value={form.status_reason || ''} onChange={set('status_reason')} placeholder="e.g. Hamstring strain, six weeks" />
            </Field>
          )}
          <Field label="Phone"><input className="input" value={form.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Email"><input className="input" value={form.email || ''} onChange={set('email')} /></Field>
          <Field label="City"><input className="input" value={form.city || ''} onChange={set('city')} /></Field>
          <Field label="Height (cm)"><input className="input" type="number" step="0.1" value={form.height_cm || ''} onChange={set('height_cm')} /></Field>
          <Field label="Weight (kg)"><input className="input" type="number" step="0.1" value={form.weight_kg || ''} onChange={set('weight_kg')} /></Field>
          <Field label="Record visibility">
            <select className="input" value={form.visibility || 'club'} onChange={set('visibility')}>
              {['public', 'club', 'staff', 'private'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}
            </select>
          </Field>
          <Field label="Guardian name"><input className="input" value={form.guardian_name || ''} onChange={set('guardian_name')} /></Field>
          <Field label="Guardian phone"><input className="input" value={form.guardian_phone || ''} onChange={set('guardian_phone')} /></Field>
          <Field label="Emergency contact"><input className="input" value={form.emergency_name || ''} onChange={set('emergency_name')} /></Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddSport({ open, onClose, playerId, sports, existing, onSaved }) {
  const [form, setForm] = useState({ sport_id: '', position: '', playing_level: 'academy', jersey_number: '', is_primary: 0 });
  const [error, setError] = useState(null);
  const available = sports.filter((s) => !existing.some((e) => e.sport_id === s.id));
  const chosen = sports.find((s) => String(s.id) === String(form.sport_id));

  useEffect(() => { if (open) { setForm({ sport_id: '', position: '', playing_level: 'academy', jersey_number: '', is_primary: 0 }); setError(null); } }, [open]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/players/${playerId}/sports`, {
        ...form,
        sport_id: Number(form.sport_id),
        jersey_number: form.jersey_number === '' ? null : Number(form.jersey_number),
      });
      onSaved();
      onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a sport">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-400">
          The athlete keeps the same record and athlete ID. Statistics for each sport are kept separately.
        </p>
        <Field label="Sport">
          <select className="input" required value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value, position: '' })}>
            <option value="">Choose a sport</option>
            {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Position">
          <select className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} disabled={!chosen}>
            <option value="">Not set</option>
            {(chosen?.config?.positions || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Playing level">
            <select className="input" value={form.playing_level} onChange={(e) => setForm({ ...form, playing_level: e.target.value })}>
              {['academy', 'development', 'senior', 'representative', 'recreational'].map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
            </select>
          </Field>
          <Field label="Jersey number"><input className="input" type="number" value={form.jersey_number} onChange={(e) => setForm({ ...form, jersey_number: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked ? 1 : 0 })} />
          Make this the primary sport
        </label>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Add sport</button>
        </div>
      </form>
    </Modal>
  );
}

function AddTimelineNote({ open, onClose, playerId, sports, onSaved }) {
  const [form, setForm] = useState({ event_date: new Date().toISOString().slice(0, 10), event_type: 'note', title: '', description: '', sport_id: '', importance: 2 });
  const [error, setError] = useState(null);

  useEffect(() => { if (open) setError(null); }, [open]);

  async function submit(e) {
    e.preventDefault();
    try {
      await api.post(`/players/${playerId}/timeline`, {
        ...form,
        sport_id: form.sport_id ? Number(form.sport_id) : null,
        importance: Number(form.importance),
      });
      onSaved();
      onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a timeline entry">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Date"><input className="input" type="date" required value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></Field>
        <Field label="Title"><input className="input" required placeholder="e.g. Selected for the district squad" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Description"><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sport">
            <select className="input" value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value })}>
              <option value="">Not sport specific</option>
              {sports.map((s) => <option key={s.sport_id} value={s.sport_id}>{s.sport_name}</option>)}
            </select>
          </Field>
          <Field label="Prominence">
            <select className="input" value={form.importance} onChange={(e) => setForm({ ...form, importance: e.target.value })}>
              <option value={1}>Routine</option><option value={2}>Notable</option><option value={3}>Milestone</option>
            </select>
          </Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold">Add entry</button>
        </div>
      </form>
    </Modal>
  );
}

function AssignTeam({ open, onClose, playerId, teams, current, onSaved }) {
  const [form, setForm] = useState({ team_id: '', role: 'player', jersey_number: '', start_date: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ team_id: '', role: 'player', jersey_number: '', start_date: new Date().toISOString().slice(0, 10) });
      setError(null);
    }
  }, [open]);

  const alreadyOn = new Set((current || []).map((t) => t.team_id));
  const available = teams.filter((t) => !alreadyOn.has(t.id));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/teams/${form.team_id}/members`, {
        player_id: Number(playerId),
        role: form.role,
        jersey_number: form.jersey_number === '' ? null : Number(form.jersey_number),
        start_date: form.start_date,
      });
      onSaved();
      onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Assign to a team">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-400">
          Joining a team also registers the athlete for that sport if they are not already. Their athlete ID and
          existing record stay the same.
        </p>
        <Field label="Team">
          <select className="input" required value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })}>
            <option value="">Choose a team</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>{t.name} — {t.sport_name}{t.age_group ? ` · ${t.age_group}` : ''}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Squad role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {['player', 'captain', 'vice_captain', 'wicket_keeper', 'goalkeeper'].map((r) => (
                <option key={r} value={r}>{titleCase(r)}</option>
              ))}
            </select>
          </Field>
          <Field label="Jersey number" hint="Must be free in that squad">
            <input className="input" type="number" value={form.jersey_number} onChange={(e) => setForm({ ...form, jersey_number: e.target.value })} />
          </Field>
          <Field label="Start date" className="col-span-2">
            <input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy || !form.team_id}>{busy ? 'Assigning…' : 'Assign to team'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AssignStaff({ open, onClose, playerId, coaches, sports, onSaved }) {
  const [form, setForm] = useState({ coach_id: '', role: 'coach', sport_id: '', start_date: new Date().toISOString().slice(0, 10), notes: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ coach_id: '', role: 'coach', sport_id: '', start_date: new Date().toISOString().slice(0, 10), notes: '' });
      setError(null);
    }
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/players/${playerId}/staff`, {
        coach_id: Number(form.coach_id),
        role: form.role,
        sport_id: form.sport_id ? Number(form.sport_id) : null,
        start_date: form.start_date,
        notes: form.notes || null,
      });
      onSaved();
      onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Assign a coach or trainer">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-400">
          This is a personal assignment — a trainer, physio or mentor following this athlete specifically. It sits
          alongside whoever coaches their team.
        </p>
        <Field label="Staff member">
          <select className="input" required value={form.coach_id} onChange={(e) => setForm({ ...form, coach_id: e.target.value })}>
            <option value="">Choose</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name} — {titleCase(c.role)}{c.sport_name ? ` · ${c.sport_name}` : ''}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assigned as">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {['coach', 'assistant_coach', 'personal_trainer', 'fitness_trainer', 'physio', 'mentor', 'specialist'].map((r) => (
                <option key={r} value={r}>{titleCase(r)}</option>
              ))}
            </select>
          </Field>
          <Field label="Sport" hint="Leave empty if it applies across sports">
            <select className="input" value={form.sport_id} onChange={(e) => setForm({ ...form, sport_id: e.target.value })}>
              <option value="">All sports</option>
              {sports.map((s) => <option key={s.sport_id} value={s.sport_id}>{s.sport_name}</option>)}
            </select>
          </Field>
          <Field label="Start date" className="col-span-2">
            <input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes"><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold" disabled={busy || !form.coach_id}>{busy ? 'Assigning…' : 'Assign staff'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** One metric against its age-group bands. */
function BenchmarkRow({ item }) {
  const BANDS = [
    { key: 'below', label: 'Below', colour: 'bg-alert', text: 'text-alert' },
    { key: 'developing', label: 'Developing', colour: 'bg-gold', text: 'text-gold' },
    { key: 'competent', label: 'Competent', colour: 'bg-sky', text: 'text-sky' },
    { key: 'strong', label: 'Strong', colour: 'bg-pitch', text: 'text-pitch' },
    { key: 'exceptional', label: 'Exceptional', colour: 'bg-violet', text: 'text-violet' },
  ];
  const index = Math.max(0, BANDS.findIndex((b) => b.key === item.band));
  const band = BANDS[index];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <span className="text-sm text-ink-600">
          {item.label}
          {item.sport && <span className="text-ink-400 text-xs"> · {item.sport}</span>}
        </span>
        <span className="flex items-baseline gap-2">
          <span className="stat-value">{item.value}<span className="text-ink-400 text-xs">{item.unit ? ` ${item.unit}` : ''}</span></span>
          <span className={`chip ${band.text} border`} style={{ borderColor: 'currentColor', background: 'transparent' }}>
            {band.label}
          </span>
        </span>
      </div>
      <div className="flex gap-1">
        {BANDS.slice(1).map((b, i) => (
          <span
            key={b.key}
            className={`h-2 flex-1 rounded-full ${i <= index - 1 ? b.colour : 'bg-surface-sunken'}`}
            title={`${b.label}: ${item.higherIsBetter ? 'at or above' : 'at or below'} ${item.thresholds[b.key] ?? '—'}`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-ink-200 font-mono">
        <span>{item.thresholds.developing ?? '—'}</span>
        <span>{item.thresholds.competent ?? '—'}</span>
        <span>{item.thresholds.strong ?? '—'}</span>
        <span>{item.thresholds.exceptional ?? '—'}</span>
      </div>
    </div>
  );
}

/**
 * Turning the showcase on mints a link; turning it off destroys the token, so
 * a copied URL genuinely stops working rather than merely being discouraged.
 */
function ShowcaseControl({ open, onClose, player, onSaved }) {
  const [headline, setHeadline] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setHeadline(player.showcase_headline || '');
      setResult(player.showcase_enabled && player.showcase_token
        ? { enabled: true, token: player.showcase_token, path: `/showcase/${player.showcase_token}` }
        : null);
      setCopied(false); setError(null);
    }
  }, [open, player]);

  const link = result?.token ? `${window.location.origin}${window.location.pathname}#/showcase/${result.token}` : null;

  async function update(enabled, regenerate = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.put(`/players/${player.id}/showcase`, { enabled, headline, regenerate });
      setResult(r.enabled ? r : null);
      onSaved();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Showcase profile">
      <div className="space-y-4">
        <p className="text-sm text-ink-400">
          A shareable summary of this athlete's record — career statistics, honours, squads and milestones —
          for selectors and academies. Contact details, guardians, documents and assessments are never
          included.
        </p>

        <Field label="Headline" hint="One line, shown under their name">
          <textarea className="input" rows={2} value={headline} onChange={(e) => setHeadline(e.target.value)}
            placeholder="Top-order batter, strong through the covers. Looking for representative cricket." />
        </Field>

        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-pitch/30 bg-pitch/10 px-3.5 py-3">
              <p className="text-sm font-semibold text-pitch">The profile is live.</p>
              <p className="text-xs text-pitch/80 mt-1">Anyone with this link can open it. No sign-in is needed.</p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-line bg-surface-sunken px-3 py-2.5 font-mono text-[11px] text-ink break-all">
                {link}
              </code>
              <button
                type="button"
                className="btn-ghost shrink-0"
                onClick={() => navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <ErrorNote error={error} />
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => update(true, true)}>
                Reissue link
              </button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => update(true)}>
                Save headline
              </button>
              <button type="button" className="btn-danger" disabled={busy} onClick={() => update(false)}>
                Withdraw
              </button>
            </div>
            <p className="text-xs text-ink-400">
              Withdrawing destroys the link. Reissuing replaces it, so anything shared previously stops working.
            </p>
          </div>
        ) : (
          <>
            <ErrorNote error={error} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn-gold" disabled={busy} onClick={() => update(true)}>
                {busy ? 'Publishing…' : 'Publish showcase'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
