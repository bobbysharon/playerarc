export const STATUS_STYLES = {
  active: 'bg-pitch/10 text-pitch',
  inactive: 'bg-ink-200/20 text-ink-400',
  injured: 'bg-alert/10 text-alert',
  on_loan: 'bg-gold-soft text-gold-dark',
  suspended: 'bg-alert/10 text-alert',
  retired: 'bg-ink-200/20 text-ink-400',
  alumni: 'bg-ink-200/20 text-ink-600',
  trial: 'bg-gold-soft text-gold-dark',
  scheduled: 'bg-ink-200/20 text-ink-600',
  live: 'bg-alert/10 text-alert',
  completed: 'bg-pitch/10 text-pitch',
  upcoming: 'bg-gold-soft text-gold-dark',
  ongoing: 'bg-pitch/10 text-pitch',
  cancelled: 'bg-ink-200/20 text-ink-400',
  abandoned: 'bg-ink-200/20 text-ink-400',
  win: 'bg-pitch/10 text-pitch',
  loss: 'bg-alert/10 text-alert',
  draw: 'bg-ink-200/20 text-ink-600',
  tie: 'bg-ink-200/20 text-ink-600',
  present: 'bg-pitch/10 text-pitch',
  absent: 'bg-alert/10 text-alert',
  late: 'bg-gold-soft text-gold-dark',
  excused: 'bg-ink-200/20 text-ink-600',
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
