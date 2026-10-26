/* Popup defaults and starter templates. Setting names follow the Elfsight popup schema
   (triggerExitIntentEnabled, displayFrequency, displayPages, ...) so concepts map 1:1. */
(function (w) {
  'use strict';

  function inDays(n) {
    var t = new Date(Date.now() + n * 86400000);
    t.setSeconds(0, 0);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + 'T' + p(t.getHours()) + ':' + p(t.getMinutes());
  }

  function defaults() {
    return {
      id: '', name: 'Untitled popup', active: true, createdAt: 0, updatedAt: 0,
      blocks: [],
      // design
      layout: 'modal', position: 'right', widgetWidth: 480, borderRadius: 16,
      background: '#ffffff', textColor: '#0f172a', accentColor: '#4f46e5', accentTextColor: '#ffffff',
      elementsAlignment: 'center', sideImage: '', sideImagePosition: 'left',
      backdropVisible: true, backdropColor: '#0f172a', backdropOpacity: 60, backdropBackground: 'rgba(15,23,42,0.6)',
      backdropClose: true, closeButtonVisible: true, closeButtonColor: '',
      // triggers
      triggerPageLoadEnabled: true,
      triggerTimeOnPageEnabled: false, triggerTimeOnPageDuration: 5,
      triggerScrollEnabled: false, triggerScrollPosition: 50,
      triggerScrollToElementEnabled: false, triggerScrollToElementId: '',
      triggerExitIntentEnabled: false,
      triggerClickEnabled: false, triggerClickElementId: '',
      // display rules
      displayFrequency: 'everytime',
      displayPages: 'allPages', displaySpecificPages: [], displayExcludedPages: [],
      displayDevices: ['desktop', 'mobile'],
      scheduleEnabled: false, scheduleStart: '', scheduleEnd: '',
      reopenButton: false, reopenButtonText: 'Open offer', reopenButtonPosition: 'right', reopenButtonMode: 'afterClose',
      googleAnalytics: false
    };
  }

  var templates = [
    {
      key: 'blank', name: 'Blank popup', desc: 'Start from an empty canvas.',
      build: function () {
        return { name: 'Blank popup', blocks: [
          { type: 'heading', text: 'Your headline here', size: 28 },
          { type: 'text', text: 'Add a short message for your visitors.' },
          { type: 'button', text: 'Got it', action: 'close' }
        ] };
      }
    },
    {
      key: 'discount', name: 'Welcome discount', desc: 'Split layout with a copyable coupon code.',
      build: function () {
        return {
          name: 'Welcome discount', layout: 'split', widgetWidth: 460, accentColor: '#e11d48',
          triggerPageLoadEnabled: false, triggerTimeOnPageEnabled: true, triggerTimeOnPageDuration: 5,
          displayFrequency: 'daily', reopenButton: true, reopenButtonText: 'Get 15% off',
          blocks: [
            { type: 'heading', text: 'Get 15% off your first order', size: 30 },
            { type: 'text', text: 'Thanks for stopping by. Use this code at checkout.' },
            { type: 'coupon', code: 'WELCOME15', copyText: 'Copy', copiedText: 'Copied!' },
            { type: 'button', text: 'No thanks', action: 'close', style: 'ghost' }
          ]
        };
      }
    },
    {
      key: 'newsletter', name: 'Newsletter signup', desc: 'Email capture that appears after scrolling.',
      build: function () {
        return {
          name: 'Newsletter signup', accentColor: '#0d9488',
          triggerPageLoadEnabled: false, triggerScrollEnabled: true, triggerScrollPosition: 40,
          displayFrequency: 'weekly',
          blocks: [
            { type: 'heading', text: 'Stay in the loop', size: 28 },
            { type: 'text', text: 'Get our best tips and offers once a month. No spam, unsubscribe anytime.' },
            { type: 'form', nameField: true, buttonText: 'Subscribe', successText: 'You are in! Check your inbox.', webhookUrl: '' },
            { type: 'button', text: 'Maybe later', action: 'close', style: 'ghost' }
          ]
        };
      }
    },
    {
      key: 'exit', name: 'Exit-intent offer', desc: 'Catches visitors as they move to leave.',
      build: function () {
        return {
          name: 'Exit-intent offer', accentColor: '#ea580c',
          triggerPageLoadEnabled: false, triggerExitIntentEnabled: true,
          displayFrequency: 'once',
          blocks: [
            { type: 'heading', text: 'Wait! Before you go...', size: 30 },
            { type: 'text', text: 'Here is 10% off if you book today.' },
            { type: 'coupon', code: 'STAY10', copyText: 'Copy', copiedText: 'Copied!' },
            { type: 'button', text: 'Claim my discount', action: 'close', fullWidth: true }
          ]
        };
      }
    },
    {
      key: 'bar', name: 'Announcement bar', desc: 'Slim bar pinned to the top of the page.',
      build: function () {
        return {
          name: 'Announcement bar', layout: 'bar-top', background: '#4f46e5', textColor: '#ffffff',
          accentColor: '#ffffff', accentTextColor: '#4f46e5', borderRadius: 10,
          displayFrequency: 'everyTimeUntilClose',
          blocks: [
            { type: 'text', text: 'New: book online in under 60 seconds.', size: 15 },
            { type: 'button', text: 'Learn more', action: 'url', url: 'https://example.com', newTab: false }
          ]
        };
      }
    },
    {
      key: 'countdown', name: 'Countdown sale', desc: 'Urgency timer for a limited-time offer.',
      build: function () {
        return {
          name: 'Countdown sale', background: '#0f172a', textColor: '#f8fafc', accentColor: '#facc15', accentTextColor: '#0f172a',
          displayFrequency: 'daily',
          blocks: [
            { type: 'heading', text: 'Flash sale ends soon', size: 30 },
            { type: 'text', text: 'Save 20% on every booking before the timer runs out.' },
            { type: 'countdown', endsAt: inDays(3), expiredText: 'This offer has ended.' },
            { type: 'button', text: 'Shop the sale', action: 'url', url: 'https://example.com', fullWidth: true }
          ]
        };
      }
    },
    {
      key: 'callback', name: 'Callback request', desc: 'Corner slide-in that collects leads.',
      build: function () {
        return {
          name: 'Callback request', layout: 'slidein', widgetWidth: 360, backdropVisible: false,
          triggerPageLoadEnabled: false, triggerTimeOnPageEnabled: true, triggerTimeOnPageDuration: 15,
          displayFrequency: 'everyTimeUntilClose', elementsAlignment: 'left',
          blocks: [
            { type: 'heading', text: 'Questions? We will call you.', size: 22, align: 'left' },
            { type: 'text', text: 'Leave your number and a real person gets back to you today.', size: 14, align: 'left' },
            { type: 'form', nameField: true, emailField: false, phoneField: true, phoneRequired: true, buttonText: 'Call me back', successText: 'Got it. Talk soon!', webhookUrl: '' }
          ]
        };
      }
    }
  ];

  w.CxTemplates = { defaults: defaults, list: templates, inDays: inDays };
})(window);
