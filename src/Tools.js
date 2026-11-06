/**
 * Tool implementations the agent can call. Each returns a plain object
 * that is sent back to Gemini as the function result.
 */

function runTool_(name, args, ctx) {
  switch (name) {
    case 'log_notes': {
      const entries = Array.isArray(args.entries) ? args.entries : [];
      if (!entries.length) return { error: 'No entries given.' };
      const saved = addNotes_(entries, ctx.source, ctx.raw);
      ctx.logged = ctx.logged.concat(saved);
      return { saved: saved };
    }

    case 'list_notes': {
      const from = args.from || today_();
      const to = args.to || from;
      const notes = getNotes_(from, to).slice(-200);
      return { count: notes.length, notes: notes.map(function (n) { return { id: n.id, date: n.date, status: n.status, text: n.text }; }) };
    }

    case 'update_note':
      return { ok: updateNote_(String(args.id || ''), args.text, args.status) };

    case 'delete_note':
      return { ok: deleteNote_(String(args.id || '')) };

    case 'save_draft': {
      const date = today_();
      const reason = dsrBlockedReason_(date);
      if (reason) return { error: reason };
      if (!getNotes_(date, date).length) return { error: 'No notes logged today. Ask the user what they did first.' };

      const day = getDay_(date);
      day.draft = renderDsr_(date, args);
      day.version = day.version + 1;
      day.status = 'drafted';
      saveDay_(day);
      ctx.draft = { date: date, version: day.version, text: day.draft };
      return { ok: true, version: day.version, note: 'Draft saved. It is shown to the user with Send / Regenerate buttons.' };
    }

    default:
      return { error: 'Unknown tool: ' + name };
  }
}

/** Add [YouTube: "title" by channel] after YouTube links (oEmbed, no API key). */
function enrichLinks_(text) {
  return String(text).replace(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/\S+/g, function (url) {
    const info = youtubeInfo_(url);
    return info ? url + ' [YouTube: "' + info.title + '" by ' + info.author + ']' : url;
  });
}

function youtubeInfo_(url) {
  try {
    const res = UrlFetchApp.fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const j = JSON.parse(res.getContentText());
    return { title: j.title, author: j.author_name };
  } catch (e) {
    return null;
  }
}
