import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Service Role Key עוקף RLS — בטוח כי קוד זה רץ בשרת בלבד
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)
const SYNC_SECRET = Deno.env.get('SHEETS_SYNC_SECRET')!

// ── Types ──────────────────────────────────────────────────────────────────────

interface StudentRow {
  idNumber: string
  fullName: string
  classId: string
}

interface GradeStats {
  upserted: number
  deleted: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function jsonErr(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

// ── Core sync logic ────────────────────────────────────────────────────────────

async function syncGrade(grade: string, incoming: StudentRow[]): Promise<GradeStats> {
  if (incoming.length === 0) return { upserted: 0, deleted: 0 }

  // UPSERT — כל תלמיד שבגיליון (match by idNumber, update שם + כיתה)
  const rows = incoming.map((s) => ({
    id: crypto.randomUUID(), // מוחלף ע"י ON CONFLICT (idNumber הוא unique)
    fullName: s.fullName,
    idNumber: s.idNumber,
    phone: '',
    grade,
    classId: s.classId,
    currentStatus: 'ON_CAMPUS' as const,
    pendingApproval: false,
    createdAt: new Date().toISOString(),
  }))

  const { error: upErr } = await supabase
    .from('students')
    .upsert(rows, { onConflict: 'idNumber' })
  if (upErr) throw new Error(`UPSERT "${grade}": ${upErr.message}`)

  // DELETE — תלמידים שב-DB בgrade זה אך נעלמו מהגיליון ("רוחות")
  const keepIds = new Set(incoming.map((s) => s.idNumber))
  const { data: existing, error: selErr } = await supabase
    .from('students')
    .select('id, idNumber')
    .eq('grade', grade)
  if (selErr) throw new Error(`SELECT "${grade}": ${selErr.message}`)

  const toDelete = (existing ?? [])
    .filter((s) => !keepIds.has(s.idNumber))
    .map((s) => s.id)

  let deleted = 0
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase.from('students').delete().in('id', toDelete)
    if (delErr) throw new Error(`DELETE "${grade}": ${delErr.message}`)
    deleted = toDelete.length
  }

  return { upserted: incoming.length, deleted }
}

// ── Class-code management ──────────────────────────────────────────────────────

async function ensureClassCodes(
  classIds: string[],
): Promise<{ classId: string; code: string }[]> {
  // קרא קודים קיימים
  const { data: existing } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', 'class_code_%')

  const codeMap = new Map<string, string>()
  for (const row of existing ?? []) {
    codeMap.set(row.key.replace('class_code_', ''), row.value)
  }

  // מצא את הקוד הסדרתי הגבוה ביותר
  const existingNums = [...codeMap.values()].map((v) => parseInt(v, 10)).filter(Number.isFinite)
  let next = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1

  // הקצה קודים לכיתות חדשות
  for (const classId of classIds) {
    if (!codeMap.has(classId)) {
      const code = String(next++).padStart(3, '0')
      await supabase
        .from('app_settings')
        .upsert({ key: `class_code_${classId}`, value: code }, { onConflict: 'key' })
      codeMap.set(classId, code)
    }
  }

  return classIds
    .map((id) => ({ classId: id, code: codeMap.get(id)! }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Secret',
      },
    })
  }

  // אימות secret — מגן מפני קריאות לא מורשות
  if (req.headers.get('X-Sync-Secret') !== SYNC_SECRET) {
    return jsonErr('Unauthorized — סיסמת הסנכרון שגויה', 401)
  }

  if (req.method !== 'POST') {
    return jsonErr('Method not allowed', 405)
  }

  // payload: Record<grade, StudentRow[]>
  let payload: Record<string, StudentRow[]>
  try {
    payload = await req.json()
  } catch {
    return jsonErr('גוף הבקשה אינו JSON תקין', 400)
  }

  const gradeResults: Record<string, GradeStats> = {}
  const allClassIds = new Set<string>()

  for (const [grade, students] of Object.entries(payload)) {
    for (const s of students) allClassIds.add(s.classId)
    try {
      gradeResults[grade] = await syncGrade(grade, students)
    } catch (err) {
      return jsonErr(`שגיאה בסנכרון שכבה "${grade}": ${(err as Error).message}`, 500)
    }
  }

  // עדכן / הקצה קודי כיתה (001, 002, ...)
  const classCodes = await ensureClassCodes([...allClassIds])

  // קרא admin_pin כדי לחשב PINs של רכזים לסיכום
  const { data: pinRow } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'admin_pin')
    .single()
  const adminPin: string = pinRow?.value ?? '????'

  return jsonOk({
    grades: gradeResults,
    classCodes: classCodes.map(({ classId, code }) => ({
      classId,
      code,
      supervisorPin: adminPin + code,
    })),
  })
})
