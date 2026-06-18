import { describe, expect, it } from 'vitest'
import { classLabel, getClasses, ALL_CLASS_IDS } from '@/lib/constants/grades'

describe('classLabel', () => {
  it('strips the leading "כיתה " prefix for display', () => {
    expect(classLabel('כיתה הרב אבישי')).toBe('הרב אבישי')
    expect(classLabel('כיתה אברכים ובוגרצ')).toBe('אברכים ובוגרצ')
    expect(classLabel('כיתה שיעור ד')).toBe('שיעור ד')
  })

  it('handles null/undefined/empty safely', () => {
    expect(classLabel(null)).toBe('')
    expect(classLabel(undefined)).toBe('')
    expect(classLabel('')).toBe('')
  })

  it('leaves a value without the prefix unchanged', () => {
    expect(classLabel('הרב אבישי')).toBe('הרב אבישי')
  })

  it('produces a non-empty label for every real classId', () => {
    for (const id of ALL_CLASS_IDS) {
      const label = classLabel(id)
      expect(label.length).toBeGreaterThan(0)
      expect(label.startsWith('כיתה ')).toBe(false)
    }
  })
})

describe('getClasses', () => {
  it('returns the class list for a known grade and [] for unknown', () => {
    expect(getClasses('שיעור ד-ה')).toEqual(['כיתה שיעור ד', 'כיתה שיעור ה'])
    expect(getClasses('does-not-exist')).toEqual([])
  })
})
