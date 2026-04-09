# CLAUDE.md — מצפן אסטרטגי לפרויקט מעקב נוכחות ישיבת שבי חברון

> **קרא קובץ זה לפני כל פעולה בפרויקט.** הוא מכיל את כל ההחלטות, הכללים, ולוגיקה העסקית של המערכת.

---

## 1. זהות הפרויקט

**שם:** מערכת מעקב נוכחות — ישיבת שבי חברון  
**סוג:** PWA (Progressive Web App) + Android APK (Capacitor)  
**Stack:** React 18 + Vite + TypeScript + Supabase + Tailwind CSS + shadcn/ui  
**שפה:** עברית בלבד. RTL. אין תמיכה בשפות אחרות.  
**פריסה:** Vercel (frontend) + Supabase (backend/DB/Edge Functions)

---

## 2. ארכיטקטורה כללית

```
┌─────────────────────────────────────────────────────────┐
│  Google Sheets  ──GAS──►  sync-from-sheets (Edge Fn)    │
│                              │ UPSERT/DELETE students     │
│                              ▼                            │
│  React PWA / Android APK ◄──► Supabase PostgreSQL DB     │
│  (Vite + Zustand + Dexie)    │ Real-time subscriptions   │
│                              │ RPC functions              │
│                              ▼                            │
│  Supabase Edge Functions: send-push, broadcast-location  │
└─────────────────────────────────────────────────────────┘
```

### כלל ברזל #1 — Google Sheets הוא מקור האמת היחיד לתלמידים
- תלמידים **נוצרים, מעודכנים ונמחקים** אך ורק דרך סינכרון Google Sheets.
- אין ואסור שיהיה ממשק להוספת / עריכת / ייבוא תלמידים מהאתר.
- כשהסינכרון רץ — תלמיד שנמחק מהשיט **נמחק לחלוטין מה-DB כולל ההיסטוריה שלו** (cascade).
- שינוי כיתה של תלמיד דרך ה-UI (ClassEditModal) תקף רק עד הסינכרון הבא, שידרוס אותו.

### כלל ברזל #2 — אין סטטוס "איחור" (OVERDUE)
- `OVERDUE` קיים בטיפוסי TypeScript **לתאימות לאחור עם רשומות DB ישנות בלבד**.
- לא יוצרים סטטוס OVERDUE חדש בשום מקום. `markOverdueStudents()` מחזירה 0.
- בכל ממשק UI — OVERDUE מוצג ומטופל **זהה ל-OFF_CAMPUS**.
- לא מציגים את המילה "איחור" לשום משתמש.

### כלל ברזל #3 — ביטול יציאה מוחק את האירוע לחלוטין
- כשתלמיד (או מנהל) מבטל יציאה — האירוע **נמחק מה-DB** (`deleteEvent`).
- לא יוצרים CHECK_IN נגדי. הסטטוס מאופס ל-ON_CAMPUS ישירות.
- זה נכון **בלי קשר לזמן** — אין הבדל בין ביטול תוך 5 דקות לביטול אחרי שעה.

---

## 3. מבנה הכיתות ושכבות הגיל

| שכבה | שם | כיתות | תלמידים לכיתה (קיבולת) |
|------|-----|-------|------------------------|
| שנה א' | שיעור א' | 6 (כיתה 1–6) | 25 |
| שנה ב' | שיעור ב' | 4 (כיתה 1–4) | 25 |
| שנה ג' | שיעור ג' | 3 (כיתה 1–3) | 25 |
| שנה ד' | שיעור ד' | 1 (classId = שם השכבה) | 25 |
| אברכים | אברכים | 1 (classId = שם השכבה) | 50 |
| בוגרים | בוגרצים | 1 (classId = שם השכבה) | 50 |

**סה"כ: 16 כיתות, ~400 תלמידים.**

- שכבות עם כיתה יחידה: `classId === gradeName` (לדוגמה: `classId = "אברכים"`).
- שכבות עם כיתות מרובות: `classId = "${gradeName} כיתה ${n}"` (לדוגמה: `"שיעור א' כיתה 3"`).

