import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Trophy, Shield, CalendarDays, MapPin } from 'lucide-react';
import { api } from '../lib/api';
import { Spinner, Avatar, Chip, StatTile } from '../components/ui';
import { ageFrom, formatDate, titleCase } from '../lib/format';

/**
 * The showcase profile, as a selector or academy sees it.
 *
 * No sign-in: the link itself is the credential, and withdrawing it is what
 * revokes access. Only what an athlete would put on a résumé appears here —
 * the record, the honours, the squads. Contact details, guardians, documents,
 * assessments and coach notes are never fetched, so there is nothing to leak.
 */
export default function Showcase() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/players/showcase/${token}`).then(setData).catch(setError);
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="text-center max-w-sm">
          <p className="font-display text-3xl text-ink">Profile unavailable</p>
          <p className="text-sm text-ink-400 mt-2">
            This showcase link is no longer active. The athlete or their club may have withdrawn it.
          </p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="min-h-screen grid place-items-center"><Spinner label="Loading profile" /></div>;

  const { athlete, summary, careers, teams, achievements, milestones } = data;
  const current = teams.filter((t) => !t.end_date);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="relative overflow-hidden border-b border-line">
        <span className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-gold/20 blur-3xl" />
        <span className="pointer-events-none absolute -bottom-20 right-0 h-72 w-72 rounded-full bg-violet/20 blur-3xl" />

        <div className="relative max-w-5xl mx-auto px-5 sm:px-8 py-10">
          <div className="flex flex-wrap items-center gap-6">
            <Avatar player={{ photo_url: athlete.photoUrl, first_name: athlete.name.split(' ')[0], last_name: athlete.name.split(' ').slice(-1)[0] }} size={96} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-gold tracking-wider">{athlete.athleteId}</p>
              <h1 className="font-display text-4xl sm:text-5xl leading-none mt-1 text-ink">{athlete.name}</h1>
              {athlete.headline && <p className="text-sm text-ink-600 mt-3 max-w-xl">{athlete.headline}</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                {current.map((t, i) => (
                  <Chip key={i} tone="active">{t.name}</Chip>
                ))}
                {athlete.nationality && <Chip tone="inactive">{athlete.nationality}</Chip>}
                {athlete.dob && <Chip tone="inactive">{ageFrom(athlete.dob)} years</Chip>}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 mt-8">
            {[
              ['Club', athlete.club],
              ['Member since', formatDate(athlete.registeredSince)],
              ['Batting / hand', titleCase(athlete.preferredHand)],
              ['Preferred foot', titleCase(athlete.preferredFoot)],
              ['Height', athlete.heightCm ? `${athlete.heightCm} cm` : null],
              ['Profile updated', formatDate(athlete.updatedAt)],
            ].filter(([, v]) => v && v !== '—').map(([label, value]) => (
              <div key={label}>
                <dt className="label">{label}</dt>
                <dd className="text-sm mt-1 text-ink-700">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 sm:px-8 py-8 space-y-8">
        {/* Headline record */}
        <section>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile label="Matches" value={summary.matches} tone="gold" />
            <StatTile label="Wins" value={summary.wins} hint={`${summary.winRate}% win rate`} tone="pitch" />
            <StatTile label="Tournaments" value={summary.tournaments} tone="sky" />
            <StatTile label="Awards" value={summary.awards} tone="violet" icon={Trophy} />
            <StatTile label="Sports" value={summary.sports} tone="ink" />
            <StatTile label="Rating" value={summary.rating ?? '—'} hint={summary.rating ? 'out of 100' : null} tone="gold" />
          </div>
        </section>

        {/* Career by sport */}
        {careers.filter((c) => c.matchesPlayed > 0).map((c) => (
          <section key={c.sport.id}>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="h-5 w-1 rounded-full" style={{ background: c.sport.color }} />
              <h2 className="font-display text-2xl text-ink">{c.sport.name}</h2>
              <span className="text-sm text-ink-400">{c.matchesPlayed} appearances</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-line rounded-xl overflow-hidden border border-line mb-4">
              {c.headline.map((h) => (
                <div key={h.key} className="bg-surface px-3 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-ink-400 truncate">{h.label}</p>
                  <p className="stat-value text-xl mt-0.5">{h.display}</p>
                </div>
              ))}
            </div>

            {c.career.groups.filter((g) => g.stats.length).map((group) => (
              <div key={group.key} className="mb-3">
                <p className="label mb-2">{group.label}</p>
                <div className="flex flex-wrap gap-2">
                  {group.stats.map((s) => (
                    <span key={s.key} className="rounded-lg border border-line bg-surface px-3 py-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-ink-400">{s.label} </span>
                      <span className="stat-value text-sm">{s.display}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}

        {/* Honours */}
        {achievements.length > 0 && (
          <section>
            <h2 className="font-display text-2xl text-ink mb-3 flex items-center gap-2"><Trophy size={20} className="text-gold" /> Honours</h2>
            <ul className="grid sm:grid-cols-2 gap-2">
              {achievements.map((a, i) => (
                <li key={i} className="card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{a.title}</p>
                      <p className="text-xs text-ink-400 mt-0.5">
                        {[a.sport_name, a.tournament_name, titleCase(a.level)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="font-mono text-[11px] text-ink-400 shrink-0">{formatDate(a.awarded_date)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Squads */}
        {teams.length > 0 && (
          <section>
            <h2 className="font-display text-2xl text-ink mb-3 flex items-center gap-2"><Shield size={20} className="text-sky" /> Squads</h2>
            <ul className="space-y-2">
              {teams.map((t, i) => (
                <li key={i} className="card px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="text-sm text-ink block">{t.name}</span>
                    <span className="text-xs text-ink-400">
                      {[t.sport_name, t.age_group, titleCase(t.level), t.role !== 'player' ? titleCase(t.role) : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] text-ink-400">
                    {formatDate(t.start_date)} → {t.end_date ? formatDate(t.end_date) : 'present'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Milestones */}
        {milestones.length > 0 && (
          <section>
            <h2 className="font-display text-2xl text-ink mb-3 flex items-center gap-2"><CalendarDays size={20} className="text-violet" /> Milestones</h2>
            <ol className="relative ml-3 border-l-2 border-line">
              {milestones.map((m, i) => (
                <li key={i} className="relative pl-6 pb-4">
                  <span className="absolute -left-[9px] top-1 h-4 w-4 rounded-full bg-gold-grad" />
                  <p className="font-mono text-[11px] text-ink-400">{m.event_date}</p>
                  <p className="text-sm text-ink">{m.title}</p>
                  {m.description && <p className="text-xs text-ink-400 mt-0.5">{m.description}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>

      <footer className="border-t border-line px-5 sm:px-8 py-6 text-center">
        <p className="text-xs text-ink-400 flex items-center justify-center gap-1.5">
          <MapPin size={12} /> {athlete.club} · verified record, maintained by the club
        </p>
        <p className="text-[11px] text-ink-200 mt-1">
          Published from PlayerArc. Contact details are never shown on a showcase profile.
        </p>
      </footer>
    </div>
  );
}
