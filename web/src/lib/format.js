export const STATUS_STYLES = {
  // Positive / live
  active: 'bg-pitch/15 text-pitch border border-pitch/30',
  present: 'bg-pitch/15 text-pitch border border-pitch/30',
  completed: 'bg-pitch/15 text-pitch border border-pitch/30',
  ongoing: 'bg-pitch/15 text-pitch border border-pitch/30',
  win: 'bg-pitch/15 text-pitch border border-pitch/30',

  // Attention / pending
  trial: 'bg-gold/15 text-gold border border-gold/30',
  on_loan: 'bg-gold/15 text-gold border border-gold/30',
  upcoming: 'bg-gold/15 text-gold border border-gold/30',
  late: 'bg-gold/15 text-gold border border-gold/30',

  // Negative
  injured: 'bg-alert/15 text-alert border border-alert/30',
  suspended: 'bg-alert/15 text-alert border border-alert/30',
  absent: 'bg-alert/15 text-alert border border-alert/30',
  loss: 'bg-alert/15 text-alert border border-alert/30',

  // Live
  live: 'bg-fuchsia/15 text-fuchsia border border-fuchsia/30',

  // Neutral / informational
  scheduled: 'bg-sky/15 text-sky border border-sky/30',
  excused: 'bg-sky/15 text-sky border border-sky/30',
  draw: 'bg-violet/15 text-violet border border-violet/30',
  tie: 'bg-violet/15 text-violet border border-violet/30',
  alumni: 'bg-violet/15 text-violet border border-violet/30',

  // Dormant
  inactive: 'bg-white/5 text-ink-400 border border-line',
  retired: 'bg-white/5 text-ink-400 border border-line',
  cancelled: 'bg-white/5 text-ink-400 border border-line',
  abandoned: 'bg-white/5 text-ink-400 border border-line',
};

export const titleCase = (s) =>
  String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function formatDate(value, opts = {}) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...opts });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${formatDate(d)} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function ageFrom(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
}

export const playerName = (p) =>
  p?.display_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Unknown athlete';
