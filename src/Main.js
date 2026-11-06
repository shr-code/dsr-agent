/**
 * Entry points.
 *   doPost  - Telegram webhook (URL contains a secret)
 *   doGet   - laptop page, and the Android one-tap shortcut (both need LINK_SECRET)
 *   setup() - run from the editor; safe to run again any time
 */

function doPost(e) {
  try {
    const secret = prop_('TELEGRAM_WEBHOOK_SECRET');
    if (!secret || !e || !e.parameter || e.parameter.secret !== secret) return ok_();
    const update = JSON.parse(e.postData.contents);
    if (alreadySeen_(update.update_id)) return ok_();
    handleTelegramUpdate_(update);
  } catch (err) {
    log_('telegram', 'doPost_error', (err && err.stack) || err);
  }
  return ok_();
}

function ok_() {
  return ContentService.createTextOutput('ok');
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const linkSecret = prop_('LINK_SECRET');
  if (!linkSecret || p.key !== linkSecret) return HtmlService.createHtmlOutput('Not found.');

  // Android home-screen shortcut: draft today's DSR and push it to Telegram.
  if (p.action === 'dsr') return ContentService.createTextOutput(shortcutDraft_());

  const t = HtmlService.createTemplateFromFile('Index');
  t.key = p.key;
  return t.evaluate()
    .setTitle('DSR Agent')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function shortcutDraft_() {
  const reason = dsrBlockedReason_(today_());
  if (reason) {
    tgSend_(reason);
    return reason;
  }
  try {
    const text = 'Draft my DSR for today.';
    tgDeliver_(runAgent_([{ text: text }], { channel: 'shortcut', source: 'telegram', historyText: text }));
    return 'Done. Check Telegram.';
  } catch (e) {
    log_('shortcut', 'agent_error', e.stack || e);
    return friendlyError_(e);
  }
}

/**
 * One-click setup. Run it:
 *   1) once before deploying (creates the Sheet, secrets, reminder trigger)
 *   2) again after you add WEB_APP_URL (connects Telegram and prints your links)
 */
function setup() {
  const p = props_();

  if (!prop_('SHEET_ID')) {
    const ss = SpreadsheetApp.create('DSR Agent Data');
    p.setProperty('SHEET_ID', ss.getId());
  }
  ensureTabs_();

  if (!prop_('TELEGRAM_WEBHOOK_SECRET')) p.setProperty('TELEGRAM_WEBHOOK_SECRET', randomSecret_());
  if (!prop_('LINK_SECRET')) p.setProperty('LINK_SECRET', randomSecret_());

  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'dailyReminder'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReminder')
    .timeBased()
    .atHour(Number(prop_('REMINDER_HOUR', '18')))
    .nearMinute(Number(prop_('REMINDER_MINUTE', '30')))
    .everyDays(1)
    .inTimezone(TZ)
    .create();

  const missing = ['TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY', 'CHAT_WEBHOOK_URL', 'WEB_APP_URL'].filter(function (k) { return !prop_(k); });
  const out = ['Sheet: ' + ss_().getUrl(), 'Reminder trigger: daily ~' + prop_('REMINDER_HOUR', '18') + ':' + prop_('REMINDER_MINUTE', '30') + ' IST (skips weekends)'];

  if (prop_('WEB_APP_URL') && prop_('TELEGRAM_BOT_TOKEN')) {
    const r = tg_('setWebhook', {
      url: prop_('WEB_APP_URL') + '?secret=' + prop_('TELEGRAM_WEBHOOK_SECRET'),
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
    out.push('Telegram webhook: ' + (r.ok ? 'connected' : 'FAILED - ' + r.description));
    out.push('');
    out.push(linksText_());
  }
  if (missing.length) out.push('\nStill missing Script Properties: ' + missing.join(', ') + '. Add them and run setup() again.');

  console.log(out.join('\n'));
}

function linksText_() {
  const base = prop_('WEB_APP_URL') + '?key=' + prop_('LINK_SECRET');
  return [
    'Laptop page (bookmark it, treat it like a password):',
    base,
    '',
    'Android one-tap shortcut URL (drafts the DSR and sends it to Telegram):',
    base + '&action=dsr',
  ].join('\n');
}

/** Print the laptop + shortcut links again. */
function showLinks() {
  console.log(linksText_());
}

/** Shows what Telegram thinks of the webhook (last error, pending updates). */
function checkTelegramWebhook() {
  console.log(JSON.stringify(tg_('getWebhookInfo', {}), null, 2));
}

/** Quick check that the Gemini key + model work. */
function testGemini() {
  const r = callGemini_({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: pong' }] }] });
  console.log(JSON.stringify(r.candidates[0].content.parts));
}

/** Posts a SAMPLE DSR to CHAT_WEBHOOK_URL to check formatting. Point it at a test space first! */
function testChatPost() {
  const sample = renderDsr_(today_(), {
    accomplished: ['[TEST] Learned how Kafka consumer groups rebalance', '[TEST] Fixed the login bug in my expense tracker'],
    in_progress: ['[TEST] Spring Boot course, module 4 of 9'],
    blockers: [],
    next_steps: ['[TEST] Finish module 5 and add JWT auth to the expense tracker'],
  });
  const res = UrlFetchApp.fetch(requireProp_('CHAT_WEBHOOK_URL'), {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ text: sample }),
    muteHttpExceptions: true,
  });
  console.log('HTTP ' + res.getResponseCode() + '\n' + sample);
}
