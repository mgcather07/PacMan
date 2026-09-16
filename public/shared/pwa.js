/*
 * Install to home screen: registers the service worker and powers any [data-install] button.
 * Chrome/Edge/Android use the browser's install prompt; iPhone/iPad Safari gets short
 * "Share → Add to Home Screen" instructions. Buttons stay hidden once the app is installed.
 */
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[pwa] service worker failed:', e));
    });
  }

  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;

  const buttons = () => document.querySelectorAll('[data-install]');
  const show = (on) => buttons().forEach((b) => { b.hidden = !on; });

  function track(name, params) { if (window.Analytics) Analytics.event(name, params); }

  function iosSheet() {
    if (document.getElementById('pwa-sheet')) return;
    const st = document.createElement('style');
    st.textContent = `
      .pwa-sheet { position: fixed; inset: 0; z-index: 10001; display: grid; place-items: end center; background: #000a; padding: 16px; }
      .pwa-card { width: 100%; max-width: 420px; background: #12122a; border: 1px solid #ffffff2a; border-radius: 18px; padding: 20px; color: #eee; font: 15px/1.5 Inter, system-ui, sans-serif; box-shadow: 0 20px 60px #000c; margin-bottom: env(safe-area-inset-bottom); }
      .pwa-card h3 { margin: 0 0 10px; font: 13px/1.5 "Press Start 2P", monospace; color: #ffe600; }
      .pwa-card ol { margin: 0 0 16px; padding-left: 22px; }
      .pwa-card li { margin: 6px 0; }
      .pwa-card .ico { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; background: #ffffff1a; vertical-align: middle; }
      .pwa-card button { width: 100%; font: 700 15px Inter, system-ui, sans-serif; padding: 12px; border-radius: 12px; border: 0; background: #ffe600; color: #1b1400; cursor: pointer; }
    `;
    document.head.appendChild(st);
    const sheet = document.createElement('div');
    sheet.id = 'pwa-sheet';
    sheet.className = 'pwa-sheet';
    sheet.innerHTML = `<div class="pwa-card" role="dialog" aria-label="Add to Home Screen">
      <h3>📲 INSTALL THE ARCADE</h3>
      <ol>
        <li>Tap the <b>Share</b> button <span class="ico">⬆︎</span> in Safari’s toolbar.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>. The arcade opens full-screen like an app, and games work offline.</li>
      </ol>
      <button type="button">Got it</button>
    </div>`;
    const close = () => sheet.remove();
    sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
    sheet.querySelector('button').addEventListener('click', close);
    document.body.appendChild(sheet);
  }

  async function install(e) {
    if (e) e.preventDefault();
    if (deferred) {
      const prompt = deferred;
      deferred = null;
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      track('app_install_prompt', { outcome });
      if (outcome === 'accepted') show(false);
    } else if (isIOS) {
      track('app_install_prompt', { outcome: 'ios_instructions' });
      iosSheet();
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (!standalone()) show(true);
  });
  window.addEventListener('appinstalled', () => { show(false); track('app_installed'); });

  function init() {
    buttons().forEach((b) => b.addEventListener('click', install));
    // Safari on iOS has no install prompt event, so offer the instructions there
    show(!standalone() && (isIOS || !!deferred));
    if (standalone()) document.documentElement.classList.add('standalone');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.PWA = { install, standalone };
})();
