import { describe, expect, it } from 'vitest'
import { calcQuota } from '@/domain/quota'

// Quota formula is the single source of truth shared by the client and the
// submit_departure RPC: GREATEST(1, FLOOR(classSize * 0.135)).
// NOTE: these expectations are derived from the FORMULA (the real contract),
// which is authoritative. The illustrative table in CLAUDE.md §5 is slightly
// off at the n=22 boundary (it lists 22→3, but FLOOR(22*0.135)=FLOOR(2.97)=2).
describe('calcQuota', () => {
  it('never returns less than 1, even for tiny or empty classes', () => {
    expect(calcQuota(0)).toBe(1)
    expect(calcQuota(1)).toBe(1)
    expect(calcQuota(7)).toBe(1)
    expect(calcQuota(8)).toBe(1)
  })

  it('matches FLOOR(classSize * 0.135) at each breakpoint', () => {
    // → 1 for 9–14
    expect(calcQuota(9)).toBe(1)
    expect(calcQuota(14)).toBe(1)
    // → 2 for 15–22  (22*0.135 = 2.97 → 2)
    expect(calcQuota(15)).toBe(2)
    expect(calcQuota(22)).toBe(2)
    // → 3 for 23–29
    expect(calcQuota(23)).toBe(3)
    expect(calcQuota(29)).toBe(3)
    // → 4 for 30–37
    expect(calcQuota(30)).toBe(4)
    expect(calcQuota(37)).toBe(4)
    // → 5 for 38–44
    expect(calcQuota(38)).toBe(5)
    expect(calcQuota(44)).toBe(5)
    // → 6 for 45–51
    expect(calcQuota(45)).toBe(6)
    expect(calcQuota(51)).toBe(6)
  })

  it('computes the אברכים ובוגרצ class of 85 → 11', () => {
    expect(calcQuota(85)).toBe(11)
  })

  it('stays consistent with a direct re-implementation of the formula', () => {
    for (let n = 0; n <= 120; n++) {
      expect(calcQuota(n)).toBe(Math.max(1, Math.floor(n * 0.135)))
    }
  })
})
