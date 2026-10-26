/*!
 * Connexions Popups runtime v1.0.0
 * Drop-in embed: finds popup configs on the page, checks page/device/schedule
 * rules and display frequency, arms triggers, and renders the popup.
 */
(function (w, d) {
  'use strict';
  if (w.CxPopups && w.CxPopups.version) return;

  var VERSION = '1.0.0';
  var STORAGE_PREFIX = 'cxp:';
  var DAY = 86400;
  var WEEK = 604800;
  var MOBILE_MAX = 767;
  var instances = {};

  var CSS = '' +
    '.cxp-root{--cxp-bg:#fff;--cxp-fg:#111827;--cxp-accent:#4f46e5;--cxp-accent-fg:#fff;--cxp-radius:16px;--cxp-width:480px;--cxp-backdrop:rgba(15,23,42,.6);' +
    'position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.45;color:var(--cxp-fg)}' +
    '.cxp-root *,.cxp-root *::before,.cxp-root *::after{box-sizing:border-box}' +
    '.cxp-backdrop{position:absolute;inset:0;background:var(--cxp-backdrop);opacity:0;transition:opacity .25s ease;pointer-events:none}' +
    '.cxp-root.cxp-open .cxp-backdrop{opacity:1;pointer-events:auto}' +
    '.cxp-box{position:absolute;background:var(--cxp-bg);color:var(--cxp-fg);border-radius:var(--cxp-radius);box-shadow:0 24px 64px rgba(15,23,42,.28);display:flex;overflow:hidden;opacity:0;pointer-events:none;transition:opacity .25s ease,transform .3s cubic-bezier(.2,.8,.2,1);max-height:calc(100vh - 32px)}' +
    '.cxp-root.cxp-open .cxp-box{opacity:1;pointer-events:auto}' +
    '.cxp-body{flex:1 1 auto;padding:32px;overflow:auto;display:flex;flex-direction:column;gap:14px;min-width:0}' +
    '.cxp-media{flex:0 0 42%;background:linear-gradient(135deg,var(--cxp-accent),#0ea5e9);background-size:cover;background-position:center;min-height:200px}' +
    '.cxp-close{position:absolute;top:10px;right:10px;width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:var(--cxp-close,currentColor);font-size:24px;line-height:1;cursor:pointer;z-index:2;display:flex;align-items:center;justify-content:center;opacity:.7}' +
    '.cxp-close:hover{opacity:1;background:rgba(127,127,127,.15)}' +
    /* layouts */
    '.cxp-layout-modal .cxp-box,.cxp-layout-split .cxp-box{left:50%;top:50%;width:min(var(--cxp-width),calc(100vw - 32px));transform:translate(-50%,-46%) scale(.96)}' +
    '.cxp-layout-modal.cxp-open .cxp-box,.cxp-layout-split.cxp-open .cxp-box{transform:translate(-50%,-50%) scale(1)}' +
    '.cxp-layout-split .cxp-box{width:min(calc(var(--cxp-width) * 1.6),calc(100vw - 32px))}' +
    '.cxp-layout-slidein .cxp-box{width:min(var(--cxp-width),calc(100vw - 32px));bottom:16px;transform:translateY(24px)}' +
    '.cxp-layout-slidein.cxp-pos-right .cxp-box{right:16px}.cxp-layout-slidein.cxp-pos-left .cxp-box{left:16px}' +
    '.cxp-layout-slidein.cxp-open .cxp-box{transform:none}' +
    '.cxp-layout-bar-top .cxp-box,.cxp-layout-bar-bottom .cxp-box{left:0;right:0;border-radius:0;max-height:none}' +
    '.cxp-layout-bar-top .cxp-box{top:0;transform:translateY(-100%)}.cxp-layout-bar-bottom .cxp-box{bottom:0;transform:translateY(100%)}' +
    '.cxp-layout-bar-top.cxp-open .cxp-box,.cxp-layout-bar-bottom.cxp-open .cxp-box{transform:none}' +
    '.cxp-layout-bar-top .cxp-body,.cxp-layout-bar-bottom .cxp-body{flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:center;padding:12px 56px 12px 20px;gap:12px 20px}' +
    '.cxp-layout-bar-top .cxp-b-text,.cxp-layout-bar-bottom .cxp-b-text,.cxp-layout-bar-top .cxp-b-heading,.cxp-layout-bar-bottom .cxp-b-heading{margin:0}' +
    '.cxp-layout-bar-top .cxp-close,.cxp-layout-bar-bottom .cxp-close{top:50%;transform:translateY(-50%)}' +
    '.cxp-layout-fullscreen .cxp-box{inset:0;border-radius:0;max-height:none;transform:scale(1.02)}' +
    '.cxp-layout-fullscreen.cxp-open .cxp-box{transform:none}' +
    '.cxp-layout-fullscreen .cxp-body{justify-content:center;align-items:center;max-width:var(--cxp-width);margin:0 auto}' +
    '.cxp-no-anim .cxp-box,.cxp-no-anim .cxp-backdrop{transition:none!important}' +
    '@media (max-width:640px){.cxp-layout-split .cxp-box{flex-direction:column}.cxp-layout-split .cxp-media{flex-basis:160px;min-height:160px}.cxp-body{padding:24px}}' +
    '@media (prefers-reduced-motion:reduce){.cxp-box,.cxp-backdrop{transition:opacity .15s linear!important}}' +
    /* blocks */
    '.cxp-align-left .cxp-body{text-align:left;align-items:stretch}.cxp-align-center .cxp-body{text-align:center}' +
    '.cxp-b-heading{margin:0;font-weight:800;letter-spacing:-.01em;line-height:1.15}' +
    '.cxp-b-text{margin:0;white-space:pre-line;opacity:.85}' +
    '.cxp-b-image{display:block;width:100%;object-fit:cover;border-radius:calc(var(--cxp-radius) * .6)}' +
    '.cxp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:calc(var(--cxp-radius) * .6);padding:13px 22px;font:inherit;font-weight:700;cursor:pointer;background:var(--cxp-accent);color:var(--cxp-accent-fg);text-decoration:none;transition:filter .15s}' +
    '.cxp-btn:hover{filter:brightness(1.08)}.cxp-btn-ghost{background:transparent;color:inherit;text-decoration:underline;font-weight:500;padding:6px}' +
    '.cxp-btn-full{width:100%}' +
    '.cxp-form{display:flex;flex-direction:column;gap:10px;text-align:left}' +
    '.cxp-layout-bar-top .cxp-form,.cxp-layout-bar-bottom .cxp-form{flex-direction:row;flex-wrap:wrap}' +
    '.cxp-input{width:100%;font:inherit;padding:12px 14px;border:1px solid rgba(127,127,127,.35);border-radius:calc(var(--cxp-radius) * .5);background:rgba(255,255,255,.9);color:#111827}' +
    '.cxp-layout-bar-top .cxp-input,.cxp-layout-bar-bottom .cxp-input{width:auto;min-width:200px;padding:9px 12px}' +
    '.cxp-input:focus{outline:2px solid var(--cxp-accent);outline-offset:1px}' +
    '.cxp-success{padding:14px;border-radius:calc(var(--cxp-radius) * .5);background:rgba(16,185,129,.12);font-weight:600;text-align:center}' +
    '.cxp-error{color:#dc2626;font-size:.9em}' +
    '.cxp-coupon{display:flex;align-items:stretch;border:2px dashed var(--cxp-accent);border-radius:calc(var(--cxp-radius) * .6);overflow:hidden}' +
    '.cxp-coupon-code{flex:1;padding:12px 16px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1.25em;font-weight:800;letter-spacing:.08em;display:flex;align-items:center;justify-content:center}' +
    '.cxp-coupon .cxp-btn{border-radius:0}' +
    '.cxp-countdown{display:flex;gap:10px;justify-content:center}' +
    '.cxp-cd-unit{min-width:62px;padding:10px 6px;border-radius:calc(var(--cxp-radius) * .5);background:rgba(127,127,127,.12);text-align:center}' +
    '.cxp-cd-num{display:block;font-size:1.6em;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1}' +
    '.cxp-cd-lbl{font-size:.72em;text-transform:uppercase;letter-spacing:.08em;opacity:.7}' +
    '.cxp-spacer{flex:0 0 auto}' +
    '.cxp-divider{border:0;border-top:1px solid rgba(127,127,127,.3);margin:4px 0;width:100%}' +
    /* reopen button */
    '.cxp-reopen{position:fixed;bottom:16px;z-index:2147482999;border:0;border-radius:999px;padding:12px 18px;font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(15,23,42,.25);background:var(--cxp-accent,#4f46e5);color:var(--cxp-accent-fg,#fff)}' +
    '.cxp-reopen.cxp-pos-right{right:16px}.cxp-reopen.cxp-pos-left{left:16px}';

  // ---------- small helpers ----------
  function now() { return Math.trunc(Date.now() / 1000); }
  function el(tag, cls, text) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function injectStyles() {
    if (d.getElementById('cxp-styles')) return;
    var s = el('style');
    s.id = 'cxp-styles';
    s.textContent = CSS;
    (d.head || d.documentElement).appendChild(s);
  }
  function emit(name, cfg, detail) {
    var data = { popupId: cfg.id, popupName: cfg.name };
    for (var k in detail || {}) data[k] = detail[k];
    try { w.dispatchEvent(new CustomEvent('cxpopup:' + name, { detail: data })); } catch (e) {}
    if (cfg.googleAnalytics && typeof w.gtag === 'function') {
      try { w.gtag('event', 'cxpopup_' + name, { popup_id: cfg.id, popup_name: cfg.name }); } catch (e) {}
    }
  }
  function store() {
    try { var t = '__cxp_test'; w.localStorage.setItem(t, '1'); w.localStorage.removeItem(t); return w.localStorage; }
    catch (e) { return null; }
  }
  function readState(id) {
    var s = store();
    if (!s) return {};
    try { return JSON.parse(s.getItem(STORAGE_PREFIX + id)) || {}; } catch (e) { return {}; }
  }
  function writeState(id, patch) {
    var s = store();
    if (!s) return;
    var cur = readState(id);
    for (var k in patch) cur[k] = patch[k];
    try { s.setItem(STORAGE_PREFIX + id, JSON.stringify(cur)); } catch (e) {}
  }

  // ---------- display rules ----------
  // Same gate Elfsight's popup uses: last-shown timestamp + closed flag, compared to day/week windows.
  function frequencyAllows(cfg) {
    var st = readState(cfg.id);
    var shown = parseInt(st.shown || 0, 10);
    var dayPassed = now() - shown >= DAY;
    switch (cfg.displayFrequency) {
      case 'once': return !shown && !st.converted;
      case 'daily': return !shown || dayPassed;
      case 'weekly': return !shown || now() - shown >= WEEK;
      case 'everyTimeUntilClose': return !(st.closed && shown && !dayPassed) && !st.converted;
      default: return true; // 'everytime'
    }
  }
  function normUrl(u) {
    return String(u || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  }
  function urlMatches(pattern, loc) {
    var p = normUrl(pattern);
    if (!p) return false;
    var target = p.charAt(0) === '/' ? normUrl(loc.pathname + loc.search) : normUrl(loc.href);
    if (p.charAt(0) === '/' && !target) target = '/';
    var rx = new RegExp('^' + p.split('*').map(function (s) { return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }).join('.*') + '$');
    return rx.test(target || '/');
  }
  function pageAllows(cfg, loc) {
    loc = loc || w.location;
    var mode = cfg.displayPages || 'allPages';
    var list = (mode === 'specificPages' ? cfg.displaySpecificPages : cfg.displayExcludedPages) || [];
    list = list.filter(function (p) { return String(p || '').trim(); });
    if (mode === 'specificPages') return list.some(function (p) { return urlMatches(p, loc); });
    if (mode === 'excludedPages') return !list.some(function (p) { return urlMatches(p, loc); });
    return true;
  }
  function deviceAllows(cfg) {
    var devices = cfg.displayDevices || ['desktop', 'mobile'];
    var type = w.innerWidth <= MOBILE_MAX ? 'mobile' : 'desktop';
    return devices.indexOf(type) !== -1;
  }
  function scheduleAllows(cfg) {
    if (!cfg.scheduleEnabled) return true;
    var t = Date.now();
    var start = cfg.scheduleStart ? new Date(cfg.scheduleStart).getTime() : null;
    var end = cfg.scheduleEnd ? new Date(cfg.scheduleEnd).getTime() : null;
    if (start && t < start) return false;
    if (end && t > end) return false;
    return true;
  }

  // ---------- triggers (any one fires the popup) ----------
  function armTriggers(cfg, fire) {
    var cleanups = [];
    var done = false;
    function once(name) {
      if (done) return;
      done = true;
      cleanups.forEach(function (c) { try { c(); } catch (e) {} });
      fire(name);
    }
    if (cfg.triggerPageLoadEnabled) {
      var t0 = setTimeout(function () { once('pageLoad'); }, 0);
      cleanups.push(function () { clearTimeout(t0); });
    }
    if (cfg.triggerTimeOnPageEnabled && cfg.triggerTimeOnPageDuration > 0) {
      var t1 = setTimeout(function () { once('timeOnPage'); }, cfg.triggerTimeOnPageDuration * 1000);
      cleanups.push(function () { clearTimeout(t1); });
    }
    if (cfg.triggerScrollEnabled && cfg.triggerScrollPosition > 0) {
      var onScroll = function () {
        var max = d.documentElement.scrollHeight - w.innerHeight;
        var pct = max > 0 ? (w.scrollY / max) * 100 : 100;
        if (pct >= cfg.triggerScrollPosition) once('scroll');
      };
      w.addEventListener('scroll', onScroll, { passive: true });
      cleanups.push(function () { w.removeEventListener('scroll', onScroll); });
    }
    if (cfg.triggerScrollToElementEnabled && cfg.triggerScrollToElementId && w.IntersectionObserver) {
      var target = d.getElementById(String(cfg.triggerScrollToElementId).replace(/^#/, ''));
      if (target) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { if (en.isIntersecting) once('scrollToElement'); });
        });
        io.observe(target);
        cleanups.push(function () { io.disconnect(); });
      }
    }
    if (cfg.triggerExitIntentEnabled) {
      // Cursor leaves through the top of the viewport (toward tabs / address bar).
      var root = d.documentElement;
      var onLeave = function (e) { if (e.clientY < 0 || e.pageY < 0) once('exitIntent'); };
      root.addEventListener('mouseleave', onLeave, { passive: true });
      cleanups.push(function () { root.removeEventListener('mouseleave', onLeave); });
    }
    return function () { done = true; cleanups.forEach(function (c) { try { c(); } catch (e) {} }); };
  }

  // ---------- rendering ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function renderBlock(b, ctx) {
    switch (b.type) {
      case 'heading': {
        var h = el('h2', 'cxp-b-heading', b.text || '');
        h.style.fontSize = (b.size || 28) + 'px';
        if (b.align) h.style.textAlign = b.align;
        return h;
      }
      case 'text': {
        var p = el('p', 'cxp-b-text', b.text || '');
        if (b.size) p.style.fontSize = b.size + 'px';
        if (b.align) p.style.textAlign = b.align;
        return p;
      }
      case 'image': {
        if (!b.src) return null;
        var img = el('img', 'cxp-b-image');
        img.src = b.src;
        img.alt = b.alt || '';
        if (b.height) img.style.height = b.height + 'px';
        return img;
      }
      case 'button': {
        var isLink = b.action === 'url' && b.url;
        var btn = el(isLink ? 'a' : 'button', 'cxp-btn' + (b.style === 'ghost' ? ' cxp-btn-ghost' : '') + (b.fullWidth ? ' cxp-btn-full' : ''), b.text || 'Click');
        if (isLink) {
          btn.href = b.url;
          if (b.newTab !== false) { btn.target = '_blank'; btn.rel = 'noopener'; }
        } else {
          btn.type = 'button';
        }
        btn.addEventListener('click', function () {
          emit('click', ctx.cfg, { button: b.text });
          if (b.action === 'close' || (isLink && b.closeOnClick !== false)) ctx.close(true);
        });
        return btn;
      }
      case 'form': return renderForm(b, ctx);
      case 'coupon': {
        var wrap = el('div', 'cxp-coupon');
        var code = el('div', 'cxp-coupon-code', b.code || 'CODE');
        var copy = el('button', 'cxp-btn', b.copyText || 'Copy');
        copy.type = 'button';
        copy.addEventListener('click', function () {
          var done = function () { copy.textContent = b.copiedText || 'Copied!'; emit('couponCopied', ctx.cfg, { code: b.code }); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(b.code || '').then(done, fallback);
          else fallback();
          function fallback() {
            var ta = el('textarea'); ta.value = b.code || ''; d.body.appendChild(ta); ta.select();
            try { d.execCommand('copy'); } catch (e) {}
            ta.remove(); done();
          }
        });
        wrap.appendChild(code); wrap.appendChild(copy);
        return wrap;
      }
      case 'countdown': {
        var cd = el('div', 'cxp-countdown');
        var end = b.endsAt ? new Date(b.endsAt).getTime() : 0;
        var units = [['days', 'Days'], ['hours', 'Hours'], ['mins', 'Min'], ['secs', 'Sec']].map(function (u) {
          var box = el('div', 'cxp-cd-unit');
          var num = el('span', 'cxp-cd-num', '00');
          box.appendChild(num); box.appendChild(el('span', 'cxp-cd-lbl', u[1]));
          cd.appendChild(box);
          return num;
        });
        var tick = function () {
          var left = Math.max(0, Math.floor((end - Date.now()) / 1000));
          if (!end || left <= 0) {
            cd.textContent = '';
            cd.appendChild(el('p', 'cxp-b-text', b.expiredText || 'This offer has ended.'));
            clearInterval(iv);
            return;
          }
          var vals = [Math.floor(left / 86400), Math.floor(left % 86400 / 3600), Math.floor(left % 3600 / 60), left % 60];
          units.forEach(function (n, i) { n.textContent = pad(vals[i]); });
        };
        var iv = setInterval(tick, 1000);
        ctx.timers.push(iv);
        tick();
        return cd;
      }
      case 'divider': return el('hr', 'cxp-divider');
      case 'spacer': {
        var sp = el('div', 'cxp-spacer');
        sp.style.height = (b.height || 16) + 'px';
        return sp;
      }
    }
    return null;
  }

  function renderForm(b, ctx) {
    var form = el('form', 'cxp-form');
    form.noValidate = true;
    var fields = [];
    if (b.nameField) fields.push({ name: 'name', type: 'text', placeholder: b.namePlaceholder || 'Your name', required: !!b.nameRequired });
    if (b.emailField !== false) fields.push({ name: 'email', type: 'email', placeholder: b.emailPlaceholder || 'Your email', required: b.emailRequired !== false });
    if (b.phoneField) fields.push({ name: 'phone', type: 'tel', placeholder: b.phonePlaceholder || 'Phone number', required: !!b.phoneRequired });
    fields.forEach(function (f) {
      var i = el('input', 'cxp-input');
      i.type = f.type; i.name = f.name; i.placeholder = f.placeholder; i.required = f.required;
      i.setAttribute('aria-label', f.placeholder);
      if (f.type === 'email') i.autocomplete = 'email';
      if (f.type === 'tel') i.autocomplete = 'tel';
      if (f.name === 'name') i.autocomplete = 'name';
      form.appendChild(i);
    });
    var err = el('div', 'cxp-error');
    var submit = el('button', 'cxp-btn cxp-btn-full', b.buttonText || 'Subscribe');
    submit.type = 'submit';
    form.appendChild(submit);
    form.appendChild(err);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      var data = {};
      var bad = null;
      Array.prototype.forEach.call(form.querySelectorAll('input'), function (i) {
        var v = i.value.trim();
        data[i.name] = v;
        if (!bad && i.required && !v) bad = 'Please fill in all required fields.';
        if (!bad && i.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) bad = 'Please enter a valid email address.';
      });
      if (bad) { err.textContent = bad; return; }
      submit.disabled = true;
      var payload = {
        popupId: ctx.cfg.id, popupName: ctx.cfg.name, fields: data,
        pageUrl: w.location.href, submittedAt: new Date().toISOString()
      };
      var finish = function () {
        if (!ctx.preview) writeState(ctx.cfg.id, { converted: true });
        emit('submit', ctx.cfg, { fields: data });
        var ok = el('div', 'cxp-success', b.successText || 'Thanks! You are on the list.');
        form.replaceWith(ok);
      };
      if (b.webhookUrl && !ctx.preview) {
        // text/plain keeps this a "simple" CORS request, so most webhook receivers accept it without a preflight.
        fetch(b.webhookUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload) })
          .then(finish, function () { submit.disabled = false; err.textContent = 'Something went wrong. Please try again.'; });
      } else {
        finish();
      }
    });
    return form;
  }

  function render(cfg, opts) {
    opts = opts || {};
    injectStyles();
    var layout = cfg.layout || 'modal';
    var hasBackdrop = (layout === 'modal' || layout === 'split' || layout === 'fullscreen') && cfg.backdropVisible !== false;
    var root = el('div', 'cxp-root cxp-layout-' + layout + ' cxp-pos-' + (cfg.position || 'right') + ' cxp-align-' + (cfg.elementsAlignment || 'center'));
    root.setAttribute('data-cxp-id', cfg.id);
    var vars = {
      '--cxp-bg': cfg.background, '--cxp-fg': cfg.textColor, '--cxp-accent': cfg.accentColor,
      '--cxp-accent-fg': cfg.accentTextColor, '--cxp-radius': cfg.borderRadius != null ? cfg.borderRadius + 'px' : null,
      '--cxp-width': cfg.widgetWidth ? cfg.widgetWidth + 'px' : null, '--cxp-backdrop': cfg.backdropBackground,
      '--cxp-close': cfg.closeButtonColor
    };
    for (var k in vars) if (vars[k]) root.style.setProperty(k, vars[k]);

    var ctx = { cfg: cfg, preview: !!opts.preview, timers: [], close: null };
    var backdrop = el('div', 'cxp-backdrop');
    if (!hasBackdrop) backdrop.style.display = 'none';
    var box = el('div', 'cxp-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', hasBackdrop ? 'true' : 'false');
    box.setAttribute('aria-label', cfg.name || 'Popup');
    if (layout === 'split') {
      var media = el('div', 'cxp-media');
      if (cfg.sideImage) media.style.backgroundImage = 'url("' + String(cfg.sideImage).replace(/"/g, '%22') + '")';
      if (cfg.sideImagePosition === 'right') media.style.order = '2';
      box.appendChild(media);
    }
    var body = el('div', 'cxp-body');
    (cfg.blocks || []).forEach(function (b) {
      var n = renderBlock(b, ctx);
      if (n) body.appendChild(n);
    });
    box.appendChild(body);
    if (cfg.closeButtonVisible !== false) {
      var x = el('button', 'cxp-close', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', function () { api.close(true); });
      box.appendChild(x);
    }
    root.appendChild(backdrop);
    root.appendChild(box);
    if (hasBackdrop && cfg.backdropClose !== false) backdrop.addEventListener('click', function () { api.close(true); });

    var reopen = null;
    if (cfg.reopenButton) {
      reopen = el('button', 'cxp-reopen cxp-pos-' + (cfg.reopenButtonPosition || 'right'), cfg.reopenButtonText || 'Open offer');
      reopen.type = 'button';
      reopen.style.setProperty('--cxp-accent', cfg.accentColor || '');
      reopen.style.setProperty('--cxp-accent-fg', cfg.accentTextColor || '');
      reopen.hidden = true;
      reopen.addEventListener('click', function () { api.open('reopenButton'); });
    }

    var onKey = function (e) { if (e.key === 'Escape' && api.isOpen) api.close(true); };
    var lastFocus = null;

    var api = {
      isOpen: false,
      root: root,
      open: function (trigger) {
        if (api.isOpen) return;
        if (!root.parentNode) d.body.appendChild(root);
        if (reopen && !reopen.parentNode) d.body.appendChild(reopen);
        if (reopen) reopen.hidden = true;
        if (opts.animate === false) root.classList.add('cxp-no-anim');
        lastFocus = d.activeElement;
        api.isOpen = true;
        void root.offsetWidth;
        root.classList.add('cxp-open');
        d.addEventListener('keydown', onKey);
        if (hasBackdrop) { var f = box.querySelector('input,button.cxp-btn,a.cxp-btn,.cxp-close'); if (f && !opts.preview) f.focus({ preventScroll: true }); }
        if (!opts.preview) writeState(cfg.id, { shown: now(), closed: false });
        emit('open', cfg, { trigger: trigger });
        if (opts.animate === false) setTimeout(function () { root.classList.remove('cxp-no-anim'); }, 50);
      },
      close: function (byUser) {
        if (!api.isOpen) return;
        api.isOpen = false;
        root.classList.remove('cxp-open');
        d.removeEventListener('keydown', onKey);
        if (byUser && !opts.preview) writeState(cfg.id, { closed: true });
        if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
        if (reopen && cfg.reopenButtonMode !== 'never') reopen.hidden = false;
        emit('close', cfg, {});
        if (opts.onClose) opts.onClose();
      },
      showReopen: function () {
        if (!reopen) return;
        if (!reopen.parentNode) d.body.appendChild(reopen);
        reopen.hidden = false;
      },
      destroy: function () {
        ctx.timers.forEach(clearInterval);
        d.removeEventListener('keydown', onKey);
        if (root.parentNode) root.remove();
        if (reopen && reopen.parentNode) reopen.remove();
      }
    };
    ctx.close = api.close;
    return api;
  }

  // ---------- lifecycle ----------
  function init(cfg) {
    if (!cfg || !cfg.id || instances[cfg.id]) return null;
    if (cfg.active === false) return null;
    if (!pageAllows(cfg) || !deviceAllows(cfg) || !scheduleAllows(cfg)) return null;
    var inst = render(cfg);
    instances[cfg.id] = inst;
    if (cfg.reopenButton && cfg.reopenButtonMode === 'always') inst.showReopen();
    if (cfg.triggerClickEnabled && cfg.triggerClickElementId) {
      var sel = '#' + String(cfg.triggerClickElementId).replace(/^#/, '');
      d.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest(sel) : null;
        if (t) { e.preventDefault(); inst.open('click'); }
      });
    }
    if (frequencyAllows(cfg)) {
      armTriggers(cfg, function (name) { inst.open(name); });
    } else if (cfg.reopenButton && cfg.reopenButtonMode !== 'never') {
      inst.showReopen();
    }
    return inst;
  }

  function boot(scope) {
    scope = scope || d;
    Array.prototype.forEach.call(scope.querySelectorAll('script[type="application/json"][data-cx-popup]:not([data-cxp-done])'), function (s) {
      s.setAttribute('data-cxp-done', '1');
      try { init(JSON.parse(s.textContent)); } catch (e) { console.error('[Connexions Popups] Bad popup config', e); }
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-cx-popup-src]:not([data-cxp-done])'), function (n) {
      n.setAttribute('data-cxp-done', '1');
      fetch(n.getAttribute('data-cx-popup-src'), { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(init)
        .catch(function (e) { console.error('[Connexions Popups] Could not load popup config', e); });
    });
  }

  var previewInst = null;
  function preview(cfg, opts) {
    opts = opts || {};
    if (previewInst) previewInst.destroy();
    previewInst = render(cfg, { preview: true, animate: opts.animate, onClose: opts.onClose });
    previewInst.open('preview');
    return previewInst;
  }

  w.CxPopups = {
    version: VERSION,
    init: init,
    boot: boot,
    render: render,
    preview: preview,
    open: function (id) { if (instances[id]) instances[id].open('api'); },
    close: function (id) { if (instances[id]) instances[id].close(false); },
    reset: function (id) { var s = store(); if (s) s.removeItem(STORAGE_PREFIX + id); },
    _rules: { frequencyAllows: frequencyAllows, pageAllows: pageAllows, urlMatches: urlMatches }
  };

  function start() {
    boot(d);
    if (w.MutationObserver && !w.CxPopupsNoObserve) {
      new MutationObserver(function () { boot(d); }).observe(d.documentElement, { childList: true, subtree: true });
    }
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start);
  else start();
})(window, document);
