# אפיון־על ותוכנית מוצר: ביקורת פנימית חיה

תאריך: 2026-05-16  
מערכת: נוכחות ישיבת שבי חברון  
תחום: Internal Audit / ביקורת פנימית / איסוף מיקום / דשבורד חי  
סטטוס: אפיון מאושר עקרונית על בסיס החלטות המשתמש; ממתין לאישור לפני תוכנית מימוש מפורטת וקוד.

---

## 1. תקציר מנהלים

המטרה היא להחליף את מנגנון "ביקורת פנימית" הקיים במערכת מקצועית, חיה, יציבה ונשמרת, שבה מנהל יכול לפתוח מסך נתונים בזמן אמת, להפעיל ביקורת, לשלוח התראה לכל התלמידים הרלוונטיים, לראות תגובות נכנסות למסך באופן חי, לטפל בחריגים, לקבל גיבוי מרכזי כיתה, לסיים ביקורת, ולשמור דוח היסטורי מלא לצמיתות.

המערכת הנוכחית כבר כוללת בסיס טוב: React/Vite, Supabase, Web Push, Realtime, תלמידים, רכזי כיתה, יציאות מאושרות, מכסות, וסטטוסים. אבל "ביקורת פנימית" אינה בנויה נכון כמוצר: אין סשן ביקורת אמיתי במסד הנתונים, אין תגובות משויכות להרצת ביקורת, אין persistence אחרי refresh, אין היסטוריה מלאה, וה־UX הקיים אינו עומד ברמה המבוקשת.

הפתרון הנכון הוא לא לשפץ את `RollCallPage` הקיים, אלא לבנות feature חדש ומודולרי:

- `audit_sessions`: מקור אמת לסשן ביקורת.
- `audit_session_classes`: אילו כיתות משתתפות.
- `audit_responses`: תגובת תלמיד/מיקום/כשל/אי־תגובה לכל סשן.
- `audit_manual_marks`: סימוני רכזים במצב ללא מיקום או fallback.
- `audit_alerts`: חריגות חיות שנרשמות ולא נעלמות.
- API/RPC חדש סביב סשן ביקורת.
- דשבורד מנהל חי, מסך הקרנה, דוחות עבר, ותצוגת רכזים.

העיקרון המרכזי: שום דבר חשוב לא חי רק ב־React state. כל מצב ביקורת משמעותי נשמר במסד הנתונים ונצפה דרך Supabase Realtime. לכן אם המנהל, הרכז או התלמיד מרעננים מסך, המערכת חוזרת לאותו מצב.

---

## 2. החלטות מוצר סופיות

### 2.1 הרשאות מיקום

רק מנהל רואה מיקום מדויק, ורק במסך המנהל המיוחד של ביקורת פנימית.

רכז כיתה אינו רואה קואורדינטות מדויקות. הוא רואה סטטוס תפעולי: נוכח, בחוץ עם אישור, בחוץ בלי אישור, נדרש סימון, או לא נענה.

תלמיד אינו רואה דשבורד ביקורת. הוא מקבל התראה ונכנס לאפליקציה, והמיקום נאסף אוטומטית מיד.

### 2.2 סף חריגה

תלמיד נחשב "מחוץ לטווח" אם המיקום שלו במרחק של יותר מ־5 ק"מ מהישיבה, אלא אם יש לו יציאה מאושרת פעילה באותו רגע.

אם יש לתלמיד יציאה מאושרת בזמן הביקורת:

- הוא מסומן מראש בירוק.
- מופיע הטקסט "יציאה מאושרת".
- גם רכז הכיתה רואה "בחוץ עם אישור".
- הוא לא מפעיל התראה אדומה גם אם הוא רחוק.

### 2.3 מצבי ביקורת

חובה לתמוך בשני מצבי ביקורת:

1. ביקורת עם מיקום.
2. ביקורת ללא מיקום.

בביקורת עם מיקום:

- מנהל פותח סשן.
- המערכת שולחת Push לתלמידים הרלוונטיים.
- כל תלמיד שנכנס לאפליקציה שולח מיקום אוטומטית.
- אם המיקום נכשל, התלמיד לא שלח, או אין הרשאה, הוא עובר לטיפול רכז כיתה.
- סימון הרכז חוזר למסד הנתונים ומופיע בלייב אצל המנהל.

בביקורת ללא מיקום:

- כל רכז מסמן רק את תלמידי הכיתה שלו.
- לכל תלמיד יש 3 אפשרויות: נוכח, בחוץ עם אישור, בחוץ בלי אישור.
- המנהל רואה את התקדמות הסימון בזמן אמת.

### 2.4 משך ביקורת

ביקורת נשארת פתוחה עד שהמנהל סוגר אותה. אין timeout אוטומטי שמסיים את הביקורת.

אפשר להציג "זמן פתוח" ו"המלצת סיום", אבל ההחלטה לסיים היא של המנהל בלבד.

### 2.5 הצגת שמות

במסך המנהל ובמסך ההקרנה מותר להציג שמות של כולם: תקינים, חריגים, ללא מענה, יציאה מאושרת, וכדומה.

כל המוצר עובד סביב שמות, לא סביב מספרים אנונימיים.

### 2.6 שמירת היסטוריה

היסטוריית ביקורות ומיקומים נשמרת תמיד.

מכיוון שמדובר במידע רגיש, התכנון יכלול אפשרות עתידית למדיניות מחיקה/ייצוא/הסתרה, אבל ברירת המחדל המבוקשת היא שמירה לצמיתות.

---

## 3. מצב קיים ומה לא משמרים

### 3.1 מה קיים היום

