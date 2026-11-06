/**
 * DSR rules that the AI can NOT override:
 *  - exact title + headings (code renders the template, AI only writes bullet text)
 *  - weekdays only, once per day
 *  - posting to Google Chat happens only here, only from a Send tap/click
 */

const SECTIONS = [
  ['accomplished', "What's Accomplished:"],
  ['in_progress', 'In Progress:'],
  ['blockers', 'Blockers:'],
  ['next_steps', 'Next steps:'],
];

function renderDsr_(date, d) {
  const bullet = prop_('BULLET', '* ');
  const lines = ['DSR - ' + prettyDate_(date)];
  SECTIONS.forEach(function (s) {
    let items = (d[s[0]] || [])
      .map(function (x) { return String(x).replace(/^\s*([*\-•]\s*)+/, '').trim(); })
      .filter(Boolean);
    if (!items.length) items = ['None'];
    lines.push('');
    lines.push(s[1]);
    items.forEach(function (i) { lines.push(bullet + i); });
  });
  return lines.join('\n');
}

/** Returns a reason string if no DSR may be drafted/sent for this date, else ''. */
function dsrBlockedReason_(date) {
  if (!isWeekdayIso_(date)) return 'No DSR on weekends.';
  const day = getDay_(date);
  if (day.status === 'sent') return "Today's DSR was already sent at " + day.sentAt + '.';
  return '';
}

/**
 * Post today's draft to Google Chat. Locked so a double tap can't post twice.
 * `version` must match the latest draft, so old Send buttons can't send stale text.
 */
function sendDsr_(date, version) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (date !== today_()) return { ok: false, msg: 'That draft is from ' + date + '. Only today\'s DSR can be sent.' };
    const reason = dsrBlockedReason_(date);
    if (reason) return { ok: false, msg: reason };
    const day = getDay_(date);
    if (!day.draft) return { ok: false, msg: 'There is no draft yet.' };
    if (version !== undefined && version !== null && Number(version) !== day.version) {
      return { ok: false, msg: 'That draft is outdated. Use the latest draft (v' + day.version + ').' };
    }

    const res = UrlFetchApp.fetch(requireProp_('CHAT_WEBHOOK_URL'), {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({ text: day.draft }),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code >= 300) {
      log_('chat', 'send_failed', code + ' ' + res.getContentText());
      return { ok: false, msg: 'Google Chat rejected the post (HTTP ' + code + '). Nothing was sent.' };
    }

    day.status = 'sent';
    day.sentAt = nowTime_();
    saveDay_(day);
    log_('chat', 'sent', 'v' + day.version);
    return { ok: true, msg: 'Sent to Google Chat at ' + day.sentAt };
  } finally {
    lock.releaseLock();
  }
}
