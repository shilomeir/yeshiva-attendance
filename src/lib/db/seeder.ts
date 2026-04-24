import { v4 as uuidv4 } from 'uuid'
import { db } from './schema'
import { GRADE_LEVELS, getClasses, DEFAULT_CLASS } from '@/lib/constants/grades'
import type {
  Student,
  Event,
  StudentStatus,
  EventType,
} from '@/types'

const FIRST_NAMES = [
  'אברהם', 'יצחק', 'יעקב', 'משה', 'אהרן', 'דוד', 'שלמה', 'יוסף', 'בנימין', 'לוי',
  'יהודה', 'שמעון', 'ראובן', 'דן', 'נפתלי', 'גד', 'אשר', 'זבולון', 'יששכר', 'מנשה',
  'אפרים', 'אלחנן', 'פינחס', 'עזרא', 'נחמיה', 'חנניה', 'מישאל', 'עזריה', 'דניאל', 'ירמיה',
  'ישעיה', 'יחזקאל', 'עמוס', 'הושע', 'מיכה', 'נחום', 'חבקוק', 'צפניה', 'חגי', 'זכריה',
  'מלאכי', 'עובדיה', 'יואל', 'יונה', 'מרדכי', 'עקיבא', 'שמריה', 'אליהו', 'אלישע', 'גדליה',
  'ברוך', 'חנוך', 'מתתיהו', 'שמואל', 'שאול', 'יהונתן', 'עמינדב', 'נחשון', 'אליצור', 'שלומיאל',
  'אלידד', 'חמואל', 'גמליאל', 'אביהוד', 'אחיעזר', 'פגעיאל', 'אחירע', 'אביעזר', 'רון', 'ניר',
  'גל', 'תום', 'עידן', 'איתי', 'בר', 'שי', 'עמית', 'אור', 'לירון', 'אוהד',
  'אייל', 'גיל', 'הראל', 'זיו', 'טל', 'יובל', 'כפיר', 'מאור', 'נדב', 'עוז',
  'פלג', 'צור', 'תמיר', 'אדיר', 'בועז', 'גדעון', 'חיים', 'טוביה', 'ירון', 'כרמי',
]

const LAST_NAMES = [
  'כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'דהן', 'אברהם', 'פרידמן', 'שפירא', 'רוזנברג',
  'גולדברג', 'שטיין', 'קץ', 'בלום', 'וייס', 'שוורץ', 'גרין', 'גולד', 'זילבר', 'רוט',
  'גרוס', 'קליין', 'הורוביץ', 'ברגר', 'וינר', 'לנדאו', 'כץ', 'פישר', 'גבאי', 'חסיד',
  'בן דוד', 'בן חיים', 'בן יוסף', 'בן משה', 'בן אהרן', 'בן ציון', 'בן שלמה', 'בן עמי', 'אלון', 'שלום',
  'ממן', 'סבג', 'מוסא', 'פנחסי', 'חיון', 'בוסקילה', 'אוחיון', 'עמר', 'חדד', 'לביא',
  'שמחי', 'ברברה', 'אזולאי', 'בן שושן', 'אבוטבול', 'אביב', 'שטרית', 'אלמוג', 'שלוסברג', 'ניסים',
  'גבריאל', 'גל', 'גלעד', 'חן', 'טוב', 'ים', 'כנען', 'מגן', 'נחל', 'עברי',
  'צבי', 'קדמי', 'רז', 'שחר', 'תמר', 'אלי', 'בר', 'גוט', 'דר', 'הגר',
  'ויס', 'זהב', 'חי', 'ירון', 'כרמי', 'מור', 'נעם', 'סיני', 'ענבל', 'פז',
  'צמח', 'קם', 'רענן', 'שגיא', 'אגם', 'בצלאל', 'גבור', 'דן', 'הראל', 'זמיר',
]

const ABSENCE_REASONS = [
  'נסיעה הביתה לסוף שבוע',
  'ביקור משפחה',
  'טיפול רפואי',
  'אירוע משפחתי',
  'אחר',
]

/**
 * Weighted status distribution:
 *  ~75% ON_CAMPUS · ~25% OFF_CAMPUS
 */
function weightedStatus(): StudentStatus {
  return Math.random() < 0.75 ? 'ON_CAMPUS' : 'OFF_CAMPUS'
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomPhone(): string {
  const prefixes = ['050', '052', '053', '054', '055', '058']
  const prefix = randomItem(prefixes)
  const number = Math.floor(Math.random() * 9000000) + 1000000
  return `${prefix}-${number}`
}

function randomIdNumber(): string {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
  return digits.join('')
}

function randomDateInPast(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - Math.floor(Math.random() * days))
  date.setHours(Math.floor(Math.random() * 12) + 6, Math.floor(Math.random() * 60))
  return date.toISOString()
}