הקוד הנוכחי כולל:

- `src/pages/admin/RollCallPage.tsx`: מסך ביקורת פנימית ישן.
- `src/pages/admin/DashboardPage.tsx`: דשבורד מנהל עמוס.
- `src/pages/class-supervisor/ClassSupervisorDashboard.tsx`: מסך רכז כיתה עמוס.
- `students.lastLocation`: מיקום אחרון גלובלי לתלמיד.
- `students.lastSeen`: זמן עדכון אחרון.
- Realtime broadcast בערוץ `location-requests`.
- Realtime broadcast בערוץ `audit-control`.
- Web Push לתלמידים דרך `send-push`.
- יציאות מאושרות דרך `departures`.
- סטטוסים ומכסות יציאה קיימות.

### 3.2 הבעיות במצב הקיים

הבעיות אינן רק בעיצוב:

- אין טבלת סשן ביקורת.
- אין תגובה פר תלמיד המשויכת לביקורת מסוימת.
- `students.lastLocation` נדרס בכל עדכון ואינו היסטוריה.
- `lastRun`, `isWaiting`, בחירת כיתות ורשימת תוצאות נשמרים ב־React state בלבד.
- Realtime broadcast הוא רגעי; refresh מפספס אותו.
- רכז כיתה מסמן ידנית ב־state מקומי בלבד.
- אין דוחות עבר אמיתיים.
- אין audit trail מקצועי של מי סימן מה ומתי.
- אין fallback מסודר מכשל GPS לרכז.
- אין מסך הקרנה.
- אין מודל הרשאות ייעודי למיקום מדויק.

### 3.3 מה כן משמרים

משמרים חוקים עסקיים ותשתיות, לא את המסך הישן:

- `students` כמקור אמת לתלמידים.
- `departures` כמקור אמת ליציאות מאושרות.
- `submit_departure`, `approve_departure`, `reject_departure`, `cancel_departure`, `return_departure`, `tick_departures`.
- נוסחת מכסה: `GREATEST(1, ROUND(classSize * 3 / 25))`.
- `AdminGuard`, `ClassSupervisorGuard`, `StudentGuard`.
- כניסת מנהל דרך PIN/RPC.
- כניסת רכז דרך `verify_supervisor_pin`.
- Web Push.
- Supabase Realtime.
- RTL, עברית בלבד, Tailwind/shadcn/ui.

### 3.4 מה לא משמרים כבסיס UX

לא משמרים את `RollCallPage` כמסך עבודה מרכזי.

לא משמרים מצב ביקורת ב־React state בלבד.

לא משמרים את `students.lastLocation` כפתרון ביקורת. הוא יכול להישאר "מיקום אחרון כללי", אבל תגובת ביקורת תישמר בטבלת ביקורת ייעודית.

לא משמרים את זרימת broadcast הישנה שבה תלמיד מאזין לבקשת מיקום ומעדכן `students` בלבד.

לא משמרים את סימוני הרכזים המקומיים שאינם נשמרים ב־DB.

---

## 4. עקרונות תכנון

### 4.1 DB-first

כל מצב קריטי נשמר במסד:

- סשן פתוח.
- מצב סשן.
- כיתות משתתפות.
- תלמידים שנכללים.
- תגובות מיקום.
- כשלי מיקום.
- סימונים ידניים.
- חריגות.
- סיכום סופי.

ה־UI הוא תצוגה חיה של DB, לא המחסן הראשי של המצב.

### 4.2 Realtime as View Sync

Realtime משמש לעדכון מסכים, לא כמקור אמת. אם broadcast אבד, refresh או query רגיל עדיין משחזר את המצב.

### 4.3 Push as Entry Trigger

Push לא אוסף מיקום בעצמו. Push רק מביא את התלמיד לאפליקציה. איסוף המיקום קורה אחרי שהאפליקציה פתוחה.

זה מתאים למגבלות הדפדפן וה־PWA: דפדפן לא מאפשר איסוף GPS שקט כשהאפליקציה סגורה לגמרי.

### 4.4 Manager-first UX

מסך המנהל הוא "חדר מצב":

- חי.
- חד.
- צבעוני.
- סורק.
- מתאים לפגישה.
- מתאים למסך גדול.
- מציף חריגות במהירות.
- לא דורש חיפוש ידני כדי להבין מה קורה.

### 4.5 Supervisor as Verification Layer

רכז כיתה הוא שכבת אימות:

- במקרה שאין מיקום.
- במקרה שהתלמיד לא פתח את האפליקציה.
- במקרה שסורבה הרשאת מיקום.
- בביקורת ללא מיקום.
- כשצריך החלטה אנושית.

### 4.6 No Silent Failure

כל כשל הופך לסטטוס ברור:

- לא נשלחה התראה.
- אין push token.
- התלמיד לא פתח.
- מיקום נאסף.
- מיקום נכשל.
- הרשאה נדחתה.
- דיוק נמוך.
- הועבר לרכז.
- רכז סימן.
- מנהל תיקן.

---

## 5. מודל נתונים מוצע

### 5.1 `audit_sessions`

טבלת הסשנים היא מקור האמת לכל ביקורת.

עמודות:

```sql
id uuid primary key default gen_random_uuid()
mode text not null check (mode in ('LOCATION', 'MANUAL'))
status text not null check (status in ('DRAFT', 'ACTIVE', 'CLOSING', 'COMPLETED', 'CANCELLED'))
title text not null
started_by text not null
started_at timestamptz
ended_at timestamptz
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
notes text
projection_enabled boolean not null default true
threshold_meters integer not null default 5000
include_approved_departures boolean not null default true
summary jsonb
```

