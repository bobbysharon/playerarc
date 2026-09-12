'use strict';
/**
 * Roles, permissions and data scope.
 *
 * Two separate questions are answered here:
 *   1. CAN this role perform this action at all?      -> PERMISSIONS
 *   2. WHICH records may this user touch?             -> scope helpers
 *
 * Both are enforced in the API. The web app uses the same matrix to hide
 * controls, but hiding a button is a courtesy, not a security boundary.
 */

const ROLES = [
  { key: 'super_admin', name: 'Super Admin', rank: 1, description: 'Full system access including users, settings and audit.' },
  { key: 'sports_director', name: 'Sports Director', rank: 2, description: 'All sports, players, teams, competitions and performance data.' },
  { key: 'sport_admin', name: 'Sport Administrator', rank: 3, description: 'Full access limited to assigned sports.' },
  { key: 'coach', name: 'Coach', rank: 4, description: 'Assigned teams and players: training, attendance, assessments, notes.' },
  { key: 'statistician', name: 'Statistician', rank: 5, description: 'Match records and performance statistics.' },
  { key: 'player', name: 'Player', rank: 6, description: 'Own approved record only.' },
  { key: 'guardian', name: 'Parent / Guardian', rank: 7, description: 'Approved records of linked children.' },
  { key: 'public', name: 'Public', rank: 8, description: 'Public player information only.' },
];

/**
 * Permission keys used across the API.
 * `*` grants everything and is reserved for super_admin.
 */
const PERMISSIONS = {
  super_admin: ['*'],
  sports_director: [
    'players.read', 'players.write', 'players.read_sensitive', 'players.delete',
    'sports.read', 'sports.write',
    'teams.read', 'teams.write',
    'coaches.read', 'coaches.write',
    'seasons.read', 'seasons.write',
    'tournaments.read', 'tournaments.write',
    'matches.read', 'matches.write',
    'performances.read', 'performances.write',
    'training.read', 'training.write',
    'assessments.read', 'assessments.write',
    'achievements.read', 'achievements.write',
    'media.read', 'media.write', 'media.approve',
    'documents.read', 'documents.write',
    'reports.read', 'reports.export',
    'rankings.read', 'analytics.read',
    'benchmarks.read', 'benchmarks.write',
    'drills.read', 'drills.write',
    'groups.read', 'groups.write',
    'messages.read', 'messages.write',
    'audit.read',
  ],
  sport_admin: [
    'players.read', 'players.write', 'players.read_sensitive',
    'sports.read',
    'teams.read', 'teams.write',
    'coaches.read', 'coaches.write',
    'seasons.read',
    'tournaments.read', 'tournaments.write',
    'matches.read', 'matches.write',
    'performances.read', 'performances.write',
    'training.read', 'training.write',
    'assessments.read', 'assessments.write',
    'achievements.read', 'achievements.write',
    'media.read', 'media.write', 'media.approve',
    'documents.read',
    'reports.read', 'reports.export',
    'rankings.read', 'analytics.read',
    'benchmarks.read', 'benchmarks.write',
    'drills.read', 'drills.write',
    'groups.read', 'groups.write',
    'messages.read', 'messages.write',
  ],
  coach: [
    'players.read',
    'sports.read', 'teams.read', 'coaches.read', 'seasons.read',
    'tournaments.read', 'matches.read', 'performances.read',
    'training.read', 'training.write',
    'assessments.read', 'assessments.write',
    'achievements.read', 'achievements.write',
    'media.read', 'media.write',
    'reports.read',
    'rankings.read', 'analytics.read',
    'benchmarks.read',
    'drills.read', 'drills.write',
    'groups.read', 'groups.write',
    'messages.read', 'messages.write',
  ],
  statistician: [
    'players.read',
    'sports.read', 'teams.read', 'coaches.read', 'seasons.read',
    'tournaments.read', 'tournaments.write',
    'matches.read', 'matches.write',
    'performances.read', 'performances.write',
    'achievements.read', 'achievements.write',
    'training.read',
    'assessments.read',
    'media.read',
    'reports.read', 'reports.export',
    'rankings.read', 'analytics.read',
    'benchmarks.read',
  ],
  player: ['self.read', 'sports.read', 'rankings.read', 'messages.read'],
  guardian: ['self.read', 'sports.read', 'messages.read'],
  public: ['public.read'],
};

function permissionsFor(roleKey) {
  return PERMISSIONS[roleKey] || [];
}

/**
 * The Super Admin account is for platform administration — users, roles,
 * settings, audit — not day-to-day athlete record-keeping. It deliberately
 * cannot log training sessions, assessments or achievements/awards (it can
 * still read/view them); that work belongs to coaches and sport admins.
 */
const SUPER_ADMIN_DENIED = ['training.write', 'assessments.write', 'achievements.write'];

function can(user, permission) {
  if (!user) return false;
  const list = permissionsFor(user.role);
  if (list.includes('*')) {
    if (user.role === 'super_admin' && SUPER_ADMIN_DENIED.includes(permission)) return false;
    return true;
  }
  return list.includes(permission);
}

/** Roles that see every player record regardless of sport or team. */
const GLOBAL_ROLES = new Set(['super_admin', 'sports_director', 'statistician']);

/** Roles restricted to their own or their children's records. */
const SELF_ROLES = new Set(['player', 'guardian']);

/** Fields that are hidden unless the viewer holds players.read_sensitive. */
const SENSITIVE_PLAYER_FIELDS = [
  'phone', 'email', 'address', 'city', 'country',
  'emergency_name', 'emergency_phone', 'emergency_relation',
  'guardian_name', 'guardian_phone', 'guardian_email',
  'blood_group', 'notes',
];

/**
 * Strip restricted fields from a player row for the given viewer.
 * A player and their guardian always see the player's own contact details.
 */
function redactPlayer(player, user) {
  if (!player) return player;
  if (!user) {
    const publicOnly = {
      id: player.id, athlete_id: player.athlete_id, display_name: player.display_name,
      first_name: player.first_name, last_name: player.last_name, photo_url: player.photo_url,
      nationality: player.nationality, status: player.status, visibility: player.visibility,
    };
    return player.visibility === 'public' ? publicOnly : null;
  }
  if (can(user, 'players.read_sensitive')) return player;
  if (SELF_ROLES.has(user.role) && (user.linkedPlayerIds || []).includes(player.id)) return player;
  const copy = { ...player };
  for (const f of SENSITIVE_PLAYER_FIELDS) delete copy[f];
  copy._redacted = true;
  return copy;
}

module.exports = {
  ROLES,
  PERMISSIONS,
  permissionsFor,
  can,
  GLOBAL_ROLES,
  SELF_ROLES,
  SENSITIVE_PLAYER_FIELDS,
  redactPlayer,
};
