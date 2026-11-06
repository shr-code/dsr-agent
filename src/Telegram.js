/**
 * Telegram front door (phone).
 */

function tg_(method, payload) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + requireProp_('TELEGRAM_BOT_TOKEN') + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true,
  });
  const j = JSON.parse(res.getContentText());
  if (!j.ok) log_('telegram', 'api_error', method + ': ' + res.getContentText());
  return j;
}

function tgSend_(text, extra) {
  const chatId = prop_('TELEGRAM_CHAT_ID');
  if (!chatId) return null;
  return tg_('sendMessage', Object.assign({ chat_id: chatId, text: String(text).slice(0, 4000) }, extra || {}));
}

function tgSendDraft_(draft) {
  return tgSend_(draft.text, {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Send to Chat', callback_data: 'send|' + draft.date + '|' + draft.version },
        { text: '🔄 Regenerate', callback_data: 'regen|' + draft.date + '|' + draft.version },
      ]],
    },
  });
}

/** Send the agent's reply and, if one was saved, the draft with buttons. */
function tgDeliver_(res, prefix) {
  if (res.reply) tgSend_((prefix || '') + res.reply);
  if (res.draft) tgSendDraft_(res.draft);
  if (!res.reply && !res.draft) tgSend_('👍');
}

const HELP_TEXT = [
  'Just tell me what you did, in plain words, a YouTube link, or a voice note. I log it.',
  '',
  '/dsr - draft today\'s DSR',
  '/notes - show today\'s notes',
  '/help - this message',
  '',
  'When a draft is shown, reply with changes ("make it shorter", "add that I read about Redis") or tap Send.',
  'Nothing is ever posted to Google Chat unless you tap Send.',
].join('\n');

function handleTelegramUpdate_(update) {
  if (update.callback_query) return handleCallback_(update.callback_query);
  const msg = update.message;
  if (!msg || !msg.chat) return;

  const chatId = String(msg.chat.id);
  const owner = prop_('TELEGRAM_CHAT_ID');
  const text = String(msg.text || msg.caption || '').trim();
  const command = text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';

  // First /start claims the bot. After that, everyone else is ignored.
  if (!owner) {
    if (command === '/start') {
      props_().setProperty('TELEGRAM_CHAT_ID', chatId);
      tgSend_('Hi! This bot is now linked to you only.\n\n' + HELP_TEXT);
    }
    return;
  }
  if (chatId !== owner) {
    log_('telegram', 'ignored_stranger', chatId);
    return;
  }

  if (command === '/start' || command === '/help') return tgSend_(HELP_TEXT);

  if (command === '/notes') {
    const notes = getNotes_(today_(), today_());
    return tgSend_(notes.length
      ? "Today's notes:\n" + notes.map(function (n) { return '- ' + n.text + (n.status !== 'done' ? ' (' + n.status + ')' : ''); }).join('\n')
      : 'No notes yet today.');
  }

  tg_('sendChatAction', { chat_id: owner, action: 'typing' });

  let parts;
  let historyText;
  if (command === '/dsr') {
    const reason = dsrBlockedReason_(today_());
    if (reason) return tgSend_(reason);
    parts = [{ text: 'Draft my DSR for today.' }];
    historyText = 'Draft my DSR for today.';
  } else if (msg.voice || msg.audio) {
    const media = msg.voice || msg.audio;
    if (media.file_size && media.file_size > 15 * 1024 * 1024) return tgSend_('That voice note is too long. Please keep it under a few minutes.');
    parts = [
      { text: '(The user sent a voice note. Understand it and act on it exactly as if they had typed it.)' + (text ? ' Caption: ' + text : '') },
      { inlineData: { mimeType: msg.voice ? 'audio/ogg' : (media.mime_type || 'audio/mpeg'), data: downloadTelegramFile_(media.file_id) } },
    ];
    historyText = '[voice note]';
  } else if (text) {
    const enriched = enrichLinks_(text);
    parts = [{ text: enriched }];
    historyText = enriched;
  } else {
    return tgSend_('I can read text, links and voice notes.');
  }

  try {
    tgDeliver_(runAgent_(parts, { channel: 'telegram', source: msg.voice || msg.audio ? 'voice' : 'telegram', historyText: historyText }));
  } catch (e) {
    log_('telegram', 'agent_error', e.stack || e);
    tgSend_('⚠️ ' + friendlyError_(e));
  }
}

function handleCallback_(cq) {
  const owner = prop_('TELEGRAM_CHAT_ID');
  if (!cq.message || String(cq.message.chat.id) !== owner) return;
  const parts = String(cq.data || '').split('|');
  const action = parts[0];
  const date = parts[1];
  const version = Number(parts[2]);

  if (action === 'send') {
    const r = sendDsr_(date, version);
    tg_('answerCallbackQuery', { callback_query_id: cq.id, text: r.msg, show_alert: !r.ok });
    if (r.ok) {
      // Editing without reply_markup also removes the buttons.
      tg_('editMessageText', { chat_id: owner, message_id: cq.message.message_id, text: cq.message.text + '\n\n✅ ' + r.msg });
    }
    return;
  }

  if (action === 'regen') {
    tg_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Regenerating…' });
    const reason = date !== today_() ? 'That draft is from ' + date + '.' : dsrBlockedReason_(date);
    if (reason) return tgSend_(reason);
    try {
      const text = 'Regenerate today\'s DSR draft from my notes with fresh wording. Same facts, do not ask questions, call save_draft directly.';
      tgDeliver_(runAgent_([{ text: text }], { channel: 'telegram', historyText: text }));
    } catch (e) {
      log_('telegram', 'agent_error', e.stack || e);
      tgSend_('⚠️ ' + friendlyError_(e));
    }
    return;
  }

  tg_('answerCallbackQuery', { callback_query_id: cq.id });
}

function downloadTelegramFile_(fileId) {
  const info = tg_('getFile', { file_id: fileId });
  if (!info.ok) throw new Error('Could not fetch the voice note from Telegram.');
  const url = 'https://api.telegram.org/file/bot' + requireProp_('TELEGRAM_BOT_TOKEN') + '/' + info.result.file_path;
  return Utilities.base64Encode(UrlFetchApp.fetch(url).getBlob().getBytes());
}

/**
 * Telegram may deliver the same update twice (Apps Script answers with a redirect,
 * which Telegram can treat as a failure and retry). Process each update_id once.
 */
function alreadySeen_(updateId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    const key = 'upd_' + updateId;
    if (cache.get(key)) return true;
    cache.put(key, '1', 6 * 60 * 60);
    return false;
  } finally {
    lock.releaseLock();
  }
}
