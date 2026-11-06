# DSR Agent

A personal agent that collects what you did during the day and turns it into a Daily Status Report (DSR) for your team's Google Chat space. You review every draft, and nothing is posted until you tap **Send**.

- **Phone:** a Telegram bot. You can type, paste YouTube links or send voice notes.
- **Laptop:** a small web page with the same agent and the same data.
- **Backend:** Google Apps Script on your **personal** Google account, with a Google Sheet as storage.
- **Brain:** Gemini (free tier) running a tool-calling agent loop. No SDK or framework is used.
- **Output:** a Google Chat incoming webhook into your company space. This URL is the only work-related item in the setup.

Everything in the stack is free with no time limit and needs no credit card.

## How it works

```
Phone: Telegram ──webhook──┐
Laptop: web page ──────────┼──► Apps Script ──► Gemini (decides: log / edit / draft / answer)
Android 1-tap shortcut ────┤        │                └─ tools: log_notes, list_notes, update_note,
Weekday 18:30 trigger ─────┘        │                         delete_note, save_draft
                                    ├──► Google Sheet (Notes, Days, Log)
                                    └──► Google Chat webhook   ← ONLY when you tap Send
```

**Rules enforced in code, so the AI cannot break them:**
- No DSR on weekends.
- At most one DSR per day. After it's sent, there are no more drafts or reminders that day.
- Gemini has no tool for posting. Only the Send button posts.
- The title (`DSR - 06 Nov 2026`) and the four headings are added by code. An empty section shows `None`.
- If you log no notes on a weekday, it's treated as leave or a holiday and the reminder stays quiet.

## What you need

| Item | Account | Cost |
|---|---|---|
| Telegram bot | your Telegram | free |
| Gemini API key | **personal** Google | free tier, no card |
| Apps Script + Sheet | **personal** Google | free |
| GitHub repo | **personal** GitHub | free (private repo) |
| Chat webhook URL | company Chat space | free |
| Node.js 18+ (only for the `clasp` route) | laptop | free |

---

## Step 1: Create the Telegram bot

1. In Telegram (on your phone), open **@BotFather** and send `/newbot`.
2. Give it a display name (e.g. `My DSR`) and a username ending in `bot` (e.g. `shraddha_dsr_bot`).
3. Copy the **token** it gives you (it looks like `123456:ABC...`). Treat it like a password.

## Step 2: Get a Gemini API key (personal account)

1. In your **personal** Chrome profile, open <https://aistudio.google.com/apikey>.
2. Click **Create API key** and copy it. No billing setup is needed. Don't enable billing on that project, so it stays on the free tier.
3. Optional: check the current Flash model name on <https://ai.google.dev/gemini-api/docs/models>. The default here is the alias `gemini-flash-latest`.

> **Privacy:** on the free tier, Google may use your prompts to improve its products, and human reviewers may read them. Log learning topics and side projects. Don't log client names, internal code or anything confidential.

## Step 3: Create the Google Chat webhook

Start with a **test space**: create a space with only yourself in it. Do the real team space last.

1. In Google Chat, open the space and click the **space name** at the top, then **Apps & integrations**, then **Webhooks** (or **Add webhooks**).
2. Name it `DSR – Shraddha`, optionally add an avatar URL, and click **Save**.
3. Copy the webhook URL. Anyone who has this URL can post into the space, so keep it secret. If it ever leaks, delete the webhook and create a new one.

## Step 4: Put the code into Apps Script

Use **option A** if you want GitHub as the source of truth and pushing from the laptop. Use **option B** if you just want it running.

### Option A: clasp (recommended with GitHub)

1. Turn on the Apps Script API for your **personal** account: <https://script.google.com/home/usersettings>. Set **Google Apps Script API** to **On**.
2. Install clasp and log in with your **personal** Google account:
   ```bash
   npm install -g @google/clasp
   ```
   ```bash
   clasp login
   ```
   If the login page opens in your work browser profile, copy the URL into your personal profile instead.
3. From this folder, create the project and push the code:
   ```bash
   clasp create --type standalone --title "DSR Agent" --rootDir src
   ```
   ```bash
   clasp push
   ```
   Answer **yes** if it asks to overwrite the manifest.
4. Open the project in the editor:
   ```bash
   clasp open
   ```
   On newer clasp versions this command is `clasp open-script`.

### Option B: copy and paste

1. Go to <https://script.google.com> in your personal profile and click **New project**. Rename it **DSR Agent**.
2. In **Project Settings** (gear icon), tick **Show "appsscript.json" manifest file in editor**.
3. Replace the contents of `appsscript.json` with `src/appsscript.json`.
4. For each `src/*.js` file, click **+**, then **Script**, use the same name without `.js` (e.g. `Agent`), and paste the code in. Delete the default `Code.gs`.
5. Click **+**, then **HTML**, name it `Index`, and paste `src/Index.html`.

## Step 5: Add Script Properties

In the editor, go to **Project Settings**, then **Script Properties**, then **Add script property**:

| Property | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token from step 1 |
| `GEMINI_API_KEY` | key from step 2 |
| `CHAT_WEBHOOK_URL` | **test space** webhook from step 3 |
| `USER_NAME` | `Shraddha` (optional) |
| `GEMINI_MODEL` | optional, default `gemini-flash-latest` |
| `REMINDER_HOUR` / `REMINDER_MINUTE` | optional, default `18` / `30` |
| `BULLET` | optional, default `* ` (use `• ` if Chat shows raw asterisks) |