פירוש:

- `mode`: עם מיקום או ללא מיקום.
- `status`: מצב הסשן.
- `threshold_meters`: 5000 לפי החלטת המשתמש.
- `summary`: snapshot סופי בסיום ביקורת, כדי שדוחות עבר יהיו מהירים ויציבים.

### 5.2 `audit_session_classes`

טבלת כיתות משתתפות.

```sql
id uuid primary key default gen_random_uuid()
session_id uuid not null references audit_sessions(id) on delete cascade
grade text not null
class_id text not null
created_at timestamptz not null default now()
unique(session_id, class_id)
```

מאפשרת:

- ביקורת לכל הישיבה.
- ביקורת לשכבות מסוימות.
- ביקורת לכיתות מסוימות.
- טעינה מחדש אחרי refresh.

### 5.3 `audit_participants`

טבלת snapshot של תלמידים בסשן.

```sql
id uuid primary key default gen_random_uuid()
session_id uuid not null references audit_sessions(id) on delete cascade
student_id text not null references students(id) on delete cascade
student_name text not null
id_number text not null
grade text not null
class_id text not null
baseline_status text not null
approved_departure_id uuid references departures(id)
approved_departure_label text
expected_state text not null check (expected_state in ('EXPECTED_ON_CAMPUS', 'APPROVED_OUTSIDE'))
created_at timestamptz not null default now()
unique(session_id, student_id)
```

למה צריך snapshot:

- אם תלמיד עובר כיתה אחרי הביקורת, הדוח ההיסטורי נשאר נכון.
- אם שם תלמיד משתנה בגיליון, דוח העבר עדיין מציג מה שהיה בזמן הביקורת.
- אם יש יציאה מאושרת באותו רגע, היא נרשמת בסשן.

### 5.4 `audit_location_responses`

תגובת מיקום של תלמיד.

```sql
id uuid primary key default gen_random_uuid()
session_id uuid not null references audit_sessions(id) on delete cascade
student_id text not null references students(id) on delete cascade
status text not null check (
  status in (
    'PENDING',
    'REQUEST_SENT',
    'APP_OPENED',
    'GRANTED',
    'DENIED_BY_USER',
    'UNAVAILABLE',
    'TIMEOUT',
    'LOW_ACCURACY',
    'FAILED'
  )
)
lat double precision
lng double precision
accuracy_meters double precision
distance_from_campus_meters integer
location_class text check (location_class in ('ON_CAMPUS', 'NEAR_CAMPUS', 'OUT_OF_RANGE', 'UNKNOWN'))
captured_at timestamptz
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
error_message text
device_meta jsonb
unique(session_id, student_id)
```

לוגיקה:

- `GRANTED` עם מרחק עד 5 ק"מ: תקין.
- `GRANTED` מעל 5 ק"מ בלי יציאה מאושרת: חריגה.
- כשל/אי־תגובה: עובר לרכז.
- `accuracy_meters` נשמר כדי להבדיל בין GPS מדויק לבין מדידה חלשה.

### 5.5 `audit_manual_marks`

סימון ידני של רכז.

```sql
id uuid primary key default gen_random_uuid()
session_id uuid not null references audit_sessions(id) on delete cascade
student_id text not null references students(id) on delete cascade
class_id text not null
marked_by text not null
marked_by_role text not null check (marked_by_role in ('SUPERVISOR', 'ADMIN'))
status text not null check (status in ('PRESENT', 'OUTSIDE_APPROVED', 'OUTSIDE_UNAPPROVED'))
note text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique(session_id, student_id)
```

מצבים:

- `PRESENT`: נוכח.
- `OUTSIDE_APPROVED`: בחוץ עם אישור.
- `OUTSIDE_UNAPPROVED`: בחוץ בלי אישור.

### 5.6 `audit_alerts`

טבלת חריגות חיות.

```sql
id uuid primary key default gen_random_uuid()
session_id uuid not null references audit_sessions(id) on delete cascade
student_id text not null references students(id) on delete cascade
type text not null check (
  type in (
    'OUT_OF_RANGE',
    'NO_RESPONSE',
    'LOCATION_DENIED',
    'LOCATION_FAILED',
    'MANUAL_OUTSIDE_UNAPPROVED',
    'LOW_ACCURACY'
  )
)
severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL'))
message text not null
resolved_at timestamptz
resolved_by text
created_at timestamptz not null default now()
unique(session_id, student_id, type)
```

התראות אדומות:

- תלמיד מעל 5 ק"מ בלי יציאה מאושרת.
- רכז סימן "בחוץ בלי אישור".

התראות צהובות:

- אין מיקום.
- הרשאה נדחתה.
- לא נענה.
- דיוק נמוך.

### 5.7 Views מומלצות

`v_audit_live_board`

View שמרכזת לתצוגת מנהל:

- session.
- participant.
- response.
- manual mark.
- approved departure.
- derived status.
- alert.

`v_audit_class_board`

View לרכז:

- רק תלמידי הכיתה.
- ללא lat/lng.
- כולל יציאות מאושרות.
- כולל מי דורש סימון.

`v_audit_history`

View לדוחות עבר:

- סיכום סשן.
- ספירות.
- חריגים.
- זמן התחלה/סיום.
- מי פתח ומי סגר.

---

## 6. לוגיקת סטטוס נגזרת

ה־UI לא אמור לנחש סטטוס מתוך עשרות תנאים. תהיה פונקציה אחת בדומיין:

`deriveAuditStudentStatus(participant, locationResponse, manualMark, approvedDeparture, session)`

סטטוסים נגזרים:

- `APPROVED_OUTSIDE`: יש יציאה מאושרת עכשיו.
- `ON_CAMPUS_BY_LOCATION`: מיקום תקין בטווח.
- `OUT_OF_RANGE`: מיקום מעל 5 ק"מ ללא אישור.
- `PENDING_LOCATION`: ממתין לתגובת תלמיד.
- `NEEDS_SUPERVISOR`: אין מיקום/כשל/סירוב.
- `PRESENT_BY_SUPERVISOR`: רכז סימן נוכח.
- `OUTSIDE_APPROVED_BY_SUPERVISOR`: רכז סימן בחוץ עם אישור.
- `OUTSIDE_UNAPPROVED_BY_SUPERVISOR`: רכז סימן בחוץ בלי אישור.
- `LOW_CONFIDENCE`: מיקום קיים אבל דיוק נמוך.

עדיפות סטטוסים:

1. יציאה מאושרת פעילה גוברת על מרחק.
2. סימון רכז יכול לפתור כשל מיקום.
3. מיקום חריג בלי אישור יוצר alert קריטי.
4. אי־תגובה אינה "תקין"; היא "דורש סימון רכז".

---

## 7. API/RPC מוצע

### 7.1 `create_audit_session`

יוצר סשן, כיתות משתתפות, ו־participants.

קלט:

```ts
{
  mode: 'LOCATION' | 'MANUAL'
  classIds: string[]
  title?: string
}
```

פלט:

```ts
{
  sessionId: string
  participants: number
  classes: number
}
```

התנהגות:

- בודק שאין כבר סשן ACTIVE פתוח, או מחזיר את הסשן הפעיל לפי החלטת מוצר.
- מצלם תלמידים לפי כיתות.
- מזהה יציאות מאושרות באותו רגע.
- מכניס `APPROVED_OUTSIDE` מראש למי שיש יציאה פעילה.

### 7.2 `activate_audit_session`

מעביר סשן ל־ACTIVE ושולח אירועי Realtime.

במצב `LOCATION`, אחרי הפעלה:

- יופעל Edge Function לשליחת Push.
- תיווצר רשומת `REQUEST_SENT` לכל משתתף שאינו `APPROVED_OUTSIDE`.

במצב `MANUAL`:

- תיווצר משימת סימון לכל רכז כיתה.

### 7.3 `record_audit_app_opened`

נקרא כשהתלמיד נכנס לאפליקציה מתוך התראה או בזמן שיש סשן פעיל.

מעדכן:

- `APP_OPENED`.
- זמן פתיחה.
- device meta בסיסי.

### 7.4 `record_audit_location_response`

נקרא אחרי איסוף GPS.

קלט:

```ts
{
  sessionId: string
  studentId: string
  lat?: number
  lng?: number
  accuracy?: number
  gpsStatus: 'GRANTED' | 'DENIED_BY_USER' | 'UNAVAILABLE' | 'TIMEOUT'
  errorMessage?: string
}
```

התנהגות:

- מחשב מרחק מהישיבה בשרת או ב־RPC.
- מסווג `ON_CAMPUS` / `OUT_OF_RANGE` / `UNKNOWN`.
- יוצר/מעדכן alert לפי הצורך.
- משדר Realtime למסך מנהל ולרכז.

### 7.5 `record_manual_audit_mark`

נקרא מרכז כיתה או מנהל.

קלט:

```ts
{
  sessionId: string
  studentId: string
  status: 'PRESENT' | 'OUTSIDE_APPROVED' | 'OUTSIDE_UNAPPROVED'
  note?: string
}
```

התנהגות:

- רכז יכול לסמן רק תלמידים בכיתה שלו.
- מנהל יכול לתקן הכל.
- `OUTSIDE_UNAPPROVED` יוצר alert קריטי.
- `PRESENT` יכול לפתור `NO_RESPONSE`.

### 7.6 `complete_audit_session`

סוגר ביקורת.

התנהגות:

- status עובר ל־`COMPLETED`.
- `ended_at` מתמלא.
- נבנה `summary`.
- הדוח נשאר זמין ב"ביקורות קודמות".

### 7.7 `get_active_audit_session`

מחזיר סשן פעיל לפי תפקיד:

- מנהל: כל הסשן.
- רכז: רק הכיתה שלו, בלי lat/lng.
- תלמיד: האם הוא משתתף בסשן פעיל ומה עליו לעשות.

---

## 8. Edge Functions

### 8.1 `send-audit-push`

Edge Function ייעודי לביקורת.

למה לא להשתמש רק ב־`sendPushNotification` הקיים:

- צריך payload ייעודי עם `sessionId`.
- צריך URL פתיחה ישיר.
- צריך ניקוי tokens שפג תוקפם.
- צריך סטטיסטיקת שליחה לפי סשן.

Payload להתראה:

```json
{
  "type": "AUDIT_LOCATION_REQUEST",
  "sessionId": "...",
  "title": "ביקורת פנימית פעילה",
  "body": "פתח את האפליקציה כעת כדי לשלוח מיקום",
  "url": "/student?auditSession=..."
}
```

### 8.2 עדכון Service Worker

`public/push-sw.js` צריך לפתוח URL לפי payload.

אם notification payload כולל `url`, `notificationclick` פותח אותו.

אם אין URL, fallback נשאר `/student`.

### 8.3 מגבלות דפדפן

לפי MDN, Geolocation API דורש secure context והרשאת משתמש. לכן אין איסוף GPS שקט כשהאפליקציה סגורה.

הזרימה הנכונה:

