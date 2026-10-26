/* Connexions Popups builder: dashboard, template gallery, editor, install codes.
   Popups are saved in this browser's localStorage. The preview iframe runs the real
   embed runtime, so what you see in the editor is exactly what visitors get. */
(function () {
  'use strict';

  var KEY = 'cxp-builder:popups';
  var SKEY = 'cxp-builder:settings';
  var app = document.getElementById('app');
  var slot = document.getElementById('topbar-slot');
  var T = window.CxTemplates;

  var popups = load(KEY, []);
  var settings = Object.assign({
    installMode: 'inline',
    runtimeUrl: 'https://yourdomain.com/connexions-popup.js',
    jsonBase: 'https://yourdomain.com/popups/'
  }, load(SKEY, {}));

  var LAYOUTS = [
    ['modal', 'Modal'], ['split', 'Split image'], ['slidein', 'Slide-in'],
    ['bar-top', 'Top bar'], ['bar-bottom', 'Bottom bar'], ['fullscreen', 'Fullscreen']
  ];
  var FREQ = [
    ['everytime', 'Show every time'],
    ['everyTimeUntilClose', 'Show every time, until closed'],
    ['daily', 'Daily'],
    ['weekly', 'Weekly'],
    ['once', 'Show once']
  ];
  var FREQ_HINT = {
    everytime: 'Shows on every page view where a trigger fires.',
    everyTimeUntilClose: 'Shows on every page view until the visitor closes it (or submits the form), then stays hidden for 24 hours.',
    daily: 'At most once every 24 hours per visitor.',
    weekly: 'At most once every 7 days per visitor.',
    once: 'Shows one time per visitor, ever. Also stops after a form submit.'
  };
  var BLOCK_TYPES = {
    heading: { label: 'Heading', make: function () { return { type: 'heading', text: 'New heading', size: 26 }; } },
    text: { label: 'Text', make: function () { return { type: 'text', text: 'Write something here.' }; } },
    image: { label: 'Image', make: function () { return { type: 'image', src: '', alt: '', height: 180 }; } },
    button: { label: 'Button', make: function () { return { type: 'button', text: 'Click here', action: 'close' }; } },
    form: { label: 'Form', make: function () { return { type: 'form', nameField: false, emailField: true, buttonText: 'Subscribe', successText: 'Thanks! You are on the list.', webhookUrl: '' }; } },
    coupon: { label: 'Coupon', make: function () { return { type: 'coupon', code: 'SAVE10', copyText: 'Copy', copiedText: 'Copied!' }; } },
    countdown: { label: 'Countdown', make: function () { return { type: 'countdown', endsAt: T.inDays(3), expiredText: 'This offer has ended.' }; } },
    divider: { label: 'Divider', make: function () { return { type: 'divider' }; } },
    spacer: { label: 'Spacer', make: function () { return { type: 'spacer', height: 16 }; } }
  };

  // ---------- storage ----------
  function load(k, fallback) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(popups)); return true; }
    catch (e) { toast('Could not save: browser storage is unavailable or full.'); return false; }
  }
  function saveSettings() {
    try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) {}
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function find(id) { return popups.filter(function (p) { return p.id === id; })[0]; }

  // ---------- dom helper ----------
  var PROPS = { value: 1, checked: 1, disabled: 1, hidden: 1, selected: 1, type: 1, readOnly: 1 };
  function h(tag, attrs) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false && !PROPS[k]) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (PROPS[k]) n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
    return n;
  }
  function append(n, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(n, x); }); return; }
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function label(list, v) { var m = list.filter(function (x) { return x[0] === v; })[0]; return m ? m[1] : v; }

  function triggerSummary(c) {
    var t = [];
    if (c.triggerPageLoadEnabled) t.push('Page load');
    if (c.triggerTimeOnPageEnabled) t.push(c.triggerTimeOnPageDuration + 's on page');
    if (c.triggerScrollEnabled) t.push(c.triggerScrollPosition + '% scroll');
    if (c.triggerScrollToElementEnabled) t.push('Scroll to #' + (c.triggerScrollToElementId || '?'));
    if (c.triggerExitIntentEnabled) t.push('Exit intent');
    if (c.triggerClickEnabled) t.push('Click #' + (c.triggerClickElementId || '?'));
    return t.length ? t.join(' + ') : 'No trigger';
  }

  function thumb(c, onClick) {
    var color = /^bar-/.test(c.layout) ? c.background : c.accentColor;
    var hasShade = ['modal', 'split', 'fullscreen'].indexOf(c.layout) !== -1 && c.backdropVisible !== false && c.layout !== 'fullscreen';
    return h('div', { class: 'pop-thumb', onclick: onClick },
      h('div', { class: 'mini ' + c.layout + (c.position === 'left' ? ' left' : ''), style: '--mc:' + color },
        hasShade ? h('div', { class: 'mini-shade' }) : null,
        h('div', { class: 'mini-box' })));
  }

  // ---------- router ----------
  function route() {
    closeGallery();
    var m = location.hash.match(/^#\/edit\/(.+)$/);
    if (m && find(decodeURIComponent(m[1]))) renderEditor(find(decodeURIComponent(m[1])));
    else renderDashboard();
  }
  window.addEventListener('hashchange', route);

  // ---------- dashboard ----------
  function renderDashboard() {
    document.title = 'Connexions Popups';
    clear(slot); clear(app);
    slot.classList.remove('editing');
    slot.appendChild(h('button', { class: 'btn btn-primary', onclick: openGallery }, '+ New popup'));
    var active = popups.filter(function (p) { return p.active !== false; }).length;
    var dash = h('div', { class: 'dash' },
      h('div', { class: 'dash-head' },
        h('div', null,
          h('h1', { text: 'Your popups' }),
          h('p', { text: popups.length + (popups.length === 1 ? ' popup' : ' popups') + ' · ' + active + ' active' })),
        null));
    if (!popups.length) {
      dash.appendChild(h('div', { class: 'empty' },
        h('h2', { text: 'No popups yet' }),
        h('p', { text: 'Pick a template, customize it, and paste one snippet into any website.' }),
        h('button', { class: 'btn btn-primary', onclick: openGallery }, 'Create your first popup')));
    } else {
      var grid = h('div', { class: 'pop-grid' });
      popups.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).forEach(function (p) {
        grid.appendChild(popupCard(p));
      });
      dash.appendChild(grid);
    }
    app.appendChild(dash);
  }

  function popupCard(p) {
    var go = function () { location.hash = '#/edit/' + encodeURIComponent(p.id); };
    var del = h('button', { class: 'btn btn-sm btn-danger', onclick: function () {
      if (!del.classList.contains('armed')) {
        del.classList.add('armed'); del.textContent = 'Confirm delete';
        setTimeout(function () { if (del.isConnected) { del.classList.remove('armed'); del.textContent = 'Delete'; } }, 3000);
        return;
      }
      popups = popups.filter(function (x) { return x.id !== p.id; });
      persist(); renderDashboard(); toast('Popup deleted');
    } }, 'Delete');
    return h('div', { class: 'pop-card' },
      thumb(p, go),
      h('div', { class: 'pop-body' },
        h('div', { class: 'pop-title' },
          h('h3', { text: p.name, title: p.name }),
          h('button', {
            class: 'status ' + (p.active !== false ? 'on' : 'off'),
            title: 'Click to ' + (p.active !== false ? 'pause' : 'activate'),
            onclick: function () { p.active = p.active === false; p.updatedAt = Date.now(); persist(); renderDashboard(); }
          }, p.active !== false ? 'Active' : 'Paused')),
        h('div', { class: 'pop-meta' },
          h('span', { class: 'chip', text: label(LAYOUTS, p.layout) }),
          h('span', { class: 'chip', text: label(FREQ, p.displayFrequency) }),
          h('span', { class: 'chip', text: triggerSummary(p) })),
        h('div', { class: 'pop-actions' },
          h('button', { class: 'btn btn-sm btn-primary', onclick: go }, 'Edit'),
          h('a', { class: 'btn btn-sm', href: 'demo.html#' + encodeURIComponent(p.id), target: '_blank' }, 'Test live'),
          h('button', { class: 'btn btn-sm', onclick: function () {
            var copy = JSON.parse(JSON.stringify(p));
            copy.id = uid(); copy.name = p.name + ' (copy)'; copy.createdAt = copy.updatedAt = Date.now();
            popups.push(copy); persist(); renderDashboard(); toast('Popup duplicated');
          } }, 'Duplicate'),
          del)));
  }

  // ---------- template gallery ----------
  var gallery = null;
  function openGallery() {
    closeGallery();
    var grid = h('div', { class: 'tpl-grid' });
    T.list.forEach(function (t) {
      var preview = Object.assign(T.defaults(), t.build());
      grid.appendChild(h('button', { class: 'tpl', onclick: function () { createFrom(t); } },
        thumb(preview),
        h('div', { class: 'tpl-info' }, h('b', { text: t.name }), h('span', { text: t.desc }))));
    });
    gallery = h('div', { class: 'overlay', onclick: function (e) { if (e.target === gallery) closeGallery(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose a template' },
        h('div', { class: 'sheet-head' },
          h('h2', { text: 'Choose a template' }),
          h('button', { class: 'btn btn-sm', onclick: closeGallery }, 'Cancel')),
        grid));
    document.body.appendChild(gallery);
    grid.querySelector('button').focus();
  }
  function closeGallery() { if (gallery) { gallery.remove(); gallery = null; } }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeGallery(); });

  function createFrom(t) {
    var c = Object.assign(T.defaults(), t.build());
    c.id = uid(); c.createdAt = c.updatedAt = Date.now();
    popups.push(c);
    if (persist()) location.hash = '#/edit/' + encodeURIComponent(c.id);
  }

  // ---------- editor ----------
  var ed = null; // { cfg, tab, openBlocks, panel, frame, saved, ready }

  function renderEditor(cfg) {
    document.title = cfg.name + ' · Connexions Popups';
    clear(slot); clear(app);
    slot.classList.add('editing');
    var keepTab = ed && ed.cfg.id === cfg.id ? ed.tab : 'content';
    ed = { cfg: cfg, tab: keepTab, openBlocks: {}, ready: false };

    var name = h('input', { class: 'name-input', value: cfg.name, 'aria-label': 'Popup name', oninput: function () {
      cfg.name = name.value || 'Untitled popup'; changed();
    } });
    ed.saved = h('span', { class: 'saved', text: 'Saved' });
    slot.appendChild(h('a', { class: 'btn btn-sm', href: '#/' }, '← All popups'));
    slot.appendChild(name);
    slot.appendChild(ed.saved);
    slot.appendChild(h('a', { class: 'btn btn-sm', href: 'demo.html#' + encodeURIComponent(cfg.id), target: '_blank' }, 'Test live'));
    slot.appendChild(h('button', { class: 'btn btn-sm btn-primary', onclick: function () { setTab('install'); } }, 'Install'));

    var tabs = h('div', { class: 'tabs', role: 'tablist' });
    [['content', 'Content'], ['design', 'Design'], ['triggers', 'Triggers'], ['display', 'Display'], ['install', 'Install']].forEach(function (t) {
      tabs.appendChild(h('button', { class: 'tab', role: 'tab', 'data-tab': t[0], onclick: function () { setTab(t[0]); } }, t[1]));
    });
    ed.tabs = tabs;
    ed.panel = h('div', { class: 'panel', role: 'tabpanel' });

    ed.frame = h('iframe', { src: 'preview.html', title: 'Popup preview' });
    var frameWrap = h('div', { class: 'stage-frame' }, ed.frame);
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Preview device' });
    [['desktop', 'Desktop'], ['mobile', 'Mobile']].forEach(function (d) {
      seg.appendChild(h('button', { 'aria-pressed': d[0] === 'desktop' ? 'true' : 'false', onclick: function (e) {
        Array.prototype.forEach.call(seg.children, function (b) { b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'); });
        frameWrap.classList.toggle('mobile', d[0] === 'mobile');
        setTimeout(function () { pushPreview(true); }, 220);
      } }, d[1]));
    });
    ed.closedNote = h('span', { class: 'saved', text: '' });
    var stage = h('section', { class: 'stage' },
      h('div', { class: 'stage-bar' }, seg,
        h('div', { style: 'display:flex;align-items:center;gap:10px' }, ed.closedNote,
          h('button', { class: 'btn btn-sm', onclick: function () { pushPreview(true); } }, '↻ Replay'))),
      frameWrap);

    app.appendChild(h('div', { class: 'editor' }, h('aside', { class: 'side' }, tabs, ed.panel), stage));
    setTab(ed.tab);
  }

  // Preview iframe protocol: ready -> we send config; it reports when the popup gets closed.
  window.addEventListener('message', function (e) {
    if (!ed || !ed.frame || e.source !== ed.frame.contentWindow) return;
    var m = e.data || {};
    if (m.type === 'cxp-preview-ready') { ed.ready = true; pushPreview(true); }
    if (m.type === 'cxp-preview-closed') ed.closedNote.textContent = 'Popup closed. Hit Replay to see it again.';
  });

  function pushPreview(animate) {
    if (!ed || !ed.ready || !ed.frame.contentWindow) return;
    ed.closedNote.textContent = '';
    ed.frame.contentWindow.postMessage({ type: 'cxp-preview', config: publicConfig(ed.cfg), animate: !!animate }, '*');
  }

  var saveTimer;
  function changed(o) {
    o = o || {};
    ed.cfg.updatedAt = Date.now();
    ed.saved.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { if (persist()) ed.saved.textContent = 'Saved'; }, 350);
    pushPreview(false);
    if (o.rerender) renderPanel();
    if (o.after) o.after();
  }

  function setTab(tab) {
    ed.tab = tab;
    Array.prototype.forEach.call(ed.tabs.children, function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === tab ? 'true' : 'false'); });
    ed.panel.scrollTop = 0;
    renderPanel();
  }

  function renderPanel() {
    var st = ed.panel.scrollTop;
    clear(ed.panel);
    ({ content: panelContent, design: panelDesign, triggers: panelTriggers, display: panelDisplay, install: panelInstall })[ed.tab](ed.panel);
    ed.panel.scrollTop = st;
  }

  // ---------- form controls ----------
  var fid = 0;
  function field(lbl, control, hint) {
    var id = control.id || (control.id = 'f' + (++fid));
    return h('div', { class: 'field' }, h('label', { for: id, text: lbl }), control, hint ? h('p', { class: 'hint', text: hint }) : null);
  }
  function fText(lbl, obj, key, o) {
    o = o || {};
    var inp = h(o.multiline ? 'textarea' : 'input', {
      class: o.multiline ? 'textarea' : 'input', type: o.multiline ? null : (o.type || 'text'),
      placeholder: o.placeholder, value: obj[key] == null ? '' : String(obj[key])
    });
    inp.addEventListener(o.type === 'datetime-local' ? 'change' : 'input', function () { obj[key] = inp.value; changed(o); });
    return field(lbl, inp, o.hint);
  }
  function fNum(lbl, obj, key, o) {
    o = o || {};
    var inp = h('input', { class: 'input', type: 'number', min: o.min, max: o.max, step: o.step || 1, value: obj[key] == null ? '' : String(obj[key]) });
    inp.addEventListener('input', function () {
      var v = parseFloat(inp.value);
      if (isNaN(v)) return;
      if (o.min != null) v = Math.max(o.min, v);
      if (o.max != null) v = Math.min(o.max, v);
      obj[key] = v; changed(o);
    });
    return field(lbl, inp, o.hint);
  }
  function fSelect(lbl, obj, key, options, o) {
    o = o || {};
    var sel = h('select', { class: 'select' });
    options.forEach(function (op) { sel.appendChild(h('option', { value: op[0], selected: obj[key] === op[0] || (obj[key] == null && op[0] === '') }, op[1])); });
    sel.addEventListener('change', function () { obj[key] = sel.value; changed(o); });
    return field(lbl, sel, o.hint);
  }
  function fColor(lbl, obj, key, o) {
    o = o || {};
    var val = obj[key] || '';
    var txt = h('input', { type: 'text', value: val, placeholder: o.placeholder || 'auto', spellcheck: 'false' });
    var pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(val) ? val : '#000000', 'aria-label': lbl + ' picker' });
    pick.addEventListener('input', function () { txt.value = pick.value; obj[key] = pick.value; changed(o); });
    txt.addEventListener('input', function () {
      var v = txt.value.trim();
      if (!v || /^#([0-9a-f]{3}){1,2}$/i.test(v)) { obj[key] = v; if (/^#[0-9a-f]{6}$/i.test(v)) pick.value = v; changed(o); }
    });
    txt.id = 'f' + (++fid);
    var f = field(lbl, h('div', { class: 'color' }, pick, txt), o.hint);
    f.querySelector('label').setAttribute('for', txt.id);
    return f;
  }
  function fToggle(lbl, obj, key, o) {
    o = o || {};
    var cb = h('input', { type: 'checkbox', checked: !!obj[key] });
    cb.addEventListener('change', function () { obj[key] = cb.checked; changed({ rerender: o.rerender !== false }); });
    return h('label', { class: 'toggle' }, h('span', { text: lbl }), h('span', { class: 'switch' }, cb, h('i')));
  }
  function section(title) {
    var s = h('div', { class: 'section' }, title ? h('h4', { text: title }) : null);
    for (var i = 1; i < arguments.length; i++) append(s, arguments[i]);
    return s;
  }

  // ---------- Content tab ----------
  function blockSummary(b) {
    switch (b.type) {
      case 'heading': case 'text': return b.text || '';
      case 'image': return b.src || 'No image URL yet';
      case 'button': return (b.text || '') + (b.action === 'url' ? ' → ' + (b.url || 'no link') : b.action === 'close' ? ' (closes popup)' : '');
      case 'form': return [b.nameField && 'Name', b.emailField !== false && 'Email', b.phoneField && 'Phone'].filter(Boolean).join(', ') || 'No fields';
      case 'coupon': return b.code || '';
      case 'countdown': return b.endsAt ? 'Ends ' + new Date(b.endsAt).toLocaleString() : 'No end date';
      case 'spacer': return (b.height || 16) + 'px';
      default: return '';
    }
  }

  function panelContent(p) {
    var blocks = ed.cfg.blocks;
    var list = h('div');
    blocks.forEach(function (b, i) {
      var open = !!ed.openBlocks[i];
      var sum = h('span', { class: 'block-sum', text: blockSummary(b) });
      var after = function () { sum.textContent = blockSummary(b); };
      var move = function (dir) {
        return function (e) {
          e.stopPropagation();
          var j = i + dir;
          blocks.splice(j, 0, blocks.splice(i, 1)[0]);
          var oi = ed.openBlocks[i], oj = ed.openBlocks[j];
          ed.openBlocks[i] = oj; ed.openBlocks[j] = oi;
          changed({ rerender: true });
        };
      };
      var head = h('div', { class: 'block-head', onclick: function () { ed.openBlocks[i] = !open; renderPanel(); } },
        h('span', { class: 'block-type', text: BLOCK_TYPES[b.type].label }), sum,
        h('button', { class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: move(-1) }, '↑'),
        h('button', { class: 'icon-btn', title: 'Move down', 'aria-label': 'Move down', disabled: i === blocks.length - 1, onclick: move(1) }, '↓'),
        h('button', { class: 'icon-btn', title: 'Duplicate', 'aria-label': 'Duplicate', onclick: function (e) {
          e.stopPropagation(); blocks.splice(i + 1, 0, JSON.parse(JSON.stringify(b))); ed.openBlocks = {}; changed({ rerender: true });
        } }, '⧉'),
        h('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove', onclick: function (e) {
          e.stopPropagation(); blocks.splice(i, 1); ed.openBlocks = {}; changed({ rerender: true });
        } }, '✕'));
      var card = h('div', { class: 'block' }, head);
      if (open) card.appendChild(h('div', { class: 'block-body' }, blockFields(b, after)));
      list.appendChild(card);
    });
    if (!blocks.length) list.appendChild(h('p', { class: 'hint', text: 'No content yet. Add a block below.' }));

    var adds = h('div', { class: 'add-row' });
    Object.keys(BLOCK_TYPES).forEach(function (t) {
      adds.appendChild(h('button', { class: 'btn btn-sm', onclick: function () {
        blocks.push(BLOCK_TYPES[t].make());
        ed.openBlocks = {}; ed.openBlocks[blocks.length - 1] = true;
        changed({ rerender: true });
      } }, '+ ' + BLOCK_TYPES[t].label));
    });
    p.appendChild(section('Blocks', h('p', { class: 'hint', style: 'margin:0 0 10px', text: 'Click a block to edit it. Blocks stack top to bottom.' }), list));
    p.appendChild(section('Add block', adds));
  }

  var ALIGN = [['', 'Default'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']];
  function blockFields(b, after) {
    var o = { after: after };
    switch (b.type) {
      case 'heading': return [fText('Text', b, 'text', o), h('div', { class: 'row2' }, fNum('Size (px)', b, 'size', { min: 12, max: 72, after: after }), fSelect('Align', b, 'align', ALIGN, o))];
      case 'text': return [fText('Text', b, 'text', { multiline: true, after: after }), h('div', { class: 'row2' }, fNum('Size (px)', b, 'size', { min: 10, max: 40, after: after }), fSelect('Align', b, 'align', ALIGN, o))];
      case 'image': return [fText('Image URL', b, 'src', { placeholder: 'https://...', after: after, hint: 'Use a hosted image link (https).' }), h('div', { class: 'row2' }, fText('Alt text', b, 'alt', o), fNum('Height (px)', b, 'height', { min: 40, max: 600 }))];
      case 'button': return [
        fText('Label', b, 'text', o),
        fSelect('When clicked', b, 'action', [['close', 'Close the popup'], ['url', 'Open a link'], ['none', 'Track click only']], { rerender: true }),
        b.action === 'url' ? fText('Link URL', b, 'url', { placeholder: 'https://...', after: after }) : null,
        b.action === 'url' ? fToggle('Open in new tab', b, 'newTab') : null,
        h('div', { class: 'row2' }, fSelect('Style', b, 'style', [['', 'Solid'], ['ghost', 'Text link']]), h('div', { class: 'field' }, h('span', { class: 'lbl', text: ' ' }), fToggle('Full width', b, 'fullWidth')))
      ];
      case 'form': return [
        fToggle('Name field', b, 'nameField'),
        fToggle('Email field', b, 'emailField'),
        fToggle('Phone field', b, 'phoneField'),
        b.phoneField ? fToggle('Phone required', b, 'phoneRequired') : null,
        fText('Button label', b, 'buttonText', o),
        fText('Success message', b, 'successText', o),
        fText('Webhook URL (optional)', b, 'webhookUrl', { placeholder: 'https://hooks.zapier.com/...', hint: 'Each submission is POSTed here as JSON (popup id, fields, page URL, time). Point it at Zapier, Make, or the Connexions CRM when its intake endpoint exists. Not sent from the editor preview.' })
      ];
      case 'coupon': return [h('div', { class: 'row2' }, fText('Code', b, 'code', o), fText('Copy button', b, 'copyText', o))];
      case 'countdown': return [fText('Ends at', b, 'endsAt', { type: 'datetime-local', after: after, hint: 'Counts down in each visitor’s local time.' }), fText('Message after it ends', b, 'expiredText', o)];
      case 'spacer': return [fNum('Height (px)', b, 'height', { min: 4, max: 120, after: after })];
      default: return [h('p', { class: 'hint', text: 'Nothing to configure.' })];
    }
  }

  // ---------- Design tab ----------
  function hexToRgba(hex, pct) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return 'rgba(15,23,42,' + pct / 100 + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + pct / 100 + ')';
  }
  function panelDesign(p) {
    var c = ed.cfg;
    var grid = h('div', { class: 'layouts' });
    LAYOUTS.forEach(function (l) {
      var demo = Object.assign({}, c, { layout: l[0] });
      grid.appendChild(h('button', { class: 'layout-opt', 'aria-pressed': c.layout === l[0] ? 'true' : 'false', onclick: function () {
        c.layout = l[0]; changed({ rerender: true }); pushPreview(true);
      } }, thumb(demo), l[1]));
    });
    p.appendChild(section('Layout', grid,
      c.layout === 'slidein' ? h('div', { style: 'margin-top:12px' }, fSelect('Corner', c, 'position', [['right', 'Bottom right'], ['left', 'Bottom left']])) : null,
      c.layout === 'split' ? h('div', { style: 'margin-top:12px' },
        fText('Side image URL', c, 'sideImage', { placeholder: 'https://...', hint: 'Leave empty for a gradient in your accent color.' }),
        fSelect('Image side', c, 'sideImagePosition', [['left', 'Left'], ['right', 'Right']])) : null));

    var isBar = /^bar-/.test(c.layout);
    p.appendChild(section('Size & shape', h('div', { class: 'row2' },
      isBar ? null : fNum('Width (px)', c, 'widgetWidth', { min: 260, max: 1000, step: 10 }),
      fNum('Corner radius', c, 'borderRadius', { min: 0, max: 40 })),
      isBar ? null : fSelect('Content alignment', c, 'elementsAlignment', [['center', 'Center'], ['left', 'Left']])));

    p.appendChild(section('Colors',
      h('div', { class: 'row2' }, fColor('Background', c, 'background'), fColor('Text', c, 'textColor')),
      h('div', { class: 'row2' }, fColor('Accent (buttons)', c, 'accentColor'), fColor('Button text', c, 'accentTextColor'))));

    if (['modal', 'split', 'fullscreen'].indexOf(c.layout) !== -1) {
      var setBackdrop = function () { c.backdropBackground = hexToRgba(c.backdropColor, c.backdropOpacity); };
      p.appendChild(section('Backdrop',
        fToggle('Show backdrop', c, 'backdropVisible'),
        c.backdropVisible !== false ? [
          h('div', { class: 'row2' },
            fColor('Color', c, 'backdropColor', { after: function () { setBackdrop(); pushPreview(false); } }),
            fNum('Opacity (%)', c, 'backdropOpacity', { min: 0, max: 100, step: 5, after: function () { setBackdrop(); pushPreview(false); } })),
          fToggle('Close when backdrop is clicked', c, 'backdropClose')
        ] : null));
    }
    p.appendChild(section('Close button',
      fToggle('Show close button', c, 'closeButtonVisible'),
      c.closeButtonVisible !== false ? fColor('Color', c, 'closeButtonColor', { placeholder: 'matches text' }) : null));
  }

  // ---------- Triggers tab ----------
  function triggerCard(title, desc, key, extra) {
    var c = ed.cfg;
    return h('div', { class: 'card' + (c[key] ? ' on' : '') },
      fToggle(title, c, key),
      h('p', { class: 'hint', style: 'margin:0', text: desc }),
      c[key] && extra ? h('div', { class: 'sub' }, extra) : null);
  }
  function panelTriggers(p) {
    var c = ed.cfg;
    p.appendChild(h('div', { class: 'note', text: 'The popup opens on whichever enabled trigger fires first. Frequency and page rules (Display tab) are checked before any trigger is armed.' }));
    if (triggerSummary(c) === 'No trigger') p.appendChild(h('div', { class: 'note', style: 'background:#fef3c7;color:#92400e', text: 'No trigger is on, so this popup will never open by itself.' }));
    p.appendChild(triggerCard('On page load', 'Open the popup as soon as the page loads.', 'triggerPageLoadEnabled'));
    p.appendChild(triggerCard('Time on page', 'Open after the visitor spends a set number of seconds on the page.', 'triggerTimeOnPageEnabled',
      fNum('Seconds', c, 'triggerTimeOnPageDuration', { min: 1, max: 600 })));
    p.appendChild(triggerCard('On scroll', 'Open after the visitor scrolls past a percentage of the page.', 'triggerScrollEnabled',
      fNum('Scroll position (%)', c, 'triggerScrollPosition', { min: 1, max: 100, step: 5 })));
    p.appendChild(triggerCard('On scroll to element', 'Open when a specific element on your page scrolls into view.', 'triggerScrollToElementEnabled',
      fText('Element ID', c, 'triggerScrollToElementId', { placeholder: 'pricing', hint: 'The id attribute of the element, without the #.' })));
    p.appendChild(triggerCard('On exit intent', 'Open when the cursor leaves through the top of the window (toward the tabs or address bar). Desktop only: phones have no cursor.', 'triggerExitIntentEnabled'));
    p.appendChild(triggerCard('On click', 'Open whenever an element with this ID is clicked, like a "Get offer" button. Clicks ignore the frequency limit.', 'triggerClickEnabled',
      fText('Element ID', c, 'triggerClickElementId', { placeholder: 'open-offer', hint: 'The id attribute of the button or link, without the #.' })));
  }

  // ---------- Display tab ----------
  function linesField(lbl, obj, key, hint) {
    var ta = h('textarea', { class: 'textarea', placeholder: '/pricing\n/blog/*\nexample.com/contact', value: (obj[key] || []).join('\n') });
    ta.addEventListener('input', function () { obj[key] = ta.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); changed(); });
    return field(lbl, ta, hint);
  }
  function panelDisplay(p) {
    var c = ed.cfg;
    p.appendChild(section('Status', fToggle('Popup is active', c, 'active'),
      h('p', { class: 'hint', text: c.active === false ? 'Paused popups never show. With inline install, re-paste the code after pausing; hosted JSON updates on its own.' : 'Live wherever the install code is on the page.' })));

    p.appendChild(section('Frequency', fSelect('How often a visitor sees it', c, 'displayFrequency', FREQ, { rerender: true, hint: FREQ_HINT[c.displayFrequency] })));

    p.appendChild(section('Pages',
      fSelect('Show on', c, 'displayPages', [['allPages', 'All pages'], ['specificPages', 'Only specific pages'], ['excludedPages', 'All pages except...']], { rerender: true }),
      c.displayPages === 'specificPages' ? linesField('Show only on these pages', c, 'displaySpecificPages', 'One per line. Paths (/pricing) or full URLs. Use * as a wildcard, e.g. /blog/*') : null,
      c.displayPages === 'excludedPages' ? linesField('Never show on these pages', c, 'displayExcludedPages', 'One per line. Paths (/checkout) or full URLs. Use * as a wildcard.') : null));

    var devs = h('div', { class: 'checks' });
    [['desktop', 'Desktop'], ['mobile', 'Mobile']].forEach(function (d) {
      var cb = h('input', { type: 'checkbox', checked: (c.displayDevices || []).indexOf(d[0]) !== -1 });
      cb.addEventListener('change', function () {
        var set = (c.displayDevices || []).filter(function (x) { return x !== d[0]; });
        if (cb.checked) set.push(d[0]);
        if (!set.length) { cb.checked = true; toast('Keep at least one device'); return; }
        c.displayDevices = set; changed();
      });
      devs.appendChild(h('label', null, cb, d[1]));
    });
    p.appendChild(section('Devices', devs, h('p', { class: 'hint', text: 'Mobile means screens 767px wide or narrower.' })));

    p.appendChild(section('Schedule', fToggle('Only show between set dates', c, 'scheduleEnabled'),
      c.scheduleEnabled ? h('div', { class: 'row2' },
        fText('Start', c, 'scheduleStart', { type: 'datetime-local' }),
        fText('End', c, 'scheduleEnd', { type: 'datetime-local' })) : null,
      c.scheduleEnabled ? h('p', { class: 'hint', text: 'Uses each visitor’s local time. Leave either side empty for open-ended.' }) : null));

    p.appendChild(section('Reopen button', fToggle('Show a button that reopens the popup', c, 'reopenButton'),
      c.reopenButton ? [
        fText('Button text', c, 'reopenButtonText'),
        h('div', { class: 'row2' },
          fSelect('Position', c, 'reopenButtonPosition', [['right', 'Bottom right'], ['left', 'Bottom left']]),
          fSelect('When visible', c, 'reopenButtonMode', [['afterClose', 'After closing'], ['always', 'Always']]))
      ] : null));

    p.appendChild(section('Analytics', fToggle('Send events to Google Analytics', c, 'googleAnalytics'),
      h('p', { class: 'hint', text: 'When gtag is on the page, sends cxpopup_open, cxpopup_close, cxpopup_click, cxpopup_submit and cxpopup_couponCopied. The runtime always fires matching cxpopup:* browser events too.' })));
  }

  // ---------- Install tab ----------
  function publicConfig(c) {
    var out = JSON.parse(JSON.stringify(c));
    delete out.createdAt; delete out.updatedAt; delete out.backdropColor; delete out.backdropOpacity;
    return out;
  }
  function jsonUrl(c) { return settings.jsonBase.replace(/\/?$/, '/') + 'cx-popup-' + c.id + '.json'; }
  function snippet(c) {
    var head = '<!-- Connexions Popup: ' + c.name.replace(/--/g, '-') + ' -->\n<script src="' + settings.runtimeUrl + '" defer></script>\n';
    if (settings.installMode === 'hosted') return head + '<div data-cx-popup-src="' + jsonUrl(c) + '"></div>';
    var json = JSON.stringify(publicConfig(c)).replace(/</g, '\\u003c');
    return head + '<script type="application/json" data-cx-popup>' + json + '</script>';
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); }, fallback);
    } else fallback();
    function fallback() {
      var ta = h('textarea', { value: text }); document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied to clipboard'); } catch (e) { toast('Select the code and copy it manually'); }
      ta.remove();
    }
  }
  function download(name, text) {
    var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function panelInstall(p) {
    var c = ed.cfg;
    var modes = h('div', { class: 'radio-row' });
    [['inline', 'Inline (simplest)', 'Settings live inside the snippet. After any edit, paste the new code again.'],
     ['hosted', 'Hosted JSON (edit once, update everywhere)', 'Snippet points at a small JSON file on your server. After edits, re-upload just that file. Same idea as Elfsight’s boot service.']].forEach(function (m) {
      var r = h('input', { type: 'radio', name: 'cxp-mode', checked: settings.installMode === m[0] });
      r.addEventListener('change', function () { settings.installMode = m[0]; saveSettings(); renderPanel(); });
      modes.appendChild(h('label', { class: 'radio' }, r, h('div', null, h('b', { text: m[1] }), h('span', { text: m[2] }))));
    });
    p.appendChild(section('Install method', modes));

    var rt = h('input', { class: 'input', value: settings.runtimeUrl });
    rt.addEventListener('input', function () { settings.runtimeUrl = rt.value.trim(); saveSettings(); code.value = snippet(c); });
    var where = [field('Runtime script URL', rt, 'Where you uploaded runtime/connexions-popup.js from this folder. Upload it once; every popup shares it.')];
    if (settings.installMode === 'hosted') {
      var jb = h('input', { class: 'input', value: settings.jsonBase });
      jb.addEventListener('input', function () { settings.jsonBase = jb.value.trim(); saveSettings(); code.value = snippet(c); });
      where.push(field('Folder for popup JSON files', jb, 'Keep it on the same domain as the site, or enable CORS on that server.'));
    }
    p.appendChild(section('Your hosting', where));

    var code = h('textarea', { class: 'code', readOnly: true, value: snippet(c), 'aria-label': 'Install code', spellcheck: 'false' });
    code.addEventListener('focus', function () { code.select(); });
    var steps = settings.installMode === 'hosted'
      ? ['Upload connexions-popup.js to your site (one time).', 'Download this popup’s JSON and upload it to the folder above.', 'Paste the code before </body> on every page where it may show.', 'After edits: download and re-upload the JSON. No code change needed.']
      : ['Upload connexions-popup.js to your site (one time).', 'Paste the code before </body> on every page where it may show.', 'After edits: copy and paste the new code.'];
    p.appendChild(section('Install code',
      h('ol', { class: 'steps' }, steps.map(function (s) { return h('li', { text: s }); })),
      h('div', { style: 'margin-top:12px' }, code),
      h('div', { class: 'add-row' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: function () { copyText(code.value); } }, 'Copy code'),
        settings.installMode === 'hosted' ? h('button', { class: 'btn btn-sm', onclick: function () {
          download('cx-popup-' + c.id + '.json', JSON.stringify(publicConfig(c), null, 2)); toast('JSON downloaded');
        } }, 'Download JSON') : null,
        h('a', { class: 'btn btn-sm', href: 'demo.html#' + encodeURIComponent(c.id), target: '_blank' }, 'Test on demo page'))));

    p.appendChild(section('Good to know',
      h('p', { class: 'hint', text: 'Popup ID: ' + c.id }),
      h('p', { class: 'hint', text: 'Frequency is tracked per visitor in their browser (localStorage key cxp:' + c.id + '). Clearing site data resets it.' }),
      h('p', { class: 'hint', text: 'Open or close from your own code: CxPopups.open(‘' + c.id + '’) and CxPopups.close(‘' + c.id + '’).' })));
  }

  route();
})();
