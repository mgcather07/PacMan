// Rewrites the game table in README.md from the registry (public/shared/games.js).
// Run after adding a game:  node scripts/update-readme-games.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const sandbox = {};
vm.runInNewContext(readFileSync(new URL('public/shared/games.js', root), 'utf8'), sandbox);
const { list } = sandbox.ArcadeGames;

const CATS = { arcade: 'Arcade', puzzle: 'Puzzle', cards: 'Cards' };
const rows = list.map((g) => {
  const classic = g.boards.some((b) => b.group === 'Classic') ? (g.tagsClassic ? g.tagsClassic[0] : 'Yes') : '—';
  const infinite = g.tags[0];
  return `| ${g.icon} | [${g.name}](public${g.path}) | ${CATS[g.category] || g.category} | ${infinite} | ${classic} | ${g.daily} |`;
});
const table = [
  `**${list.length} games.** Every one has an endless Infinite mode, most have a Classic mode with an ending you can beat, and all of them have a daily challenge everyone plays from the same seed.`,
  '',
  '| | Game | Kind | Infinite | Classic | Daily challenge |',
  '|---|---|---|---|---|---|',
  ...rows,
].join('\n');

const p = new URL('README.md', root);
const md = readFileSync(p, 'utf8');
const start = '<!-- games:start -->';
const end = '<!-- games:end -->';
if (!md.includes(start)) throw new Error(`README.md is missing the ${start} marker`);
const out = md.slice(0, md.indexOf(start) + start.length) + '\n' + table + '\n' + md.slice(md.indexOf(end));
writeFileSync(p, out);
console.log(`README.md: ${list.length} games listed`);
