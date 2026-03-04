import { v4 as uuidv4 } from 'uuid'
import { db } from './schema'
import type { Student, Event, StudentStatus, EventType } from '@/types'

const FIRST_NAMES = [
  'אברהם', 'יצחק', 'יעקב', 'משה', 'אהרן', 'דוד', 'שלמה', 'יוסף', 'בנימין', 'לוי',
  'יהודה', 'שמעון', 'ראובן', 'דן', 'נפתלי', 'גד', 'אשר', 'זבולון', 'יששכר', 'מנשה',
  'אפרים', 'אלחנן', 'פינחס', 'עזרא', 'נחמיה', 'חנניה', 'מישאל', 'עזריה', 'דניאל', 'ירמיה',
  'ישעיה', 'יחזקאל', 'עמוס', 'הושע', 'מיכה', 'נחום', 'חבקוק', 'צפניה', 'חגי', 'זכריה',
  'מלאכי', 'עובדיה', 'יואל', 'יונה', 'מרדכי', 'עקיבא', 'שמריה', 'אליהו', 'אלישע', 'גדליה',
  'ברוך', 'חנוך', 'מתתיהו', 'שמואל', 'שאול', 'יהונתן', 'עמינדב', 'נחשון', 'אליצור', 'שלומיאל',
  'אלידד', 'חמואל', 'גמליאל', 'אביהוד', 'אחיעזר', 'פגעיאל', 'אחירע', 'נהשון', 'אביעזר', 'רון',
  'ניר', 'גל', 'תום', 'עידן', 'איתי', 'בר', 'שי', 'עמית', 'אור', 'לירון',
  'אוהד', 'אייל', 'גיל', 'הראל', 'זיו', 'טל', 'יובל', 'כפיר', 'מאור', 'נדב',
  'ספיר', 'עוז', 'פלג', 'צור', 'קרן', 'שקד', 'תמיר', 'אדיר', 'בועז', 'גדעון',
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
  'ויס', 'זהב', 'חי', 'טוביה', 'ירון', 'כרמי', 'מור', 'נעם', 'סיני', 'ענבל',
  'פז', 'צמח', 'קם', 'רענן', 'שגיא', 'תג', 'אגם', 'בצלאל', 'גבור', 'דן',
]

// All students default to ON_CAMPUS — they check out explicitly when leaving
const STATUSES: StudentStatus[] = ['ON_CAMPUS']

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
    }
    events.push(event)
  }

  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

export async function seedDatabase(): Promise<void> {
  const existingCount = await db.students.count()
  if (existingCount > 0) return

  const students: Student[] = []
  const allEvents: Event[] = []

  for (let i = 0; i < 400; i++) {
    const firstName = randomItem(FIRST_NAMES)
    const lastName = randomItem(LAST_NAMES)
    const status = randomItem(STATUSES)
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
    }

    students.push(student)

    const eventCount = Math.floor(Math.random() * 15) + 2
    const events = generateEvents(studentId, eventCount)
    allEvents.push(...events)
  }

  // Use bulk puts with smaller batches to avoid memory issues
  const BATCH_SIZE = 50
  for (let i = 0; i < students.length; i += BATCH_SIZE) {
    await db.students.bulkPut(students.slice(i, i + BATCH_SIZE))
  }

  for (let i = 0; i < allEvents.length; i += BATCH_SIZE) {
    await db.events.bulkPut(allEvents.slice(i, i + BATCH_SIZE))
  }

  console.log(`Seeded ${students.length} students and ${allEvents.length} events`)
}
