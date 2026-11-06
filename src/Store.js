/**
 * Google Sheet storage = the agent's memory.
 *   Notes: one row per logged entry
 *   Days:  one row per day (draft, version, sent or not)
 *   Log:   debug trail (errors, agent steps)
 */

const TABS = {
  Notes: ['id', 'date', 'time', 'text', 'status', 'source', 'raw'],
  Days: ['date', 'status', 'draft', 'version', 'sent_at', 'reminded'],
  Log: ['time', 'channel', 'event', 'detail'],
};

let SS_CACHE_ = null;

function ss_() {
  if (!SS_CACHE_) SS_CACHE_ = SpreadsheetApp.openById(requireProp_('SHEET_ID'));
  return SS_CACHE_;
}

function tab_(name) {
  return ss_().getSheetByName(name);
}

/** Create the tabs (idempotent). Everything is stored as plain text. */
function ensureTabs_() {
  const ss = ss_();
  Object.keys(TABS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), TABS[name].length).setNumberFormat('@');
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

// ---------- Notes ----------

function addNotes_(entries, source, raw) {
  const sh = tab_('Notes');
  const date = today_();
  const time = nowTime_();
  const rows = entries
    .filter(function (e) { return e && String(e.text || '').trim(); })
    .map(function (e) {
      return [
        'n' + Utilities.getUuid().slice(0, 6),
        date,
        time,
        String(e.text).trim(),
        STATUSES.indexOf(e.status) >= 0 ? e.status : 'done',
        source || '',
        String(raw || '').slice(0, 2000),
      ];
    });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return rows.map(function (r) { return { id: r[0], text: r[3], status: r[4] }; });
}

/** Notes with from <= date <= to (YYYY-MM-DD strings compare correctly). */
function getNotes_(from, to) {
  const values = tab_('Notes').getDataRange().getValues().slice(1);
  return values
    .map(function (r) {
      return { id: str_(r[0]), date: str_(r[1]), time: str_(r[2]), text: str_(r[3]), status: str_(r[4]), source: str_(r[5]) };
    })
    .filter(function (n) { return n.id && n.date >= from && n.date <= to; });
}

function findNoteRow_(id) {
  const sh = tab_('Notes');
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (str_(ids[i][0]) === id) return i + 2;
  return 0;
}

function updateNote_(id, text, status) {
  const row = findNoteRow_(id);
  if (!row) return false;
  const sh = tab_('Notes');
  if (text) sh.getRange(row, 4).setValue(String(text).trim());
  if (status && STATUSES.indexOf(status) >= 0) sh.getRange(row, 5).setValue(status);
  return true;
}

function deleteNote_(id) {
  const row = findNoteRow_(id);
  if (!row) return false;
  tab_('Notes').deleteRow(row);
  return true;
}

// ---------- Days ----------

function getDay_(date) {
  const values = tab_('Days').getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (str_(values[i][0]) === date) {
      return {
        row: i + 1,
        date: date,
        status: str_(values[i][1]) || 'none',
        draft: str_(values[i][2]),
        version: Number(values[i][3]) || 0,
        sentAt: str_(values[i][4]),
        reminded: str_(values[i][5]),
      };
    }
  }
  return { row: 0, date: date, status: 'none', draft: '', version: 0, sentAt: '', reminded: '' };
}

function saveDay_(d) {
  const sh = tab_('Days');
  const row = [d.date, d.status, d.draft, String(d.version), d.sentAt, d.reminded];
  if (d.row) {
    sh.getRange(d.row, 1, 1, row.length).setValues([row]);
  } else {
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    d.row = sh.getLastRow();
  }
}

// ---------- Log ----------

function log_(channel, event, detail) {
  try {
    tab_('Log').appendRow([
      Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'),
      channel,
      event,
      String(detail === undefined ? '' : detail).slice(0, 5000),
    ]);
  } catch (e) {
    console.error('log_ failed', e);
  }
}
