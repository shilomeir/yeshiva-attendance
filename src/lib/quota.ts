/** Dynamic quota formula — identical to the server-side RPC logic.
 *  GREATEST(1, FLOOR(classSize * 0.135))
 *  This is the single source of truth for the client-side formula.
 */
export function calcQuota(classSize: number): number {
  return Math.max(1, Math.floor(classSize * 0.135))
}
