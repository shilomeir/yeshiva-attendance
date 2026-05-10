/**
 * Quota formula — canonical location.
 * MUST stay in sync with the submit_departure RPC:
 *   GREATEST(1, FLOOR(class_size * 0.135))
 */
export function calcQuota(classSize: number): number {
  return Math.max(1, Math.floor(classSize * 0.135))
}
