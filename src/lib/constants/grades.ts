/** Grade-level and class structure for Yeshivat Shavi Hevron */

export const GRADE_LEVELS = [
  { name: "שיעור א'", classCount: 6, capacity: 25 },
  { name: "שיעור ב'", classCount: 4, capacity: 25 },
  { name: "שיעור ג'", classCount: 3, capacity: 25 },
  { name: "שיעור ד'", classCount: 1, capacity: 25 },
  { name: 'אברכים',   classCount: 1, capacity: 50 },
  { name: 'בוגרצים',  classCount: 1, capacity: 50 },
] as const

export type GradeName = (typeof GRADE_LEVELS)[number]['name']

export const ALL_GRADE_NAMES: string[] = GRADE_LEVELS.map((g) => g.name)

/**
 * Returns all classId values for a given grade.
 * For single-class grades the classId equals the grade name.
 */
export function getClasses(gradeName: string): string[] {
  const level = GRADE_LEVELS.find((g) => g.name === gradeName)
  if (!level) return []
  if (level.classCount === 1) return [gradeName]
  return Array.from({ length: level.classCount }, (_, i) => `${gradeName} כיתה ${i + 1}`)
}

/** All classId values across the entire yeshiva (16 total) */
export const ALL_CLASS_IDS: string[] = GRADE_LEVELS.flatMap((g) => getClasses(g.name))

/** Default grade/class for students without an assignment */
export const DEFAULT_GRADE = "שיעור א'"
export const DEFAULT_CLASS = "שיעור א' כיתה 1"

/**
 * Canonical tab names from the Google Sheet ("DATA תלמידים ביקורות שבי חברון").
 * Each tab maps 1:1 to a grade name in the DB.
 * Used by the sync-from-sheets Edge Function and the GAS script.
 */
export const SHEET_GRADE_NAMES = [
  "שיעור א'",
  "שיעור ב'",
  "שיעור ג'",
  "שיעור ד'-ה'",
  "אברכים ובוגרצ'",
] as const

export type SheetGradeName = (typeof SHEET_GRADE_NAMES)[number]