function generateEvents(studentId: string, count: number): Event[] {
  const events: Event[] = []
  const now = new Date()

  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(Math.random() * 30)
    const date = new Date(now)
    date.setDate(date.getDate() - daysAgo)
    date.setHours(Math.floor(Math.random() * 12) + 6, Math.floor(Math.random() * 60))

    const isCheckOut = Math.random() > 0.4
    const type: EventType = isCheckOut ? 'CHECK_OUT' : 'CHECK_IN'

    const event: Event = {
      id: uuidv4(),
      studentId,
      type,
      timestamp: date.toISOString(),
      reason: null,
      expectedReturn: isCheckOut
        ? new Date(date.getTime() + (1 + Math.floor(Math.random() * 4)) * 3600000).toISOString()
        : null,
      gpsLat: 31.5253 + (Math.random() - 0.5) * 0.01,
      gpsLng: 35.1056 + (Math.random() - 0.5) * 0.01,
      gpsStatus: 'GRANTED',
      distanceFromCampus: Math.floor(Math.random() * 500),
      note: null,
      syncedAt: Math.random() > 0.2 ? date.toISOString() : null,
      departure_id: null,
    }
    events.push(event)
  }

  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

// Absence requests are no longer seeded locally — departures live in Supabase only.

/**
 * Build a flat list of (grade, classId, capacity) slots for all 16 classes.
 * שיעור א': 6×25=150  שיעור ב': 4×25=100  שיעור ג': 3×25=75
 * שיעור ד': 1×25=25   אברכים: 1×50=50    בוגרצים: 1×50=50   = 450 total
 */
function buildClassSlots(): { grade: string; classId: string; count: number }[] {
  return GRADE_LEVELS.flatMap((level) =>
    getClasses(level.name).map((classId) => ({
      grade: level.name,
      classId,
      count: level.capacity,
    }))
  )
}

export async function seedDatabase(): Promise<void> {
  const existingCount = await db.students.count()

  if (existingCount > 0) {
    const nonDefaultCount = await db.students.where('classId').notEqual(DEFAULT_CLASS).count()
    if (nonDefaultCount > 0) return // already seeded with distributed classes
    // All in DEFAULT_CLASS → stale seed → re-seed
    await db.students.clear()
    await db.events.clear()
  }

  const students: Student[] = []
  const allEvents: Event[] = []

  const slots = buildClassSlots() // 16 slots, total 450

  for (const slot of slots) {
    for (let i = 0; i < slot.count; i++) {
      const firstName = randomItem(FIRST_NAMES)
      const lastName = randomItem(LAST_NAMES)
      const status = weightedStatus()
      const studentId = uuidv4()

      const student: Student = {
        id: studentId,
        fullName: `${firstName} ${lastName}`,
        idNumber: randomIdNumber(),
        phone: randomPhone(),
        deviceToken: Math.random() > 0.1 ? uuidv4() : null,
        currentStatus: status,
        lastSeen: status !== 'ON_CAMPUS' ? randomDateInPast(3) : randomDateInPast(1),
        lastLocation:
          Math.random() > 0.3
            ? {
                lat: 31.5253 + (Math.random() - 0.5) * 0.02,
                lng: 35.1056 + (Math.random() - 0.5) * 0.02,
              }
            : null,
        push_token: null,
        pendingApproval: Math.random() < 0.05,
        createdAt: randomDateInPast(365),
        grade: slot.grade,
        classId: slot.classId,
      }

      students.push(student)

      const eventCount = Math.floor(Math.random() * 15) + 2
      allEvents.push(...generateEvents(studentId, eventCount))
    }
  }

  const BATCH_SIZE = 50
  for (let i = 0; i < students.length; i += BATCH_SIZE) {
    await db.students.bulkPut(students.slice(i, i + BATCH_SIZE))
  }
  for (let i = 0; i < allEvents.length; i += BATCH_SIZE) {
    await db.events.bulkPut(allEvents.slice(i, i + BATCH_SIZE))
  }

  const onCampus  = students.filter(s => s.currentStatus === 'ON_CAMPUS').length
  const offCampus = students.filter(s => s.currentStatus === 'OFF_CAMPUS').length

  console.log(
    `Seeded ${students.length} students ` +
    `(${onCampus} ON_CAMPUS · ${offCampus} OFF_CAMPUS) ` +
    `across 16 classes, ${allEvents.length} events`
  )
}
