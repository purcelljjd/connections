# Connexions Reputation

Review requests by email and text, feedback routing, and AI review replies. Modeled on GatherUp (see `EVIDENCE.md`).

Plain static files with no server and no build step. Open `index.html`. Data stays in that browser's localStorage. Use **Settings > Data** to export a backup.

## Files
- `index.html`, `app.js`, `app.css`: the app. Routes are `#/onboarding` (wizard), `#/` (customers), `#/requests`, `#/reviews` and `#/settings`.
- `feedback.html`: the page customers land on. Its link carries the business settings in the `#` part, so it needs no server.
- `reply-engine.js`: AI reply drafting, either the built-in drafter or Claude.
- `evidence/`: GatherUp's public guides, API doc extracts, and the 403 from the gated wizard.
- `screenshots/`: the browser test run.

## How a request works
1. Add a customer, then click **Ask for review**. The message uses your template and a personal link.
2. **Delivery:**
   - **Manual** opens your email or text app with the message filled in.
   - **Connexions server** sends texts for real through Twilio or Txtria (see below). Email still opens your email app.
   - **Webhook** POSTs `{type:"message", channel, to, subject, body}` to your URL, so Zapier or Make can do the sending.
3. **The customer:**
   - rates the visit, then gets routed: positive goes to review-site buttons, negative goes to an apology and a private feedback box (review links stay visible);
   - and each rating, comment and site click is reported back to the dashboard. In the same browser this goes through the `cxr:inbox` localStorage key, and to the webhook as `{type:"rating"|"comment"|"site"|"open", ...}`.
4. Reminders 1 and 2 show as **Send reminder** once due. Automatic mode sends them itself, through the Connexions server (texts) or the webhook.

## SMS server (Twilio or Txtria)
`server/server.js` is a zero-dependency Node server (Node 20.12+, this PC has 24). It serves the app and sends texts.

**Setup:**
1. Copy `server/.env.example` to `server/.env` and fill it in. `.env` is git-ignored and never served to browsers.
   - `SMS_PROVIDER=twilio`, `txtria`, or `test` (logs only, sends nothing) picks the provider. Change it and restart to switch.
   - `ACCESS_KEY` is a long random string. Paste the same value into Settings > Delivery > Server access key.
   - Twilio needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` (your number, or a Messaging Service SID starting `MG`).
   - Txtria needs `TXTRIA_SYS_ID`, `TXTRIA_AUTH_TOKEN`, and `TXTRIA_FROM` (your 10-digit TxTRIA number).
2. Run `node server/server.js`, then open `http://127.0.0.1:8820`.
3. In Settings > Delivery, choose **Connexions server**. The status line shows the active provider. Use **Send a test text** to confirm.

**Routes:**
- `POST /api/sms/send` sends a text. It needs the `x-cx-key` header.
- `GET /api/sms/status` reports the provider and whether it's set up.
- `GET /api/sms/optouts` lists numbers that replied STOP.
- `POST /api/sms/inbound?token=INBOUND_TOKEN` is where the provider sends replies:
  - STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE and OPTOUT block that number;
  - START, UNSTOP and YES unblock it.

**Inbound replies:**
- Twilio: set the number's "A message comes in" webhook to the inbound URL (HTTP POST).
- Txtria: register it with their `POST https://txtria.com/api/smsurl` (fields `number`, `url`, `sys_id`, `auth_token`).
- Txtria doesn't document the field names of inbound messages. The server accepts the common ones and logs every raw payload to `server/inbound.log`. Check the first real STOP there.
- Inbound only works once the server is on a public address.

**Logs:** `server/sends.log` records each send. Phone numbers are masked and message text isn't stored.

**Retries:** if the connection to the provider never opens (dead DNS, for example), the server retries once. It never retries after the provider may have received the message, so a customer can't get a double text.

## AI replies
- **Built-in drafter:** offline and free. It matches the rating's sentiment, uses the reviewer's first name and what they mentioned, never offers incentives, and strips em-dashes.
- **Claude:** calls the Anthropic Messages API from the browser with your key (Settings > AI replies).
  - Default model `claude-opus-5-5`, with low effort and server-side refusal fallback. Haiku 5.5 is the cheap option.
  - The key is stored only in this browser, under `cxr:anthropic-key`. It is never included in exports.
- Positive reviews auto-draft. Every reply needs your **Approve** click:
  - private feedback gets emailed to the customer;
  - public reviews get copied, and the review site opens so you can paste it.

## Known limits (honest list)
- **Email has no automatic sender yet.** Texts go through the server (Twilio or Txtria). Email still opens your email app, or goes through the webhook.
- **Automatic mode runs only while the dashboard is open**, because the customer list lives in the browser. A scheduled server-side sender needs the Connexions backend database.
- **Feedback links are long, measured at 378 characters with two review sites and no logo or webhook (more with those)**, because they carry the settings. That's fine in email but too long for SMS. A production version needs a short-link service on a Connexions domain.
- **Links only reach customers once `feedback.html` is hosted.** Set Settings > Delivery > Feedback page address. A `file:///` link does not work for customers.
- **Feedback only flows back into the dashboard automatically when both are on the same host and browser**, or through the webhook. A real multi-user setup needs the Connexions backend.
- **No Google Business Profile sync or direct posting yet.** Reviews are pasted in by hand.
- **No QR code generator or kiosk mode yet.** The general feedback link (Requests page) can be turned into a QR code with any free generator.
