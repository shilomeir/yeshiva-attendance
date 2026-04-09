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
 * ║  שימוש: סמן את הצ'קבוקס בתא A1 כדי להפעיל סנכרון מלא.            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ── טאבים שיסונכרנו ──────────────────────────────────────────────────────────
// (ללא אפוסטרופים — findSheet מטפל בהתאמה גמישה)
var TARGET_TABS = [
  "שיעור א",
  "שיעור ב",
  "שיעור ג",
  "שיעור ד-ה",
  "אברכים ובוגרצ",
];

// ── נרמול שם לצורך השוואה גמישה ─────────────────────────────────────────────
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
  var sheets      = ss.getSheets();
  var normTarget  = normalizeTabName(targetName);

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

// ── DEBUG: הצג שמות כל הטאבים ────────────────────────────────────────────────
function debugListTabs() {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var msg    = '📋 טאבים בגיליון זה:\n\n';
  sheets.forEach(function(s, i) {
    var name  = s.getName();
    var found = TARGET_TABS.some(function(t) {
      return normalizeTabName(t) === normalizeTabName(name);
    });
    msg += (i + 1) + '. "' + name + '"' + (found ? ' ✅' : ' ❌ (לא ברשימה)') + '\n';
  });
  msg += '\nעדכן TARGET_TABS בקוד אם יש ❌.';
  SpreadsheetApp.getUi().alert(msg);
}

