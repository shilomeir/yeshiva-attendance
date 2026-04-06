import { GRADE_LEVELS } from '@/lib/constants/grades'

/** Maps grade names to their single-character password letter */
const GRADE_TO_LETTER: Record<string, string> = {
  "שיעור א'": 'a',
  "שיעור ב'": 'b',
  "שיעור ג'": 'c',
  "שיעור ד'": 'd',
  'אברכים':  'e',
  'בוגרצים': 'f',
}

export interface ClassSupervisorInfo {
  classId: string
  gradeName: string
}

/**
 * Given the suffix after the admin PIN, returns the corresponding class info.
 * Suffix format: gradeLetter + classNumber  (e.g. "a3" → שיעור א' כיתה 3)
 * Single-class grades accept just the letter or letter+"1" (e.g. "d" or "d1").
 */
export function parseClassSupervisorSuffix(suffix: string): ClassSupervisorInfo | null {
  if (!suffix) return null

  const letter = suffix[0].toLowerCase()
  const numStr = suffix.slice(1)

  // Find grade by letter
  const gradeName = Object.entries(GRADE_TO_LETTER).find(([, l]) => l === letter)?.[0]
  if (!gradeName) return null

  const level = GRADE_LEVELS.find((g) => g.name === gradeName)
  if (!level) return null

  if (level.classCount === 1) {
    // Single-class grade: accept empty suffix or "1"
    if (numStr === '' || numStr === '1') {
      return { gradeName, classId: gradeName }
    }
    return null
  }

  const classNum = parseInt(numStr, 10)
  if (!classNum || classNum < 1 || classNum > level.classCount) return null

  return {
    gradeName,
    classId: `${gradeName} כיתה ${classNum}`,
  }
}

/** Returns the supervisor password for a given classId and adminPin */
export function buildSupervisorPin(adminPin: string, classId: string): string {
  for (const level of GRADE_LEVELS) {
    const letter = GRADE_TO_LETTER[level.name]
    if (!letter) continue
    if (level.classCount === 1) {
      if (classId === level.name) return `${adminPin}${letter}1`
    } else {
      const match = classId.match(/כיתה (\d+)$/)
      if (match && classId.startsWith(level.name)) {
        return `${adminPin}${letter}${match[1]}`
      }
    }
  }
  return ''
}