### שמות גיליונות Google Sheets vs DB
| שם בגיליון (`SHEET_GRADE_NAMES`) | שם ב-DB (`GRADE_LEVELS`) |
|----------------------------------|--------------------------|
| שיעור א' | שיעור א' |
| שיעור ב' | שיעור ב' |
| שיעור ג' | שיעור ג' |
| שיעור ד'-ה' | שיעור ד' |
| אברכים ובוגרצ' | אברכים / בוגרצים |

⚠️ **המיפוי בין שמות הגיליון לשמות DB נעשה ב-Edge Function `sync-from-sheets`.**

---

## 4. מערכת הסטטוסים

### סטטוסי תלמיד (`currentStatus`)

| סטטוס | משמעות | צבע UI |
|--------|---------|--------|
| `ON_CAMPUS` | תלמיד בישיבה | ירוק |
| `OFF_CAMPUS` | תלמיד מחוץ לישיבה | כתום |
| `OVERDUE` | **מיושן** — מוצג כ-OFF_CAMPUS בכל מקום | כתום |
| `PENDING` | תלמיד ממתין לאישור (רק בעת רישום ראשוני) | אפור |

### סוגי אירועים (`events.type`)

| סוג | פעולה | שינוי סטטוס |
|-----|--------|-------------|
| `CHECK_OUT` | יציאה מהישיבה | → OFF_CAMPUS |
| `CHECK_IN` | חזרה לישיבה | → ON_CAMPUS |
| `OVERRIDE` | שינוי ידני ע"י מנהל | כל סטטוס |
| `SMS_IN` | חזרה דרך SMS | → ON_CAMPUS |
| `SMS_OUT` | יציאה דרך SMS | → OFF_CAMPUS |

---

## 5. מכסת יציאות (Quota)

### נוסחה: `GREATEST(1, ROUND((classSize × 3) / 25))`

| גודל כיתה | מכסה |
|-----------|------|
| 25 | 3 |
| 26–29 | 3 |
| 30–37 | 4 |
| 38–45 | 5 |
| 46–54 | 6 |
| 50 (אברכים/בוגרצים) | 6 |

**כללים:**
- המכסה מחושבת **לפי מספר התלמידים הרשומים בפועל בכיתה** (לא קיבולת סטטית).
- הנוסחה זהה בצד השרת (RPC `create_checkout_with_quota_check`) ובצד הלקוח (`calcQuota()` ב-OffCampusSheet).
- תלמיד עם **בקשת היעדרות דחופה מאושרת** — **לא נחשב במכסה** לכל אורך תקופת הבקשה (לפי `date` עד `endDate`).
- מנהל שמבצע OVERRIDE ידני — **עוקף את המכסה** ללא בדיקה.
- הבדיקה מתבצעת עם advisory lock (`pg_try_advisory_xact_lock`) למניעת race conditions.

---

## 6. בקשות היעדרות

### מחזור חיים

```
תלמיד מגיש בקשה → PENDING
    ↓
מנהל בוחן:
  APPROVED → תלמיד מקבל push notification
  REJECTED → תלמיד לא מקבל
  CANCELLED → בוטל ע"י מנהל
    ↓
תלמיד חוזר → שואלים אם לבטל את הבקשה
```

### כללים
- בקשה יכולה להיות **חד-יומית** (`date`) או **רב-יומית** (`date` עד `endDate`).
- `startTime` / `endTime` — שעות ביום (HH:MM).
- `isUrgent = true` — הבקשה פוטרת מהמכסה לכל התקופה.
- אישור שולח push: _"בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉"_
- כל פעולה (אישור/דחייה/ביטול) **נרשמת ב-`admin_overrides`** (audit log).
- ביציאה מהישיבה — אם יש בקשה מאושרת בתוקף, מוצגת ללא צורך בהגשה מחדש.

---