// ── Trigger ───────────────────────────────────────────────────────────────────
function onSheetEdit(e) {
  try {
    if (e.range.getA1Notation() !== 'A1') return;
    if (e.range.getValue() !== true) return;
    e.range.setValue(false);
    syncAllTabs();
  } catch (err) {
    SpreadsheetApp.getUi().alert('❌ שגיאה:\n\n' + err.toString());
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
      Logger.log('⚠️ טאב לא נמצא: "' + tabName + '" (הרץ debugListTabs לבדיקה)');
      return;
    }
    var actualName        = sheet.getName();
    payload[actualName]   = parseTab(sheet);
    Logger.log(actualName + ': ' + payload[actualName].length + ' תלמידים');
  });

  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      method          : 'post',
      contentType     : 'application/json; charset=utf-8',
      headers         : { 'X-Sync-Secret': secret },
      payload         : JSON.stringify(payload),
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
// parseTab — מנתח טאב שבו כיתות מסודרות אופקית AND אנכית (סקציות מרובות)
//
// מבנה הגיליון (מתוך בדיקה):
//   שורה X   : כותרות כיתות (גופן גדול + "כית") — שתיים / יותר זו לצד זו
//   שורות ... : שמות + ת"ז + נתוני נוכחות
//   שורת סיכום: מכילה "סה"כ" — כאן מסתיימת הסקציה
//   (ריווח)
//   שורה Y   : כותרות הסקציה הבאה — ושוב
//
// אלגוריתם:
//  1. מצא כל כותרות כיתה → { classId, row, col }
//  2. מצא שורות סיכום ("סה"כ") → מגדירות את סוף כל סקציה
//  3. קבץ כותרות לסקציות לפי קרבת שורה (±3)
//  4. לכל סקציה: מיין לפי עמודה → קבע טווחי עמודות
//  5. לכל כיתה: זהה עמודת ת"ז, קרא תלמידים בין headerRow+1 ל-sectionEnd
// ══════════════════════════════════════════════════════════════════════════════
function parseTab(sheet) {
  var dataRange = sheet.getDataRange();
  var values    = dataRange.getValues();
  var fontSizes = dataRange.getFontSizes();
  var numRows   = values.length;
  var numCols   = numRows > 0 ? values[0].length : 0;
  var students  = [];

  // ── שלב 1: מצא כותרות כיתה ───────────────────────────────────────────
  var allHeaders = []; // { classId, row, col }
  for (var r = 0; r < numRows; r++) {
    for (var c = 0; c < numCols; c++) {
      var cellText = String(values[r][c] || '').trim();
      var fontSize = fontSizes[r][c] || 0;
      if (fontSize >= 14 && /כית/.test(cellText) && cellText.length > 2) {
        var dup = allHeaders.some(function(h) {
          return h.classId === cellText && h.col === c;
        });
        if (!dup) allHeaders.push({ classId: cellText, row: r, col: c });
      }
    }
  }

  if (allHeaders.length === 0) {
    Logger.log('⚠️ לא נמצאו כותרות כיתה (גופן ≥14 + "כית") ב-' + sheet.getName());
    return students;
  }

  // ── שלב 2: מצא שורות סיכום ("סה"כ") ──────────────────────────────────
  var summaryRows = [];
  for (var r = 0; r < numRows; r++) {
    var rowText = values[r].map(function(v) { return String(v || ''); }).join('');
    // מזהה: "סה"כ", "סה״כ", "סהכ" בכל צורה
    if (/סה.?כ/.test(rowText)) summaryRows.push(r);
  }

  // ── שלב 3: קבץ כותרות לסקציות (כותרות בתוך ±3 שורות = אותה סקציה) ───
  allHeaders.sort(function(a, b) {
    return a.row !== b.row ? a.row - b.row : a.col - b.col;
  });

  var sections = [];
  allHeaders.forEach(function(hdr) {
    for (var s = 0; s < sections.length; s++) {
      var inSec = sections[s].some(function(h) {
        return Math.abs(hdr.row - h.row) <= 3;
      });
      if (inSec) { sections[s].push(hdr); return; }
    }
    sections.push([hdr]);
  });

  Logger.log(sheet.getName() + ': ' + sections.length + ' סקציות, ' + allHeaders.length + ' כיתות');

  // ── שלב 4-5: לכל סקציה — טווחי עמודות + קריאת תלמידים ────────────────
  sections.forEach(function(section, secIdx) {
    section.sort(function(a, b) { return a.col - b.col; });

    // שורת הכותרת המינימלית בסקציה זו
    var secHeaderRow = section.reduce(function(mn, h) { return Math.min(mn, h.row); }, numRows);

    // שורת סיום: ה-"סה"כ" הראשון לאחר שורת הכותרת
    var secEndRow = numRows;
    summaryRows.forEach(function(sr) {
      if (sr > secHeaderRow && sr < secEndRow) secEndRow = sr;
    });
    // גם: תחילת הסקציה הבאה (להגנה כשאין "סה"כ")
    sections.forEach(function(other) {
      var otherMin = other.reduce(function(mn, h) { return Math.min(mn, h.row); }, numRows);
      if (otherMin > secHeaderRow && otherMin < secEndRow) secEndRow = otherMin;
    });

    Logger.log('  סקציה ' + (secIdx + 1) + ': שורה ' + secHeaderRow + '-' + (secEndRow - 1) + ', כיתות: ' + section.map(function(h) { return h.classId; }).join(', '));

    // קבע טווחי עמודות לכל כיתה בסקציה
    for (var i = 0; i < section.length; i++) {
      section[i].startCol = section[i].col;
      section[i].endCol   = (i + 1 < section.length)
        ? section[i + 1].col - 1
        : numCols - 1;
    }

    // קרא תלמידים לכל כיתה
    section.forEach(function(cls) {
      var dataStart = cls.row + 1; // שורה ראשונה של נתונים (אחרי הכותרת)
      var idCol = detectIdColumnInRange(values, cls.startCol, cls.endCol, dataStart, secEndRow);

      if (idCol === -1) {
        Logger.log('    ⚠️ אין עמודת ת"ז ל-"' + cls.classId + '" (עמ\' ' + cls.startCol + '-' + cls.endCol + ')');
        return;
      }
      Logger.log('    "' + cls.classId + '" → עמ\' ' + cls.startCol + '-' + cls.endCol +
                 ' | ת"ז: עמ\' ' + idCol + ' | שורות ' + dataStart + '-' + (secEndRow - 1));

      for (var r = dataStart; r < secEndRow; r++) {
        var row = values[r];

        // ת"ז: ספרות בלבד + השלמת אפס מוביל שנקצץ ע"י Sheets
        var rawId = String(row[idCol] !== undefined ? row[idCol] : '')
                      .trim().replace(/[^0-9]/g, '');
        var idVal = rawId.padStart(9, '0');
        if (rawId.length === 0 || !/^\d{9}$/.test(idVal)) continue;

        // שם: שם משפחה + שם פרטי נמצאים תמיד בעמודות מיד לפני ת"ז (idCol-3..idCol-1)
        // (לא סורקים את כל טווח הכיתה כדי לא לבלבל עם עמודות של הכיתה השכנה)
        var nameParts = [];
        for (var c = Math.max(0, idCol - 3); c < idCol; c++) {
          var text = String(row[c] !== undefined ? row[c] : '').trim();
          if (
            text.length > 1 &&
            /[\u0590-\u05FF]/.test(text) &&   // מכיל עברית
            !/^\d+(\.\d+)?$/.test(text)        // לא מספר בלבד
          ) {
            nameParts.push(text);
          }
        }

        var fullName = nameParts.join(' ').trim();
        if (!fullName) continue;

        students.push({ idNumber: idVal, fullName: fullName, classId: cls.classId });
      }
    });
  });

  return students;
}

