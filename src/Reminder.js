/**
 * Weekday safety-net reminder (time trigger created by setup()).
 * Runs once a day around REMINDER_HOUR:REMINDER_MINUTE IST (Apps Script fires within ~15 min of that).
 */

function dailyReminder() {
  const date = today_();
  if (!isWeekdayIso_(date)) return;
  const day = getDay_(date);
  if (day.status === 'sent' || day.reminded) return;
  if (!getNotes_(date, date).length) return; // no notes = leave/holiday: stay quiet

  day.reminded = nowTime_();
  saveDay_(day);

  if (day.draft) {
    tgSend_('⏰ Your DSR draft is waiting:');
    tgSendDraft_({ date: date, version: day.version, text: day.draft });
    return;
  }

  try {
    const text = '(Automatic evening reminder) Prepare my DSR for today. If my notes are thin or next steps are unclear, ask me one short question instead.';
    tgDeliver_(runAgent_([{ text: text }], { channel: 'reminder', source: 'telegram', historyText: text }), '⏰ ');
  } catch (e) {
    log_('reminder', 'agent_error', e.stack || e);
    tgSend_('⏰ Time for your DSR. (Drafting failed: ' + friendlyError_(e) + ' Send /dsr to retry.)');
  }
}
