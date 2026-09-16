/*
 * Daily Challenge: everyone who opens a game with ?daily=YYYYMMDD gets the same seeded game that day.
 *
 *   Daily.active            → { key: 20260916, label: 'Wed, Sep 16' } or null
 *   Daily.seed(game)        → 32-bit seed for this game on the active day
 *   Daily.rng(game)         → fresh seeded random() for world generation (same sequence for everyone)
 *   Daily.board(game)       → leaderboard id 'daily-<game>-<key>' when a daily is active, else null
 *   Daily.todayKey()        → today's local date as YYYYMMDD
 */
(function () {
  'use strict';

  const GAMES = ['pacman', 'snake', 'minesweeper', 'frogger', 'breakout', 'asteroids', 'tetris', 'shooter', 'klondike', 'spider', 'freecell'];

  const keyOf = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const dateOf = (key) => new Date(Math.floor(key / 10000), Math.floor(key / 100) % 100 - 1, key % 100);
  const todayKey = () => keyOf(new Date());
  const shiftKey = (key, days) => { const d = dateOf(key); d.setDate(d.getDate() + days); return keyOf(d); };
  const label = (key) => dateOf(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ?daily=today or ?daily=YYYYMMDD (only yesterday/today/tomorrow are accepted so boards stay current)
  let active = null;
  const param = new URLSearchParams(location.search).get('daily');
  if (param !== null) {
    const today = todayKey();
    let key = /^\d{8}$/.test(param) ? +param : today;
    if (![shiftKey(today, -1), today, shiftKey(today, 1)].includes(key)) key = today;
    active = { key, label: label(key) };
  }

  const seed = (game, key = active && active.key) => hashString(`infinite-arcade:${key}:${game}`);
  const rng = (game, key) => mulberry32(seed(game, key));
  const board = (game, key = active && active.key) => (key && GAMES.includes(game) ? `daily-${game}-${key}` : null);

  function msUntilTomorrow() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return next - now;
  }

  // Page chrome: "DAILY CHALLENGE" title, a date banner, and home links that return to /daily/
  function decorate() {
    if (!active) return;
    document.documentElement.dataset.daily = String(active.key);
    document.title = 'Daily ' + document.title.replace(/^(Infinite|Classic) /, '');
    if (!document.getElementById('daily-css')) {
      const st = document.createElement('style');
      st.id = 'daily-css';
      st.textContent = `
        .only-daily { display: none !important; }
        [data-daily] .only-daily { display: revert !important; }
        [data-daily] .not-daily { display: none !important; }
        .daily-banner { display: inline-flex; align-items: center; gap: 8px; margin: 6px auto 4px; padding: 8px 14px; border-radius: 999px;
          background: #ff9f3d1f; border: 1px solid #ff9f3d66; color: #ffc27a; font: 600 13px Inter, system-ui, sans-serif; line-height: 1.3; }
        .daily-banner b { color: #fff; }
        .daily-pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: #ff9f3d26;
          border: 1px solid #ff9f3d66; color: #ffc27a; font: 700 12px Inter, system-ui, sans-serif; white-space: nowrap; }
      `;
      document.head.appendChild(st);
    }
    const small = document.querySelector('#title h1 small');
    if (small) small.textContent = 'DAILY CHALLENGE';
    const h1 = document.querySelector('#title h1');
    if (h1 && !document.querySelector('.daily-banner')) {
      const b = document.createElement('div');
      b.className = 'daily-banner';
      b.innerHTML = `📅 <b>${label(active.key)}</b> · everyone plays the same game today`;
      h1.after(b);
    }
    const bar = document.querySelector('.bar .stats');
    if (!h1 && bar && !document.querySelector('.daily-pill')) {
      const p = document.createElement('div');
      p.className = 'daily-pill';
      p.textContent = `📅 Daily · ${label(active.key)}`;
      bar.prepend(p);
    }
    document.querySelectorAll('a[href="/"], a[href="/#classic"]').forEach((a) => { a.href = '/daily/'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate); else decorate();

  window.Daily = { GAMES, active, todayKey, shiftKey, label, seed, rng, board, msUntilTomorrow, decorate };
})();
