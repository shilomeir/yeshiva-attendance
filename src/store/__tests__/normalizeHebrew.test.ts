import { describe, expect, it } from 'vitest'
import { normalizeHebrew } from '@/store/studentsStore'

// Grade/class comparisons must be apostrophe-insensitive (CLAUDE.md §3).
describe('normalizeHebrew', () => {
  it('treats all apostrophe variants as equal', () => {
    const ascii = normalizeHebrew("שיעור א'")
    const curly = normalizeHebrew('שיעור א’')
    const geresh = normalizeHebrew('שיעור א׳')
    expect(ascii).toBe(curly)
    expect(curly).toBe(geresh)
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeHebrew('  שיעור ב  ')).toBe('שיעור ב')
  })

  it('strips a trailing apostrophe so prefixed and bare forms match', () => {
    expect(normalizeHebrew("שיעור א'")).toBe(normalizeHebrew('שיעור א'))
  })

  it('leaves a plain grade name unchanged', () => {
    expect(normalizeHebrew('אברכים ובוגרצ')).toBe('אברכים ובוגרצ')
  })
})
