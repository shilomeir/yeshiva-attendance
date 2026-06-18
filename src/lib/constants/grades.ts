/** Grade-level and class structure for Yeshivat Shavi Hevron.
 *  Names match the actual `grade` and `classId` column values in the DB exactly. */

export const GRADE_LEVELS = [
  { name: 'שיעור א' as const,      capacity: 25 },
  { name: 'שיעור ב' as const,      capacity: 25 },
  { name: 'שיעור ג' as const,      capacity: 25 },
  { name: 'שיעור ד-ה' as const,    capacity: 25 },
  { name: 'אברכים ובוגרצ' as const, capacity: 50 },
] as const

export type GradeName = (typeof GRADE_LEVELS)[number]['name']

export const ALL_GRADE_NAMES: string[] = GRADE_LEVELS.map((g) => g.name)

/** Exact class IDs per grade — match DB classId column values verbatim. */
export const GRADE_CLASS_MAP: Record<string, string[]> = {
  'שיעור א': [
    'כיתה הרב אבישי',
    'כיתה הרב בועז',
    'כיתה הרב הלל',
    'כיתה הרב יעקב',
    'כיתה הרב משה',
    'כיתה הרב תמיר',
  ],
  'שיעור ב': [
    'כיתה הרב אהרלה',
    'כיתה הרב דוד לנדאו',
    'כיתה הרב דודו',
    'כיתה הרב מוטי',
  ],
  'שיעור ג': [
    'כיתה הרב בועז רויטל',
    'כיתה הרב חגי',
    'כיתה הרב רפי',
  ],
  'שיעור ד-ה': [
    'כיתה שיעור ד',
    'כיתה שיעור ה',
  ],
  'אברכים ובוגרצ': [
    'כיתה אברכים ובוגרצ',
  ],
}

/** All classId values across the entire yeshiva (16 total) */
export const ALL_CLASS_IDS: string[] = Object.values(GRADE_CLASS_MAP).flat()

/** Default grade/class for students without an assignment */
export const DEFAULT_GRADE = 'שיעור א'
export const DEFAULT_CLASS = 'כיתה הרב אבישי'

/**
 * Returns all classId values for a given grade.
 * Use GRADE_CLASS_MAP[gradeName] directly when possible.
 */
export function getClasses(gradeName: string): string[] {
  return GRADE_CLASS_MAP[gradeName] ?? []
}

/**
 * Strips the leading "כיתה " prefix from a classId for display.
 * classId values are stored as e.g. "כיתה הרב אבישי" → returns "הרב אבישי".
 * Single source of truth for class-label trimming (used by admin + supervisor UI).
 */
export function classLabel(classId: string | null | undefined): string {
  return (classId ?? '').replace(/^כיתה\s+/, '')
}