## 7. מערכת האימות — שלוש שכבות

### תלמיד
- כניסה לפי **מספר תעודת זהות בלבד** (אין סיסמה כרגע — יתווסף בעתיד).
- `deviceToken` (UUID) נשמר ב-`localStorage` ומשמש לזיהוי מכשיר לסינכרון offline.

### מנהל (Admin)
- PIN מאוחסן ב-`app_settings` תחת המפתח `admin_pin`.
- כניסה מוגנת ב-AdminLoginModal בלבד.
- גישה מלאה לכל הדפים.

### רכז כיתה (Class Supervisor)
- PIN = `{adminPin}{classCode}` (קוד 3 ספרות, לדוגמה: `1234001`).
- קודי הכיתות נוצרים אוטומטית בסינכרון מה-Sheets ונשמרים ב-`app_settings` כ-`class_code_{classId}`.
- **אם ה-Admin PIN משתנה — כל הרכזים צריכים PIN חדש** (אין הודעה אוטומטית — ידני).
- רכז רואה **רק את הכיתה שלו**.

---

## 8. Google Sheets ← → Supabase Sync

### זרימת סינכרון
1. מנהל מסמן תיבת סימון ב-A1 בגיליון.
2. טריגר GAS (`onSheetEdit`) מופעל.
3. GAS מנתח את כל הלשוניות (parseTab) ושולח POST ל-Edge Function `sync-from-sheets`.
4. Edge Function מבצע UPSERT לפי `idNumber` ומוחק תלמידים שנעלמו.

### כללי סינכרון חשובים
- **הסינכרון חד-כיווני: Sheets → DB בלבד.**
- תלמיד שנמחק מהגיליון — נמחק מה-DB כולל ההיסטוריה שלו.
- שינוי כיתה ב-UI ידרס בסינכרון הבא.
- הגיליון מטפל ב-ת.ז. שמתחילות ב-0 (padding ל-9 ספרות).
- כותרות הכיתה מזוהות לפי **גודל פונט ≥14** ומחרוזת "כית".

---

## 9. מבנה הטבלאות (Supabase)

### `students`
| עמודה | סוג | הערות |
|-------|-----|-------|
| `id` | UUID | PK |
| `idNumber` | TEXT | ייחודי, 9 ספרות |
| `fullName` | TEXT | |
| `phone` | TEXT | |
| `grade` | TEXT | שם שכבה (ראה מיפוי) |
| `classId` | TEXT | ייחודי בתוך שכבה |
| `currentStatus` | TEXT | ON_CAMPUS / OFF_CAMPUS / OVERDUE / PENDING |
| `lastSeen` | TIMESTAMPTZ | |
| `lastLocation` | JSONB | `{lat, lng}` |
| `deviceToken` | TEXT | UUID, ל-offline sync |
| `push_token` | TEXT | Web Push subscription JSON |
| `fcm_token` | TEXT | Firebase (Android APK בלבד) |
| `pendingApproval` | BOOLEAN | |
| `createdAt` | TIMESTAMPTZ | |

> ⚠️ **כל שמות העמודות ב-camelCase עם גרשיים ב-SQL** (למשל `"classId"`, `"currentStatus"`).

### `events`
| עמודה | סוג | הערות |
|-------|-----|-------|
| `id` | UUID | PK |
| `studentId` | UUID | FK → students |
| `type` | TEXT | CHECK_IN / CHECK_OUT / OVERRIDE / SMS_IN / SMS_OUT |
| `timestamp` | TIMESTAMPTZ | |
| `reason` | TEXT | סיבת יציאה (אופציונלי) |
| `expectedReturn` | TIMESTAMPTZ | שעת חזרה צפויה |
| `gpsLat` / `gpsLng` | FLOAT | GPS בזמן יציאה |
| `gpsStatus` | TEXT | GRANTED / DENIED_BY_USER / UNAVAILABLE / PENDING |
| `distanceFromCampus` | FLOAT | מטרים |
| `note` | TEXT | הערת מנהל |
| `syncedAt` | TIMESTAMPTZ | null = עדיין לא סונכרן |

