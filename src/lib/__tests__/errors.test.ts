import { describe, expect, it } from 'vitest'
import { getErrorMessage, getResultErrorMessage } from '@/lib/errors'

describe('user-facing error messages', () => {
  it('keeps the real Supabase/Postgres reason visible with a helpful Hebrew explanation', () => {
    const message = getErrorMessage(
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "departures_one_active_per_student"',
        details: 'Key (student_id)=(abc) already exists.',
      },
      'רישום היציאה נכשל',
    )

    expect(message).toContain('רישום היציאה נכשל')
    expect(message).toContain('כבר קיימת רשומה פעילה')
    expect(message).toContain('23505')
    expect(message).toContain('departures_one_active_per_student')
  })

  it('turns network failures into a specific explanation instead of a generic failure', () => {
    const message = getErrorMessage(new TypeError('Failed to fetch'), 'טעינת הנתונים נכשלה')

    expect(message).toContain('טעינת הנתונים נכשלה')
    expect(message).toContain('אין חיבור לשרת')
    expect(message).toContain('Failed to fetch')
  })

  it('uses RPC result message/error fields before falling back to generic text', () => {
    const message = getResultErrorMessage(
      { error: 'quota_window_overlap', message: 'חלון הזמן מתנגש עם יציאה קיימת' },
      'שליחת הבקשה נכשלה',
    )

    expect(message).toContain('שליחת הבקשה נכשלה')
    expect(message).toContain('חלון הזמן מתנגש עם יציאה קיימת')
    expect(message).toContain('quota_window_overlap')
  })
})
