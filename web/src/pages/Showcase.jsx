import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Spinner, ErrorNote, Avatar } from '../components/ui';
import { formatDate, titleCase } from '../lib/format';

export default function Showcase() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/showcase/${token}`).then(setData).catch(setError);
  }, [token]);

  return (
    <div className="min-h-screen bg-surface text-ink px-4 py-10 sm:py-16">
      <div className="max-w-3xl mx-auto">
        <p className="text-center text-xs uppercase tracking-widest text-gold mb-8">Player showcase · Cricket</p>

        {!data && !error && <Spinner label="Loading profile" />}
        {error && (
          <div className="card p-6">
            <ErrorNote error={error} />
            <p className="text-sm text-ink-400 mt-2">This link may have expired, or the player has made their showcase private.</p>
          </div>
        )}

        {data && (
          <>
            <div className="card p-6 sm:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
              <Avatar player={{ display_name: data.player.display_name, photo_url: data.player.photo_url }} size={72} />
              <div>
                <h1 className="font-display text-2xl">{data.player.display_name}</h1>
                <p className="text-ink-400 text-sm mt-1">
                  {data.position?.role ? titleCase(data.position.role) : 'Cricketer'}
                  {data.position?.team ? ` · ${data.position.team}` : ''}
                  {data.position?.ageGroup ? ` · ${data.position.ageGroup}` : ''}
                </p>
                {data.player.bio && <p className="text-sm text-ink-300 mt-3 max-w-xl">{data.player.bio}</p>}
              </div>
            </div>

            {data.career?.matchesPlayed > 0 ? (
              <div className="card p-6 sm:p-8 mt-5">
                <h2 className="font-display text-lg mb-1">Career statistics</h2>
                <p className="text-xs text-ink-400 mb-4">{data.career.matchesPlayed} recorded appearances</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line rounded-lg overflow-hidden border border-line">
                  {data.career.headline.map((h) => (
                    <div key={h.key} className="bg-surface px-3 py-3">
                      <p className="text-[10px] uppercase tracking-wide text-ink-400 truncate">{h.label}</p>
                      <p className="stat-value text-xl mt-0.5">{h.display}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card p-6 sm:p-8 mt-5 text-sm text-ink-400">No match statistics recorded yet.</div>
            )}

            {data.achievements?.length > 0 && (
              <div className="card p-6 sm:p-8 mt-5">
                <h2 className="font-display text-lg mb-4">Achievements</h2>
                <ul className="space-y-2">
                  {data.achievements.map((a, i) => (
                    <li key={i} className="flex items-center justify-between text-sm border-b border-line/60 pb-2 last:border-0">
                      <span>{a.title}</span>
                      <span className="text-ink-400 text-xs">{formatDate(a.awarded_date)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.assessmentSummary?.length > 0 && (
              <div className="card p-6 sm:p-8 mt-5">
                <h2 className="font-display text-lg mb-4">Recent assessments</h2>
                <ul className="space-y-2">
                  {data.assessmentSummary.map((a, i) => (
                    <li key={i} className="flex items-center justify-between text-sm border-b border-line/60 pb-2 last:border-0">
                      <span>{formatDate(a.assessment_date)} · {titleCase(a.cycle || '')}</span>
                      <span className="text-ink-400 text-xs">{a.overall_score != null ? `${a.overall_score}/100` : a.recommendation || '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-center text-xs text-ink-400 mt-8">Shared via PlayerArc · no video or contact details are included on this page</p>
          </>
        )}
      </div>
    </div>
  );
}
