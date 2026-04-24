/** Dynamic quota formula — identical to the server-side RPC logic.
 *  GREATEST(1, ROUND((classSize * 3) / 25))
 *  This is the single source of truth for the client-side formula.
 */
export function calcQuota(classSize: number): number {
  return Math.max(1, Math.round((classSize * 3) / 25))
}
