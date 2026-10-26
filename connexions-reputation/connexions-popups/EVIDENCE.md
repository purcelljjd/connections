# How Elfsight Popups work (evidence)

Captured 2026-10-25 from Elfsight's live public files and its no-login demo editor
(`https://dash.elfsight.com/demo/popup?templatePid=28e828db-0b36-45a8-bc33-eb23133b2570`),
using a real Edge session plus downloads of the shipped JavaScript. Every claim below has the source string it came from.

## 1. The dashboard is a shell around two iframes

`dash.elfsight.com` is a Next.js app (`/_next/static/chunks/pages/demo/[alias]-acec6479a3816be5.js`). Opening the popup editor
made the browser load two separate, versioned app builds from Elfsight's CDN:

```
https://universe-static.elfsightcdn.com/app-releases/popup/stable/v2.53.8/4d04e143.../configurator/index.html   <- settings panel
https://universe-static.elfsightcdn.com/app-releases/popup/stable/v2.53.8/4d04e143.../preview/index.html        <- live preview
```

The preview iframe then loads `https://static.elfsight.com/platform/platform.js`, the same script customers embed. So the
editor preview runs the production widget, not a mock. **Connexions copies this:** `preview.html` runs the real runtime.

## 2. The embed: platform.js finds placeholders and calls a boot API

From `platform.js` (44 KB, "Copyright (c) 2026 Elfsight, LLC"):

```js
getWidgetsElements: ... e.getElementsByTagName("elfsight-app") ... e.querySelectorAll('*[class^="elfsight-app"]')
getWidgetIdByElement: ... o.getEappsClass(e).replace("elfsight-app-","")
u+="/p/boot/"; var f=b.stringify({w:i.join(","),page:o.getPage()}); p.open("get",u+"?"+f), p.withCredentials=!0
... o.loadAssets(t.data.assets), c.forEach(o.initWidget.bind(o))
"https://core.service.elfsight.com"
o.observe=function(){if(e.MutationObserver ... {childList:!0,subtree:!0,characterData:!0}
```

Flow: the customer pastes `<script src="platform.js">` and `<div class="elfsight-app-<UUID>">`. The script collects every UUID,
makes one GET to `core.service.elfsight.com/p/boot/?w=<ids>&page=<url>`, receives each widget's settings and the app bundle
URLs, injects the scripts, and starts each widget. A MutationObserver catches widgets added later (SPA sites).
Lazy loading is supported: `data-elfsight-app-lazy` with modes `disabled | enabled | first-activity | in-viewport`.

The boot API is live and public. A request for a template UUID returned:
`{"status":1,"data":{"widgets":{"c0d67c16-...":{"status":0,"reason":"WIDGET_NOT_FOUND"}},"assets":[]}}`

**Connexions equivalent:** inline JSON in the snippet, or "Hosted JSON" mode (`data-cx-popup-src`), which works the same way
as boot: edit settings once and every site picks them up.

## 3. The popup settings schema

Destructured in the preview bundle `preview-4TnxjlCB.js` (1.37 MB):

```
blocks layout widgetWidth elementsAlignment elementsAlignmentPane backdropVisible backdropClose backdropBackground
closeButtonVisible closeButtonColor triggerPageLoadEnabled triggerTimeOnPageEnabled triggerTimeOnPageDuration
triggerScrollEnabled triggerScrollPosition triggerScrollToElementEnabled triggerScrollToElementId
triggerExitIntentEnabled triggerClickEnabled triggerClickElementId displayFrequency displayPages
displaySpecificPages displayExcludedPages displayDevices reopenButton reopenButtonIcon reopenButtonText
reopenButtonPosition reopenButtonMode ... schedule ... googleAnalytics
```

Connexions uses the same key names, so the concepts map one to one.

## 4. Triggers: whichever fires first wins

```js
W=[g&&Xh(), _&&v&&Zh(`timeOnPageOver`,v), y&&b&&qh(`documentScrollOver`,b/100),
   x&&S&&Jh(`elementInViewport`,`#${CSS.escape(S)}`), C&&Yh()].filter(e=>typeof e==`function`)
```

- Page load: `Xh=(e='immediately')=>t=>t(e)`
- Time on page: `Zh('timeOnPageOver', seconds)`
- Scroll %: `qh('documentScrollOver', pct/100)`
- Scroll to element: `IntersectionObserver` on `document.querySelector('#id')`
- **Exit intent:** `t.addEventListener('mouseleave', r)` on `document.documentElement`, firing when `t.pageY<0||t.clientY<0`
  (the cursor left through the top of the window). It is desktop-only by nature.
- Click: `triggerClickElementId`

## 5. Frequency: timestamps in the visitor's browser

```js
let t=Math.trunc(Date.now()/1e3), n=parseInt(String(re??0),10), r=!!ne, i=t-n>=86400,
a=[()=>E===`weekly`&&n&&t-n<604800, ()=>E===`daily`&&n&&!i, ()=>E===`once`&&n,
   ()=>E===`everyTimeUntilClose`&&r&&n&&!i];
for(let e of a) if(e()){oe(!1);return}
```

`n` is the last-shown time and `r` is "was closed". Editor labels from `configurator/languages/en.json`: "Show every time",
"Show every time, until I close it", "Daily", "Weekly", "Show once". Note what the code does with "until I close it": the
popup **comes back after 24 hours** (`!i`). The label doesn't say that. Connexions keeps the same behavior but says so in the UI.

Storage goes through `localStorage` with a `sessionStorage` fallback (`ElfsightLibraryStorageTest` probe).

## 6. Other features seen in the bundle and labels

Page targeting with `*` wildcards ("use asterisk symbol * to choose a group of pages"), devices (Desktop / Mobile), a
scheduled start/end with repeat rules (`scheduleRepeatPeriod`, `scheduleRepeatWeeklyOnDays`, ...), a reopen button,
Google Analytics events (`popupOpened`, "Triggered when a visitor copies a coupon code"...), forms with SMTP / Google
Sheets / webhook integrations, and block types including text, button, email and imageChoice.

## What Connexions Popups does NOT copy yet

- Repeating schedules (daily/weekly windows). Connexions has a start/end window only.
- Server-side form storage and a submissions inbox. Connexions sends each submission to a webhook (Zapier, Make, or the
  Connexions CRM once its intake endpoint exists).
- Accounts, multi-user, and view analytics. The builder stores popups in one browser's localStorage. A real Connexions
  backend replaces that, plus the boot service, when the CRM side exists.
