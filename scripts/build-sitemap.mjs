/*
 * Writes public/robots.txt and public/sitemap.xml from the game registry.
 * Run it after adding a game, or after pointing a custom domain at the site:
 *
 *   node scripts/build-sitemap.mjs                        # uses the Firebase URL
 *   SITE_URL=https://example.com node scripts/build-sitemap.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SITE = (process.env.SITE_URL || 'https://pacman-d28dc.web.app').replace(/\/$/, '');

const root = {};
new Function('root', 'globalThis', 'window', readFileSync('public/shared/games.js', 'utf8'))(root, root, root);
const games = (root.ArcadeGames || globalThis.ArcadeGames).list;

// Every page worth indexing: the catalog, the hubs, and each game in both modes.
const paths = ['/', '/daily/', '/leaderboards/', '/privacy/'];
for (const g of games) {
  paths.push(g.path);
  if (g.boards.some((b) => b.group === 'Classic')) paths.push(`${g.path}?mode=classic`);
}

const today = new Date().toISOString().slice(0, 10);
const priority = (p) => (p === '/' ? '1.0' : p.includes('?') ? '0.5' : p.endsWith('/privacy/') ? '0.2' : '0.8');
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url>
    <loc>${SITE}${p.replace(/&/g, '&amp;')}</loc>
    <lastmod>${today}</lastmod>
    <priority>${priority(p)}</priority>
  </url>`).join('\n')}
</urlset>
`;
writeFileSync('public/sitemap.xml', xml);

// The profile page is per-player and already noindex; keep crawlers out of it.
writeFileSync('public/robots.txt', `User-agent: *
Allow: /
Disallow: /profile/

Sitemap: ${SITE}/sitemap.xml
`);

console.log(`sitemap.xml: ${paths.length} urls at ${SITE}`);
console.log('robots.txt written');
