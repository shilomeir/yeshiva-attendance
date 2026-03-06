import { v4 as uuidv4 } from 'uuid'
import { db } from './schema'
import { GRADE_LEVELS, getClasses, DEFAULT_CLASS } from '@/lib/constants/grades'
import type {
  Student,
  Event,
  StudentStatus,
  EventType,
  AbsenceRequest,
  AbsenceRequestStatus,
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
 *  ~75% ON_CAMPUS · ~20% OFF_CAMPUS · ~5% OVERDUE
 */
function weightedStatus(): StudentStatus {
  const r = Math.random()
  if (r < 0.75) return 'ON_CAMPUS'
  if (r < 0.95) return 'OFF_CAMPUS'
  return 'OVERDUE'
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

/** Returns a YYYY-MM-DD string for N days ago (0 = today). */
function dateStrDaysAgo(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - Math.max(0, daysAgo))
  return d.toISOString().slice(0, 10)
}

function padHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
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
    }
    events.push(event)
  }

  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

/**
 * Generate absence requests for a student based on their current status.
 *
 * OFF_CAMPUS  → ~68% APPROVED · ~17% PENDING (some urgent) · ~8% REJECTED · ~7% none
 * OVERDUE     → ~60% APPROVED (returned late) · ~40% none
 * ON_CAMPUS   → ~8% have an old APPROVED/REJECTED request (historical)
 */
function generateAbsenceRequests(
  studentId: string,
  status: StudentStatus,
): AbsenceRequest[] {
  let reqStatus: AbsenceRequestStatus | null = null
  let isUrgent = false

  if (status === 'OFF_CAMPUS') {
    const r = Math.random()
    if (r < 0.68) {
      reqStatus = 'APPROVED'
    } else if (r < 0.85) {
      reqStatus = 'PENDING'
      isUrgent = Math.random() < 0.30 // 30% of pending OFF_CAMPUS are urgent
    } else if (r < 0.93) {
      reqStatus = 'REJECTED'
    }
    // ~7%: no request at all
  } else if (status === 'OVERDUE') {
    if (Math.random() < 0.60) reqStatus = 'APPROVED'
  } else {
    // ON_CAMPUS: occasional historical request
    if (Math.random() < 0.08) {
      reqStatus = Math.random() < 0.65 ? 'APPROVED' : 'REJECTED'
    }
  }

  if (!reqStatus) return []

  // Start date: recent for active absence, older for historical ON_CAMPUS
  const startDaysAgo =
    status === 'ON_CAMPUS'
      ? Math.floor(Math.random() * 12) + 2
      : Math.floor(Math.random() * 3)

  const dateStr = dateStrDaysAgo(startDaysAgo)

  // Multi-day: ~30% chance — end date is 1-2 days after start
  let endDate: string | null = null
  if (Math.random() < 0.30) {
    const extraDays = Math.floor(Math.random() * 2) + 1
    const endDaysAgo = Math.max(0, startDaysAgo - extraDays)
    const candidate = dateStrDaysAgo(endDaysAgo)
    if (candidate > dateStr) endDate = candidate
  }

  const adminNote: string | null =
    reqStatus === 'REJECTED'
      ? randomItem(['הבקשה לא אושרה, אנא פנה למשגיח', 'נא לתאם מראש', null])
      : null

  const startHour = 7 + Math.floor(Math.random() * 4)   // 07–10
  const endHour   = 18 + Math.floor(Math.random() * 5)   // 18–22

  const createdAt = new Date()
  createdAt.setDate(createdAt.getDate() - startDaysAgo)
  createdAt.setHours(Math.max(0, createdAt.getHours() - Math.floor(Math.random() * 6) - 1))

  return [
    {
      id: uuidv4(),
      studentId,
      date: dateStr,
      endDate,
      reason: randomItem(ABSENCE_REASONS),
      startTime: padHour(startHour),
      endTime: padHour(endHour),
      status: reqStatus,
      adminNote,
      isUrgent,
      createdAt: createdAt.toISOString(),
    },
  ]
}

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
    // If all students are in DEFAULT_CLASS they came from the old DB migration — re-seed.
    const nonDefaultCount = await db.students.where('classId').notEqual(DEFAULT_CLASS).count()
    if (nonDefaultCount > 0) {
      // Students are distributed across classes.
      // The new seeder always seeds absence requests — if none exist this is an old seeder run.
      const requestCount = await db.absenceRequests.count()
      if (requestCount > 0) return // new seeder already ran — skip
      // Zero absence requests → old seeder version (all ON_CAMPUS, no requests) — re-seed
    }

    // Clear stale data and re-seed
    await db.students.clear()
    await db.events.clear()
    await db.absenceRequests.clear()
  }

  const students: Student[] = []
  const allEvents: Event[] = []
  const allAbsenceRequests: AbsenceRequest[] = []

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
        pendingApproval: Math.random() < 0.05,
        createdAt: randomDateInPast(365),
        grade: slot.grade,
        classId: slot.classId,
      }

      students.push(student)

      const eventCount = Math.floor(Math.random() * 15) + 2
      allEvents.push(...generateEvents(studentId, eventCount))

      allAbsenceRequests.push(...generateAbsenceRequests(studentId, status))
    }
  }

  // Bulk insert in batches of 50
  const BATCH_SIZE = 50
  for (let i = 0; i < students.length; i += BATCH_SIZE) {
    await db.students.bulkPut(students.slice(i, i + BATCH_SIZE))
  }
  for (let i = 0; i < allEvents.length; i += BATCH_SIZE) {
    await db.events.bulkPut(allEvents.slice(i, i + BATCH_SIZE))
  }
  for (let i = 0; i < allAbsenceRequests.length; i += BATCH_SIZE) {
    await db.absenceRequests.bulkPut(allAbsenceRequests.slice(i, i + BATCH_SIZE))
  }

  const onCampus   = students.filter(s => s.currentStatus === 'ON_CAMPUS').length
  const offCampus  = students.filter(s => s.currentStatus === 'OFF_CAMPUS').length
  const overdue    = students.filter(s => s.currentStatus === 'OVERDUE').length
  const urgent     = allAbsenceRequests.filter(r => r.isUrgent).length
  const pending    = allAbsenceRequests.filter(r => r.status === 'PENDING').length

  console.log(
    `Seeded ${students.length} students ` +
    `(${onCampus} ON_CAMPUS · ${offCampus} OFF_CAMPUS · ${overdue} OVERDUE) ` +
    `across 16 classes, ${allEvents.length} events, ` +
    `${allAbsenceRequests.length} absence requests (${urgent} urgent · ${pending} pending)`
  )
}