### `absence_requests`
| עמודה | הערות |
|-------|-------|
| `date` | תאריך התחלה YYYY-MM-DD |
| `endDate` | תאריך סיום (אופציונלי, לבקשות רב-יומיות) |
| `startTime` / `endTime` | HH:MM |
| `status` | PENDING / APPROVED / REJECTED / CANCELLED |
| `isUrgent` | boolean — פטור ממכסה |

### `admin_overrides` — Audit Log
כל פעולה מנהלתית נרשמת כאן: אישור/דחיית בקשות, שינוי סטטוס ידני, ביטול יציאה.

### `app_settings`
זוגות key-value:
- `admin_pin` — PIN המנהל
- `class_code_{classId}` — קוד 3 ספרות לרכז

---

## 10. פונקציות RPC (Supabase)

### `create_checkout_with_quota_check(p_student_id, p_class_id, p_grade, p_reason, p_expected_return)`
- **מה עושה:** בודק מכסה + יוצר אירוע CHECK_OUT **אטומית**.
- **מכסה:** דינמית — `GREATEST(1, ROUND((class_size × 3)::numeric / 25))`.
- **פטור ממכסה:** תלמידים עם urgent request מאושר לתקופה הנוכחית.
- **מחזיר:** `{success: true, eventId}` או `{success: false, error, current, quota}`.
- **טיפול ב-timezone:** משתמש ב-`Asia/Jerusalem` לחישוב תאריך.

### `auto_return_students()`
- **מה עושה:** מחזיר תלמידים ל-ON_CAMPUS כאשר `expectedReturn` עבר.
- **מחזיר:** מספר תלמידים שהוחזרו.
- **הפעלה:** ידנית מ-DashboardPage. אין cron job ייעודי כרגע.

### `mark_overdue_students()` — **מושבתת**
- מחזירה 0 תמיד. קיימת לתאימות לאחור.

---

## 11. מערכת Push Notifications

### Web Push (PWA)
- נרשם בעת כניסת תלמיד (`registerPushSubscription`).
- מאוחסן ב-`students.push_token` (JSON).
- שולח דרך Edge Function `send-push` (VAPID + AES-128-GCM).
- **שימוש:** אישור בקשת היעדרות.

### Firebase Cloud Messaging (Android APK בלבד)
- Token מאוחסן ב-`students.fcm_token`.
- שולח דרך Edge Function `broadcast-location-request`.
- **שימוש:** ביקורת פנימית — מעיר את האפליקציה ברקע לשלוח GPS.

---

## 12. GPS ומיקום

| קטגוריה | מרחק | צבע |
|----------|------|-----|
| בישיבה | ≤ 300 מטר | ירוק |
| באזור (חברון) | 300מ' – 5 ק"מ | כתום |
| רחוק | > 5 ק"מ | אדום |

- **קואורדינטות הישיבה:** `LAT=31.5253, LNG=35.1056`
- GPS נאסף **רק** בביקורת פנימית (admin RollCall) — לא בעת יציאה רגילה.
- מכשירי iPhone/PWA: אין FCM — לא מגיבים לביקורת פנימית (מגבלת טכנולוגיה).

---

## 13. Offline Support

- **IndexedDB (Dexie):** שמירה מקומית של events, students, syncQueue.
- **כשאין חיבור:** פעולות נשמרות ב-`syncQueue` ומסונכרנות עם חזרת החיבור.
- **Conflict Resolution:** בגרסה נוכחית — הפעולות מ-offline נשלחות לפי סדר לאחר חזרת חיבור. אם האדמין שינה את הסטטוס בינתיים — פעולת ה-offline עלולה לדרוס. **ידוע, אין פתרון בגרסה נוכחית.**
- **Sync triggers:** כשהאפליקציה חוזרת online, כשהיא חוזרת לפוקוס, כל 30 שניות.

---

