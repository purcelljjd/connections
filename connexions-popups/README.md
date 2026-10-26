# Connexions Popups

A popup builder for Connexions, modeled on how Elfsight's popup app works (see EVIDENCE.md). Plain static files: no server,
no install, no build step.

## Use it

Double-click `index.html` (it opens in Edge). Popups save in that browser's localStorage.

- **Dashboard:** list, pause/activate, duplicate, delete, "Test live".
- **New popup:** pick one of 7 templates (welcome discount, newsletter, exit-intent offer, announcement bar, countdown sale,
  callback request, blank).
- **Editor tabs:**
  - Content: blocks for heading, text, image, button, form, coupon, countdown, divider and spacer.
  - Design: 6 layouts, colors, size, backdrop, close button.
  - Triggers: page load, time on page, scroll %, scroll to element, exit intent, click.
  - Display: frequency, pages, devices, schedule, reopen button, GA events.
  - Install: the embed code.
- **Test live:** `demo.html` loads the real runtime on a long sample page, shows which rules pass, and logs every event.

## Put a popup on a website

1. Upload `runtime/connexions-popup.js` to the site once.
2. In the Install tab, set the runtime URL and copy the code. Paste it before `</body>`.
   - Inline mode: settings live in the snippet, so re-paste after edits.
   - Hosted JSON mode: upload `cx-popup-<id>.json` and re-upload only that file after edits.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js`, `app.css`, `templates.js` | The builder (dashboard + editor) |
| `preview.html` | Editor preview frame; runs the real runtime |
| `runtime/connexions-popup.js` | The embed customers load (about 27 KB, no dependencies) |
| `demo.html` | Trigger/frequency test page |
| `EVIDENCE.md` | How Elfsight popups work, with source quotes |

## Runtime API (for site owners)

`CxPopups.open(id)`, `CxPopups.close(id)`, `CxPopups.reset(id)` (clears frequency for this visitor).
Events: `cxpopup:open`, `cxpopup:close`, `cxpopup:click`, `cxpopup:submit`, `cxpopup:couponCopied` on `window`.
