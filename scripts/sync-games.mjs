// Generates functions/games.json (the server's board list and plausibility limits) from the game
// registry in public/shared/games.js. Runs automatically before `firebase deploy --only functions`;
// run it by hand after editing the registry to test with the emulators:  node scripts/sync-games.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const sandbox = {};
vm.runInNewContext(readFileSync(new URL('public/shared/games.js', root), 'utf8'), sandbox);
const { list } = sandbox.ArcadeGames;

const problems = [];
const seen = new Set();
const out = { games: [], timeGames: [], boards: {}, scoreCap: {}, minTime: {}, resumable: [] };
for (const g of list) {
  if (!/^[a-z0-9]+$/.test(g.id)) problems.push(`${g.id}: ids must be lowercase letters and digits`);
  if (!Array.isArray(g.scoreCap) || g.scoreCap.length !== 3) problems.push(`${g.id}: scoreCap must be [base, perSecond, perSecond²]`);
  if (!['score', 'time'].includes(g.type)) problems.push(`${g.id}: type must be 'score' or 'time'`);
  out.games.push(g.id);
  if (g.type === 'time') {
    out.timeGames.push(g.id);
    if (!g.dailyMinTime) problems.push(`${g.id}: time games need dailyMinTime`);
    else out.minTime[g.id] = g.dailyMinTime;
  }
  out.scoreCap[g.id] = g.scoreCap;
  for (const b of g.boards) {
    if (seen.has(b.id)) problems.push(`duplicate board ${b.id}`);
    seen.add(b.id);
    if (/^daily-/.test(b.id)) problems.push(`${b.id}: board ids may not start with daily-`);
    out.boards[b.id] = [g.id, b.group.toLowerCase(), b.type];
    if (b.type === 'time') {
      if (!b.minTime) problems.push(`${b.id}: time boards need minTime`);
      else out.minTime[b.id] = b.minTime;
    }
    if (b.resumable) out.resumable.push(b.id);
  }
}
if (problems.length) {
  console.error('games.js problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
writeFileSync(new URL('functions/games.json', root), JSON.stringify(out, null, 2) + '\n');
console.log(`functions/games.json: ${out.games.length} games, ${Object.keys(out.boards).length} boards`);