## 14. שלושה ממשקי משתמש

### תלמיד (`/student`)
- **דף הבית:** כפתורי CHECK_IN / CHECK_OUT, סטטוס נוכחי, באנר יציאה מאושרת, אפשרות ביטול יציאה.
- **בקשות:** הגשת בקשת היעדרות (חד-יומית / רב-יומית / דחופה).
- **היסטוריה:** רשימת אירועים.
- **חוויה:** Mobile-first. הכל בעברית RTL.

### מנהל (`/admin`)
- **דשבורד:** סטטיסטיקות, גרפים, שידור push.
- **תלמידים:** רשימה עם פילטרים לפי שכבה/כיתה/סטטוס/חיפוש. **קריאה בלבד — לא ניתן להוסיף/לייבא תלמידים.** ייצוא Excel זמין.
- **בקשות:** אישור/דחיית בקשות המתנה.
- **ביקורת פנימית (RollCall):** שידור בקשת GPS לכל המכשירים.
- **יומן ביקורת:** כל הפעולות המנהלתיות.
- **הגדרות:** שינוי Admin PIN.

### רכז כיתה (`/class-supervisor`)
- **דשבורד:** רשימת תלמידי הכיתה שלו בלבד, סטטוסים, היסטוריה.
- כל פעולה שרכז מבצע **נרשמת ב-`admin_overrides`**.

---

## 15. מבנה הפרויקט

```
src/
├── App.tsx                    # ניתוב ראשי (React Router)
├── pages/
│   ├── student/               # דפי תלמיד
│   ├── admin/                 # דפי מנהל
│   └── class-supervisor/      # דף רכז כיתה
├── components/
│   ├── admin/                 # רכיבי מנהל
│   ├── student/               # רכיבי תלמיד (StatusButtons, OffCampusSheet)
│   ├── shared/                # StatusBadge, SyncStatusBar, SplashScreen
│   ├── analytics/             # גרפים (recharts)
│   ├── auth/                  # LoginScreen, AdminLoginModal
│   └── ui/                    # shadcn/ui primitives
├── store/
│   ├── authStore.ts           # Zustand — auth state (persistent: deviceToken)
│   ├── studentsStore.ts       # Zustand — רשימת תלמידים + פילטרים
│   ├── syncStore.ts           # Zustand — מצב סינכרון offline
│   └── uiStore.ts             # Zustand — theme, sidebar (persistent)
├── lib/
│   ├── api/
│   │   ├── supabaseClient.ts  # מימוש IApiClient
│   │   └── types.ts           # IApiClient interface
│   ├── constants/grades.ts    # GRADE_LEVELS, getClasses, ALL_CLASS_IDS
│   ├── db/schema.ts           # Dexie (IndexedDB) schema
│   ├── sync/syncEngine.ts     # מנוע סינכרון offline
│   ├── location/gps.ts        # GPS utils (Haversine, campus coords)
│   └── sms/parser.ts          # ניתוח הודעות SMS בעברית
├── types/index.ts             # כל ה-TypeScript types
supabase/
├── migrations/
│   ├── 20260405_quota_rpc.sql
│   ├── 20260405_overdue_transition.sql
│   ├── 20260406_auto_return.sql
│   ├── fix_checkout_and_push_token.sql
│   └── 20260409_dynamic_quota.sql   ← מכסה דינמית (גרסה נוכחית)
└── functions/
    ├── sync-from-sheets/      # GAS → Supabase sync
    ├── send-push/             # Web Push (RFC 8291)
    └── broadcast-location-request/ # FCM broadcast
GoogleAppsScript.gs            # קוד GAS לסינכרון מהגיליון
```

---

## 16. משתני סביבה

