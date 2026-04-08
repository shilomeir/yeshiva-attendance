/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  סנכרון גיליון → Supabase  |  ישיבת שבי חברון                      ║
 * ║                                                                      ║
 * ║  הגדרה חד-פעמית:                                                    ║
 * ║  1. Extensions → Apps Script → Project Settings → Script Properties ║
 * ║     הוסף שני מאפיינים:                                              ║
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
// ⚠️  אם סנכרון טאב מסוים נכשל, הרץ debugListTabs() כדי לראות את השמות המדויקים.
var TARGET_TABS = [
  "שיעור א'",
  "שיעור ב'",
  "שיעור ג'",
  "שיעור ד'-ה'",
  "אברכים ובוגרצ'",
];

// ── נרמול שם לצורך השוואה גמישה ─────────────────────────────────────────────
// מסיר: אפוסטרוף, גרש עברי, מרכאות, מקפים, רווחים כפולים
function normalizeTabName(name) {
  return String(name)
    .replace(/['\u05F3"״׳`]/g, '') // אפוסטרופים וגרשיים
    .replace(/[-–—]/g, '')          // מקפים
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ── מציאת גיליון עם התאמה גמישה ─────────────────────────────────────────────
function findSheet(ss, targetName) {
  var sheets = ss.getSheets();
  var normTarget = normalizeTabName(targetName);

  // 1. התאמה מדויקת
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === targetName) return sheets[i];
  }
  // 2. התאמה גמישה (ללא אפוסטרופים ומקפים)
  for (var j = 0; j < sheets.length; j++) {
    if (normalizeTabName(sheets[j].getName()) === normTarget) return sheets[j];
  }
  return null;
}

// ── DEBUG: הצג את שמות כל הטאבים ────────────────────────────────────────────
// הרץ פונקציה זו מ-Apps Script Editor אם טאב לא נמצא
function debugListTabs() {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var msg    = '📋 טאבים בגיליון זה:\n\n';
  sheets.forEach(function(s, i) {
    var name = s.getName();
    var found = TARGET_TABS.some(function(t) {
      return normalizeTabName(t) === normalizeTabName(name);
    });
    msg += (i + 1) + '. "' + name + '"' + (found ? ' ✅' : ' ❌ (לא ברשימה)') + '\n';
  });
  msg += '\nעדכן את TARGET_TABS בקוד אם יש ❌.';
  SpreadsheetApp.getUi().alert(msg);
}

// ── Trigger — מופעל על כל עריכה בגיליון ─────────────────────────────────────
function onSheetEdit(e) {
  try {
    if (e.range.getA1Notation() !== 'A1') return;
    if (e.range.getValue() !== true) return;
    e.range.setValue(false);
    syncAllTabs();
  } catch (err) {
    SpreadsheetApp.getUi().alert('❌ שגיאה בלתי צפויה:\n\n' + err.toString());
  }
}

// ── סנכרון כל הטאבים ─────────────────────────────────────────────────────────
function syncAllTabs() {
  var props   = PropertiesService.getScriptProperties();
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

  var url     = baseUrl.replace(/\/$/, '') + '/functions/v1/sync-from-sheets';
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var payload = {};

  TARGET_TABS.forEach(function(tabName) {
    var sheet = findSheet(ss, tabName);
    if (!sheet) {
      Logger.log('טאב לא נמצא: "' + tabName + '" (הרץ debugListTabs לבדיקה)');
      return;
    }
    var actualName = sheet.getName(); // השם האמיתי בגיליון
    payload[actualName] = parseTab(sheet);
    Logger.log(actualName + ': ' + payload[actualName].length + ' תלמידים');
  });

  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { 'X-Sync-Secret': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (fetchErr) {
    SpreadsheetApp.getUi().alert('❌ שגיאת רשת:\n\n' + fetchErr.toString());
    return;
  }

  var statusCode = res.getResponseCode();
  var bodyText   = res.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    var errMsg = '❌ שגיאה מהשרת (HTTP ' + statusCode + '):\n\n';
    try {
      var p = JSON.parse(bodyText);
      errMsg += (p.error || p.message || bodyText);
    } catch (_) { errMsg += (bodyText || '(אין תגובה)'); }
    SpreadsheetApp.getUi().alert(errMsg);
    return;
  }

  var result;
  try {
    result = JSON.parse(bodyText);
  } catch (_) {
    SpreadsheetApp.getUi().alert('⚠️ תגובה לא צפויה:\n\n' + bodyText);
    return;
  }

  showSummary(result);
}

// ══════════════════════════════════════════════════════════════════════════════
// parseTab — מנתח טאב שבו כיתות מסודרות זו לצד זו (אופקית)
//
// אלגוריתם:
//  1. סרוק כל תא — מצא כותרות כיתה (גופן ≥ 14 + "כית") וציין עמודתן
//  2. מיין לפי עמודה → הגדר טווח עמודות לכל כיתה
//  3. לכל כיתה: מצא עמודת ת"ז בתוך הטווח שלה, קרא תלמידים
// ══════════════════════════════════════════════════════════════════════════════
function parseTab(sheet) {
  var dataRange = sheet.getDataRange();
  var values    = dataRange.getValues();
  var fontSizes = dataRange.getFontSizes();
  var numRows   = values.length;
  var numCols   = numRows > 0 ? values[0].length : 0;
  var students  = [];

  // ── שלב 1: מצא את כל כותרות הכיתות ─────────────────────────────────────
  var classHeaders = [];

  for (var r = 0; r < numRows; r++) {
    for (var c = 0; c < numCols; c++) {
      var cellText = String(values[r][c] || '').trim();
      var fontSize  = fontSizes[r][c] || 0;
      if (fontSize >= 14 && /כית/.test(cellText) && cellText.length > 2) {
        // בדוק שלא הוספנו כבר כותרת מאותו תא (תאים ממוזגים מדווחים פעמים)
        var already = classHeaders.some(function(h) {
          return h.classId === cellText && h.col === c;
        });
        if (!already) {
          classHeaders.push({ classId: cellText, col: c, headerRow: r });
        }
      }
    }
  }

  if (classHeaders.length === 0) {
    Logger.log('לא נמצאו כותרות כיתה בטאב ' + sheet.getName());
    return students;
  }

  // מיין לפי מיקום עמודה (שמאל לימין)
  classHeaders.sort(function(a, b) { return a.col - b.col; });
  Logger.log('כיתות שנמצאו ב-' + sheet.getName() + ':');
  classHeaders.forEach(function(h) { Logger.log('  "' + h.classId + '" עמודה ' + h.col); });

  // ── שלב 2: קבע טווח עמודות לכל כיתה ───────────────────────────────────
  for (var i = 0; i < classHeaders.length; i++) {
    classHeaders[i].startCol = classHeaders[i].col;
    classHeaders[i].endCol   = (i + 1 < classHeaders.length)
      ? classHeaders[i + 1].col - 1
      : numCols - 1;
  }

  // ── שלב 3: לכל כיתה — מצא עמודת ת"ז וקרא תלמידים ─────────────────────
  classHeaders.forEach(function(cls) {
    var idCol = detectIdColumnInRange(values, cls.startCol, cls.endCol);
    if (idCol === -1) {
      Logger.log('לא נמצאה עמודת ת"ז עבור: ' + cls.classId);
      return;
    }
    Logger.log('"' + cls.classId + '" — עמודת ת"ז: ' + idCol);

    for (var r = cls.headerRow + 1; r < numRows; r++) {
      var row = values[r];

      // ת"ז: ספרות בלבד + השלמת אפסים מובילים שנקצצו ע"י Sheets
      var rawId = String(row[idCol] !== undefined ? row[idCol] : '')
                    .trim().replace(/[^0-9]/g, '');
      var idVal = rawId.padStart(9, '0');
      if (rawId.length === 0 || !/^\d{9}$/.test(idVal)) continue;

      // שם: אסוף טקסט עברי מטווח עמודות הכיתה (לא ת"ז, לא checkbox, לא מספרים)
      var nameParts = [];
      for (var c = cls.startCol; c <= cls.endCol; c++) {
        if (c === idCol) continue;
        var text = String(row[c] !== undefined ? row[c] : '').trim();
        if (
          text.length > 1 &&
          /[\u0590-\u05FF]/.test(text) && // מכיל עברית
          !/^\d+$/.test(text)              // לא רק ספרות
        ) {
          nameParts.push(text);
        }
      }

      var fullName = nameParts.join(' ').trim();
      if (!fullName) continue;

      students.push({ idNumber: idVal, fullName: fullName, classId: cls.classId });
    }
  });

  return students;
}

// ── זיהוי עמודת ת"ז בתוך טווח עמודות נתון ───────────────────────────────────
// סורק עמודות startCol..endCol ומחפש את זו שרוב ערכיה הם 8-9 ספרות (ת"ז ישראלית)
function detectIdColumnInRange(values, startCol, endCol) {
  var sample = values.slice(0, Math.min(40, values.length));

  for (var c = startCol; c <= endCol; c++) {
    var hits = 0, total = 0;
    sample.forEach(function(row) {
      var raw = String(row[c] !== undefined ? row[c] : '').trim().replace(/[^0-9]/g, '');
      if (raw.length === 0) return;
      total++;
      // מקבל 8 ספרות (אפס מוביל נקצץ) או 9 ספרות
      if (raw.length >= 8 && /^\d{9}$/.test(raw.padStart(9, '0'))) hits++;
    });
    if (total > 0 && hits / total > 0.4) return c;
  }
  return -1;
}

// ── הצגת סיכום ───────────────────────────────────────────────────────────────
function showSummary(result) {
  var msg = '✅ סנכרון הושלם!\n\n📊 תוצאות:\n';

  var grades = result.grades || {};
  Object.keys(grades).forEach(function(grade) {
    var s = grades[grade];
    msg += '• ' + grade + ': ' + s.upserted + ' עודכנו, ' + s.deleted + ' נמחקו\n';
  });

  var codes = result.classCodes || [];
  if (codes.length > 0) {
    msg += '\n🔑 קודי רכזי כיתות:\n';
    codes.forEach(function(item) {
      msg += '• ' + item.classId + '\n';
      msg += '  קוד=' + item.code + '  |  PIN רכז=' + item.supervisorPin + '\n';
    });
    msg += '\n💡 שמור קודים אלו — תוכל להפיץ לרבנים.\n';
    msg += '(הקודים מתעדכנים אוטומטית אם תשנה את ה-PIN הניהולי)';
  }

  SpreadsheetApp.getUi().alert(msg);
}

// ── הרצה ידנית לבדיקה (מ-Apps Script Editor) ─────────────────────────────────
function runSyncManually() {
  syncAllTabs();
}

// ── DEBUG: בדיקת פרסור טאב ספציפי ללא שליחה לשרת ────────────────────────────
// שנה את TAB_TO_DEBUG לשם הטאב שרוצים לבדוק, ואז הרץ את הפונקציה.
function debugParseTab() {
  var TAB_TO_DEBUG = "שיעור א'"; // ← שנה כאן

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = findSheet(ss, TAB_TO_DEBUG);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('טאב לא נמצא: "' + TAB_TO_DEBUG + '"\nהרץ debugListTabs לרשימה מלאה.');
    return;
  }

  var dataRange = sheet.getDataRange();
  var values    = dataRange.getValues();
  var fontSizes = dataRange.getFontSizes();
  var numRows   = values.length;
  var numCols   = numRows > 0 ? values[0].length : 0;

  // ── מצא כותרות כיתה (אותה לוגיקה כמו parseTab) ──────────────────────────
  var classHeaders = [];
  for (var r = 0; r < numRows; r++) {
    for (var c = 0; c < numCols; c++) {
      var cellText = String(values[r][c] || '').trim();
      var fontSize  = fontSizes[r][c] || 0;
      if (fontSize >= 14 && /כית/.test(cellText) && cellText.length > 2) {
        var already = classHeaders.some(function(h) { return h.classId === cellText && h.col === c; });
        if (!already) classHeaders.push({ classId: cellText, col: c, headerRow: r });
      }
    }
  }

  classHeaders.sort(function(a, b) { return a.col - b.col; });
  for (var i = 0; i < classHeaders.length; i++) {
    classHeaders[i].startCol = classHeaders[i].col;
    classHeaders[i].endCol   = (i + 1 < classHeaders.length) ? classHeaders[i + 1].col - 1 : numCols - 1;
  }

  // ── הרץ parseTab ועצור לפני שליחה ──────────────────────────────────────
  var students = parseTab(sheet);

  // ── בנה סיכום ──────────────────────────────────────────────────────────
  var msg = '🔍 ניתוח טאב: "' + sheet.getName() + '"\n';
  msg += 'גודל גיליון: ' + numRows + ' שורות × ' + numCols + ' עמודות\n\n';

  if (classHeaders.length === 0) {
    msg += '⚠️ לא נמצאו כותרות כיתה (גופן ≥ 14 + "כית")!\n';
    msg += 'בדוק שהכותרת כתובה עם "כית" ושהגופן גדול מ-14.';
    SpreadsheetApp.getUi().alert(msg);
    return;
  }

  msg += '📌 כיתות שנמצאו (' + classHeaders.length + '):\n';
  classHeaders.forEach(function(cls) {
    var idCol = detectIdColumnInRange(values, cls.startCol, cls.endCol);
    var colLetter = colToLetter(cls.startCol) + '–' + colLetter(cls.endCol);
    msg += '• "' + cls.classId + '"\n';
    msg += '  עמודות: ' + colLetter + ' | שורת כותרת: ' + (cls.headerRow + 1);
    msg += ' | עמודת ת"ז: ' + (idCol === -1 ? '❌ לא נמצאה' : colToLetter(idCol)) + '\n';
  });

  msg += '\n👥 תלמידים שנקראו: ' + students.length + '\n';

  // הצג 3 תלמידים ראשונים מכל כיתה לאימות
  var byClass = {};
  students.forEach(function(s) {
    if (!byClass[s.classId]) byClass[s.classId] = [];
    byClass[s.classId].push(s);
  });
  msg += '\nדוגמה (3 ראשונים לכל כיתה):\n';
  Object.keys(byClass).forEach(function(cls) {
    msg += '\n[' + cls + ']\n';
    byClass[cls].slice(0, 3).forEach(function(s) {
      msg += '  ' + s.fullName + ' | ' + s.idNumber + '\n';
    });
    if (byClass[cls].length > 3) msg += '  ... ועוד ' + (byClass[cls].length - 3) + '\n';
  });

  SpreadsheetApp.getUi().alert(msg);
}

// עזר: מספר עמודה → אות (0→A, 1→B, ...)
function colToLetter(col) {
  var letter = '';
  col++;
  while (col > 0) {
    var rem = (col - 1) % 26;
    letter  = String.fromCharCode(65 + rem) + letter;
    col     = Math.floor((col - 1) / 26);
  }
  return letter;
}

// alias קצר לשימוש פנימי
function colLetter(col) { return colToLetter(col); }
