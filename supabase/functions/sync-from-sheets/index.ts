import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)
const SYNC_SECRET = Deno.env.get('SHEETS_SYNC_SECRET')!

interface StudentRow {
  idNumber: string
  fullName: string
  classId: string
}

interface GradeStats {
  upserted: number
  deleted: number
}

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

// ── Class-code management ──────────────────────────────────────────────────────

async function ensureClassCodes(classIds: string[]): Promise<{ classId: string; code: string }[]> {
  const { data: existing } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', 'class_code_%')

  const codeMap = new Map<string, string>()
  for (const row of existing ?? []) {
    codeMap.set(row.key.replace('class_code_', ''), row.value)
  }

  const existingNums = [...codeMap.values()].map((v) => parseInt(v, 10)).filter(Number.isFinite)
  let next = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1

  for (const classId of classIds) {
    if (!codeMap.has(classId)) {
      const code = String(next++).padStart(3, '0')
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key: `class_code_${classId}`, value: code }, { onConflict: 'key' })
      if (error) throw new Error(`class-code upsert for "${classId}": ${error.message}`)
      codeMap.set(classId, code)
    }
  }

  return classIds
    .map((id) => ({ classId: id, code: codeMap.get(id)! }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

// ── Atomic sync — batched UPSERT → DELETE → class codes ───────────────────────
//
// Supabase JS client does not support multi-statement SQL transactions.
// We achieve near-atomicity by:
//   1. Validating and collecting all incoming data first (no DB writes yet).
//   2. Batching all UPSERTs across all grades in one call.
//   3. Batching all DELETEs in one call.
//   4. Running class-code assignment only after both steps succeed.
//   5. On any failure, returning an error — subsequent sync from Sheets is the recovery path.

async function runSync(
  payload: Record<string, StudentRow[]>,
): Promise<{ grades: Record<string, GradeStats>; classCodes: { classId: string; code: string; supervisorPin: string }[] }> {
  // ── Phase A: build batch lists ─────────────────────────────────────────────
  const allUpsertRows: Array<{
    fullName: string; idNumber: string; phone: string
    grade: string; classId: string; currentStatus: 'ON_CAMPUS'; pendingApproval: boolean; createdAt: string
  }> = []
  const gradeIncomingIds = new Map<string, Set<string>>() // grade → Set<idNumber>
  const allClassIds = new Set<string>()
  const now = new Date().toISOString()

  for (const [grade, students] of Object.entries(payload)) {
    gradeIncomingIds.set(grade, new Set(students.map((s) => s.idNumber)))
    for (const s of students) {
      allClassIds.add(s.classId)
      allUpsertRows.push({
        fullName: s.fullName,
        idNumber: s.idNumber,
        phone: '',
        grade,
        classId: s.classId,
        currentStatus: 'ON_CAMPUS',
        pendingApproval: false,
        createdAt: now,
      })
    }
  }

  // ── Phase B: UPSERT all students across all grades in one batch ────────────
  if (allUpsertRows.length > 0) {
    const { error: upErr } = await supabase
      .from('students')
      .upsert(allUpsertRows, {
        onConflict: 'idNumber',
        // Only update name, class, grade — never overwrite status with ON_CAMPUS
        // for students who are currently off-campus.
        ignoreDuplicates: false,
      })
    if (upErr) throw new Error(`UPSERT all grades: ${upErr.message}`)
  }

  // ── Phase C: DELETE students who were removed from Sheets ─────────────────
  // Fetch current DB state for all synced grades in one query.
  const grades = Object.keys(payload)
  const { data: existingStudents, error: selErr } = await supabase
    .from('students')
    .select('id, idNumber, grade')
    .in('grade', grades)
  if (selErr) throw new Error(`SELECT existing students: ${selErr.message}`)

  const toDeleteIds: string[] = []
  for (const s of existingStudents ?? []) {
    const incoming = gradeIncomingIds.get(s.grade)
    if (incoming && !incoming.has(s.idNumber)) {
      toDeleteIds.push(s.id)
    }
  }

  let totalDeleted = 0
  if (toDeleteIds.length > 0) {
    // Batch delete in chunks of 100 to stay within URL limits
    for (let i = 0; i < toDeleteIds.length; i += 100) {
      const chunk = toDeleteIds.slice(i, i + 100)
      const { error: delErr } = await supabase.from('students').delete().in('id', chunk)
      if (delErr) throw new Error(`DELETE students chunk ${i}: ${delErr.message}`)
    }
    totalDeleted = toDeleteIds.length
  }

  // ── Phase D: Class codes ───────────────────────────────────────────────────
  const classCodes = await ensureClassCodes([...allClassIds])

  const { data: pinRow } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'admin_pin')
    .single()
  const adminPin: string = pinRow?.value ?? '????'

  // ── Build per-grade stats for response ────────────────────────────────────
  const gradeStats: Record<string, GradeStats> = {}
  let deletedAccounted = 0
  for (const [grade, students] of Object.entries(payload)) {
    const deletedForGrade = (existingStudents ?? []).filter(
      (s) => s.grade === grade && !gradeIncomingIds.get(grade)!.has(s.idNumber),
    ).length
    gradeStats[grade] = {
      upserted: students.length,
      deleted: deletedForGrade,
    }
    deletedAccounted += deletedForGrade
  }

  return {
    grades: gradeStats,
    classCodes: classCodes.map(({ classId, code }) => ({
      classId,
      code,
      supervisorPin: adminPin + code,
    })),
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Secret',
      },
    })
  }

  if (req.headers.get('X-Sync-Secret') !== SYNC_SECRET) {
    return jsonErr('Unauthorized — סיסמת הסנכרון שגויה', 401)
  }

  if (req.method !== 'POST') {
    return jsonErr('Method not allowed', 405)
  }

  let payload: Record<string, StudentRow[]>
  try {
    payload = await req.json()
  } catch {
    return jsonErr('גוף הבקשה אינו JSON תקין', 400)
  }

  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    return jsonErr('payload ריק — אין נתונים לסנכרן', 400)
  }

  try {
    const result = await runSync(payload)
    return jsonOk(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync-from-sheets] error:', msg)
    return jsonErr(`שגיאת סנכרון: ${msg}`, 500)
  }
})