1. Push מגיע.
2. תלמיד לוחץ.
3. האפליקציה נפתחת.
4. המסך מזהה סשן פעיל.
5. `getCurrentPosition` רץ מיד.
6. התוצאה נשמרת ל־`audit_location_responses`.

---

## 9. Realtime

### 9.1 ערוצים

ערוצים מוצעים:

- `audit-session-{sessionId}`: עדכוני סשן כלליים.
- `audit-responses-{sessionId}`: תגובות מיקום.
- `audit-manual-{sessionId}`: סימוני רכזים.
- `audit-alerts-{sessionId}`: חריגות.

בפועל, אפשר גם להאזין ל־`postgres_changes` על הטבלאות:

- `audit_sessions`
- `audit_location_responses`
- `audit_manual_marks`
- `audit_alerts`

### 9.2 עיקרון refresh

כל מסך עושה קודם query:

1. טען סשן פעיל.
2. טען rows קיימים.
3. הצטרף ל־Realtime.

כך אין תלות בכך שה־Realtime היה מחובר בזמן שהאירוע קרה.

### 9.3 מניעת כפילויות

כל response הוא `unique(session_id, student_id)`.

עדכון חוזר מאותו תלמיד עושה upsert, לא יוצר row חדש.

manual mark גם unique לפי session/student.

---

## 10. UX מנהל: מסך ביקורת פנימית חדש

### 10.1 מבנה כללי

שם מסך: `ביקורת פנימית`

נתיב מוצע:

- `/admin/internal-audit`
- או החלפה של `/admin/rollcall`

המלצה: להשאיר את URL הקיים `/admin/rollcall` כדי לא לשבור ניווט, אבל הקומפוננטה תהיה חדשה לגמרי.

### 10.2 מצב לפני ביקורת

מסך פתיחה:

- כותרת: "ביקורת פנימית"
- מצב מערכת: "אין ביקורת פעילה"
- כפתור ראשי: "הפעל ביקורת"
- גישה ל"ביקורות קודמות"
- גישה ל"מסך הקרנה"

לחיצה על "הפעל ביקורת" פותחת dialog מקצועי:

1. בחירת מצב: עם מיקום / ללא מיקום.
2. בחירת כיתות: הכל / שכבה / כיתות.
3. שם ביקורת אופציונלי.
4. סקירה לפני הפעלה: מספר תלמידים, מספר כיתות, מספר מכשירים עם push רשום.
5. כפתור: "התחל ביקורת".

### 10.3 מצב ביקורת פעילה

המסך מתחלק ל־5 אזורים:

1. פס עליון חי.
2. מטריקות גדולות.
3. זרם אירועים חי.
4. טבלת תלמידים/כיתות.
5. התראות חריגות.

### 10.4 פס עליון חי

כולל:

- שם ביקורת.
- מצב: פעילה.
- זמן מתחילת ביקורת.
- מספר תלמידים שנבדקו.
- כפתור "סיים ביקורת".
- כפתור "מסך הקרנה".
- indicator ירוק: Realtime מחובר.

אם Realtime מתנתק:

- indicator צהוב/אדום.
- fallback polling כל 10-15 שניות.
- הודעה לא מלחיצה: "החיבור החי מתעדכן מחדש".

### 10.5 מטריקות גדולות

כרטיסים:

- נבדקו.
- בישיבה.
- יציאה מאושרת.
- חריגים.
- ממתינים לרכז.
- לא נענו.

הכרטיסים צריכים להיות גדולים, קריאים, עם צבעים ברורים:

- ירוק: תקין / יציאה מאושרת.
- אדום: בחוץ בלי אישור / מעל 5 ק"מ.
- כחול: נתוני מיקום נכנסו.
- צהוב: דורש טיפול רכז.
- אפור: ממתין.

### 10.6 נתונים "קופצים" למסך

כאשר תגובת תלמיד מגיעה:

- row חדש/מעודכן מקבל highlight.
- counter עולה באנימציה קצרה.
- שם התלמיד מופיע בזרם האירועים.
- אם תקין: אנימציה ירוקה קצרה.
- אם חריג: alert אדום, צליל, והוספה לרשימת חריגים.

אין להשתמש באנימציות מוגזמות שמפריעות לקריאה. המטרה היא תחושת חדר מצב מקצועי, לא משחק.

### 10.7 טבלת תלמידים

עמודות:

- שם.
- כיתה.
- סטטוס.
- מקור אימות: GPS / רכז / יציאה מאושרת / מנהל.
- זמן עדכון.
- מרחק.
- דיוק.
- הערה.

רק מנהל רואה:

- lat/lng.
- קישור למפה.
- דיוק.
- מרחק מדויק.

רכז לא רואה נתונים אלה.

### 10.8 תצוגת כיתות

לכל כיתה:

- total.
- נבדקו.
- תקינים.
- יציאה מאושרת.
- דורשים רכז.
- חריגים.
- אחוז השלמה.

לחיצה על כיתה מסננת את טבלת התלמידים.

### 10.9 התראות

חריגה אדומה:

- תלמיד מעל 5 ק"מ ללא יציאה מאושרת.
- תלמיד שסומן "בחוץ בלי אישור".

כאשר חריגה נוצרת:

- קוביית alert אדומה מופיעה.
- צליל קצר.
- שם תלמיד.
- כיתה.
- סיבה.
- פעולה מומלצת.

פעולות:

- "סמן בטיפול".
- "פתח תלמיד".
- "בקש מרכז לאמת".
- "הוסף הערה".

---

## 11. UX מסך הקרנה

### 11.1 יעד

מסך הקרנה מיועד לחדר ישיבות/משרד/צג גדול.

הוא לא מסך עריכה. הוא תצוגת מצב גדולה וברורה.

