import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)
const SYNC_SECRET = Deno.env.get('SHEETS_SYNC_SECRET')!

const BATCH_SIZE = 50

interface StudentRow {
  idNumber: string
  fullName: string
  classId: string
  phone?: string
}

interface GradeStats {
  upserted: number
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

// ── Sync students via RPC (safe: never overwrites currentStatus/tokens) ────────

async function syncStudentsToDb(
  grade: string,
  students: StudentRow[],
): Promise<void> {
  // Process in chunks of BATCH_SIZE to avoid timeout
  for (let i = 0; i < students.length; i += BATCH_SIZE) {
    const batch = students.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map((student) =>
        supabase.rpc('sync_student_from_sheet', {
          p_id_number: student.idNumber,
          p_full_name: student.fullName,
          p_phone:     student.phone ?? '',
          p_grade:     grade,
          p_class_id:  student.classId,
        })
      ),
    )
  }
}

// ── Main sync orchestration ────────────────────────────────────────────────────

async function runSync(
  payload: Record<string, StudentRow[]>,
): Promise<{ grades: Record<string, GradeStats>; classCodes: { classId: string; code: string; supervisorPin: string }[] }> {
  const allClassIds = new Set<string>()
  const gradeStats: Record<string, GradeStats> = {}

  // Sync each grade's students via the safe RPC (no currentStatus overwrite)
  for (const [grade, students] of Object.entries(payload)) {
    for (const s of students) {
      allClassIds.add(s.classId)
    }
    await syncStudentsToDb(grade, students)
    gradeStats[grade] = { upserted: students.length }
  }

  // Assign class codes for any new classes
  const classCodes = await ensureClassCodes([...allClassIds])

  const { data: pinRow } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'admin_pin')
    .single()
  const adminPin: string = pinRow?.value ?? '????'

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
