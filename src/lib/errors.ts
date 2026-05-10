type ErrorRecord = Record<string, unknown>

const NO_DETAILS = 'לא התקבל פירוט שגיאה מהשרת.'

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null
}

function stringifyValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function pickString(record: ErrorRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringifyValue(record[key])
    if (value?.trim()) return value.trim()
  }
  return null
}

function getKnownExplanation(code: string | null, message: string): string | null {
  const text = `${code ?? ''} ${message}`.toLowerCase()

  if (text.includes('failed to fetch') || text.includes('networkerror') || text.includes('load failed')) {
    return 'אין חיבור לשרת או שהרשת חסומה. בדוק חיבור לאינטרנט ונסה שוב.'
  }
  if (text.includes('23505') || text.includes('duplicate key') || text.includes('unique constraint')) {
    return 'כבר קיימת רשומה פעילה שמתנגשת עם הפעולה הזו.'
  }
  if (text.includes('duplicate_departure')) {
    return 'יש לך בקשת יציאה פעילה לאותה תקופה.'
  }
  if (text.includes('23503') || text.includes('foreign key')) {
    return 'הרשומה קשורה לנתון אחר שחסר או נמחק.'
  }
  if (text.includes('42501') || text.includes('permission denied') || text.includes('row-level security')) {
    return 'אין הרשאה לבצע את הפעולה הזו עבור המשתמש הנוכחי.'
  }
  if (text.includes('pgrst116') || text.includes('not found') || text.includes('not_found')) {
    return 'הרשומה המבוקשת לא נמצאה או שכבר עודכנה במקום אחר.'
  }
  if (text.includes('quota_full')) {
    return 'מכסת היציאות מלאה בזמן המבוקש.'
  }
  if (text.includes('already terminal')) {
    return 'הבקשה כבר נסגרה ולכן אי אפשר לעדכן אותה שוב.'
  }
  if (text.includes('overlap')) {
    return 'חלון הזמן מתנגש עם יציאה קיימת.'
  }

  return null
}

function buildMessage(action: string, code: string | null, message: string, details: string | null): string {
  const explanation = getKnownExplanation(code, message)
  const parts = [`${action}: ${explanation ?? message ?? NO_DETAILS}`]
  const rawParts = [code ? `קוד: ${code}` : null, message ? `מקור: ${message}` : null, details ? `פרטים: ${details}` : null]
    .filter(Boolean)
    .join(' · ')

  if (rawParts) parts.push(rawParts)
  return parts.join('\n')
}

export function getErrorMessage(error: unknown, action = 'הפעולה נכשלה'): string {
  if (error instanceof Error) {
    return buildMessage(action, error.name || null, error.message || NO_DETAILS, null)
  }

  if (typeof error === 'string') {
    return buildMessage(action, null, error.trim() || NO_DETAILS, null)
  }

  if (isRecord(error)) {
    const code = pickString(error, ['code', 'error', 'status', 'statusCode', 'name'])
    const message = pickString(error, ['message', 'error_description', 'details']) ?? code ?? NO_DETAILS
    const details = pickString(error, ['details', 'hint'])
    return buildMessage(action, code, message, details)
  }

  return buildMessage(action, null, NO_DETAILS, null)
}

export function getResultErrorMessage(result: unknown, action = 'הפעולה נכשלה'): string {
  if (!isRecord(result)) return getErrorMessage(result, action)

  const message = pickString(result, ['message', 'error']) ?? NO_DETAILS
  const code = pickString(result, ['error', 'code', 'status'])
  const details = pickString(result, ['details', 'hint'])
  return buildMessage(action, code, message, details)
}
