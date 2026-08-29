import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Shapes, Shield, Megaphone, Swords, Trophy, Dumbbell,
  ClipboardCheck, Activity, Award, CalendarClock, Flame,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader, StatTile, Section, Spinner, ErrorNote, Avatar, StatusChip,
  BarsChart, TrendChart, EmptyState, Chip,
} from '../components/ui';
import { formatDate, formatDateTime, playerName, titleCase } from '../lib/format';

export default function Dashboard() {
  const { user, can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/dashboard').then(setData).catch(setError);
  }, []);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Building the club overview" />;

  const t = data.totals;
  const firstName = (user?.fullName || '').split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`Good day, ${firstName}`}
        subtitle="Karwan Sports Club at a glance — athletes, competition and development across every sport."
        actions={
          <>
            {can('players.write') && <Link to="/players?new=1" className="btn-gold">Register athlete</Link>}
            {can('reports.read') && <Link to="/reports" className="btn-ghost">Reports</Link>}
          </>
        }
      />

      {data.demoDataPresent && (
        <div className="mb-5 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold flex flex-wrap items-center justify-between gap-3">
          <span>This workspace contains demonstration data. Real records are kept separate and are never removed by clearing it.</span>
          <Link to="/settings" className="font-semibold underline">Manage demo data</Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <StatTile label="Athletes" value={t.athletes} hint={`${t.activeAthletes} active`} tone="gold" icon={Users} to="/players" />
        <StatTile label="Sports" value={t.sports} tone="violet" icon={Shapes} to="/sports" />
        <StatTile label="Teams" value={t.teams} tone="sky" icon={Shield} to="/teams" />
        <StatTile label="Coaches" value={t.coaches} tone="pitch" icon={Megaphone} to="/coaches" />
        <StatTile label="Matches" value={t.matches} hint={`${t.completedMatches} completed`} tone="alert" icon={Swords} to="/matches" />
        <StatTile label="Tournaments" value={t.tournaments} tone="gold" icon={Trophy} to="/tournaments" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatTile label="Training sessions" value={t.trainingSessions} hint={`${data.attendanceRate}% attendance`} tone="pitch" icon={Dumbbell} to="/training" />
        <StatTile label="Assessments" value={t.assessments} tone="sky" icon={ClipboardCheck} to="/assessments" />
        <StatTile label="Performance records" value={t.performances} tone="violet" icon={Activity} />
        <StatTile label="Achievements" value={t.achievements} tone="gold" icon={Award} to="/achievements" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Section title="Athletes by sport" subtitle="An athlete registered for two sports is counted in both" className="lg:col-span-2">
          <div className="p-4">
            <BarsChart
              data={data.bySport.map((s) => ({ name: s.name, players: s.players, color: s.color }))}
              xKey="name"
              barKey="players"
              height={230}
            />
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-4">
              {data.bySport.map((s) => (
                <Link
                  key={s.id}
                  to={`/players?sport=${s.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 transition-all hover:border-line-bright hover:bg-white/[0.04]"
                  style={{ borderLeft: `3px solid ${s.color}` }}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0 ring-2" style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }} />
                    <span className="text-sm truncate">{s.name}</span>
                  </span>
                  <span className="font-mono text-xs text-ink-400 shrink-0">{s.players}p · {s.teams}t · {s.matches}m</span>
                </Link>
              ))}
            </div>
          </div>
        </Section>

        <div className="space-y-5">
          <Section title="Registrations" subtitle="Last twelve months">
            <div className="p-4">
              <TrendChart
                data={data.registrationTrend.map((r) => ({ date: r.month.slice(2), count: r.count }))}
                series={[{ key: 'count', label: 'Registrations', color: '#F59E0B' }]}
                height={150}
              />
            </div>
          </Section>

          <Section title="Squad status">
            <div className="p-4 space-y-2">
              {data.byStatus.map((s) => (
                <div key={s.status} className="flex items-center justify-between">
                  <StatusChip status={s.status} />
                  <span className="stat-value text-sm">{s.count}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mt-5">
        <Section title="Upcoming fixtures" actions={<Link to="/matches" className="btn-quiet text-xs">All matches</Link>}>
          {data.upcomingMatches.length === 0
            ? <EmptyState title="No fixtures scheduled" message="Add a match to start planning the next block." />
            : (
              <ul className="divide-y divide-line">
                {data.upcomingMatches.map((m) => (
                  <li key={m.id}>
                    <Link to={`/matches/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04]">
                      <span className="h-8 w-1 rounded-full shrink-0" style={{ background: m.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium block truncate">
                          {m.home_team_name || 'Karwan'} vs {m.away_team_name || m.opponent_name || 'TBC'}
                        </span>
                        <span className="text-xs text-ink-400">{m.tournament_name || m.sport_name} · {m.venue || 'Venue TBC'}</span>
                      </span>
                      <span className="font-mono text-[11px] text-ink-400 shrink-0">{formatDateTime(m.scheduled_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </Section>

        <Section title="Latest results" actions={<Link to="/matches?status=completed" className="btn-quiet text-xs">All results</Link>}>
          {data.recentMatches.length === 0
            ? <EmptyState title="No results recorded" message="Completed matches and their statistics will appear here." />
            : (
              <ul className="divide-y divide-line">
                {data.recentMatches.map((m) => (
                  <li key={m.id}>
                    <Link to={`/matches/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04]">
                      <Chip tone={m.result}>{titleCase(m.result || '—')}</Chip>
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium block truncate">
                          {m.home_team_name || 'Karwan'} vs {m.away_team_name || m.opponent_name}
                        </span>
                        <span className="text-xs text-ink-400 truncate block">
                          {m.home_score && `${m.home_score} – ${m.away_score} · `}{m.motm_name ? `Player of the match: ${m.motm_name}` : m.sport_name}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-ink-400 shrink-0">{formatDate(m.scheduled_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </Section>

        <Section title="Recent achievements" actions={<Link to="/achievements" className="btn-quiet text-xs">All awards</Link>}>
          {data.recentAchievements.length === 0
            ? <EmptyState title="No awards yet" message="Player of the Match awards are recorded automatically when a match result is entered." />
            : (
              <ul className="divide-y divide-line">
                {data.recentAchievements.map((a) => (
                  <li key={a.id}>
                    <Link to={`/players/${a.player_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04]">
                      <Avatar player={a} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium block truncate">{a.title}</span>
                        <span className="text-xs text-ink-400 truncate block">{playerName(a)} · {a.sport_name || 'Club'}</span>
                      </span>
                      <span className="font-mono text-[11px] text-ink-400 shrink-0">{formatDate(a.awarded_date)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </Section>

        <Section title="New registrations" actions={<Link to="/players" className="btn-quiet text-xs">All athletes</Link>}>
          <ul className="divide-y divide-line">
            {data.recentRegistrations.map((p) => (
              <li key={p.id}>
                <Link to={`/players/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04]">
                  <Avatar player={p} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium block truncate">{playerName(p)}</span>
                    <span className="font-mono text-[11px] text-ink-400">{p.athlete_id}</span>
                  </span>
                  <StatusChip status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {data.upcomingTraining.length > 0 && (
        <Section title="Training ahead" className="mt-5" actions={<Link to="/training" className="btn-quiet text-xs">All sessions</Link>}>
          <ul className="divide-y divide-line">
            {data.upcomingTraining.map((s) => (
              <li key={s.id}>
                <Link to={`/training/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-white/[0.04]">
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium block truncate">{s.team_name || s.sport_name} — {titleCase(s.training_type)}</span>
                    <span className="text-xs text-ink-400">{s.location} · {s.coach_name || 'Coach TBC'}</span>
                  </span>
                  <span className="font-mono text-[11px] text-ink-400">{formatDate(s.session_date)} {s.start_time}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
