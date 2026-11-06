/**
 * The agent: a plain tool-calling loop with Gemini (no SDK, no framework).
 *
 *   user message -> Gemini (+ tools) -> tool call? run it, send result back -> ... -> final reply
 *
 * Gemini decides WHAT to do (log, edit notes, draft, revise, answer questions).
 * Code decides what is ALLOWED (weekday, once per day, template). Gemini has no "send" tool.
 */

const MAX_STEPS = 6;
const HISTORY_TURNS = 6;

const TOOL_DECLARATIONS = [
  {
    name: 'log_notes',
    description: 'Save what the user did, as separate concise entries dated today.',
    parameters: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'One concise entry, e.g. "Watched a video on Kafka consumer groups".' },
              status: {
                type: 'string',
                enum: STATUSES,
                description: 'done = finished today; in_progress = started but not finished; blocker = something slowing the user down; next = a plan for tomorrow.',
              },
            },
            required: ['text', 'status'],
          },
        },
      },
      required: ['entries'],
    },
  },
  {
    name: 'list_notes',
    description: 'List saved notes between two dates (inclusive). Use for questions about past days or weeks.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date, YYYY-MM-DD' },
        to: { type: 'string', description: 'End date, YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'update_note',
    description: 'Change the text and/or status of a saved note.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        text: { type: 'string' },
        status: { type: 'string', enum: STATUSES },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_note',
    description: 'Delete a saved note.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'save_draft',
    description:
      "Save today's DSR draft. Pass only bullet texts (no bullet symbols, no headings, no title); code adds the title and headings. " +
      'The user then sees the draft with Send and Regenerate buttons.',
    parameters: {
      type: 'object',
      properties: {
        accomplished: { type: 'array', items: { type: 'string' } },
        in_progress: { type: 'array', items: { type: 'string' } },
        blockers: { type: 'array', items: { type: 'string' } },
        next_steps: { type: 'array', items: { type: 'string' } },
      },
      required: ['accomplished', 'in_progress', 'blockers', 'next_steps'],
    },
  },
];

function systemPrompt_() {
  const date = today_();
  const day = getDay_(date);
  const notes = getNotes_(date, date);
  const name = prop_('USER_NAME', 'the user');

  let dsrState;
  if (!isWeekdayIso_(date)) dsrState = 'It is the WEEKEND: there is no DSR today. Never call save_draft. Logging notes is fine.';
  else if (day.status === 'sent') dsrState = 'Today\'s DSR was already SENT at ' + day.sentAt + '. Never call save_draft again today. Logging notes is fine.';
  else if (day.draft) dsrState = 'A draft (v' + day.version + ') exists and is NOT sent yet:\n' + day.draft;
  else dsrState = 'No draft yet today.';

  const noteLines = notes.length
    ? notes.map(function (n) { return '- [' + n.id + '] (' + n.status + ') ' + n.text; }).join('\n')
    : '(none yet)';

  return [
    'You are the personal DSR (daily status report) assistant of ' + name + ', a software engineer currently on bench,',
    'who spends the day learning (tutorials, videos, articles) and building side projects.',
    '',
    'Today is ' + prettyDate_(date, 'EEEE, dd MMM yyyy') + ' (' + date + '), timezone IST.',
    'DSR status: ' + dsrState,
    '',
    "Today's notes:",
    noteLines,
    '',
    'HOW TO ACT',
    '1. When the user describes what they did, call log_notes. Split into separate concise entries, keep their meaning, never invent details.',
    '   A message that is only a YouTube link means they watched it today (done) unless they say otherwise.',
    '   Text like [YouTube: "Title" by Channel] tells you what a link is about: log the topic, not the URL.',
    '   After logging, reply with a compact confirmation listing what you saved.',
    '2. To fix or remove notes ("that Redis thing is still in progress", "delete the last note"), use update_note / delete_note with the ids above.',
    '3. Drafting (the user asks for the DSR, says "post my DSR", or this is the reminder):',
    '   - If there are no notes today, say so and ask what they did. Do not draft.',
    '   - If no draft exists yet AND (there are fewer than 2 notes OR nothing suggests next steps), ask ONE short question',
    '     covering what is missing (e.g. "Anything else today, and what\'s next tomorrow? Reply skip to draft as is.").',
    '     If they reply skip, or already answered, draft right away.',
    '   - Otherwise call save_draft.',
    '4. Revising: when a draft exists and the user asks for changes ("make it shorter", "add that I also read about Redis"),',
    '   call save_draft with the revised lists. If they mention new work, also call log_notes.',
    '5. Questions about past work ("what did I learn this week?"): call list_notes for the date range and answer briefly.',
    '',
    'DSR WRITING RULES (for save_draft)',
    '- accomplished: things finished today (topics learned, videos completed, features built, articles read). Past tense.',
    '- in_progress: things started but not finished (a course midway, a feature still being built).',
    '- blockers: only blockers the user actually mentioned. Empty list if none (code prints "None"). Never invent one.',
    '- next_steps: one or two items for tomorrow based on the notes.',
    '- Bullets: concise, professional, specific, one line each. Describe video/article topics instead of pasting links.',
    '  No emojis, no markdown, no bullet symbols, no trailing periods.',
    '- Merge duplicates. Do not pad: a short honest DSR is better than a long one.',
    '',
    'LIMITS',
    '- You cannot post to Google Chat. Only the user can, by tapping Send. Never say the DSR was sent.',
    '- After save_draft, reply with at most one short line; the draft itself is shown to the user separately.',
    '- Replies are plain text (no markdown, no asterisks), short and friendly.',
  ].join('\n');
}

