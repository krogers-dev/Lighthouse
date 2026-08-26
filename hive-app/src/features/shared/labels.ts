/** Client-facing wording and formatting, in one place.
 *
 * Relationship language is Stacie's to own (WO-002 D4). Everything here is
 * plain, non-committal placeholder wording chosen so the screens are
 * readable and testable now; it is expected to be replaced wholesale
 * without touching a screen, a query, or a migration. That is exactly why
 * activity is stored as enumerated kinds rather than sentences: changing
 * the words below changes the app, and nothing else.
 */
import type {
  ActivityActorRole,
  ActivityEventKind,
  RequestStatus,
} from '@/data/supabase/repositories';
import type { MembershipRole } from '@/tenancy/types';
import type { StatusKind } from '@/ui/primitives/StatusBadge';

export const OWNER_LABEL: Record<MembershipRole, string> = {
  client_user: 'You',
  intake: 'Honeybee intake',
  preparer: 'Your preparer',
  reviewer: 'Reviewer',
  approver: 'Approver',
};

/** Activity never names a person, only the acting role (threat T3). */
export const ACTOR_LABEL: Record<ActivityActorRole, string> = {
  ...OWNER_LABEL,
  system: 'HIVE',
};

export const REQUEST_STATUS_PRESENTATION: Record<
  RequestStatus,
  { kind: StatusKind; label: string }
> = {
  OPEN: { kind: 'attention', label: 'Needs a response' },
  ANSWERED: { kind: 'neutral', label: 'Answered' },
  CLOSED: { kind: 'stable', label: 'Closed' },
  EXPIRED: { kind: 'blocked', label: 'Expired' },
};

export const ACTIVITY_KIND_LABEL: Record<ActivityEventKind, string> = {
  'case.status_changed': 'Status changed',
  'request.opened': 'Request opened',
  'request.answered': 'Request answered',
  'request.closed': 'Request closed',
  'request.expired': 'Request expired',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Format a server `date` column (YYYY-MM-DD).
 *
 * Parsed by parts rather than through Date: `new Date('2026-08-10')` is
 * parsed as UTC midnight and then rendered in the device's zone, which
 * shows the previous day west of Greenwich. A date the server recorded
 * must not shift because of where the phone is. */
export function formatServerDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return value;
  return `${monthName} ${Number(day)}, ${year}`;
}

/** Format a server timestamptz for display, to the day.
 *
 * Milestone 1 shows the date only. A time-of-day rendered in the device's
 * zone invites "that is not when it happened" from a client in another
 * zone, and nothing in this read surface needs the hour. */
export function formatServerTimestamp(value: string): string {
  return formatServerDate(value);
}

/** The truthful staleness line (R7 / threat T4).
 *
 * States what the information is recorded THROUGH — the newest server
 * timestamp actually present — never a device-clock reading dressed up as
 * "as of". Returns null when there is nothing to be current about, so the
 * caller renders no claim at all. */
export function recordedThroughLabel(recordedThrough: string | null): string | null {
  if (!recordedThrough) return null;
  return `Recorded through ${formatServerTimestamp(recordedThrough)}`;
}
