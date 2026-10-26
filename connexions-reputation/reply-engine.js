/* Connexions Reputation: review reply engine.
 * Two drafters with the same contract: (review, business, opts) -> reply text.
 *  - builtin: offline, rule-based. Matches sentiment, uses the first name, calls out
 *    what the reviewer mentioned, never offers incentives.
 *  - claude:  Anthropic Messages API, called straight from the browser with the
 *    user's own key (stored only in this browser).
 * Every draft is editable and nothing is posted without a click (same as GatherUp SmartReply).
 */
(function () {
  'use strict';

  // Sentiment from the rating, on either scale. NPS: 9-10 promoter, 7-8 passive, 0-6 detractor.
  function sentiment(r) {
    if (r.scale === 'nps') return r.rating >= 9 ? 'positive' : r.rating >= 7 ? 'neutral' : 'negative';
    return r.rating >= 4 ? 'positive' : r.rating === 3 ? 'neutral' : 'negative';
  }

  // What the reviewer talked about. pos = phrase for a thank-you, neg = phrase for an apology.
  var TOPICS = [
    { k: ['on time', 'punctual', 'early', 'prompt', 'right on schedule'], pos: 'our on-time arrival', neg: null },
    { k: ['late', 'delay', 'waited', 'waiting', 'wait time', 'no show', 'no-show'], pos: null, neg: 'the wait and the delay' },
    { k: ['driver', 'chauffeur'], pos: 'your driver', neg: 'your experience with our driver' },
    { k: ['friendly', 'kind', 'courteous', 'polite', 'nice', 'helpful', 'welcoming'], pos: 'the friendly service', neg: null },
    { k: ['rude', 'unprofessional', 'attitude', 'disrespect'], pos: null, neg: 'how you were treated' },
    { k: ['professional', 'professionalism'], pos: 'our team\'s professionalism', neg: null },
    { k: ['clean', 'spotless', 'immaculate'], pos: 'how clean everything was', neg: null },
    { k: ['dirty', 'smell', 'filthy', 'messy'], pos: null, neg: 'the condition of the vehicle' },
    { k: ['value', 'affordable', 'worth it', 'great price', 'fair price', 'reasonable'], pos: 'the value', neg: null },
    { k: ['expensive', 'overcharged', 'overpriced', 'charged', 'hidden fee', 'billing', 'bill', 'refund', 'higher than quoted'], pos: null, neg: 'the billing issue' },
    { k: ['easy', 'smooth', 'seamless', 'simple', 'booking'], pos: 'how smooth everything went', neg: null },
    { k: ['communication', 'responsive', 'called', 'texted', 'updates'], pos: 'the communication', neg: null },
    { k: ['never called', 'no response', 'didn\'t respond', 'did not respond', 'ignored', 'unreachable'], pos: null, neg: 'the lack of communication' },
    { k: ['safe', 'safely', 'careful'], pos: 'how safe you felt', neg: null },
    { k: ['wedding', 'prom', 'anniversary', 'birthday', 'airport', 'event'], pos: null, neg: null, occasion: true }
  ];

  // Whole-word match, so "late" doesn't fire on "chocolate" or "early" on "nearly".
  function has(t, k) { return new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t); }

  function topics(text) {
    var t = String(text || '').toLowerCase().replace(/’/g, '\'');
    var pos = [], neg = [], occasion = null;
    TOPICS.forEach(function (tp) {
      var hit = tp.k.filter(function (k) { return has(t, k); })[0];
      if (!hit) return;
      if (tp.occasion) { if (!occasion) occasion = hit; return; }
      if (tp.pos) pos.push(tp.pos);
      if (tp.neg) neg.push(tp.neg);
    });
    return { pos: pos.slice(0, 2), neg: neg.slice(0, 1), occasion: occasion };
  }

  function firstName(author) {
    var f = String(author || '').trim().split(/\s+/)[0] || '';
    f = f.replace(/[^A-Za-z'\-]/g, '');
    return f.length > 1 ? f.charAt(0).toUpperCase() + f.slice(1) : '';
  }

  function joinAnd(a) { return a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }
  function hash(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // House style for anything that gets published: no em-dashes, tidy spacing.
  function clean(text) {
    return String(text || '')
      .replace(/\s*—\s*/g, ', ')
      .replace(/\s*–\s*/g, ' - ')
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  function contactLine(biz) {
    var bits = [];
    if (biz.phone) bits.push('call us at ' + biz.phone);
    if (biz.email) bits.push('email ' + biz.email);
    return bits.length ? bits.join(' or ') : 'reach out to us directly';
  }

  function builtin(review, biz, opts) {
    opts = opts || {};
    var seed = hash((review.id || '') + ':' + (opts.variant || 0));
    var name = firstName(review.author);
    var hi = name ? pick(['Hi ' + name + ',', 'Hello ' + name + ',', name + ','], seed) : pick(['Hi there,', 'Hello,'], seed);
    var tp = topics(review.text);
    var s = sentiment(review);
    var bn = biz.name || 'our team';
    var brief = opts.tone === 'brief';
    var out = [];

    if (s === 'positive') {
      out.push(hi + ' ' + pick([
        'thank you so much for the great review!',
        'thank you for taking the time to share this!',
        'we really appreciate the kind words!',
        'this made our day, thank you!'
      ], seed));
      if (tp.pos.length) {
        out.push(pick([
          'We\'re so glad you noticed ' + joinAnd(tp.pos) + '.',
          'It means a lot that you called out ' + joinAnd(tp.pos) + '.',
          'Hearing that ' + joinAnd(tp.pos) + ' stood out is exactly what we work for.'
        ], seed >> 3));
      } else if (!brief) {
        out.push(pick([
          'Feedback like yours keeps our whole team going.',
          'It\'s great to hear everything went well.',
          'We\'ll be sure to share this with the team.'
        ], seed >> 3));
      }
      if (tp.occasion && !brief) out.push('We\'re honored we got to be part of your ' + tp.occasion + '.');
      out.push(pick([
        'We look forward to serving you again soon.',
        'Thanks for choosing ' + bn + ', and we hope to see you again.',
        'We can\'t wait to have you back.'
      ], seed >> 5));
    } else if (s === 'neutral') {
      out.push(hi + ' thank you for the honest feedback.');
      if (tp.pos.length) out.push('We\'re glad ' + joinAnd(tp.pos) + ' came through for you.');
      if (tp.neg.length) out.push('We\'re sorry about ' + tp.neg[0] + ', and we\'re looking into it.');
      if (!brief) out.push('We\'d love to know what would have made it a five-star experience, so please ' + contactLine(biz) + ' anytime.');
      out.push('Thanks for giving ' + bn + ' a try.');
    } else {
      out.push(hi + ' ' + pick([
        'thank you for letting us know, and I\'m truly sorry.',
        'I\'m sorry your experience fell short, and thank you for telling us.',
        'thank you for the feedback. I\'m sorry this happened.'
      ], seed));
      if (tp.neg.length) out.push('What you described about ' + tp.neg[0] + ' is not the standard we hold ourselves to.');
      else out.push('This is not the experience we want for anyone.');
      out.push('Please ' + contactLine(biz) + ' so we can understand what happened and make it right.');
    }

    var sign = (opts.signoff || '').trim();
    var text = out.join(' ');
    if (sign) text += '\n\n' + sign;
    return clean(text);
  }

  var SYSTEM = [
    'You draft public replies to customer reviews on behalf of a local business. Write as the business, in warm, plain language that sounds like a real person, not a template.',
    'Match the sentiment of the review. Use the reviewer\'s first name when one is given. Reference something specific they mentioned.',
    'For negative or mixed reviews: apologize sincerely without arguing or admitting legal fault, and invite them to contact the business directly using the contact details provided.',
    'Never offer discounts, refunds, freebies or other incentives. Never invent facts about the business beyond the profile you are given, and do not confirm claims you cannot verify.',
    'Never mention personal, health or account details about the customer, even if the review does.',
    'Keep it under 90 words unless the tone asks for brief, then under 40. Do not use em-dashes. Output only the reply text, with no preamble, quotes or sign-off unless one is provided.'
  ].join('\n');

  function claudeBody(review, biz, opts) {
    var profile = {
      business: biz.name, category: biz.category, summary: biz.summary,
      phone: biz.phone, email: biz.email, website: biz.website
    };
    var rv = {
      source: review.source, reviewer: review.author || '(anonymous)',
      rating: review.scale === 'nps' ? review.rating + ' out of 10 (likelihood to recommend)' : review.rating + ' out of 5 stars',
      sentiment: sentiment(review), text: review.text || '(no written comment, rating only)'
    };
    var ask = 'Business profile:\n' + JSON.stringify(profile, null, 2) +
      '\n\nReview:\n' + JSON.stringify(rv, null, 2) +
      '\n\nTone: ' + (opts.tone || 'warm') +
      (opts.signoff ? '\nEnd with this sign-off on its own line: ' + opts.signoff : '') +
      (opts.variant ? '\n\nWrite a different version from any previous draft (variation ' + opts.variant + ').' : '');
    var model = opts.model || 'claude-opus-5-5';
    var body = {
      model: model,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: ask }]
    };
    // Server-side refusal fallback; not available for Haiku.
    var fallback = model.indexOf('haiku') === -1;
    if (fallback) body.fallbacks = 'default';
    return { body: body, fallback: fallback };
  }

  function claude(review, biz, opts) {
    opts = opts || {};
    if (!opts.apiKey) return Promise.reject(new Error('Add your Anthropic API key in Settings > AI replies.'));
    var req = claudeBody(review, biz, opts);
    var headers = {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (req.fallback) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: headers, body: JSON.stringify(req.body) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (!res.ok) throw new Error('Claude API error ' + res.status + ': ' + ((j.error && j.error.message) || res.statusText || 'request failed'));
          if (j.stop_reason === 'refusal') throw new Error('Claude declined to draft this one. Use the built-in drafter or write it by hand.');
          var text = (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim();
          if (!text) throw new Error('Claude returned an empty draft (stop reason: ' + j.stop_reason + ').');
          return clean(text);
        });
      });
  }

  window.CxReply = {
    sentiment: sentiment, topics: topics, clean: clean, builtin: builtin, claude: claude,
    draft: function (review, biz, opts) {
      return opts && opts.engine === 'claude' ? claude(review, biz, opts) : Promise.resolve(builtin(review, biz, opts));
    }
  };
})();
