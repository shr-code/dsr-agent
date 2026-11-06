/**
 * Laptop front door: functions called from Index.html via google.script.run.
 * Every call carries the secret link key and is rejected without it.
 */

function checkKey_(key) {
  const expected = prop_('LINK_SECRET');
  if (!expected || key !== expected) throw new Error('Not authorized.');
}

function state_() {
  const date = today_();
  const day = getDay_(date);
  return {
    date: date,
    pretty: prettyDate_(date, 'EEEE, dd MMM yyyy'),
    weekday: isWeekdayIso_(date),
    status: day.status,
    sentAt: day.sentAt,
    draft: day.draft,
    version: day.version,
    notes: getNotes_(date, date),
  };
}

function webState(key) {
  checkKey_(key);
  return state_();
}

/** Free-text message from the laptop page: same agent as Telegram. */
function webMessage(key, text) {
  checkKey_(key);
  text = String(text || '').trim();
  if (!text) return { reply: '', state: state_() };
  try {
    const enriched = enrichLinks_(text);
    const res = runAgent_([{ text: enriched }], { channel: 'web', source: 'laptop', historyText: enriched });
    return { reply: res.reply || (res.draft ? 'Draft ready below.' : ''), state: state_() };
  } catch (e) {
    log_('web', 'agent_error', e.stack || e);
    return { reply: '⚠️ ' + friendlyError_(e), state: state_() };
  }
}

function webDraft(key) {
  checkKey_(key);
  const reason = dsrBlockedReason_(today_());
  if (reason) return { reply: reason, state: state_() };
  return webMessage(key, 'Draft my DSR for today.');
}

/** Save hand edits to the draft text (bumps the version, so old Telegram buttons go stale). */
function webSaveEdit(key, text, version) {
  checkKey_(key);
  const date = today_();
  const reason = dsrBlockedReason_(date);
  if (reason) return { reply: reason, state: state_() };
  const day = getDay_(date);
  if (Number(version) !== day.version) return { reply: 'The draft changed elsewhere (v' + day.version + '). Reloaded the latest one.', state: state_() };
  day.draft = String(text || '').trim();
  day.version += 1;
  day.status = 'drafted';
  saveDay_(day);
  return { reply: 'Edits saved (v' + day.version + ').', state: state_() };
}

function webSend(key, version) {
  checkKey_(key);
  const r = sendDsr_(today_(), version);
  return { reply: (r.ok ? '✅ ' : '⚠️ ') + r.msg, state: state_() };
}

function webDeleteNote(key, id) {
  checkKey_(key);
  deleteNote_(String(id));
  return { reply: 'Note deleted.', state: state_() };
}
