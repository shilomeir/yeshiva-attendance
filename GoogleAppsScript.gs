/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  סנכרון גיליון → Supabase  |  ישיבת שבי חברון                      ║
 * ║                                                                      ║
 * ║  הגדרה חד-פעמית:                                                    ║
 * ║  1. Extensions → Apps Script → Project Settings → Script Properties ║
 * ║     הוסף שתי מאפיינים:                                              ║
 * ║       SUPABASE_URL       = https://[PROJECT-ID].supabase.co         ║
 * ║       SHEETS_SYNC_SECRET = [הסיסמה שהגדרת ב-Supabase Secrets]      ║
 * ║                                                                      ║
 * ║  2. Triggers → Add Trigger:                                          ║
 * ║       Function: onSheetEdit  |  Event: From spreadsheet → On edit   ║
 * ║                                                                      ║
 * ║  שימוש: סמן את הצ'קבוקס בתא A1 בכל טאב כדי להפעיל סנכרון מלא.   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ── טאבים שיסונכרנו ──────────────────────────────────────────────────────────
var TARGET_TABS = [
  "שיעור א'",
  "שיעור ב'",
  "שיעור ג'",
  "שיעור ד'-ה'",
  "אברכים ובוגרצ'",
];

// ── Trigger — מופעל על כל עריכה בגיליון ─────────────────────────────────────
function onSheetEdit(e) {
  try {
    // רק כשמסמנים A1 כ-TRUE
    if (e.range.getA1Notation() !== 'A1') return;
    if (e.range.getValue() !== true) return;

    // אפס את הצ'קבוקס מיד (מונע הפעלה כפולה)
    e.range.setValue(false);

    syncAllTabs();
  } catch (err) {
    SpreadsheetApp.getUi().alert('❌ שגיאה בלתי צפויה:\n\n' + err.toString());
  }
}

// ── סנכרון כל הטאבים ─────────────────────────────────────────────────────────
function syncAllTabs() {
  var props  = PropertiesService.getScriptProperties();
  var baseUrl = props.getProperty('SUPABASE_URL');
  var secret  = props.getProperty('SHEETS_SYNC_SECRET');

  if (!baseUrl || !secret) {
    SpreadsheetApp.getUi().alert(
      '⚠️ חסרות הגדרות!\n\n' +
      'נא להגדיר ב-Project Settings → Script Properties:\n' +
      '• SUPABASE_URL\n• SHEETS_SYNC_SECRET'
    );
    return;
  }

  var url = baseUrl.replace(/\/$/, '') + '/functions/v1/sync-from-sheets';
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var payload = {};

  TARGET_TABS.forEach(function(tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      Logger.log('טאב לא נמצא: ' + tabName);
      return;
    }
    payload[tabName] = parseTab(sheet);
    Logger.log(tabName + ': ' + payload[tabName].length + ' תלמידים');
  });

  // שלח לEdge Function
  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { 'X-Sync-Secret': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,  // תמיד קבל את הגוף, גם בשגיאות
    });
  } catch (fetchErr) {
    SpreadsheetApp.getUi().alert(
      '❌ שגיאת רשת — לא ניתן להתחבר לשרת:\n\n' + fetchErr.toString()
    );
    return;
  }

  var statusCode = res.getResponseCode();
  var bodyText   = res.getContentText();

  // שגיאת HTTP — הצג הודעה מדויקת מהשרת
  if (statusCode < 200 || statusCode >= 300) {
    var errMsg = '❌ שגיאה מהשרת (HTTP ' + statusCode + '):\n\n';
    try {
      var parsed = JSON.parse(bodyText);
      errMsg += (parsed.error || parsed.message || bodyText);
    } catch (_) {
      errMsg += (bodyText || '(אין תגובה מהשרת)');
    }
    SpreadsheetApp.getUi().alert(errMsg);
    return;
  }

  // פרסר תגובת JSON
  var result;
  try {
    result = JSON.parse(bodyText);
  } catch (_) {
    SpreadsheetApp.getUi().alert('⚠️ תגובה לא צפויה מהשרת:\n\n' + bodyText);
    return;
  }

  showSummary(result);
}