### Frontend (`.env.local`)
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_VAPID_PUBLIC_KEY=
```

### Supabase Edge Functions (Secrets)
```
SHEETS_SYNC_SECRET       # shared secret עם GAS
FCM_SERVER_KEY           # Firebase (ביקורת פנימית)
VAPID_PUBLIC_KEY         # Web Push
VAPID_PRIVATE_KEY        # Web Push
VAPID_SUBJECT            # mailto:... עבור VAPID
```

---

## 17. עיצוב ו-UX — כללים

- **שפה:** עברית בלבד. לא מוסיפים מחרוזות אנגלית לממשק.
- **כיוון:** RTL. משתמשים ב-`start`/`end` במקום `left`/`right` ב-Tailwind.
- **CSS Variables:** `--text`, `--text-muted`, `--bg`, `--bg-2`, `--surface`, `--border`, `--blue`, `--green`, `--orange`, `--red`.
- **Dark Mode:** כל רכיב חייב לתמוך ב-dark mode דרך CSS variables.
- **Mobile-first:** כל ממשק תלמיד מתוכנן לנייד. ממשק מנהל — responsive.
- **Toast:** כל פעולה משמעותית מלווה ב-toast. timeout סטנדרטי.
- **Loading states:** spinners/skeletons בכל פעולת רשת.

---

## 18. כללי פיתוח

### אסור בהחלט
- ❌ להוסיף ממשק הוספת/עריכת תלמיד מהאתר (Sheets בלבד).
- ❌ ליצור סטטוס OVERDUE חדש.
- ❌ להשתמש ב-`addStudent()` — הוסר בכוונה.
- ❌ לשנות נוסחת המכסה ב-OffCampusSheet בלי לשנות גם ב-RPC (ולהיפך).
- ❌ לשמור GPS של תלמיד בעת יציאה רגילה (רק בביקורת פנימית).

### חובה תמיד
- ✅ כל פעולה מנהלתית — נרשמת ב-`admin_overrides`.
- ✅ ביטול יציאה = מחיקת האירוע (`deleteEvent`), לא יצירת CHECK_IN.
- ✅ בדיקת מכסה = תמיד דרך RPC (לא בצד לקוח בלבד).
- ✅ טיפול ב-timezone = `Asia/Jerusalem` בכל חישוב תאריך בשרת.
- ✅ השוואת שמות שכבות/כיתות = normalize Hebrew (פונקציית `normalizeHebrew` ב-studentsStore).

---

## 19. חובות ידועות (TODO)

- [ ] הוספת סיסמאות לתלמידים (כרגע ID בלבד).
- [ ] Supabase Row Level Security (RLS) — כרגע כל תלמיד רואה את כל הנתונים.
- [ ] הודעה אוטומטית לרכזים בשינוי Admin PIN.
- [ ] מכסת יציאות לפי שעות (כרגע 24/7).
- [ ] פתרון conflicts offline — כרגע last-write-wins.
- [ ] הגדרת auto_return_students כ-cron job (כרגע מופעל ידנית).
- [ ] בדיקות אוטומטיות (unit / integration).

---

## 20. שאלות נפוצות

**ש: תלמיד מנסה לצאת אבל רואה שהמכסה מלאה. מה יכול לעשות?**  
ת: לחכות שחבר כיתה יחזור (המערכת מציגה מתי צפוי לחזור) — או להגיש בקשת היעדרות דחופה (isUrgent).

**ש: תלמיד לחץ "יציאה" בטעות. יש לו חלון לבטל?**  
ת: כן — 5 דקות. ביטול מוחק את האירוע לחלוטין מה-DB (לא נשאר שום עקב).

**ש: האם שינוי כיתה דרך ה-UI (ClassEditModal) קבוע?**  
ת: לא — הסינכרון הבא מה-Sheets ידרוס אותו.

**ש: האדמין שינה את ה-PIN. האם רכזי הכיתה מקבלים הודעה?**  
ת: לא — האחריות על יידוע הרכזים היא ידנית.

**ש: מה קורה לתלמיד שמסומן OVERDUE ב-DB?**  
ת: מוצג כ-OFF_CAMPUS בכל ממשק. לא יוצרים OVERDUE חדש. `auto_return_students` יחזיר אותו כשהזמן יעבור.