### 11.2 נתיב

`/admin/internal-audit/:sessionId/projection`

או:

`/admin/rollcall/projection`

### 11.3 מאפיינים

- full screen.
- טיפוגרפיה גדולה.
- ללא sidebar.
- ללא טפסים.
- צבעים חזקים וברורים.
- רוטציה אוטומטית בין תצוגות.
- שמות תלמידים מוצגים.
- מותאם 16:9.

### 11.4 רוטציה אוטומטית

תצוגות:

1. Overview: מספרים גדולים.
2. Classes: מצב לפי כיתות.
3. Live Feed: מי נכנס עכשיו.
4. Alerts: חריגים אדומים.
5. Supervisor Queue: מי ממתין לרכז.

כל תצוגה 12-20 שניות. כפתורי pause/next זמינים למנהל.

### 11.5 פרטיות

כיוון שהמשתמש אישר הצגת שמות, המסך יציג שמות.

אבל מיקום מדויק לא חייב להופיע במסך הקרנה כברירת מחדל. המלצה: להציג מרחק/קטגוריה, לא lat/lng, כדי שהמסך הגדול יהיה מקצועי ולא חושף פרטים טכניים מיותרים.

---

## 12. UX תלמיד

### 12.1 כניסה מהתראה

התלמיד מקבל התראה:

"ביקורת פנימית פעילה - פתח את האפליקציה כעת כדי לשלוח מיקום"

בלחיצה:

- האפליקציה נפתחת ב־`/student?auditSession=...`.
- אם התלמיד מחובר, נאסף מיקום מיד.
- אם התלמיד לא מחובר, אחרי login האפליקציה מזהה סשן פעיל ואוספת מיקום.

### 12.2 איסוף אוטומטי

אין כפתור "שלח מיקום עכשיו". החלטת המשתמש: איסוף מיידי.

המסך יכול להציג:

- "מתבצע אימות מיקום..."
- "המיקום נשלח בהצלחה"
- "לא הצלחנו לקבל מיקום. אחראי הכיתה יסמן אותך ידנית."

### 12.3 כשלי מיקום

אם המשתמש דחה הרשאה:

- נרשם `DENIED_BY_USER`.
- הוא עובר לרכז.
- במסך תלמיד מוצג: "לא התקבל מיקום. אחראי הכיתה יטפל בסימון."

אם GPS לא זמין:

- נרשם `UNAVAILABLE` או `TIMEOUT`.
- עובר לרכז.

אם אין סשן פעיל:

- אין איסוף.
- מסך הבית רגיל.

---

## 13. UX רכז כיתה

### 13.1 תפקיד

רכז כיתה אחראי לסמן תלמידים שלא אומתו אוטומטית, או לסמן את כל הכיתה בביקורת ללא מיקום.

### 13.2 כניסה

כאשר יש סשן פעיל:

- רכז רואה banner עליון: "ביקורת פנימית פעילה".
- אם ביקורת עם מיקום: הוא רואה "דורשים אימות".
- אם ביקורת ללא מיקום: הוא רואה את כל תלמידי הכיתה לסימון.

### 13.3 אפשרויות סימון

לכל תלמיד:

1. נוכח.
2. בחוץ עם אישור.
3. בחוץ בלי אישור.

הטקסטים חייבים להיות ברורים, גדולים, וניתנים ללחיצה מהירה.

### 13.4 תלמיד עם יציאה מאושרת

רכז רואה:

- "בחוץ עם אישור".
- סטטוס ירוק.
- אפשרות לאשר/להשאיר.

הוא לא צריך לראות מיקום מדויק.

### 13.5 סיום עבודה לרכז

רכז רואה התקדמות:

- X/Y סומנו.
- נשארו N.
- כפתור "סיימתי סימון".

אבל סגירת הביקורת הכללית היא רק של המנהל.

---

## 14. דוחות עבר

### 14.1 נתיב

`/admin/internal-audit/history`

או תחת אותו מסך: tab "ביקורות קודמות".

### 14.2 רשימת ביקורות

כל שורה:

- תאריך.
- שעה.
- מצב: עם מיקום / ללא מיקום.
- מי פתח.
- משך.
- מספר תלמידים.
- תקינים.
- יציאות מאושרות.
- חריגים.
- ללא מענה.

### 14.3 דוח ביקורת מלא

דוח כולל:

- סיכום.
- כיתות.
- תלמידים.
- תגובות GPS.
- סימוני רכזים.
- חריגים.
- ציר זמן.
- מי סימן מה ומתי.
- הערות מנהל.

### 14.4 ייצוא

מומלץ:

- CSV.
- הדפסה/PDF בהמשך.

CSV חייב לכלול UTF-8 BOM כדי להיפתח טוב באקסל בעברית.

---

## 15. אבטחה והרשאות

### 15.1 רמת הרשאה

מנהל:

- יוצר ביקורת.
- רואה הכל.
- רואה מיקום מדויק.
- סוגר ביקורת.
- רואה דוחות עבר.
- מתקן סימוני רכז.

רכז:

- רואה רק כיתה שלו.
- לא רואה lat/lng.
- מסמן תלמידי כיתה שלו.
- רואה יציאה מאושרת.

תלמיד:

- שולח מיקום רק עבור עצמו.
- לא רואה נתוני ביקורת של אחרים.

### 15.2 RLS

יש להפעיל RLS על טבלאות חדשות אם הן חשופות דרך Data API.

מדיניות מינימלית:

- Admin authenticated יכול לקרוא/לכתוב הכל.
- Supervisor יכול לקרוא רק rows של class_id שלו דרך RPC מאובטח או view מסונן.
- Student יכול לבצע RPC שמעדכן רק response שלו.

