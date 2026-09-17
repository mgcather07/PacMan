/*
 * Service worker: makes the arcade installable and playable offline.
 * Pages and scripts are network-first (so every deploy shows up right away) and fall back to the
 * cached copy when offline or when the network is too slow. Fonts are served from cache and refreshed
 * in the background. Leaderboards, analytics and Firebase always go straight to the network.
 */
const CACHE = 'arcade-v2';
const FONT_CACHE = 'arcade-fonts-v1';
const NETWORK_TIMEOUT_MS = 3500;

const PAGES = ['/', '/daily/', '/leaderboards/', '/pacman/', '/snake/', '/minesweeper/', '/frogger/', '/breakout/', '/asteroids/', '/tetris/', '/shooter/', '/solitaire/', '/spider/', '/freecell/', '/profile/'];
const ASSETS = [
  '/shared/arcade.css', '/shared/arcade.js', '/shared/daily.js', '/shared/leaderboard.js', '/shared/music.js', '/shared/analytics.js', '/shared/pwa.js', '/shared/nav.js', '/shared/achievements.js',
  '/pacman/game.js', '/snake/snake.js', '/minesweeper/mines.js', '/frogger/frogger.js', '/breakout/breakout.js', '/asteroids/asteroids.js',
  '/tetris/tetris.js', '/shooter/shooter.js', '/solitaire/style.css', '/solitaire/engine.js', '/solitaire/solitaire.js', '/solitaire/spider.js',
  '/solitaire/freecell.js', '/favicon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // one bad file shouldn't stop the others from being cached
    await Promise.all([...PAGES, ...ASSETS].map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [CACHE, FONT_CACHE];
    for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const isPage = request.mode === 'navigate';
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') cache.put(isPage ? new URL(request.url).pathname : request, response.clone());
    return response;
  });
  const cached = () => cache.match(isPage ? new URL(request.url).pathname : request, { ignoreSearch: true });
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), NETWORK_TIMEOUT_MS)),
    ]);
  } catch (e) {
    const hit = await cached();
    if (hit) return hit;
    return network; // nothing cached: keep waiting for the network (or fail)
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  }).catch(() => hit);
  return hit || refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/admin/') || url.pathname.startsWith('/__/')) return;
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
