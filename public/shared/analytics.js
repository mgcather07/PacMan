/*
 * Google Analytics 4 (the property linked to the Firebase project), so plays show up in the
 * Firebase console → Analytics and in analytics.google.com.
 *
 *   Analytics.event('game_start', { game: 'frogger', mode: 'daily' })
 *
 * Nothing is sent from localhost; events are logged to the console there instead.
 */
(function () {
  'use strict';

  const MEASUREMENT_ID = 'G-28C6FMQP9X';
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  if (!local) {
    gtag('js', new Date());
    gtag('config', MEASUREMENT_ID);
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(s);
  }

  function event(name, params = {}) {
    if (local) { (window.__analyticsLog = window.__analyticsLog || []).push([name, params]); console.debug('[analytics]', name, params); return; }
    try { gtag('event', name, params); } catch (e) { /* ignore */ }
  }

  window.Analytics = { event };
})();