בגלל שמערכת קיימת משתמשת חלקית ב־anon ו־PIN, כדאי להעביר פעולות רגישות ל־RPC SECURITY DEFINER מבוקר, ולא לפתוח טבלאות ישירות ל־anon.

### 15.3 מיקום מדויק

lat/lng נשמרים לצמיתות לפי דרישת המשתמש, אבל נחשפים רק למנהל במסך המיוחד.

בכל מקום אחר:

- רכז רואה קטגוריה.
- הקרנה יכולה להציג שם וסטטוס, לא lat/lng.
- דוחות עבר למנהל יכולים לכלול lat/lng.

---

## 16. עיצוב חזותי

### 16.1 כיוון עיצוב

הכיוון אינו "דף שיווקי" ואינו "כרטיסיות יפות". זה כלי שליטה תפעולי.

הסגנון המומלץ:

- חדר מצב מודרני.
- צפוף אך מאורגן.
- קונטרסט גבוה.
- טיפוגרפיה עברית נקייה.
- צבעים פונקציונליים.
- אנימציות תכליתיות.

### 16.2 צבעים

צבעי מצב:

- ירוק: תקין / יציאה מאושרת.
- אדום: חריגה קריטית.
- צהוב: דורש טיפול.
- כחול: נתוני GPS / live.
- אפור: ממתין / לא ידוע.

צריך להימנע מממשק שנשלט רק על ידי כחול/סגול. הדשבורד חייב להשתמש בצבעי מצב אמיתיים.

### 16.3 רכיבים חדשים

מומלץ ליצור:

- `LiveAuditShell`
- `AuditCommandHeader`
- `AuditMetricStrip`
- `AuditClassMatrix`
- `AuditStudentGrid`
- `AuditLiveFeed`
- `AuditAlertStack`
- `AuditProjectionView`
- `SupervisorAuditPanel`
- `StudentAuditCollector`
- `PreviousAuditsPage`

### 16.4 נגישות

- צבע אינו הסימון היחיד; יש גם טקסט ואייקון.
- כפתורי רכז גדולים.
- מתאים למסכי mobile.
- מתאים למסכי desktop רחבים.
- אין טקסט שגולש מחוץ לכפתורים.
- טבלאות דחוסות אבל קריאות.

---

## 17. מבנה קבצים מוצע

```txt
src/features/internal-audit/
  pages/
    InternalAuditPage.tsx
    AuditProjectionPage.tsx
    AuditHistoryPage.tsx
  components/
    AuditStartDialog.tsx
    AuditCommandHeader.tsx
    AuditMetricStrip.tsx
    AuditClassMatrix.tsx
    AuditStudentTable.tsx
    AuditLiveFeed.tsx
    AuditAlertStack.tsx
    AuditSummaryPanel.tsx
    SupervisorAuditPanel.tsx
    StudentAuditCollector.tsx
  hooks/
    useActiveAuditSession.ts
    useAuditRealtime.ts
    useAuditDashboardData.ts
    useStudentAuditCollector.ts
    useSupervisorAudit.ts
  domain/
    auditStatus.ts
    auditSummary.ts
    auditLocation.ts
    auditPermissions.ts
  api/
    auditApi.ts
    auditTypes.ts
```

קבצי DB:

```txt
supabase/migrations/<timestamp>_internal_audit_sessions.sql
supabase/functions/send-audit-push/index.ts
```

בדיקות:

```txt
src/features/internal-audit/domain/__tests__/auditStatus.test.ts
src/features/internal-audit/domain/__tests__/auditSummary.test.ts
src/features/internal-audit/api/__tests__/auditApi.mock.test.ts
```

---

## 18. בדיקות חובה

### 18.1 בדיקות דומיין

תרחישים:

- תלמיד עם יציאה מאושרת מסומן ירוק גם אם מרחק 20 ק"מ.
- תלמיד ללא יציאה מאושרת ומרחק 6 ק"מ מסומן חריג אדום.
- תלמיד ללא מיקום עובר ל־`NEEDS_SUPERVISOR`.
- סימון רכז `PRESENT` פותר חוסר מיקום.
- סימון רכז `OUTSIDE_UNAPPROVED` מייצר חריגה.
- דיוק נמוך יוצר `LOW_CONFIDENCE`.

### 18.2 בדיקות API/mock

תרחישים:

- יצירת סשן יוצרת participants לכל הכיתות שנבחרו.
- refresh מחזיר סשן פעיל.
- תגובת מיקום עושה upsert.
- סימון רכז עושה upsert.
- סיום ביקורת יוצר summary.

### 18.3 בדיקות UI

תרחישים:

- מנהל פותח ביקורת.
- תלמיד שולח מיקום.
- המנהל רואה עדכון חי.
- רכז מסמן תלמיד שלא שלח.
- המנהל רואה הסימון.
- סיום ביקורת מציג סיכום.
- דוח עבר נפתח.

### 18.4 בדיקת refresh

חובה לבדוק:

- מנהל מרענן באמצע ביקורת.
- רכז מרענן באמצע סימון.
- תלמיד מרענן אחרי פתיחת התראה.
- מסך הקרנה מרענן.

בכל המקרים, המצב נשמר.

---

## 19. שלבי מימוש מומלצים

### שלב 1: Domain ו־DB

- ליצור מיגרציה לטבלאות החדשות.
- להוסיף טיפוסים TypeScript.
- להוסיף פונקציות domain לחישוב סטטוס.
- להוסיף בדיקות domain.

### שלב 2: API

