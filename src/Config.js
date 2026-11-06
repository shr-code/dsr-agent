/**
 * Config and small helpers.
 * Every secret lives in Script Properties (Project Settings -> Script Properties),
 * never in this code and never in the Sheet.
 */

const TZ = 'Asia/Kolkata';
const STATUSES = ['done', 'in_progress', 'blocker', 'next'];

function props_() {
  return PropertiesService.getScriptProperties();
}

/** Read a Script Property, or return the fallback when it's missing/empty. */
function prop_(name, fallback) {
  const v = props_().getProperty(name);
  if (v === null || v === '') return fallback === undefined ? '' : fallback;
  return v;
}

/** Read a Script Property that must exist. */
function requireProp_(name) {
  const v = prop_(name);
  if (!v) throw new Error('Missing Script Property: ' + name + ' (see README, step 5)');
  return v;
}

/** 64 random hex characters. */
function randomSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/** Today's date as YYYY-MM-DD in IST. */
function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function nowTime_() {
  return Utilities.formatDate(new Date(), TZ, 'HH:mm');
}

/** YYYY-MM-DD -> Date at noon (noon avoids any timezone edge cases). */
function dateFromIso_(iso) {
  const p = String(iso).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12);
}

function prettyDate_(iso, pattern) {
  return Utilities.formatDate(dateFromIso_(iso), TZ, pattern || 'dd MMM yyyy');
}

/** Monday-Friday? */
function isWeekdayIso_(iso) {
  const dow = Number(Utilities.formatDate(dateFromIso_(iso), TZ, 'u')); // 1 = Mon ... 7 = Sun
  return dow <= 5;
}

/** Sheets sometimes turns text into Date objects; turn them back into strings. */
function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}
