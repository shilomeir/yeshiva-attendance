import { describe, expect, it } from 'vitest'
import { getStudentHelpSections } from '../studentHelpContent'

describe('student help content', () => {
  it('covers every main student dashboard area with simple expandable sections', () => {
    const sections = getStudentHelpSections()
    const titles = sections.map((section) => section.title)

    expect(titles).toEqual([
      'דף הבית',
      'יציאה וחזרה',
      'בקשות יציאה',
      'מכסה',
      'בקשה חריגה',
      'סטטוס בקשה',
      'היסטוריה',
    ])

    for (const section of sections) {
      expect(section.items.length).toBeGreaterThanOrEqual(2)
      expect(section.items.join(' ')).not.toMatch(/API|DB|Supabase|סטייט|טכני/i)
    }
  })

  it('keeps the help text explanatory instead of sending students elsewhere', () => {
    const allText = getStudentHelpSections()
      .flatMap((section) => [section.title, ...section.items])
      .join(' ')

    expect(allText).not.toContain('מעבר לבקשות')
  })
})