/**
 * Run one user turn.
 * @param {Object[]} userParts Gemini parts (text and/or inlineData audio)
 * @param {{channel:string, source:string, historyText:string}} opts
 * @return {{reply:string, logged:Object[], draft:?{date:string,version:number,text:string}}}
 */
function runAgent_(userParts, opts) {
  const ctx = { channel: opts.channel, source: opts.source || opts.channel, raw: opts.historyText || '', logged: [], draft: null };
  const contents = loadHistory_().concat([{ role: 'user', parts: userParts }]);

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = callGemini_({
      systemInstruction: { parts: [{ text: systemPrompt_() }] },
      contents: contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    });

    const cand = resp.candidates && resp.candidates[0];
    if (!cand || !cand.content || !cand.content.parts) {
      log_(ctx.channel, 'empty_response', JSON.stringify(resp).slice(0, 2000));
      return finish_(ctx, opts, 'Sorry, I could not process that (the AI returned nothing). Please try again.');
    }
    contents.push(cand.content); // keep the model turn as-is (includes thought signatures)

    const calls = cand.content.parts.filter(function (p) { return p.functionCall; });
    if (!calls.length) {
      const text = cand.content.parts
        .filter(function (p) { return p.text && !p.thought; })
        .map(function (p) { return p.text; })
        .join('')
        .trim();
      return finish_(ctx, opts, text);
    }

    const responses = calls.map(function (p) {
      const name = p.functionCall.name;
      const args = p.functionCall.args || {};
      let result;
      try {
        result = runTool_(name, args, ctx);
      } catch (e) {
        result = { error: String(e.message || e) };
      }
      log_(ctx.channel, 'tool:' + name, JSON.stringify({ args: args, result: result }));
      return { functionResponse: { name: name, response: result } };
    });
    contents.push({ role: 'user', parts: responses });
  }

  return finish_(ctx, opts, 'Sorry, that took too many steps. Please try rephrasing.');
}

function finish_(ctx, opts, text) {
  let reply = text || '';
  if (!reply && ctx.logged.length && !ctx.draft) {
    reply = 'Logged:\n' + ctx.logged.map(function (n) { return '- ' + n.text + (n.status !== 'done' ? ' (' + n.status + ')' : ''); }).join('\n');
  }
  saveHistory_(opts.historyText || '(message)', reply || (ctx.draft ? '(showed DSR draft v' + ctx.draft.version + ')' : ''));
  return { reply: reply, logged: ctx.logged, draft: ctx.draft };
}

function callGemini_(body) {
  const model = prop_('GEMINI_MODEL', 'gemini-flash-latest');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': requireProp_('GEMINI_API_KEY') },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if ((code === 429 || code >= 500) && attempt < 2) {
      Utilities.sleep(3000 * (attempt + 1));
      continue;
    }
    throw new Error('Gemini error ' + code + ': ' + res.getContentText().slice(0, 300));
  }
}

/** Turn internal errors into a message the user can act on. */
function friendlyError_(e) {
  const m = String((e && e.message) || e);
  if (m.indexOf('Gemini error 429') >= 0) return 'Gemini free-tier limit reached. Nothing was saved from that message; please try again in a minute.';
  if (m.indexOf('Gemini error') >= 0) return 'Gemini had a problem. Nothing was saved from that message; please try again.';
  if (m.indexOf('Missing Script Property') >= 0) return 'Setup incomplete: ' + m;
  return 'Something went wrong: ' + m;
}

// ---------- short conversation memory (text only, shared by Telegram and the laptop page) ----------

function loadHistory_() {
  const raw = CacheService.getScriptCache().get('history');
  return raw ? JSON.parse(raw) : [];
}

function saveHistory_(userText, modelText) {
  if (!modelText) return;
  const h = loadHistory_();
  h.push({ role: 'user', parts: [{ text: String(userText).slice(0, 1500) }] });
  h.push({ role: 'model', parts: [{ text: String(modelText).slice(0, 1500) }] });
  CacheService.getScriptCache().put('history', JSON.stringify(h.slice(-HISTORY_TURNS * 2)), 2 * 60 * 60);
}