- להוסיף `auditApi`.
- להוסיף mock implementation.
- להוסיף Supabase implementation.
- להוסיף RPC/queries.
- להוסיף בדיקות.

### שלב 3: תלמיד

- לעדכן Service Worker לפתיחת URL מסשן.
- להוסיף collector שמזהה סשן פעיל.
- לבצע איסוף מיקום אוטומטי.
- לשמור response.

### שלב 4: מנהל

- לבנות `InternalAuditPage` החדש.
- להפעיל סשן.
- להציג מטריקות.
- להציג טבלת תלמידים.
- להציג alerts.
- להוסיף סיום ביקורת.

### שלב 5: רכז

- להוסיף פאנל ביקורת בתוך מסך רכז או route חדש.
- להציג תלמידים שדורשים סימון.
- לשמור סימונים למסד.
- לחבר Realtime.

### שלב 6: הקרנה והיסטוריה

- לבנות projection.
- לבנות history.
- לבנות detail report.
- לבנות export CSV.

### שלב 7: polish ו־verification

- בדיקות build.
- בדיקות responsive.
- בדיקות refresh.
- בדיקות Realtime.
- בדיקות Hebrew/RTL.
- בדיקות production-like.

---

## 20. סיכונים והחלטות פתוחות

### 20.1 Push tokens

לא לכל תלמיד יהיה push token. לכן:

- לפני הפעלה מציגים כמה מכשירים רשומים.
- מי שאין לו token עדיין יוכל להיכנס לאפליקציה ולשלוח מיקום אם יפתח אותה.
- בסשן מוצג סטטוס "לא נשלחה התראה" או "אין מכשיר רשום".

### 20.2 הרשאת מיקום

משתמש יכול לדחות הרשאה. אין לעקוף זאת. המערכת מתעדת ומעבירה לרכז.

### 20.3 דיוק GPS

GPS יכול להיות לא מדויק. מומלץ:

- לשמור accuracy.
- אם accuracy מעל 150-300 מטר, להציג "דיוק נמוך".
- לא להפוך דיוק נמוך בלבד לחריגה אדומה בלי שיקול נוסף.

### 20.4 שמירה לצמיתות

המשתמש ביקש לשמור תמיד. מומלץ בעתיד להוסיף:

- מסך מדיניות.
- ייצוא דוח.
- מחיקה ידנית לפי הרשאה.
- הסתרת קואורדינטות בדוחות שאינם למנהל.

---

## 21. מקורות מקצועיים

מקורות רשמיים שנבדקו לצורך התכנון:

- MDN Geolocation API: `https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API`
- MDN `getCurrentPosition`: `https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition`
- MDN Push API: `https://developer.mozilla.org/en-US/docs/Web/API/Push_API`
- MDN Service Worker notification click: `https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event`
- Supabase Realtime Postgres Changes: `https://supabase.com/docs/guides/realtime/postgres-changes`
- Supabase Realtime Broadcast: `https://supabase.com/docs/guides/realtime/broadcast`
- Supabase Row Level Security: `https://supabase.com/docs/guides/database/postgres/row-level-security`

מסקנות מהמקורות:

- איסוף מיקום בדפדפן מחייב secure context והרשאת משתמש.
- Push יכול לפתוח את האפליקציה, אך לא אמור לאסוף GPS כשהאפליקציה סגורה.
- Realtime מתאים לעדכון מסכים חיים, אבל מקור האמת חייב להיות DB.
- בטבלאות חשופות ב־Supabase יש להתייחס ל־RLS והרשאות במפורש.

---

## 22. קריטריוני הצלחה

הפיצ'ר ייחשב מוכן רק אם כל הקריטריונים מתקיימים:

- מנהל יכול לפתוח ביקורת עם מיקום.
- תלמידים מקבלים Push.
- תלמיד שנכנס שולח מיקום אוטומטית.
- מנהל רואה תגובות נכנסות בזמן אמת.
- תלמיד מעל 5 ק"מ בלי אישור מסומן אדום עם alert.
- תלמיד עם יציאה מאושרת מסומן ירוק.
- תלמיד ללא מיקום עובר לרכז.
- רכז מסמן נוכח/בחוץ עם אישור/בחוץ בלי אישור.
- סימון רכז מופיע בלייב אצל המנהל.
- ביקורת ללא מיקום עובדת לכל רכזי הכיתה.
- refresh לא מאבד סשן אצל מנהל.
- refresh לא מאבד משימת סימון אצל רכז.
- refresh לא שובר איסוף מיקום לתלמיד.
- מסך הקרנה מציג נתונים חיים.
- סיום ביקורת יוצר סיכום.
- דוח עבר נשמר ונפתח.
- build עובר.
- בדיקות domain/API עוברות.

---

## 23. מסקנה

הביקורת הפנימית החדשה צריכה להיות feature מרכזי, לא תוספת קטנה לדשבורד. היא חייבת להיות בנויה סביב סשן ביקורת שנשמר במסד הנתונים, עם Realtime כמנגנון הצגה חי, Push כטריגר כניסה לתלמיד, ורכזי כיתה כשכבת אימות אנושית.

המסך החדש צריך לתת למנהל תחושה שהוא פותח חדר מצב אמיתי: נתונים נכנסים, שמות מופיעים, חריגים קופצים, כיתות מתעדכנות, רכזים סוגרים פערים, ובסוף נשמר דוח מלא.

הכיוון המאושר הוא לבנות מחדש את המוצר סביב הארכיטקטורה הזו, תוך שמירה על חוקי היציאות והמכסות הקיימים, ותוך החלפה כמעט מלאה של UX הביקורת הישן.