// ── זיהוי עמודת ת"ז בתוך טווח עמודות + טווח שורות נתון ─────────────────────
function detectIdColumnInRange(values, startCol, endCol, startRow, endRow) {
  startRow = (startRow !== undefined) ? startRow : 0;
  endRow   = (endRow   !== undefined) ? Math.min(endRow, values.length) : values.length;
  var sample = values.slice(startRow, Math.min(endRow, startRow + 40));

  for (var c = startCol; c <= endCol; c++) {
    var hits = 0, total = 0;
    sample.forEach(function(row) {
      var raw = String(row[c] !== undefined ? row[c] : '').trim().replace(/[^0-9]/g, '');
      if (raw.length === 0) return;
      total++;
      // מקבל 8 ספרות (אפס מוביל נקצץ ע"י Sheets) או 9 ספרות
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

// ── הרצה ידנית (מ-Apps Script Editor) ───────────────────────────────────────
function runSyncManually() {
  syncAllTabs();
}

// ── DEBUG: בדיקת פרסור טאב ספציפי ללא שליחה לשרת ────────────────────────────
// שנה TAB_TO_DEBUG לשם הטאב הרצוי, ואז הרץ מה-Editor.
function debugParseTab() {
  var TAB_TO_DEBUG = "שיעור א"; // ← שנה כאן

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = findSheet(ss, TAB_TO_DEBUG);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('טאב לא נמצא: "' + TAB_TO_DEBUG + '"\nהרץ debugListTabs לרשימה מלאה.');
    return;
  }

  var students = parseTab(sheet);

  // סכום לפי כיתה
  var byClass = {};
  students.forEach(function(s) {
    if (!byClass[s.classId]) byClass[s.classId] = [];
    byClass[s.classId].push(s);
  });

  var msg = '🔍 ניתוח טאב: "' + sheet.getName() + '"\n';
  msg += '👥 סה"כ תלמידים שנקראו: ' + students.length + '\n\n';

  msg += '📌 פירוט לפי כיתה:\n';
  Object.keys(byClass).forEach(function(cls) {
    msg += '\n[' + cls + ']  (' + byClass[cls].length + ' תלמידים)\n';
    byClass[cls].slice(0, 3).forEach(function(s) {
      msg += '  ' + s.fullName + ' | ' + s.idNumber + '\n';
    });
    if (byClass[cls].length > 3) msg += '  ... ועוד ' + (byClass[cls].length - 3) + '\n';
  });

  msg += '\n📋 לוג מפורט → Apps Script → Executions';
  SpreadsheetApp.getUi().alert(msg);
}

// עזר: מספר עמודה (0-based) → אות (A, B, ...)
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
function colLetter(col) { return colToLetter(col); }
