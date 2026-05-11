import type { DepartureStatus } from '@/types'

/** Terminal states — no further transitions are possible. */
export const TERMINAL_STATUSES = new Set<DepartureStatus>(['COMPLETED', 'REJECTED', 'CANCELLED'])

/** States visible in calendar and dashboard views (matches v_calendar_departures). */
export const VISIBLE_STATUSES = new Set<DepartureStatus>(['PENDING', 'APPROVED', 'ACTIVE', 'COMPLETED'])

/** Returns true if the departure is in a non-terminal state. */
export function isLive(status: DepartureStatus): boolean {
  return !TERMINAL_STATUSES.has(status)
}

/** Allowed transitions in the state machine. */
const TRANSITIONS: Record<DepartureStatus, DepartureStatus[]> = {
  PENDING:   ['APPROVED', 'ACTIVE', 'REJECTED', 'CANCELLED'],
  APPROVED:  ['ACTIVE', 'CANCELLED'],
  ACTIVE:    ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  REJECTED:  [],
  CANCELLED: [],
}

export function canTransition(from: DepartureStatus, to: DepartureStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}
