import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { PageHeader, Section, Spinner, ErrorNote, DataTable, StatTile, Chip, EmptyState } from '../components/ui';
import { formatDate, formatDateTime, titleCase } from '../lib/format';

export default function TournamentDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.get(`/tournaments/${id}`).then(setData).catch(setError); }, [id]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading tournament" />;
  const { tournament: t, matches, awards, leaders, teams } = data;
  const completed = matches.filter((m) => m.status === 'completed');

  return (
    <>
      <PageHeader
        eyebrow={`${t.sport_name}${t.season_name ? ` · ${t.season_name}` : ''}`}
        title={t.name}
        subtitle={[t.format, titleCase(t.level), t.venue, `${formatDate(t.start_date)} → ${formatDate(t.end_date)}`].filter(Boolean).join(' · ')}
        actions={<Chip tone={t.status}>{titleCase(t.status)}</Chip>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatTile label="Matches" value={matches.length} hint={`${completed.length} completed`} />
        <StatTile label="Teams entered" value={teams.length} />
        <StatTile label="Awards" value={awards.length} tone="gold" />
        <StatTile label="Status" value={titleCase(t.status)} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Section title="Fixtures & results" className="lg:col-span-2">
          <DataTable
            columns={[
              { key: 'scheduled_at', label: 'Date', render: (m) => formatDateTime(m.scheduled_at) },
              { key: 'fixture', label: 'Fixture', render: (m) => <Link to={`/matches/${m.id}`} className="link">{m.home_team_name || 'Karwan'} vs {m.away_team_name || m.opponent_name}</Link> },
              { key: 'stage', label: 'Stage', render: (m) => m.stage || '—' },
              { key: 'score', label: 'Score', mono: true, render: (m) => m.home_score ? `${m.home_score} – ${m.away_score}` : '—' },
              { key: 'motm', label: 'Player of the match', render: (m) => m.motm_name || '—' },
              { key: 'result', label: '', render: (m) => m.result ? <Chip tone={m.result}>{titleCase(m.result)}</Chip> : <Chip tone={m.status}>{titleCase(m.status)}</Chip> },
            ]}
            rows={matches}
            empty={{ title: 'No fixtures yet', message: 'Add matches from the Matches page and link them to this tournament.' }}
          />
        </Section>

        <div className="space-y-5">
          <Section title="Tournament leaders" subtitle={`${t.sport_name} statistics only`}>
            {!leaders?.length
              ? <EmptyState title="No statistics yet" message="Leaders appear once performances are recorded." />
              : (
                <div className="p-4 space-y-4">
                  {leaders.map((b) => (
                    <div key={b.key}>
                      <p className="label mb-1.5">{b.label}</p>
                      <ol className="space-y-1">
                        {b.entries.map((e, i) => (
                          <li key={e.playerId} className="flex items-center gap-2 text-sm">
                            <span className="font-display text-ink-200 w-4">{i + 1}</span>
                            <Link to={`/players/${e.playerId}`} className="flex-1 truncate hover:underline">{e.name}</Link>
                            <span className="stat-value">{typeof e.value === 'number' ? Math.round(e.value * 100) / 100 : e.value}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              )}
          </Section>

          <Section title="Awards">
            {!awards.length
              ? <EmptyState title="No awards recorded" message="" />
              : (
                <ul className="divide-y divide-line">
                  {awards.map((a) => (
                    <li key={a.id} className="px-4 py-2.5 flex items-center gap-2">
                      <span className="text-gold">🏆</span>
                      <span className="min-w-0 flex-1">
                        <span className="text-sm block">{a.title}</span>
                        <Link to={`/players/${a.player_id}`} className="text-xs text-ink-400 hover:underline">{a.first_name} {a.last_name}</Link>
                      </span>
                      <span className="font-mono text-[11px] text-ink-400">{formatDate(a.awarded_date)}</span>
                    </li>
                  ))}
                </ul>
              )}
          </Section>
        </div>
      </div>
    </>
  );
}
