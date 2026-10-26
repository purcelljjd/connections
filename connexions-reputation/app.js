/* Connexions Reputation: review requests by email/SMS, feedback routing, AI review replies.
 * Plain static app. State lives in this browser's localStorage under cxr:data.
 * feedback.html reports back through the cxr:inbox key (same origin) and the webhook.
 */
(function () {
  'use strict';

  var KEY = 'cxr:data', INBOX = 'cxr:inbox', AIKEY = 'cxr:anthropic-key', SRVKEY = 'cxr:server-key';
  var app = document.getElementById('app'), slot = document.getElementById('slot'), nav = document.getElementById('nav');

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid(p) { return p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function now() { return new Date().toISOString(); }
  function daysSince(iso) { return (Date.now() - Date.parse(iso)) / 864e5; }
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, p, v) { var ks = p.split('.'), a = o; ks.slice(0, -1).forEach(function (k) { a = a[k] || (a[k] = {}); }); a[ks[ks.length - 1]] = v; }
  function full(c) { return [c.first, c.last].filter(Boolean).join(' '); }
  function enc(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var SITES = { google: 'Google', facebook: 'Facebook', yelp: 'Yelp', tripadvisor: 'Tripadvisor', bbb: 'BBB', other: 'Other site' };
  var CATEGORIES = ['Limousine service', 'Chauffeur service', 'Transportation service', 'Airport shuttle service', 'Bookkeeping service',
    'Accounting firm', 'Marketing agency', 'Internet marketing service', 'Newspaper publisher', 'Restaurant', 'Dentist', 'Auto repair shop',
    'Insurance agency', 'Real estate agency', 'Law firm', 'Medical clinic', 'Hair salon', 'Plumber', 'HVAC contractor', 'Software company'];

  // ---------- state ----------
  function defaults() {
    return {
      business: {
        onboarded: false, wizStep: 1, name: '', street: '', city: '', state: '', zip: '', country: 'US', phone: '', email: '',
        website: '', category: '', summary: '', logo: '', color: '#4f46e5',
        owner: { first: '', last: '', email: '', phone: '' },
        reviewLinks: [{ type: 'google', url: '' }, { type: 'facebook', url: '' }]
      },
      settings: {
        flow: 'review', ratingType: 'nps', npsThreshold: 7, starsThreshold: 4,
        sendMethod: 'preference', repeatDays: 30, sendMode: 'manual', autoPerDay: 30,
        reminders: [{ on: true, days: 3 }, { on: true, days: 7 }], smsReminders: true,
        delivery: 'manual', webhook: '', feedbackBase: '', serverUrl: '',
        msg: {
          emailSubject: 'How did we do, {first_name}?',
          emailBody: 'Hi {first_name},\n\nThank you for choosing {business}. Could you take 30 seconds to tell us how we did?\n\n{link}\n\nYour feedback goes straight to our team.\n\nThank you,\n{owner_first}\n{business}',
          sms: 'Hi {first_name}, thanks for choosing {business}! How did we do? {link} Reply STOP to opt out.',
          remSubject: 'Quick reminder: how did we do?',
          remBody: 'Hi {first_name},\n\nJust a quick reminder: we would love to hear about your experience with {business}. It only takes a moment.\n\n{link}\n\nThank you,\n{owner_first}',
          remSms: 'Hi {first_name}, a quick reminder from {business}: we would love your feedback. {link} Reply STOP to opt out.'
        },
        copy: { q: '', ph: '', pb: '', nh: '', nb: '' },
        ai: { engine: 'builtin', model: 'claude-opus-5-5', tone: 'warm', signoff: '', autoDraft: true }
      },
      customers: [], feedback: [], reviews: []
    };
  }
  function merge(d, s) {
    if (Array.isArray(d)) return Array.isArray(s) ? s : d;
    if (d && typeof d === 'object') {
      var o = {}, k;
      for (k in d) o[k] = d[k];
      if (s && typeof s === 'object') for (k in s) o[k] = k in d ? merge(d[k], s[k]) : s[k];
      return o;
    }
    return s === undefined ? d : s;
  }
  var data;
  try { data = merge(defaults(), JSON.parse(store(KEY) || '{}')); } catch (e) { data = defaults(); }
  function save() { store(KEY, JSON.stringify(data)); }

  // ---------- feedback page reports (cxr:inbox) ----------
  function pullInbox() {
    var box;
    try { box = JSON.parse(store(INBOX) || '[]'); } catch (e) { return false; }
    if (!box.length) return false;
    store(INBOX, '[]');
    box.forEach(function (ev) {
      var cust = data.customers.filter(function (c) { return c.id === ev.c; })[0];
      var req = cust && cust.requests.filter(function (r) { return r.id === ev.r; })[0];
      var fb = data.feedback.filter(function (f) { return f.id === ev.fid; })[0];
      if (ev.type === 'open') { if (req && req.status === 'sent') req.status = 'opened'; return; }
      if (ev.type === 'rating') {
        if (!fb) {
          fb = { id: ev.fid, customerId: ev.c, requestId: ev.r, author: cust ? full(cust) : '', rating: ev.rating, scale: ev.scale,
            positive: ev.positive, comment: '', at: ev.at, sites: [], reply: null };
          data.feedback.unshift(fb);
        } else { fb.rating = ev.rating; fb.positive = ev.positive; }
        if (req) req.status = 'completed';
      } else if (ev.type === 'comment' && fb) {
        fb.comment = ev.comment;
        if (ev.name && !fb.author) fb.author = ev.name;
      } else if (ev.type === 'site') {
        if (fb && fb.sites.indexOf(ev.site) === -1) fb.sites.push(ev.site);
        if (req) {
          req.siteClicks = req.siteClicks || [];
          if (req.siteClicks.indexOf(ev.site) === -1) req.siteClicks.push(ev.site);
          if (req.status !== 'completed') req.status = 'clicked';
        }
      }
    });
    save();
    return true;
  }
  window.addEventListener('storage', function (e) { if (e.key === INBOX && pullInbox()) render(); });
  window.addEventListener('focus', function () { if (pullInbox()) render(); });

  // ---------- links + messages ----------
  function feedbackBase() { return (data.settings.feedbackBase || '').trim() || new URL('feedback.html', location.href).href.split('#')[0]; }
  function payload(extra) {
    var b = data.business, s = data.settings, cp = {}, k;
    var p = { v: 1, n: b.name, k: b.color, t: s.ratingType, f: s.flow, th: s.ratingType === 'nps' ? s.npsThreshold : s.starsThreshold,
      links: b.reviewLinks.filter(function (l) { return l.url; }).map(function (l) { return [l.type, l.url]; }) };
    if (b.logo) p.l = b.logo;
    if (s.webhook) p.w = s.webhook;
    for (k in s.copy) if (s.copy[k]) cp[k] = s.copy[k];
    if (Object.keys(cp).length) p.cp = cp;
    for (k in extra) p[k] = extra[k];
    return p;
  }
  function linkFor(cust, req) { return feedbackBase() + '#' + enc(payload(cust ? { c: cust.id, r: req.id, fn: cust.first } : {})); }
  function generalLink() { return feedbackBase() + '#' + enc(payload({})); }

  function fill(t, cust, link) {
    var b = data.business;
    return String(t || '').replace(/\{first_name\}/g, cust.first || 'there').replace(/\{last_name\}/g, cust.last || '')
      .replace(/\{business\}/g, b.name || '').replace(/\{owner_first\}/g, b.owner.first || b.name || '').replace(/\{link\}/g, link);
  }

  function channelsFor(cust) {
    var m = data.settings.sendMethod;
    var ch = m === 'both' ? ['email', 'sms'] : m === 'preference' ? [cust.pref || 'email'] : [m];
    ch = ch.filter(function (c) { return c === 'email' ? cust.email : cust.phone && !cust.smsStop; });
    if (!ch.length) ch = cust.email ? ['email'] : (cust.phone && !cust.smsStop) ? ['sms'] : [];
    return ch;
  }

  // reminder: null for the first request, 0 or 1 for reminders
  function compose(cust, req, reminder) {
    var m = data.settings.msg, link = linkFor(cust.id ? cust : null, req), out = [];
    var chans = req.channels;
    if (reminder != null) {
      chans = chans.map(function (c) { return c === 'sms' && !data.settings.smsReminders ? (cust.email ? 'email' : null) : c; })
        .filter(function (c, i, a) { return c && a.indexOf(c) === i; });
    }
    chans.forEach(function (c) {
      if (c === 'email') out.push({ channel: 'email', to: cust.email, subject: fill(reminder != null ? m.remSubject : m.emailSubject, cust, link), body: fill(reminder != null ? m.remBody : m.emailBody, cust, link) });
      else out.push({ channel: 'sms', to: cust.phone, body: fill(reminder != null ? m.remSms : m.sms, cust, link) });
    });
    return out;
  }

  // ---------- Connexions server (texts via Twilio or Txtria, chosen in server/.env) ----------
  function e164(num) {
    var s = String(num || '').trim(), d = s.replace(/\D/g, '');
    if (s.charAt(0) === '+' && d.length >= 8) return '+' + d;
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d.charAt(0) === '1') return '+' + d;
    return null;
  }
  function serverBase() {
    var u = (data.settings.serverUrl || '').trim();
    if (u) return u.replace(/\/+$/, '');
    return /^https?:$/.test(location.protocol) ? location.origin : 'http://127.0.0.1:8820';
  }
  function serverCall(p, body) {
    var h = { 'x-cx-key': store(SRVKEY) || '' };
    if (body) h['Content-Type'] = 'application/json';
    return fetch(serverBase() + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Server returned HTTP ' + r.status }; }); },
        function () { return { ok: false, code: 'network', error: 'Can’t reach the Connexions server at ' + serverBase() + '. Is it running?' }; });
  }
  var optoutsSynced = false;
  function syncOptouts() {
    if (optoutsSynced || data.settings.delivery !== 'server') return;
    optoutsSynced = true;
    serverCall('/api/sms/optouts').then(function (j) {
      if (!j.ok) return;
      var changed = false;
      data.customers.forEach(function (c) {
        var stop = !!c.phone && j.numbers.indexOf(e164(c.phone)) !== -1;
        if (!!c.smsStop !== stop) { c.smsStop = stop; changed = true; }
      });
      if (changed) { save(); render(); }
    });
  }

  function deliver(msgs, title, cust, req) {
    if (!msgs.length) return toast('No email or mobile number on file for this customer.');
    var s = data.settings;
    if (s.delivery === 'server') {
      var texts = msgs.filter(function (m) { return m.channel === 'sms'; });
      var rest = msgs.filter(function (m) { return m.channel !== 'sms'; });
      if (texts.length) {
        Promise.all(texts.map(function (m) { return serverCall('/api/sms/send', { to: m.to, body: m.body }); })).then(function (rs) {
          var bad = rs.filter(function (r) { return !r.ok; })[0];
          if (cust && rs.some(function (r) { return r.code === 'opted_out'; })) cust.smsStop = true;
          if (req) { req.sms = rs[0]; if (bad) req.error = bad.error; else delete req.error; }
          save();
          toast(bad ? 'Text not sent: ' + bad.error : 'Text sent via ' + (rs[0].provider === 'txtria' ? 'Txtria' : rs[0].provider === 'twilio' ? 'Twilio' : 'test mode (nothing actually sent)') + '.');
          if (route() === 'dashboard') render();
        });
      }
      if (rest.length) manualSheet(rest, title);
      return;
    }
    if (s.delivery === 'webhook' && s.webhook) {
      msgs.forEach(function (m) {
        try {
          fetch(s.webhook, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ type: 'message', business: data.business.name, channel: m.channel, to: m.to, subject: m.subject || '', body: m.body }) });
        } catch (e) {}
      });
      return toast('Handed ' + msgs.length + ' message' + (msgs.length > 1 ? 's' : '') + ' to your webhook.');
    }
    manualSheet(msgs, title);
  }

  function manualSheet(msgs, title) {
    openSheet(title || 'Send the request', msgs.map(function (m, i) {
      var href = m.channel === 'email'
        ? 'mailto:' + encodeURIComponent(m.to) + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body)
        : 'sms:' + String(m.to).replace(/[^\d+]/g, '') + '?body=' + encodeURIComponent(m.body);
      return '<div class="msg"><div class="msg-head"><b>' + (m.channel === 'email' ? 'Email' : 'Text message') + ' to ' + esc(m.to) + '</b>' +
        (m.channel === 'sms' ? '<span class="chip">' + m.body.length + ' chars</span>' : '') + '</div>' +
        (m.subject ? '<div class="hint" style="margin:0 0 6px">Subject: <b>' + esc(m.subject) + '</b></div>' : '') +
        '<pre>' + esc(m.body) + '</pre><div class="actions"><a class="btn btn-primary btn-sm" href="' + esc(href) + '">' +
        (m.channel === 'email' ? 'Open in email app' : 'Open in text app') + '</a>' +
        '<button class="btn btn-sm" data-a="copy-msg" data-i="' + i + '">Copy message</button></div></div>';
    }).join('') + '<p class="hint">This opens your own email or text app with the message filled in. ' +
      (data.settings.delivery === 'server' ? 'The server sends texts only; email still goes from your own email app.'
        : 'To send texts for real, switch Settings &gt; Delivery to the Connexions server.') + '</p>', function (el) {
      el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-a="copy-msg"]');
        if (b) copy(msgs[+b.dataset.i].body, 'Message copied.');
      });
    });
  }

  function lastReq(c) { return c.requests[c.requests.length - 1]; }

  var forceArm = null;
  function requestFeedback(cust, force) {
    var last = lastReq(cust), s = data.settings;
    if (last && !force && !last.error && daysSince(last.at) < s.repeatDays) {
      forceArm = cust.id;
      setTimeout(function () { if (forceArm === cust.id) forceArm = null; }, 5000);
      return toast(cust.first + ' was asked ' + Math.floor(daysSince(last.at)) + ' day(s) ago (repeat limit: ' + s.repeatDays + ' days). Click again within 5s to send anyway.');
    }
    var chans = channelsFor(cust);
    if (!chans.length) return toast('No email or mobile number on file for ' + cust.first + '.');
    var req = { id: uid('q'), at: now(), channels: chans, status: 'sent', reminders: [null, null], siteClicks: [] };
    cust.requests.push(req);
    save();
    deliver(compose(cust, req, null), 'Ask ' + cust.first + ' for a review', cust, req);
    render();
  }

  function dueReminders() {
    var out = [], rs = data.settings.reminders;
    data.customers.forEach(function (c) {
      var r = lastReq(c);
      if (!r || r.status === 'completed' || r.status === 'clicked') return;
      for (var i = 0; i < 2; i++) {
        if (r.reminders[i]) continue;
        if (rs[i].on && daysSince(r.at) >= rs[i].days) out.push({ cust: c, req: r, i: i });
        break;
      }
    });
    return out;
  }

  function sendReminder(cust) {
    var due = dueReminders().filter(function (d) { return d.cust.id === cust.id; })[0];
    if (!due) return;
    due.req.reminders[due.i] = now();
    save();
    deliver(compose(cust, due.req, due.i), (due.i === 0 ? '1st' : '2nd') + ' reminder to ' + cust.first, cust, due.req);
    render();
  }

  // Automatic mode: queue new customers, send within business hours, capped per day.
  // Needs webhook delivery, or the Connexions server (texts only: email can't go out without a click).
  function autoRun() {
    var s = data.settings, viaServer = s.delivery === 'server';
    if (s.sendMode !== 'auto' || !data.business.onboarded || !(viaServer || (s.delivery === 'webhook' && s.webhook))) return;
    var autoChannels = function (c) { return viaServer ? (c.phone && !c.smsStop ? ['sms'] : []) : channelsFor(c); };
    var autoMsgs = function (list) { return viaServer ? list.filter(function (m) { return m.channel === 'sms'; }) : list; };
    var h = new Date().getHours();
    if (h < 9 || h >= 18) return;
    var today = new Date().toDateString(), sentToday = 0;
    data.customers.forEach(function (c) { c.requests.forEach(function (r) { if (new Date(r.at).toDateString() === today) sentToday++; }); });
    var room = Math.max(0, s.autoPerDay - sentToday), n = 0;
    data.customers.forEach(function (c) {
      if (room <= 0 || c.requests.length || !autoChannels(c).length) return;
      var req = { id: uid('q'), at: now(), channels: autoChannels(c), status: 'sent', reminders: [null, null], siteClicks: [] };
      c.requests.push(req); room--; n++;
      deliver(compose(c, req, null), null, c, req);
    });
    dueReminders().forEach(function (d) {
      var msgs = autoMsgs(compose(d.cust, d.req, d.i));
      if (!msgs.length) return;
      d.req.reminders[d.i] = now(); n++;
      deliver(msgs, null, d.cust, d.req);
    });
    if (n) { save(); toast('Automatic mode sent ' + n + ' request(s) and reminder(s).'); }
  }

  // ---------- UI primitives ----------
  var toastT;
  function toast(t) {
    var el = document.querySelector('.toast') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toast' }));
    el.textContent = t; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 3600);
  }
  function copy(text, msg) {
    var done = function () { toast(msg || 'Copied.'); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {} t.remove();
  }
  function openSheet(title, html, mount) {
    closeSheet();
    var o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="sheet-head"><h2>' + esc(title) +
      '</h2><button class="btn btn-sm" data-a="close-sheet">Close</button></div>' + html + '</div>';
    o.addEventListener('click', function (e) { if (e.target === o || e.target.closest('[data-a="close-sheet"]')) closeSheet(); });
    document.body.appendChild(o);
    if (mount) mount(o);
    var f = o.querySelector('input,textarea,select'); if (f) f.focus();
  }
  function closeSheet() { var o = document.querySelector('.overlay'); if (o) o.remove(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  function arm(btn, fn) {
    if (btn.classList.contains('armed')) return fn();
    var old = btn.textContent;
    btn.classList.add('armed'); btn.textContent = 'Click to confirm';
    setTimeout(function () { btn.classList.remove('armed'); btn.textContent = old; }, 3000);
  }

  function val(p) { var v = getPath(data, p); return v == null ? '' : v; }
  function fid(p) { return 'f-' + p.replace(/\./g, '-'); }
  var F = {
    text: function (p, label, o) {
      o = o || {};
      return '<div class="field"><label for="' + fid(p) + '">' + label + '</label><input class="input" id="' + fid(p) + '" data-bind="' + p + '" type="' + (o.type || 'text') + '"' +
        ' value="' + esc(val(p)) + '" placeholder="' + esc(o.ph || '') + '"' + (o.list ? ' list="' + o.list + '"' : '') +
        (o.type === 'number' ? ' min="' + (o.min != null ? o.min : 0) + '"' + (o.max != null ? ' max="' + o.max + '"' : '') + (o.step ? ' step="' + o.step + '"' : '') : '') +
        (o.rerender ? ' data-rerender="1"' : '') + '>' + (o.hint ? '<p class="hint">' + o.hint + '</p>' : '') + '</div>';
    },
    area: function (p, label, o) {
      o = o || {};
      return '<div class="field"><label for="' + fid(p) + '">' + label + '</label><textarea class="textarea" id="' + fid(p) + '" data-bind="' + p + '" rows="' + (o.rows || 4) + '"' +
        ' placeholder="' + esc(o.ph || '') + '">' + esc(val(p)) + '</textarea>' + (o.count ? '<div class="count" data-count="' + p + '"></div>' : '') +
        (o.hint ? '<p class="hint">' + o.hint + '</p>' : '') + '</div>';
    },
    select: function (p, label, opts, o) {
      o = o || {};
      return '<div class="field"><label for="' + fid(p) + '">' + label + '</label><select class="select" id="' + fid(p) + '" data-bind="' + p + '"' + (o.rerender ? ' data-rerender="1"' : '') + '>' +
        opts.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (String(val(p)) === String(x[0]) ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') +
        '</select>' + (o.hint ? '<p class="hint">' + o.hint + '</p>' : '') + '</div>';
    },
    toggle: function (p, label, o) {
      o = o || {};
      return '<label class="toggle"><span>' + label + '</span><span class="switch"><input type="checkbox" data-bind="' + p + '"' + (val(p) ? ' checked' : '') +
        (o.rerender ? ' data-rerender="1"' : '') + '><i></i></span></label>';
    },
    color: function (p, label) {
      return '<div class="field"><label for="' + fid(p) + '">' + label + '</label><div class="color"><input type="color" data-bind="' + p + '" value="' + esc(val(p)) + '" aria-label="' + label + ' picker">' +
        '<input type="text" id="' + fid(p) + '" data-bind="' + p + '" data-color="1" value="' + esc(val(p)) + '"></div></div>';
    },
    radios: function (p, opts, o) {
      o = o || {};
      return '<div class="radio-row">' + opts.map(function (x) {
        return '<label class="radio"><input type="radio" name="' + fid(p) + '" data-bind="' + p + '" value="' + esc(x[0]) + '"' + (String(val(p)) === String(x[0]) ? ' checked' : '') +
          (o.rerender ? ' data-rerender="1"' : '') + '><div><b>' + x[1] + '</b><span>' + x[2] + '</span></div></label>';
      }).join('') + '</div>';
    }
  };

  var view = {};
  function onBind(e) {
    var el = e.target, p = el.dataset && el.dataset.bind;
    if (!p) return;
    var v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
    else if (el.type === 'number') v = el.value === '' ? 0 : Number(el.value);
    else v = el.value;
    if (el.type === 'color' || el.dataset.color) {
      if (!/^#[0-9a-f]{6}$/i.test(v)) return;
      document.querySelectorAll('[data-bind="' + p + '"]').forEach(function (o) { if (o !== el) o.value = v; });
    }
    setPath(data, p, v);
    save();
    if (el.dataset.rerender && e.type === 'change') return render();
    if (view.onChange) view.onChange(p);
  }
  document.addEventListener('input', onBind);
  document.addEventListener('change', onBind);

  // review-site link rows
  function linkRows() {
    return data.business.reviewLinks.map(function (l, i) {
      return '<div class="link-row"><select class="select" data-link="' + i + '" data-f="type" aria-label="Review site">' +
        Object.keys(SITES).map(function (k) { return '<option value="' + k + '"' + (l.type === k ? ' selected' : '') + '>' + SITES[k] + '</option>'; }).join('') +
        '</select><input class="input" data-link="' + i + '" data-f="url" value="' + esc(l.url) + '" placeholder="https://... (link to your review page)" aria-label="Review link URL">' +
        '<button class="icon-btn" data-a="link-del" data-i="' + i + '" title="Remove" aria-label="Remove">&times;</button></div>';
    }).join('') + '<button class="btn btn-sm" data-a="link-add">+ Add review site</button>' +
      '<div class="section" style="margin-top:16px"><h4>Google review link helper</h4><div class="row2">' +
      '<input class="input" id="placeid" placeholder="Google Place ID, e.g. ChIJN1t_tDeuEmsRUsoyG83frY4" aria-label="Google Place ID">' +
      '<button class="btn" data-a="placeid">Build Google review link</button></div>' +
      '<p class="hint">Find your Place ID with Google’s Place ID Finder. This builds the direct “write a review” link.</p></div>';
  }
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.dataset || el.dataset.link == null) return;
    data.business.reviewLinks[+el.dataset.link][el.dataset.f] = el.value.trim();
    save();
    if (view.onChange) view.onChange('links');
  });

  // ---------- shared pieces ----------
  function businessFields() {
    return '<div class="field"><label for="f-business-name">Business name</label><input class="input" id="f-business-name" data-bind="business.name" value="' + esc(data.business.name) +
      '" placeholder="As it appears on your Google Business Profile"><p class="hint">Tip: type it exactly as it appears on Google, and include the city.</p></div>' +
      F.text('business.street', 'Street address') +
      '<div class="row3">' + F.text('business.city', 'City') + F.text('business.state', 'State') + F.text('business.zip', 'ZIP') + '</div>' +
      '<div class="row2">' + F.text('business.phone', 'Business phone', { type: 'tel' }) + F.text('business.email', 'Business email', { type: 'email' }) + '</div>' +
      '<div class="row2">' + F.text('business.website', 'Website', { type: 'url', ph: 'https://' }) + F.text('business.category', 'Business category', { list: 'cats', ph: 'Start typing' }) + '</div>' +
      '<datalist id="cats">' + CATEGORIES.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>';
  }
  function ownerFields() {
    return '<div class="note">Accurate owner details matter. SMS carriers verify the business and its owner before text requests can go out, and blank or wrong fields delay it.</div>' +
      '<div class="row2">' + F.text('business.owner.first', 'Owner first name') + F.text('business.owner.last', 'Owner last name') + '</div>' +
      '<div class="row2">' + F.text('business.owner.email', 'Owner email', { type: 'email' }) + F.text('business.owner.phone', 'Owner mobile', { type: 'tel' }) + '</div>';
  }
  function flowRadios() {
    return F.radios('settings.flow', [
      ['ultimate', 'Survey &amp; Reviews', 'Rating, then a written comment, then happy customers can copy their comment into a public review. Best for real insight and for building first-party reviews.'],
      ['review', 'Ratings &amp; Reviews', 'Quick rating. Positive raters are sent to review sites, unhappy ones get an apology page and a private feedback box.'],
      ['direct', 'Public Reviews (1-step)', 'Skips the rating and links straight to your review sites. Best when you want the most public reviews.']
    ], { rerender: 1 });
  }
  function ratingFields() {
    var s = data.settings, nps = s.ratingType === 'nps';
    return F.radios('settings.ratingType', [['nps', 'NPS (0 to 10)', '“How likely are you to recommend us?” Gives you a Net Promoter Score.'], ['stars', 'Stars (1 to 5)', 'Familiar star rating.']], { rerender: 1 }) +
      '<div style="margin-top:12px">' + (nps
        ? F.text('settings.npsThreshold', 'Positive at or above', { type: 'number', min: 0, max: 10, hint: 'Customers scoring this or higher see the positive page. GatherUp’s default is 7.' })
        : F.text('settings.starsThreshold', 'Positive at or above (stars)', { type: 'number', min: 1, max: 5, hint: 'GatherUp’s default is 3.5 stars, which means 4 and up on a whole-star scale.' })) + '</div>';
  }
  function previewBox(id) {
    var steps = data.settings.flow === 'direct' ? [['direct', 'Review links']] :
      [['rate', 'Rating']].concat(data.settings.flow === 'ultimate' ? [['comment', 'Comment']] : []).concat([['positive', 'Positive'], ['negative', 'Negative']]);
    var cur = view.pstep && steps.some(function (s) { return s[0] === view.pstep; }) ? view.pstep : steps[0][0];
    view.pstep = cur;
    return '<div class="preview"><div class="preview-bar"><b>What your customer sees</b><div class="seg" role="group" aria-label="Preview step">' +
      steps.map(function (s) { return '<button data-a="pstep" data-s="' + s[0] + '" aria-pressed="' + (s[0] === cur) + '">' + s[1] + '</button>'; }).join('') +
      '</div></div><iframe id="' + id + '" title="Feedback page preview"></iframe></div>';
  }
  function refreshPreview() {
    var f = document.getElementById('pv');
    if (!f) return;
    var s = data.settings, pos = s.ratingType === 'nps' ? 9 : 5, neg = s.ratingType === 'nps' ? 4 : 2;
    var extra = { pv: 1, ps: view.pstep, fn: 'Alex' };
    if (view.pstep === 'positive') extra.prt = pos;
    if (view.pstep === 'negative') extra.prt = neg;
    if (!data.business.name) extra.n = 'Your Business';
    f.src = 'feedback.html#' + enc(payload(extra));
  }
  function ratingHtml(f) {
    if (f.scale === 'nps') {
      var cls = f.rating >= 9 ? 'ok' : f.rating >= 7 ? 'warn' : 'bad';
      return '<span class="chip ' + cls + '">NPS ' + f.rating + '/10</span>';
    }
    var s = '';
    for (var i = 1; i <= 5; i++) s += i <= f.rating ? '★' : '<span class="off">★</span>';
    return '<span class="stars" aria-label="' + f.rating + ' out of 5 stars">' + s + '</span>';
  }

  // ---------- views ----------
  var WIZ = ['Business', 'Owner details', 'Review sites', 'Request design', 'Test &amp; finish'];
  function onboarding() {
    nav.hidden = true;
    var st = data.business.wizStep || 1, body = '';
    if (st === 1) body = '<h2>Add your business</h2><p class="hint">Each location gets its own profile, because each one has its own reviews.</p><div style="margin-top:16px">' + businessFields() + '</div>';
    if (st === 2) body = '<h2>Business owner</h2><div style="margin-top:12px">' + ownerFields() + '</div>';
    if (st === 3) body = '<h2>Where should happy customers leave reviews?</h2><p class="hint">Pick 2 to 4 sites. A little choice gets the best response rate, too much and people stall.</p><div style="margin-top:16px">' + linkRows() + '</div>';
    if (st === 4) body = '<div class="cols"><div><h2>Design your request</h2><div style="margin-top:14px">' +
      '<div class="row2">' + F.text('business.logo', 'Logo URL', { ph: 'https://.../logo.png' }) + F.color('business.color', 'Accent color') + '</div>' +
      '<p class="hint" style="margin-top:-6px;margin-bottom:14px">Pick a bold or dark color. Light colors make buttons hard to read.</p>' +
      '<div class="section"><h4>Rating style</h4>' + ratingFields() + '</div><div class="section"><h4>Request flow</h4>' + flowRadios() + '</div></div></div>' +
      '<div class="sticky">' + previewBox('pv') + '</div></div>';
    if (st === 5) {
      body = '<h2>Send yourself a test</h2><p class="hint">Go through it as your customer would, then fine-tune anything that feels off.</p><div style="margin-top:16px">' +
        '<div class="row2"><div class="field"><label for="t-email">Your email</label><input class="input" id="t-email" type="email" value="' + esc(data.business.owner.email) + '"></div>' +
        '<div class="field"><label for="t-phone">Your mobile</label><input class="input" id="t-phone" type="tel" value="' + esc(data.business.owner.phone) + '"></div></div>' +
        '<button class="btn" data-a="test-send">Send test</button>' +
        '<div class="note" style="margin-top:18px">Next: add customers on the Customers page. Each one gets an email or text with their personal feedback link.</div></div>';
    }
    view.after = function () { if (st === 4) refreshPreview(); };
    view.onChange = function () { if (st === 4) refreshPreview(); };
    return '<div class="page"><div class="page-head"><div><h1>Set up Connexions Reputation</h1><p>About 10 minutes. You can change all of this later in Settings.</p></div></div>' +
      '<div class="wizard"><ol class="steps-nav">' + WIZ.map(function (w, i) {
        return '<li class="' + (i + 1 < st ? 'done' : i + 1 === st ? 'cur' : '') + '"><i>' + (i + 1 < st ? '✓' : i + 1) + '</i><span>' + w + '</span></li>';
      }).join('') + '</ol><div class="box">' + body + '<div class="wiz-foot">' +
      (st > 1 ? '<button class="btn" data-a="wiz-back">Back</button>' : '<span></span>') +
      (st < 5 ? '<button class="btn btn-primary" data-a="wiz-next">Continue</button>' : '<button class="btn btn-primary" data-a="wiz-finish">Finish</button>') +
      '</div></div></div></div>';
  }
  function wizMissing(st) {
    var b = data.business, miss = [];
    if (st === 1) {
      [['name', 'business name'], ['city', 'city'], ['state', 'state'], ['phone', 'business phone']].forEach(function (f) { if (!String(b[f[0]] || '').trim()) miss.push(f[1]); });
    }
    if (st === 2 && !b.owner.first.trim()) miss.push('owner first name');
    if (st === 2 && !b.owner.email.trim()) miss.push('owner email');
    return miss;
  }

  function dashboard() {
    var s = data.settings, cs = data.customers, fb = data.feedback;
    var reqs = 0, done = 0, clicks = 0;
    cs.forEach(function (c) { c.requests.forEach(function (r) { reqs++; if (r.status === 'completed' || r.status === 'clicked') done++; clicks += (r.siteClicks || []).length; }); });
    var nps = fb.filter(function (f) { return f.scale === 'nps'; }), stars = fb.filter(function (f) { return f.scale === 'stars'; });
    var score = nps.length ? Math.round((nps.filter(function (f) { return f.rating >= 9; }).length - nps.filter(function (f) { return f.rating <= 6; }).length) / nps.length * 100) : null;
    var avg = stars.length ? (stars.reduce(function (a, f) { return a + f.rating; }, 0) / stars.length).toFixed(1) : null;
    var waiting = data.feedback.concat(data.reviews).filter(function (x) { return !x.reply || x.reply.status !== 'sent'; }).length;
    var due = dueReminders(), queued = cs.filter(function (c) { return !c.requests.length; }).length;

    var html = '<div class="page"><div class="page-head"><div><h1>Customers</h1><p>Add customers and ask them for feedback by email or text.</p></div><div class="actions">' +
      '<select class="select" data-bind="settings.sendMode" data-rerender="1" style="width:auto" aria-label="Send mode"><option value="manual"' + (s.sendMode === 'manual' ? ' selected' : '') + '>Send mode: Manual</option>' +
      '<option value="auto"' + (s.sendMode === 'auto' ? ' selected' : '') + '>Send mode: Automatic</option></select>' +
      '<button class="btn" data-a="csv">Import CSV</button><button class="btn btn-primary" data-a="add-cust">+ Add customer</button></div></div>';

    html += '<div class="summary"><span><b>' + cs.length + '</b> customers</span><span><b>' + reqs + '</b> requests sent</span>' +
      '<span><b>' + (reqs ? Math.round(done / reqs * 100) : 0) + '%</b> responded</span><span><b>' + clicks + '</b> review-site clicks</span>' +
      (score != null ? '<span>NPS <b>' + (score > 0 ? '+' : '') + score + '</b> (' + nps.length + ')</span>' : '') +
      (avg != null ? '<span>Avg rating <b>' + avg + '★</b> (' + stars.length + ')</span>' : '') +
      '<span><a href="#/reviews"><b>' + waiting + '</b> awaiting a reply</a></span></div>';

    syncOptouts();
    if (s.sendMode === 'auto') {
      html += s.delivery === 'server'
        ? '<div class="note">Automatic mode: customers with a mobile number are texted a request through the Connexions server (max ' + s.autoPerDay + '/day, 9am to 6pm), and text reminders go out when due, each time this dashboard is open. Email-only customers still need a click. ' + queued + ' queued.</div>'
        : s.delivery === 'webhook' && s.webhook
        ? '<div class="note">Automatic mode: new customers are sent a request (max ' + s.autoPerDay + '/day, 9am to 6pm) and reminders go out when due, each time this dashboard is open. ' + queued + ' queued.</div>'
        : '<div class="note warn">Automatic mode needs the Connexions server or a webhook so messages can go out without you clicking. Set it up in <a href="#/settings">Settings &gt; Delivery</a>. Until then, ' + queued + ' customer(s) are queued for a manual send.</div>';
    }
    if (due.length) html += '<div class="note warn"><b>' + due.length + ' reminder(s) due.</b> Use “Send reminder” on the highlighted rows.</div>';

    if (!cs.length) {
      html += '<div class="empty"><h2>No customers yet</h2><p>Add yourself first and send a test, so you see exactly what your customers will see.</p>' +
        '<button class="btn btn-primary" data-a="add-cust">+ Add customer</button></div></div>';
      return html;
    }
    var dueIds = due.map(function (d) { return d.cust.id; });
    var labels = { sent: ['Sent', ''], opened: ['Opened', 'brand'], clicked: ['Clicked review site', 'ok'], completed: ['Responded', 'ok'] };
    html += '<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Contact</th><th>Last request</th><th>Feedback</th><th style="text-align:right">Actions</th></tr></thead><tbody>' +
      cs.slice().reverse().map(function (c) {
        var r = lastReq(c), f = data.feedback.filter(function (x) { return x.customerId === c.id; })[0];
        var st = r ? (r.error ? ['Send failed', 'bad'] : labels[r.status]) : null, isDue = dueIds.indexOf(c.id) !== -1;
        var rem = r ? r.reminders.filter(Boolean).length : 0;
        return '<tr' + (isDue ? ' style="background:#fffbeb"' : '') + '><td><b>' + esc(full(c)) + '</b>' + (c.tags ? '<div class="sub">' + esc(c.tags) + '</div>' : '') + '</td>' +
          '<td>' + (c.email ? '<div>' + esc(c.email) + '</div>' : '') + (c.phone ? '<div class="sub">' + esc(c.phone) + '</div>' : '') +
          '<div class="sub">Prefers ' + (c.pref === 'sms' ? 'text' : 'email') + '</div>' + (c.smsStop ? '<span class="chip bad">Replied STOP to texts</span>' : '') + '</td>' +
          '<td>' + (r ? '<span class="chip ' + st[1] + '">' + st[0] + '</span><div class="sub">' + fmtDate(r.at) + ' via ' + r.channels.map(function (x) { return x === 'sms' ? 'text' : 'email'; }).join(' + ') +
            (rem ? ', ' + rem + ' reminder' + (rem > 1 ? 's' : '') : '') + '</div>' + (r.error ? '<div class="sub" style="color:var(--danger)">' + esc(r.error) + '</div>' : '') : '<span class="chip">' + (s.sendMode === 'auto' ? 'Queued' : 'Not asked') + '</span>') + '</td>' +
          '<td>' + (f ? ratingHtml(f) + (f.comment ? '<div class="sub" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">“' + esc(f.comment) + '”</div>' : '') : '<span class="sub">None yet</span>') + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
          (isDue ? '<button class="btn btn-sm btn-primary" data-a="remind" data-id="' + c.id + '">Send reminder</button> ' : '') +
          '<button class="btn btn-sm' + (isDue ? '' : ' btn-primary') + '" data-a="ask" data-id="' + c.id + '">' + (r ? 'Ask again' : 'Ask for review') + '</button> ' +
          '<button class="btn btn-sm btn-danger" data-a="del-cust" data-id="' + c.id + '">Delete</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
  }

  function addCustomerSheet() {
    openSheet('Add a customer', '<div class="row2"><div class="field"><label for="c-first">First name</label><input class="input" id="c-first"></div>' +
      '<div class="field"><label for="c-last">Last name</label><input class="input" id="c-last"></div></div>' +
      '<div class="row2"><div class="field"><label for="c-email">Email</label><input class="input" id="c-email" type="email"></div>' +
      '<div class="field"><label for="c-phone">Mobile phone</label><input class="input" id="c-phone" type="tel"></div></div>' +
      '<div class="row2"><div class="field"><label for="c-pref">Prefers</label><select class="select" id="c-pref"><option value="email">Email</option><option value="sms">Text message</option></select></div>' +
      '<div class="field"><label for="c-tags">Tags</label><input class="input" id="c-tags" placeholder="e.g. airport, wedding"></div></div>' +
      '<label class="toggle"><span>Send the feedback request now</span><span class="switch"><input type="checkbox" id="c-send" checked><i></i></span></label>' +
      '<p class="hint">Email or mobile is required. Only text customers who agreed to receive texts from you.</p>' +
      '<div class="actions" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-primary" id="c-save">Add customer</button></div>', function (el) {
      var pref = el.querySelector('#c-pref');
      el.querySelector('#c-phone').addEventListener('input', function (e) { if (e.target.value && !el.querySelector('#c-email').value) pref.value = 'sms'; });
      el.querySelector('#c-save').addEventListener('click', function () {
        var g = function (id) { return el.querySelector(id).value.trim(); };
        var c = { id: uid('c'), first: g('#c-first'), last: g('#c-last'), email: g('#c-email').toLowerCase(), phone: g('#c-phone'), pref: pref.value, tags: g('#c-tags'), created: now(), requests: [] };
        var err = validateCustomer(c);
        if (err) return toast(err);
        data.customers.push(c);
        save();
        closeSheet();
        if (el.querySelector('#c-send').checked) requestFeedback(c);
        else { toast(full(c) + ' added.'); render(); }
      });
    });
  }
  function validateCustomer(c) {
    if (!c.first) return 'First name is required.';
    if (!c.email && !c.phone) return 'Add an email address or a mobile number.';
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return 'That email address doesn’t look right.';
    if (c.phone && c.phone.replace(/\D/g, '').length < 10) return 'That mobile number looks too short.';
    if (c.pref === 'sms' && !c.phone) c.pref = 'email';
    if (c.pref === 'email' && !c.email) c.pref = 'sms';
    var digits = c.phone.replace(/\D/g, '').slice(-10);
    var dupe = data.customers.filter(function (x) { return (c.email && x.email === c.email) || (digits && x.phone.replace(/\D/g, '').slice(-10) === digits); })[0];
    if (dupe) return full(dupe) + ' already has that email or phone number.';
    return '';
  }

  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }
  function csvSheet() {
    openSheet('Import customers from CSV', '<p class="hint" style="margin-top:0">Columns: first name, last name, email, phone (header row optional). Extra columns named <b>tags</b> or <b>prefers</b> are picked up too.</p>' +
      '<div class="field"><label for="csv-file">CSV file</label><input class="input" id="csv-file" type="file" accept=".csv,text/csv" style="padding-top:5px"></div>' +
      '<div class="field"><label for="csv-text">Or paste rows</label><textarea class="textarea" id="csv-text" rows="6" placeholder="first,last,email,phone&#10;Jane,Doe,jane@example.com,555-555-1234"></textarea></div>' +
      '<p class="hint">Imported customers aren’t messaged right away. In Automatic mode they go out in daily batches; in Manual mode you send each one.</p>' +
      '<div class="actions" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-primary" id="csv-go">Import</button></div>', function (el) {
      el.querySelector('#csv-file').addEventListener('change', function (e) {
        var f = e.target.files[0];
        if (f) f.text().then(function (t) { el.querySelector('#csv-text').value = t; });
      });
      el.querySelector('#csv-go').addEventListener('click', function () {
        var rows = parseCSV(el.querySelector('#csv-text').value);
        if (!rows.length) return toast('Nothing to import.');
        var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/[^a-z]/g, ''); });
        var hasHead = head.some(function (h) { return /first|email|phone|mobile/.test(h); });
        var col = function (names, fallback) {
          if (!hasHead) return fallback;
          for (var i = 0; i < head.length; i++) if (names.some(function (n) { return head[i].indexOf(n) === 0; })) return i;
          return -1;
        };
        var ci = { first: col(['first', 'firstname', 'name'], 0), last: col(['last', 'lastname', 'surname'], 1), email: col(['email', 'emailaddress'], 2),
          phone: col(['phone', 'mobile', 'cell'], 3), tags: col(['tags'], -1), pref: col(['prefers', 'preference'], -1) };
        var added = 0, skipped = [];
        rows.slice(hasHead ? 1 : 0).forEach(function (r, n) {
          var g = function (k) { return ci[k] >= 0 ? String(r[ci[k]] || '').trim() : ''; };
          var c = { id: uid('c'), first: g('first'), last: g('last'), email: g('email').toLowerCase(), phone: g('phone'), tags: g('tags'), created: now(), requests: [] };
          c.pref = /sms|text/i.test(g('pref')) || (!c.email && c.phone) ? 'sms' : 'email';
          var err = validateCustomer(c);
          if (err) skipped.push('Row ' + (n + 1) + ': ' + err); else { data.customers.push(c); added++; }
        });
        save(); closeSheet(); render();
        toast('Imported ' + added + ' customer(s)' + (skipped.length ? ', skipped ' + skipped.length + ' (' + skipped[0] + ')' : '') + '.');
      });
    });
  }

  function requests() {
    view.after = refreshPreview;
    view.onChange = function (p) {
      if (/^settings\.(copy|flow|ratingType|npsThreshold|starsThreshold)|^business\./.test(p)) refreshPreview();
      updateCounts();
    };
    var s = data.settings;
    return '<div class="page"><div class="page-head"><div><h1>Requests</h1><p>How you ask, what the messages say, and where each answer leads.</p></div></div><div class="cols"><div>' +
      '<div class="box"><h2>Request flow</h2><p class="hint">Each flow keeps its own steps. You can switch anytime.</p><div style="margin-top:12px">' + flowRadios() + '</div></div>' +
      (s.flow !== 'direct' ? '<div class="box"><h2>Rating</h2><div style="margin-top:12px">' + ratingFields() + '</div></div>' : '') +
      '<div class="box"><h2>Sending</h2><div style="margin-top:12px">' +
      F.select('settings.sendMethod', 'Default send method', [['preference', 'Each customer’s preference'], ['email', 'Email'], ['sms', 'Text message (SMS)'], ['both', 'Both email and text']]) +
      '<div class="row2">' + F.text('settings.repeatDays', 'Repeat customer limit (days)', { type: 'number', min: 0, hint: 'Don’t ask the same person again within this many days.' }) +
      F.text('settings.autoPerDay', 'Automatic mode: max per day', { type: 'number', min: 1, hint: 'Spacing requests out keeps review sites’ spam filters calm.' }) + '</div>' +
      '<div class="row2"><div>' + F.toggle('settings.reminders.0.on', '1st reminder') + F.text('settings.reminders.0.days', 'Days after request', { type: 'number', min: 1 }) + '</div>' +
      '<div>' + F.toggle('settings.reminders.1.on', '2nd reminder') + F.text('settings.reminders.1.days', 'Days after request', { type: 'number', min: 1 }) + '</div></div>' +
      F.toggle('settings.smsReminders', 'Send reminders by text when the request went by text') +
      '<p class="hint">Reminders stop once the customer responds or clicks a review site.</p></div></div>' +
      '<div class="box"><h2>Messages</h2><p class="hint">Merge tags: {first_name} {last_name} {business} {owner_first} {link}</p><div style="margin-top:12px">' +
      F.text('settings.msg.emailSubject', 'Email subject') + F.area('settings.msg.emailBody', 'Email body', { rows: 8 }) +
      F.area('settings.msg.sms', 'Text message', { rows: 3, count: 1, hint: 'Keep “Reply STOP to opt out” in every text.' }) +
      F.text('settings.msg.remSubject', 'Reminder email subject') + F.area('settings.msg.remBody', 'Reminder email body', { rows: 6 }) +
      F.area('settings.msg.remSms', 'Reminder text message', { rows: 3, count: 1 }) +
      '<button class="btn" data-a="test-send">Send a test to myself</button></div></div>' +
      '<div class="box"><h2>Landing page wording</h2><p class="hint">Leave blank to use the defaults shown. {business} and {first_name} work here too.</p><div style="margin-top:12px">' +
      F.text('settings.copy.q', 'Rating question', { ph: s.ratingType === 'nps' ? 'How likely are you to recommend {business} to a friend or colleague?' : 'How would you rate your experience with {business}?' }) +
      F.text('settings.copy.ph', 'Positive page heading', { ph: 'Thank you! Would you share your experience online?' }) +
      F.text('settings.copy.pb', 'Positive page text', { ph: 'Reviews help other people find {business}. It only takes a minute.' }) +
      F.text('settings.copy.nh', 'Negative page heading', { ph: 'We’re sorry we missed the mark.' }) +
      F.text('settings.copy.nb', 'Negative page text', { ph: 'Please tell us what happened so we can make it right.' }) +
      '<p class="hint">Unhappy customers still see your review-site links (smaller, below the feedback box). Hiding them would be review gating, which the FTC and Google prohibit.</p></div></div>' +
      '<div class="box"><h2>Your feedback link</h2><p class="hint">One link for your website, email signature, receipts or a QR code. Answers aren’t tied to a customer.</p>' +
      '<div class="row2" style="margin-top:10px"><input class="input" readonly value="' + esc(generalLink()) + '" aria-label="Feedback link"><button class="btn" data-a="copy-general">Copy link</button></div></div>' +
      '</div><div class="sticky">' + previewBox('pv') + '</div></div></div>';
  }
  function updateCounts() {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var t = fill(val(el.dataset.count), { first: 'Alex', last: 'Smith' }, 'https://cx.link/abc123');
      el.textContent = t.length + ' characters' + (t.length > 160 ? ', ' + Math.ceil(t.length / 153) + ' SMS segments' : '') + ' (with a short link)';
      el.classList.toggle('over', t.length > 160);
    });
  }

  // ---- reviews + AI replies ----
  function items() {
    var fbItems = data.feedback.map(function (f) {
      return { kind: 'feedback', ref: f, id: f.id, source: 'Private feedback', site: null, author: f.author, rating: f.rating, scale: f.scale, text: f.comment, at: f.at, reply: f.reply, customerId: f.customerId };
    });
    var rvItems = data.reviews.map(function (r) {
      return { kind: 'review', ref: r, id: r.id, source: SITES[r.site] || r.site, site: r.site, author: r.author, rating: r.rating, scale: 'stars', text: r.text, at: r.at, reply: r.reply };
    });
    return fbItems.concat(rvItems).sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); });
  }
  function aiOpts(variant) {
    var a = data.settings.ai;
    return { engine: a.engine, model: a.model, tone: a.tone, signoff: a.signoff, variant: variant || 0, apiKey: store(AIKEY) || '' };
  }
  function bizForAI() {
    var b = data.business;
    return { name: b.name, category: b.category, summary: b.summary, phone: b.phone, email: b.email || b.owner.email, website: b.website };
  }
  var busy = {};
  function draftFor(it, variant, auto) {
    if (busy[it.id]) return Promise.resolve();
    busy[it.id] = true;
    paintBusy(it.id);
    return CxReply.draft({ id: it.id, author: it.author, rating: it.rating, scale: it.scale, text: it.text, source: it.source }, bizForAI(), aiOpts(variant))
      .then(function (text) {
        it.ref.reply = { text: text, status: 'draft', engine: data.settings.ai.engine, at: now(), variant: variant || 0, auto: !!auto };
        save();
      }, function (err) { if (auto) autoFailed = true; toast(err.message); })
      .then(function () { delete busy[it.id]; if (route() === 'reviews') render(); });
  }
  function paintBusy(id) {
    var b = document.querySelector('[data-a="draft"][data-id="' + id + '"],[data-a="regen"][data-id="' + id + '"]');
    if (b) { b.disabled = true; b.textContent = 'Drafting…'; }
  }
  var autoQueue = false, autoFailed = false; // one failed auto-draft pauses auto-drafting until reload
  function autoDraft() {
    if (!data.settings.ai.autoDraft || autoQueue || autoFailed) return;
    var todo = items().filter(function (it) { return !it.reply && CxReply.sentiment(it) === 'positive'; });
    if (!todo.length) return;
    if (data.settings.ai.engine === 'claude' && !store(AIKEY)) return;
    autoQueue = true;
    todo.reduce(function (p, it) { return p.then(function () { return autoFailed ? null : draftFor(it, 0, true); }); }, Promise.resolve())
      .then(function () { autoQueue = false; });
  }

  function reviews() {
    var f = view.filter || data._revFilter || 'needs';
    view.after = autoDraft;
    var all = items();
    var counts = {
      all: all.length,
      needs: all.filter(function (i) { return !i.reply || i.reply.status !== 'sent'; }).length,
      replied: all.filter(function (i) { return i.reply && i.reply.status === 'sent'; }).length,
      negative: all.filter(function (i) { return CxReply.sentiment(i) === 'negative'; }).length
    };
    var list = all.filter(function (i) {
      if (f === 'needs') return !i.reply || i.reply.status !== 'sent';
      if (f === 'replied') return i.reply && i.reply.status === 'sent';
      if (f === 'negative') return CxReply.sentiment(i) === 'negative';
      return true;
    });
    var a = data.settings.ai, engineLabel = a.engine === 'claude' ? 'Claude (' + a.model + ')' : 'built-in drafter';
    var html = '<div class="page"><div class="page-head"><div><h1>Reviews</h1><p>Private feedback from your requests plus public reviews. AI drafts a reply; you edit and approve.</p></div>' +
      '<div class="actions"><button class="btn" data-a="add-review">+ Add review</button></div></div>' +
      '<div class="summary"><span>Replies drafted by <b>' + esc(engineLabel) + '</b></span><span>Auto-draft for positive reviews: <b>' + (a.autoDraft ? 'on' : 'off') + '</b></span><a href="#/settings">Change</a>' +
      (a.engine === 'claude' && !store(AIKEY) ? '<span class="chip warn">No API key set</span>' : '') + '</div>' +
      '<div class="filters" role="group" aria-label="Filter">' + [['needs', 'Needs reply'], ['negative', 'Negative'], ['replied', 'Replied'], ['all', 'All']].map(function (x) {
        return '<button data-a="filter" data-f="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + ' (' + counts[x[0]] + ')</button>';
      }).join('') + '</div>';
    if (!all.length) {
      return html + '<div class="empty"><h2>Nothing here yet</h2><p>Feedback from your requests lands here automatically. You can also paste in reviews from Google or Facebook.</p>' +
        '<div class="actions" style="justify-content:center"><button class="btn btn-primary" data-a="add-review">+ Add review</button><button class="btn" data-a="samples">Load sample reviews</button></div></div></div>';
    }
    if (!list.length) return html + '<div class="empty"><h2>All caught up</h2><p>Nothing matches this filter.</p></div></div>';
    return html + list.map(revCard).join('') + '</div>';
  }
  function revCard(it) {
    var s = CxReply.sentiment(it), sc = { positive: 'ok', neutral: 'warn', negative: 'bad' }[s];
    var r = it.reply, body = '';
    var cust = it.customerId && data.customers.filter(function (c) { return c.id === it.customerId; })[0];
    if (!r) {
      body = '<div class="reply-actions"><button class="btn btn-sm btn-primary" data-a="draft" data-id="' + it.id + '">Draft reply with AI</button>' +
        '<button class="btn btn-sm" data-a="write" data-id="' + it.id + '">Write my own</button></div>';
    } else if (r.status === 'sent') {
      body = '<div class="reply sent"><div class="reply-head"><span>' + (it.kind === 'feedback' ? 'Sent to customer' : 'Posted') + ' ' + fmtDate(r.sentAt) + '</span>' +
        '<button class="btn-link" data-a="edit-reply" data-id="' + it.id + '">Edit</button></div><p>' + esc(r.text) + '</p></div>';
    } else {
      var primary = it.kind === 'feedback'
        ? (cust && cust.email ? 'Approve &amp; email ' + esc(cust.first) : 'Approve &amp; copy')
        : 'Approve, copy &amp; open ' + esc(it.source);
      body = '<div class="reply"><div class="reply-head"><span>' + (r.auto ? 'Auto-drafted' : 'Draft') + ' by ' + (r.engine === 'claude' ? 'Claude' : 'built-in drafter') +
        ' · edit freely, nothing is sent until you approve</span></div>' +
        '<textarea class="textarea" data-reply="' + it.id + '" aria-label="Reply draft">' + esc(r.text) + '</textarea>' +
        '<div class="reply-actions"><button class="btn btn-sm btn-primary" data-a="approve" data-id="' + it.id + '">' + primary + '</button>' +
        '<button class="btn btn-sm" data-a="regen" data-id="' + it.id + '">Regenerate</button>' +
        '<button class="btn btn-sm btn-danger" data-a="discard" data-id="' + it.id + '">Discard</button></div></div>';
    }
    return '<article class="rev"><div class="rev-head"><b>' + esc(it.author || 'Anonymous') + '</b>' + ratingHtml(it) +
      '<span class="chip' + (it.kind === 'feedback' ? ' brand' : '') + '">' + esc(it.source) + '</span><span class="chip ' + sc + '">' + s + '</span>' +
      (it.kind === 'feedback' && it.ref.sites.length ? '<span class="chip ok">Clicked ' + it.ref.sites.map(function (x) { return SITES[x] || x; }).join(', ') + '</span>' : '') +
      '<span class="when">' + fmtDate(it.at) + '</span>' + (it.kind === 'review' ? '<button class="btn-link" data-a="del-review" data-id="' + it.id + '" style="color:var(--muted)">Remove</button>' : '') + '</div>' +
      '<p class="rev-text' + (it.text ? '' : ' none') + '">' + (it.text ? esc(it.text) : 'Rating only, no written comment.') + '</p>' + body + '</article>';
  }
  document.addEventListener('input', function (e) {
    var id = e.target.dataset && e.target.dataset.reply;
    if (!id) return;
    var it = items().filter(function (i) { return i.id === id; })[0];
    if (it && it.ref.reply) { it.ref.reply.text = e.target.value; save(); }
  });
  function approve(it) {
    var r = it.ref.reply, text = CxReply.clean(r.text);
    if (!text) return toast('The reply is empty.');
    r.text = text;
    var cust = it.customerId && data.customers.filter(function (c) { return c.id === it.customerId; })[0];
    if (it.kind === 'feedback' && cust && cust.email) {
      location.href = 'mailto:' + encodeURIComponent(cust.email) + '?subject=' + encodeURIComponent('Re: your feedback for ' + data.business.name) + '&body=' + encodeURIComponent(text);
    } else {
      copy(text, it.kind === 'review' ? 'Reply copied. Paste it on ' + it.source + '.' : 'Reply copied.');
      if (it.kind === 'review') {
        var link = data.business.reviewLinks.filter(function (l) { return l.type === it.site && l.url; })[0];
        if (link) window.open(link.url, '_blank', 'noopener');
      }
    }
    r.status = 'sent'; r.sentAt = now();
    save(); render();
  }
  function addReviewSheet() {
    openSheet('Add a review', '<p class="hint" style="margin-top:0">Paste a review from Google, Facebook or another site to draft a reply. Pulling reviews in automatically needs a Google Business Profile connection, which isn’t built yet.</p>' +
      '<div class="row2"><div class="field"><label for="r-site">Site</label><select class="select" id="r-site">' + Object.keys(SITES).map(function (k) { return '<option value="' + k + '">' + SITES[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="r-rating">Rating</label><select class="select" id="r-rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></div></div>' +
      '<div class="row2"><div class="field"><label for="r-author">Reviewer name</label><input class="input" id="r-author"></div>' +
      '<div class="field"><label for="r-date">Date</label><input class="input" id="r-date" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div></div>' +
      '<div class="field"><label for="r-text">Review text</label><textarea class="textarea" id="r-text" rows="5"></textarea></div>' +
      '<div class="actions" style="justify-content:flex-end"><button class="btn btn-primary" id="r-save">Add review</button></div>', function (el) {
      el.querySelector('#r-save').addEventListener('click', function () {
        var d = el.querySelector('#r-date').value;
        data.reviews.push({ id: uid('r'), site: el.querySelector('#r-site').value, author: el.querySelector('#r-author').value.trim(), rating: +el.querySelector('#r-rating').value,
          text: el.querySelector('#r-text').value.trim(), at: d ? new Date(d + 'T12:00:00').toISOString() : now(), reply: null });
        save(); closeSheet(); render();
      });
    });
  }
  function loadSamples() {
    var d = function (n) { return new Date(Date.now() - n * 864e5).toISOString(); };
    [
      ['google', 'Maria Gonzalez', 5, 'Our driver was early, super friendly and the car was spotless. Made our wedding day so easy!', 1],
      ['google', 'Kevin T.', 2, 'Driver was 25 minutes late for my airport pickup and nobody called to tell me. Almost missed my flight.', 2],
      ['facebook', 'Dana Whitfield', 4, 'Smooth booking and great value. Would use again.', 4],
      ['yelp', 'R. Patel', 3, 'The ride itself was fine but the final bill was higher than quoted.', 6]
    ].forEach(function (x) { data.reviews.push({ id: uid('r'), site: x[0], author: x[1], rating: x[2], text: x[3], at: d(x[4]), reply: null, sample: true }); });
    save(); render();
  }

  function settings() {
    view.onChange = function (p) { if (p === 'settings.ai.engine') render(); if (p === 'settings.serverUrl') checkServer(); };
    view.after = checkServer;
    var s = data.settings, a = s.ai, key = store(AIKEY) || '';
    return '<div class="page"><div class="page-head"><div><h1>Settings</h1><p>Business details, review sites, delivery and AI replies.</p></div></div>' +
      '<div class="cols"><div>' +
      '<div class="box"><h2>Business</h2><div style="margin-top:12px">' + businessFields() +
      F.area('business.summary', 'What you do (used by AI replies)', { rows: 3, ph: 'e.g. Chauffeured sedans, SUVs and limos for airport runs, weddings and corporate travel across Long Island.', hint: 'Replies only mention facts from this profile. Keep it accurate.' }) +
      '<div class="row2">' + F.text('business.logo', 'Logo URL') + F.color('business.color', 'Accent color') + '</div></div></div>' +
      '<div class="box"><h2>Owner</h2><div style="margin-top:12px">' + ownerFields() + '</div></div>' +
      '<div class="box"><h2>Review sites</h2><p class="hint">Where positive customers are sent. 2 to 4 sites works best.</p><div style="margin-top:12px">' + linkRows() + '</div></div>' +
      '</div><div>' +
      '<div class="box"><h2>Delivery</h2><div style="margin-top:12px">' +
      F.radios('settings.delivery', [['manual', 'Manual', 'Opens your own email or text app with the message ready. Nothing to set up.'],
        ['server', 'Connexions server', 'Texts send for real through Twilio or Txtria. Which one is set on the server (SMS_PROVIDER in server/.env). Email still opens your email app.'],
        ['webhook', 'Webhook', 'Each message is POSTed as JSON to your webhook (Zapier, Make, n8n), which does the sending.']], { rerender: 1 }) +
      (s.delivery === 'server' ? '<div style="margin-top:12px">' +
        F.text('settings.serverUrl', 'Server address', { type: 'url', ph: serverBase(), hint: 'Leave blank when you open the app from the server itself.' }) +
        '<div class="field"><label for="srv-key">Server access key</label><input class="input" id="srv-key" type="password" autocomplete="off" value="' + esc(store(SRVKEY) || '') + '">' +
        '<p class="hint">Must match ACCESS_KEY in server/.env. Saved only in this browser, never in exported data.</p></div>' +
        '<div id="srv-status" class="note">Checking the server…</div>' +
        '<div class="row2"><input class="input" id="srv-test-to" type="tel" placeholder="Your mobile number" value="' + esc(data.business.owner.phone) + '" aria-label="Test number">' +
        '<button class="btn" data-a="srv-test">Send a test text</button></div></div>' : '') +
      '<div style="margin-top:12px">' + F.text('settings.webhook', 'Webhook URL', { type: 'url', ph: 'https://hooks.zapier.com/...', hint: 'Also receives every rating, comment and review-site click from the feedback page.' }) +
      F.text('settings.feedbackBase', 'Feedback page address', { type: 'url', ph: feedbackBase(), hint: 'Where feedback.html is hosted. Customers can’t open a link to a file on this computer, so set this once it’s online.' }) + '</div></div></div>' +
      '<div class="box"><h2>AI replies</h2><div style="margin-top:12px">' +
      F.radios('settings.ai.engine', [['builtin', 'Built-in drafter', 'Works offline, free. Matches the rating, uses the reviewer’s name and what they mentioned.'],
        ['claude', 'Claude', 'Anthropic’s model writes a fresh, specific reply each time. Uses your own API key; cost is a fraction of a cent per reply.']], { rerender: 1 }) +
      (a.engine === 'claude' ? '<div style="margin-top:12px">' + F.select('settings.ai.model', 'Model', [['claude-opus-5-5', 'Claude Opus 5.5 (best writing)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)']]) +
        '<div class="field"><label for="ai-key">Anthropic API key</label><input class="input" id="ai-key" type="password" autocomplete="off" value="' + esc(key) + '" placeholder="sk-ant-...">' +
        '<p class="hint">Saved only in this browser on this computer, never in exported data. Anyone with access to this browser profile can read it, so use a key with a spending limit.</p></div>' : '') +
      '<div class="row2" style="margin-top:12px">' + F.select('settings.ai.tone', 'Tone', [['warm', 'Warm'], ['professional', 'Professional'], ['brief', 'Brief']]) + F.text('settings.ai.signoff', 'Sign-off', { ph: 'e.g. Joe, Owner' }) + '</div>' +
      F.toggle('settings.ai.autoDraft', 'Auto-draft replies to positive reviews') +
      '<p class="hint">Drafts are never posted on their own. You approve every reply.</p>' +
      '<button class="btn" data-a="ai-test" style="margin-top:10px">Test with a sample review</button><div id="ai-test-out"></div></div></div>' +
      '<div class="box"><h2>Data</h2><p class="hint">Everything is stored in this browser. Export a backup before clearing browser data.</p><div class="actions" style="margin-top:12px">' +
      '<button class="btn" data-a="export">Export backup</button><label class="btn">Import backup<input type="file" id="imp" accept="application/json" hidden></label>' +
      '<button class="btn btn-danger" data-a="reset">Reset everything</button></div></div>' +
      '</div></div></div>';
  }

  var checkT;
  function checkServer() {
    clearTimeout(checkT);
    checkT = setTimeout(function () {
      var el = document.getElementById('srv-status');
      if (!el) return;
      serverCall('/api/sms/status').then(function (j) {
        if (!document.body.contains(el)) return;
        if (j.ok) {
          el.className = 'note';
          el.textContent = 'Connected. Texts send through ' + j.label + (j.from ? ' from ' + j.from : '') + '.' + (j.inbound ? '' : ' Inbound STOP handling is off until INBOUND_TOKEN is set.');
        } else {
          el.className = 'note warn';
          el.textContent = j.missing && j.missing.length ? 'Server reached, but ' + j.label + ' isn’t set up. Missing in server/.env: ' + j.missing.join(', ') + '.' : (j.error || 'Server problem.');
        }
      });
    }, 300);
  }

  // ---------- router ----------
  function route() { return location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard'; }
  function render() {
    pullInbox();
    var r = route();
    if (!data.business.onboarded && r !== 'onboarding') { location.hash = '#/onboarding'; return; }
    view = { pstep: view.pstep, filter: view.filter };
    nav.hidden = false;
    nav.querySelectorAll('a').forEach(function (a) { a.setAttribute('aria-current', a.dataset.r === r ? 'page' : 'false'); });
    var V = { dashboard: dashboard, requests: requests, reviews: reviews, settings: settings, onboarding: onboarding }[r] || dashboard;
    app.innerHTML = V();
    slot.innerHTML = data.business.onboarded ? '<span>' + esc(data.business.name) + '</span>' : '';
    if (view.after) view.after();
    updateCounts();
  }
  window.addEventListener('hashchange', render);

  // ---------- actions ----------
  function custById(id) { return data.customers.filter(function (c) { return c.id === id; })[0]; }
  function itemById(id) { return items().filter(function (i) { return i.id === id; })[0]; }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.dataset.a, id = b.dataset.id;
    switch (a) {
      case 'wiz-next':
        var miss = wizMissing(data.business.wizStep);
        if (miss.length) return toast('Please add: ' + miss.join(', ') + '.');
        if (data.business.wizStep === 3 && !data.business.reviewLinks.some(function (l) { return l.url; })) toast('No review sites yet. You can add them later in Settings.');
        data.business.wizStep++; save(); render(); window.scrollTo(0, 0); break;
      case 'wiz-back': data.business.wizStep--; save(); render(); break;
      case 'wiz-finish': data.business.onboarded = true; save(); location.hash = '#/'; toast('You’re set up. Add your first customer.'); break;
      case 'pstep': view.pstep = b.dataset.s; b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); refreshPreview(); break;
      case 'link-add': data.business.reviewLinks.push({ type: 'other', url: '' }); save(); render(); break;
      case 'link-del': data.business.reviewLinks.splice(+b.dataset.i, 1); save(); render(); break;
      case 'placeid':
        var pid = document.getElementById('placeid').value.trim();
        if (!pid) return toast('Paste your Google Place ID first.');
        var url = 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(pid);
        var g = data.business.reviewLinks.filter(function (l) { return l.type === 'google'; })[0];
        if (g) g.url = url; else data.business.reviewLinks.unshift({ type: 'google', url: url });
        save(); render(); toast('Google review link added.'); break;
      case 'test-send':
        var o = data.business.owner;
        var te = (document.getElementById('t-email') || {}).value, tp = (document.getElementById('t-phone') || {}).value;
        var me = { id: null, first: o.first || 'there', last: o.last, email: (te != null ? te : o.email).trim(), phone: (tp != null ? tp : o.phone).trim(), pref: 'email' };
        var ch = [me.email && 'email', me.phone && 'sms'].filter(Boolean);
        if (!ch.length) return toast('Add your email or mobile first.');
        deliver(compose(me, { id: 'test', channels: ch }, null), 'Your test request'); break;
      case 'add-cust': addCustomerSheet(); break;
      case 'csv': csvSheet(); break;
      case 'ask': var c = custById(id); if (c) requestFeedback(c, forceArm === id); break;
      case 'remind': var c2 = custById(id); if (c2) sendReminder(c2); break;
      case 'del-cust': arm(b, function () { data.customers = data.customers.filter(function (c) { return c.id !== id; }); save(); render(); }); break;
      case 'copy-general': copy(generalLink(), 'Feedback link copied.'); break;
      case 'filter': view.filter = data._revFilter = b.dataset.f; save(); render(); break;
      case 'add-review': addReviewSheet(); break;
      case 'samples': loadSamples(); break;
      case 'del-review': arm(b, function () { data.reviews = data.reviews.filter(function (r) { return r.id !== id; }); save(); render(); }); break;
      case 'draft': var it = itemById(id); if (it) draftFor(it, 0); break;
      case 'regen': var it2 = itemById(id); if (it2) draftFor(it2, (it2.reply.variant || 0) + 1); break;
      case 'write': var it3 = itemById(id); if (it3) { it3.ref.reply = { text: '', status: 'draft', engine: 'manual', at: now() }; save(); render(); var t = document.querySelector('[data-reply="' + id + '"]'); if (t) t.focus(); } break;
      case 'discard': var it4 = itemById(id); if (it4) { it4.ref.reply = null; save(); render(); } break;
      case 'edit-reply': var it5 = itemById(id); if (it5) { it5.ref.reply.status = 'draft'; save(); render(); } break;
      case 'approve': var it6 = itemById(id); if (it6) approve(it6); break;
      case 'ai-test':
        var out = document.getElementById('ai-test-out');
        out.innerHTML = '<p class="hint">Drafting…</p>';
        CxReply.draft({ id: 'test', author: 'Sam Rivera', rating: 2, scale: 'stars', text: 'The car showed up 20 minutes late and the driver never called. The ride was comfortable once we got going.', source: 'Google' },
          bizForAI(), aiOpts(0)).then(function (t) {
          out.innerHTML = '<div class="reply" style="margin-top:12px"><div class="reply-head"><span>Sample 2-star review reply</span></div><p>' + esc(t) + '</p></div>';
        }, function (err) { out.innerHTML = '<div class="note warn" style="margin-top:12px">' + esc(err.message) + '</div>'; });
        break;
      case 'srv-test':
        var to = document.getElementById('srv-test-to').value.trim();
        if (!e164(to)) return toast('Enter a valid mobile number first.');
        b.disabled = true;
        serverCall('/api/sms/send', { to: to, body: 'Test from ' + (data.business.name || 'Connexions Reputation') + ': your text messages are working.' }).then(function (j) {
          b.disabled = false;
          toast(j.ok ? (j.provider === 'test' ? 'Test mode: logged on the server, nothing actually sent.' : 'Test text sent via ' + (j.provider === 'txtria' ? 'Txtria' : 'Twilio') + '.') : 'Not sent: ' + j.error);
        });
        break;
      case 'export':
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'connexions-reputation-backup.json'; l.click();
        setTimeout(function () { URL.revokeObjectURL(l.href); }, 2000); break;
      case 'reset': arm(b, function () { localStorage.removeItem(KEY); data = defaults(); location.hash = '#/onboarding'; render(); }); break;
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'ai-key') { store(AIKEY, e.target.value.trim()); }
    if (e.target.id === 'srv-key') { store(SRVKEY, e.target.value.trim()); optoutsSynced = false; checkServer(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'imp' || !e.target.files[0]) return;
    e.target.files[0].text().then(function (t) {
      try { data = merge(defaults(), JSON.parse(t)); save(); render(); toast('Backup imported.'); }
      catch (err) { toast('That file isn’t a valid backup.'); }
    });
  });

  render();
  autoRun();
})();