// ── פרסר תוכן טאב ────────────────────────────────────────────────────────────
function parseTab(sheet) {
  var dataRange = sheet.getDataRange();
  var values    = dataRange.getValues();
  var fontSizes = dataRange.getFontSizes();

  var students     = [];
  var currentClass = null;
  var idCol        = detectIdColumn(values);

  values.forEach(function(row, rowIdx) {
    var rowText = row.map(function(c) { return String(c); }).join(' ');

    // כותרת כיתה: גופן ≥ 14pt + מכיל "כית"
    var rowFonts  = fontSizes[rowIdx].filter(function(f) { return f > 0; });
    var maxFont   = rowFonts.length > 0 ? Math.max.apply(null, rowFonts) : 0;

    if (maxFont >= 14 && /כית/.test(rowText)) {
      var headerCell = row.find(function(c) { return /כית/.test(String(c)); });
      if (headerCell) currentClass = String(headerCell).trim();
      return;
    }

    // שורת תלמיד
    if (!currentClass || idCol === -1) return;

    // padStart(9,'0') — Sheets מסיר אפסים מובילים מספרים (033... → 33...)
    var rawId = String(row[idCol]).trim().replace(/[^0-9]/g, '');
    var idVal = rawId.padStart(9, '0');
    if (!/^\d{9}$/.test(idVal) || rawId.length === 0) return;

    // שם: כל תא בשורה עם טקסט עברי (מחוץ לעמודת הת"ז)
    var nameParts = [];
    row.forEach(function(cell, colIdx) {
      if (colIdx === idCol) return;
      var text = String(cell).trim();
      if (text.length > 1 && /[\u0590-\u05FF]/.test(text)) {
        nameParts.push(text);
      }
    });
    var fullName = nameParts.join(' ').trim();
    if (!fullName) return;

    students.push({
      idNumber: idVal,
      fullName: fullName,
      classId:  currentClass,
    });
  });

  return students;
}

// ── זיהוי עמודת ת"ז ───────────────────────────────────────────────────────────
function detectIdColumn(values) {
  var sample   = values.slice(0, 40);
  var colCount = Math.max.apply(null, sample.map(function(r) { return r.length; }));

  for (var c = 0; c < colCount; c++) {
    var hits = 0, total = 0;
    sample.forEach(function(row) {
      var raw = String(row[c] !== undefined ? row[c] : '').trim().replace(/[^0-9]/g, '');
      if (raw.length === 0) return;
      total++;
      // padStart כדי לסמן גם מספרים שאפסיהם נקצצו
      if (/^\d{9}$/.test(raw.padStart(9, '0')) && raw.length >= 8) hits++;
    });
    if (total > 0 && hits / total > 0.4) return c;
  }
  return -1;
}

// ── הצגת סיכום ───────────────────────────────────────────────────────────────
function showSummary(result) {
  var msg = '✅ סנכרון הושלם!\n\n';

  // תוצאות לפי שכבה
  msg += '📊 תוצאות:\n';
  var grades = result.grades || {};
  Object.keys(grades).forEach(function(grade) {
    var s = grades[grade];
    msg += '• ' + grade + ': ' + s.upserted + ' עודכנו, ' + s.deleted + ' נמחקו\n';
  });

  // קודי רכזים
  var codes = result.classCodes || [];
  if (codes.length > 0) {
    msg += '\n🔑 קודי רכזי כיתות:\n';
    codes.forEach(function(item) {
      msg += '• ' + item.classId + '\n';
      msg += '  קוד=' + item.code + '  |  PIN רכז=' + item.supervisorPin + '\n';
    });
    msg += '\n💡 שמור קודים אלו — תוכל להפיץ לרבנים.\n';
    msg += '(הקודים יתעדכנו אוטומטית אם תשנה את ה-PIN הניהולי)';
  }

  SpreadsheetApp.getUi().alert(msg);
}

// ── פונקציה ידנית לבדיקה (ניתן להריץ ישירות מ-Apps Script Editor) ────────────
function runSyncManually() {
  syncAllTabs();
}