`setup()` creates `SHEET_ID`, `TELEGRAM_WEBHOOK_SECRET`, `LINK_SECRET` and `TELEGRAM_CHAT_ID` for you. Don't type these.

## Step 6: Run setup and deploy

1. In the editor, choose **`setup`** in the function dropdown and click **Run**.
2. Approve the permissions. You'll see *"Google hasn't verified this app"*. That's expected for your own script: click **Advanced**, then **Go to DSR Agent (unsafe)**, then **Allow**.
   - This creates a Sheet called **DSR Agent Data** in your Drive and the 18:30 weekday reminder.
3. Click **Deploy**, then **New deployment**, then the gear icon, then **Web app**:
   - **Execute as:** Me
   - **Who has access:** **Anyone**. Telegram's servers need to reach the script without a Google login. Every request is still checked for a secret.
   - Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
4. Add a Script Property `WEB_APP_URL` with that URL.
5. Run **`setup`** again. The **Execution log** should show `Telegram webhook: connected`, followed by your **laptop link** and your **Android shortcut link**.

## Step 7: Claim the bot and test

1. Send `/start` to your bot **straight away**. The first chat that sends `/start` becomes the only one allowed to use the bot.
2. Send something like: `watched a video on Kafka consumer groups, then fixed the login bug in my expense app, still stuck on docker networking`. The bot should reply with what it logged.
3. Send `/dsr`. It may ask one question first; answer it or reply `skip`. Then the draft appears with **Send** and **Regenerate** buttons.
4. Reply `make it shorter` and check that it revises the draft.
5. Tap **Send** and check the post in your **test space**.
6. Optional formatting check: run `testChatPost` from the editor. If the bullets show as raw `*`, set `BULLET` to `• `.
7. When you're happy with it, change `CHAT_WEBHOOK_URL` to the **team space** webhook. You don't need to redeploy for property changes.

## Step 8: Laptop

Bookmark the **laptop link** printed by `setup()` in your **personal** Chrome profile. If you lose it, run `showLinks` from the editor.

- The link contains a secret key. Anyone who has the link can use your agent, so treat it like a password and don't paste it into chats or documents.
- To revoke it, delete the `LINK_SECRET` property and run `setup()`. That creates a new link and the old one stops working.
- For voice on the laptop, press **Win + H** inside the text box to use Windows voice typing.

## Step 9: Android one-tap shortcut (optional)

1. Install **HTTP Shortcuts** (free, open source) from the Play Store.
2. Tap **+**, then **Regular Shortcut**. Name it `Post my DSR`, set the method to **GET**, and paste the **Android shortcut link** from `setup()`.
3. Long-press the shortcut and choose **Place on home screen**.

Tapping it drafts today's DSR and sends it to Telegram for review. It never posts to Chat by itself.

For voice on the phone, send a Telegram voice note saying "post my DSR". It works the same as typing it.

---

## Daily use

| You do | Agent does |
|---|---|
| Message what you did, paste a YouTube link, or send a voice note | Splits it into entries, tags each as done / in progress / blocker / next, and confirms |
| "the Redis course is still in progress", "delete the last note" | Edits your notes |
| `/dsr`, "post my DSR", Draft DSR (laptop), or the Android shortcut | Asks at most one question if notes are thin, then shows the draft |
| "make it shorter", "add that I read about Redis caching" | Revises the draft (and logs new work) |
| Tap **Send** / **Send to Google Chat** | Posts to Chat and locks the day |
| "what did I learn this week?" | Looks up your notes and answers |
| Nothing (weekday, 18:30) | If you have notes and haven't sent: sends you the draft. Otherwise stays quiet |

Telegram commands: `/dsr`, `/notes`, `/help`.

## Updating the code

1. Edit the files under `src/`, then run `clasp push` (or paste into the editor).
2. **Then redeploy.** Otherwise the web app keeps running the old version. Go to **Deploy**, then **Manage deployments**, click the pencil icon, set **Version** to **New version**, and click **Deploy**. The URL stays the same.

## Troubleshooting

| Problem | Check |
|---|---|
| Bot doesn't answer | Run `checkTelegramWebhook`. Look at `last_error_message`. A `302` there is a known Apps Script quirk, and repeated deliveries are ignored. Also check the **Log** tab in the Sheet and **Executions** in the editor |
| "Gemini free-tier limit reached" | Wait a minute, or set `GEMINI_MODEL` to a lighter model (e.g. a Flash-Lite one) |
| Chat post fails (HTTP 4xx) | The webhook was deleted or the URL is wrong. Recreate it and update `CHAT_WEBHOOK_URL` |
| Reminder time is off by a few minutes | Normal: Apps Script fires within ~15 minutes of the set time |
| Changed `REMINDER_HOUR` | Run `setup()` again to recreate the trigger |
| Laptop page says "Not found." | The bookmark's key is old. Run `showLinks` |

## GitHub (personal account)

This repo contains no secrets. They all live in Script Properties, and `.clasp.json` is git-ignored.

```bash
git config user.name "Your Name"
```
```bash
git config user.email "your-personal-email@example.com"
```
These settings apply only to this repo, so your company git identity stays untouched. Then create a **private** repo on your personal GitHub and push to it.

## Later ideas

- Weekly and monthly summaries (already possible by asking; could become a Friday message).
- An email copy of the reminder for laptop-only days.
