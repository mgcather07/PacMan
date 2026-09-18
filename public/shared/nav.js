/*
 * Site top bar for the arcade's own pages (home, Daily Challenge, Leaderboards, Profile):
 * logo, section links and the player badge (avatar, name, level, streak) that opens the profile.
 * Load after leaderboard.js and put <nav id="site-nav"></nav> at the top of <body>.
 */
(function () {
  'use strict';

  const LB = window.Leaderboard;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LINKS = [
    ['/', '🎮', 'Games', 'Games'],
    ['/daily/', '📅', 'Daily', 'Daily'],
    ['/leaderboards/', '🏅', 'Leaderboards', 'Ranks'],
  ];

  const css = `
    .an { position: sticky; top: 0; z-index: 40; background: #07070fe6; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid #ffffff14; box-shadow: 0 4px 0 #00000055; padding-top: env(safe-area-inset-top); }
    .an-in { max-width: 1120px; margin: 0 auto; display: flex; align-items: center; gap: 14px; padding: 9px 16px; }
    .an a { text-decoration: none; }
    .an-logo { display: inline-flex; align-items: center; gap: 9px; font: 11px/1.2 "Press Start 2P", monospace; color: #ffe600; text-shadow: 2px 2px 0 #7a5a00; white-space: nowrap; }
    .an-logo i { font-style: normal; font-size: 20px; text-shadow: none; }
    .an-logo b { font-weight: normal; color: #3fd8ff; text-shadow: 2px 2px 0 #0a4a5c; }
    .an-links { display: flex; gap: 4px; margin-left: auto; }
    .an-links a { position: relative; display: inline-flex; align-items: center; gap: 7px; font: 9px/1 "Press Start 2P", monospace; text-transform: uppercase; color: #9a9ab8; padding: 10px 11px 9px; border-radius: 4px; border: 1px solid transparent; }
    .an-links a:hover { color: #fff; background: #ffffff0d; }
    .an-links a[aria-current="page"] { color: #fff; background: #ffffff12; border-color: #ffffff26; box-shadow: 2px 2px 0 #000; }
    .an-links .ic { font-size: 14px; line-height: 1; }
    .an-links .dot { position: absolute; top: 5px; left: 22px; width: 7px; height: 7px; border-radius: 50%; background: #ff3b5c; box-shadow: 0 0 6px #ff3b5c; }
    .an-links .short { display: none; }
    .an-me { display: inline-flex; align-items: center; gap: 9px; padding: 4px 10px 4px 4px; border-radius: 6px; background: #ffffff0a; border: 1px solid #ffffff22; color: #fff; box-shadow: 2px 2px 0 #000; min-width: 0; max-width: 260px; }
    .an-me:hover { border-color: #ffe60088; background: #ffe6000f; }
    .an-me[aria-current="page"] { border-color: #ffe600aa; }
    .an-me .lb-avatar { width: 32px; height: 32px; border-radius: 5px; font-size: 14px; }
    .an-me .lb-avatar.has-icon { font-size: 18px; }
    .an-me .who { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .an-me .nm { font: 700 13px/1 Inter, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .an-me .meta { display: flex; gap: 6px; align-items: center; font: 7px/1 "Press Start 2P", monospace; color: #ffe600; white-space: nowrap; }
    .an-me .meta .st { color: #ff8fa3; }
    .an-me .meta .sy { color: #3cff8a; }
    .an-me.guest .nm { color: #cfcfe6; }
    .an-me.guest .meta { color: #3fd8ff; }
    @media (max-width: 760px) {
      .an-logo span { display: none; }
      .an-in { gap: 8px; padding: 7px 10px; }
      .an-links { gap: 2px; }
      .an-links a { flex-direction: column; gap: 5px; font-size: 7px; padding: 6px 8px 5px; }
      .an-links .long { display: none; } .an-links .short { display: inline; }
      .an-links .ic { font-size: 16px; }
      .an-links .dot { top: 3px; left: auto; right: 7px; }
      .an-me { padding: 3px; gap: 0; }
      .an-me .who { display: none; }
      .an-me .lb-avatar { width: 36px; height: 36px; }
    }
    @media (max-width: 360px) { .an-links a { padding: 6px 5px 5px; } }
  `;

  function mount(el) {
    if (!el) return;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    if (LB) LB.injectCss();
    el.className = 'an';
    el.setAttribute('aria-label', 'Arcade');
    const path = location.pathname.replace(/index\.html$/, '');

    const render = () => {
      const name = LB ? LB.cachedName() : '';
      const s = LB ? LB.streak() : { current: 0 };
      const lvl = LB && LB.cachedLevel();
      const acct = LB ? LB.account() : { signedIn: false };
      const dailyDue = LB && window.Daily && !s.playedToday;
      const links = LINKS.map(([href, icon, long, short]) => `<a href="${href}"${path === href ? ' aria-current="page"' : ''}><span class="ic">${icon}</span><span class="long">${long}</span><span class="short">${short}</span>${href === '/daily/' && dailyDue ? '<i class="dot" title="Today’s challenges are waiting"></i>' : ''}</a>`).join('');
      const meta = [
        lvl ? `<span>LV ${lvl.level}</span>` : '',
        s.current ? `<span class="st">🔥${s.current}</span>` : '',
        acct.signedIn ? '<span class="sy" title="Synced with Google">☁️</span>' : '',
      ].join('');
      const me = LB
        ? `<a class="an-me${name ? '' : ' guest'}" href="/profile/"${path === '/profile/' ? ' aria-current="page"' : ''} title="Your profile">${LB.avatarHtml(name || '?', LB.cachedAvatar())}<span class="who"><span class="nm">${esc(name || 'Guest')}</span><span class="meta">${meta || 'SET UP PROFILE ▶'}</span></span></a>`
        : '';
      el.innerHTML = `<div class="an-in"><a class="an-logo" href="/"><i>🕹️</i><span>FOREVER <b>ARCADE</b></span></a><div class="an-links">${links}</div>${me}</div>`;
    };
    render();
    if (!LB) return;
    LB.onName(render);
    LB.onStreak(render);
    LB.onAccount(render);
    LB.onSummary(render);

    // keep the level and streak fresh for returning players (at most every few minutes)
    const known = LB.cachedName() || LB.account().signedIn || LB.playedDays().length;
    let last = 0;
    try { last = +sessionStorage.getItem('arcade.navRefresh') || 0; } catch (e) { /* ignore */ }
    if (known && Date.now() - last > 5 * 60000 && path !== '/profile/') {
      setTimeout(() => {
        try { sessionStorage.setItem('arcade.navRefresh', String(Date.now())); } catch (e) { /* ignore */ }
        LB.summary().catch(() => {});
      }, 1200);
    }
  }

  mount(document.getElementById('site-nav'));
})();
