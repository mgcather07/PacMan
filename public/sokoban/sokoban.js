/*
 * Sokoban — Infinite (an endless ladder of generated warehouses), Classic (30 rooms) and the seeded Daily.
 * Generated rooms are built backwards from the solved position (crates start on the goals and are pulled
 * around), so the walk played in reverse is always a solution; a bounded A* then double-checks every room
 * and hands back the reference solution used for the move-efficiency bonus.
 */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, swipe, soundButton, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 600, FH = 840;                 // fixed play field, scaled to the window
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = (window.Daily && Daily.board('sokoban')) || (CLASSIC ? 'sokoban-classic' : 'sokoban');
  const HIGH_KEY = Arcade.modeKey('sokoban.high');
  const SKIPS = 3;                          // infinite: rooms you may walk away from
  const MOVE_T = 0.085;                     // one step of the slide animation
  const CLEAR_T = 1.15;                     // the level-complete flourish
  const BOARD_W = 552, BOARD_H = 590, BOARD_TOP = 168;

  // ---------------------------------------------------------------------------
  // Puzzle engine — grids, a bounded solver, and a generator that works backwards
  // (self-contained: no DOM and no Arcade, so tests can drive it on its own)
  // ---------------------------------------------------------------------------
  // Directions are indexed 0 right, 1 down, 2 left, 3 up — the order Arcade.swipe reports.
  // A level is flat w×h grids (wall / goal / dead), crate indexes and the player index. The outer ring is
  // always wall, so neighbour arithmetic never walks off the grid.
  function buildLevel(w, h, wall, goal, crates, player) {
    const size = w * h, D = [1, w, -1, -w];
    const floor = new Uint8Array(size);
    const stack = [player];
    floor[player] = 1;
    while (stack.length) {
      const p = stack.pop();
      for (let k = 0; k < 4; k++) {
        const q = p + D[k];
        if (wall[q] || floor[q]) continue;
        floor[q] = 1;
        stack.push(q);
      }
    }
    for (let i = 0; i < size; i++) if (!floor[i]) wall[i] = 1;   // anything the player can't reach is outside
    // squares a crate can never leave again: a non-goal corner
    const dead = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      if (wall[i] || goal[i]) continue;
      if ((wall[i - w] || wall[i + w]) && (wall[i - 1] || wall[i + 1])) dead[i] = 1;
    }
    const lv = { w, h, wall, goal, dead, floor, crates: crates.slice(), player, D };
    lv.hmap = goalDistances(lv);
    lv.goalMaps = goalMaps(lv);
    return lv;
  }

  // one distance map per goal, and the cheapest way to hand every crate its own goal. Pushing a crate can
  // never be cheaper than walking it there, so this matching is a lower bound on the room's push count.
  function goalMaps(lv) {
    const { wall, goal, D } = lv;
    const maps = [];
    for (let g = 0; g < wall.length; g++) {
      if (!goal[g] || wall[g]) continue;
      const dist = new Int32Array(wall.length).fill(1e6);
      dist[g] = 0;
      const q = [g];
      for (let head = 0; head < q.length; head++) {
        const p = q[head];
        for (let k = 0; k < 4; k++) {
          const n = p + D[k];
          if (wall[n] || dist[n] <= dist[p] + 1) continue;
          dist[n] = dist[p] + 1;
          q.push(n);
        }
      }
      maps.push(dist);
    }
    return maps;
  }

  function matchCost(lv, crates) {
    const maps = lv.goalMaps;
    const n = Math.min(crates.length, maps.length);
    const used = new Array(maps.length).fill(false);
    let bestCost = Infinity;
    (function walk(i, sum) {
      if (sum >= bestCost) return;                 // the permutations are few, but prune anyway
      if (i === n) { bestCost = sum; return; }
      for (let j = 0; j < maps.length; j++) {
        if (used[j]) continue;
        used[j] = true;
        walk(i + 1, sum + Math.min(maps[j][crates[i]], 999));
        used[j] = false;
      }
    })(0, 0);
    return bestCost === Infinity ? 0 : bestCost;
  }

  // steps from every square to the nearest goal, ignoring crates (an admissible push heuristic)
  function goalDistances(lv) {
    const { wall, goal, D } = lv;
    const dist = new Int32Array(wall.length).fill(1e6);
    const q = [];
    for (let i = 0; i < wall.length; i++) if (goal[i] && !wall[i]) { dist[i] = 0; q.push(i); }
    for (let head = 0; head < q.length; head++) {
      const p = q[head];
      for (let k = 0; k < 4; k++) {
        const n = p + D[k];
        if (wall[n] || dist[n] <= dist[p] + 1) continue;
        dist[n] = dist[p] + 1;
        q.push(n);
      }
    }
    return dist;
  }

  // classic Sokoban notation: # wall, . goal, $ crate, * crate on goal, @ player, + player on goal
  function parseLevel(text) {
    const rows = String(text).replace(/^\n+|\n+$/g, '').split('\n');
    const iw = Math.max(...rows.map((r) => r.length));
    const w = iw + 2, h = rows.length + 2, size = w * h;
    const wall = new Uint8Array(size), goal = new Uint8Array(size);
    const crates = [];
    let player = 0;
    for (let x = 0; x < w; x++) { wall[x] = 1; wall[size - 1 - x] = 1; }
    for (let y = 0; y < h; y++) { wall[y * w] = 1; wall[y * w + w - 1] = 1; }
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < iw; x++) {
        const ch = rows[y][x] || ' ';
        const i = (y + 1) * w + x + 1;
        if (ch === '#') wall[i] = 1;
        if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
        if (ch === '$' || ch === '*') crates.push(i);
        if (ch === '@' || ch === '+') player = i;
      }
    }
    return buildLevel(w, h, wall, goal, crates, player);
  }

  function levelToString(lv, crates, player) {
    const set = new Set(crates || lv.crates);
    const p = player === undefined ? lv.player : player;
    const rows = [];
    for (let y = 0; y < lv.h; y++) {
      let row = '';
      for (let x = 0; x < lv.w; x++) {
        const i = y * lv.w + x, g = lv.goal[i];
        row += lv.wall[i] ? '#' : i === p ? (g ? '+' : '@') : set.has(i) ? (g ? '*' : '$') : g ? '.' : ' ';
      }
      rows.push(row);
    }
    return rows.join('\n');
  }

  // Bounded A* over pushes. A state is (crate positions + the region the player stands in); the score is
  // pushes so far plus the sum of every crate's distance to the nearest goal.
  function solveLevel(lv, budget = 60000) {
    const { wall, goal, dead, hmap, D } = lv;
    const size = wall.length;
    const occ = new Uint8Array(size);
    const vis = new Int32Array(size);      // stamped with a generation, so no clearing between floods
    const stack = new Int32Array(size);
    const reach = new Uint8Array(size);
    let gen = 0;
    const nodes = [];
    const f = [];
    const heap = [];
    const seen = new Set();

    const setOcc = (crates) => { occ.fill(0); for (let i = 0; i < crates.length; i++) occ[crates[i]] = 1; };

    // every square the player can walk to, signed by its lowest index
    function flood(from) {
      const g = ++gen;
      let sp = 0, min = from;
      vis[from] = g;
      stack[sp++] = from;
      while (sp) {
        const p = stack[--sp];
        if (p < min) min = p;
        for (let k = 0; k < 4; k++) {
          const q = p + D[k];
          if (wall[q] || occ[q] || vis[q] === g) continue;
          vis[q] = g;
          stack[sp++] = q;
        }
      }
      return min;
    }

    // a 2×2 block of walls and crates can never move again
    function frozen(i) {
      const w = lv.w;
      const blocked = (p) => wall[p] || occ[p];
      for (let c = 0; c < 4; c++) {
        const a = i + (c < 2 ? -w : 0) + (c % 2 ? 0 : -1), b = a + 1, e = a + w, g = e + 1;
        if (blocked(a) && blocked(b) && blocked(e) && blocked(g)) {
          if ((occ[a] && !goal[a]) || (occ[b] && !goal[b]) || (occ[e] && !goal[e]) || (occ[g] && !goal[g])) return true;
        }
      }
      return false;
    }

    function hpush(id) {
      heap.push(id);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (f[heap[p]] <= f[heap[c]]) break;
        const t = heap[p]; heap[p] = heap[c]; heap[c] = t;
        c = p;
      }
    }
    function hpop() {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let p = 0; ;) {
          const l = p * 2 + 1, r = l + 1;
          let m = p;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === p) break;
          const t = heap[p]; heap[p] = heap[m]; heap[m] = t;
          p = m;
        }
      }
      return top;
    }

    const hOf = (cr) => { let s = 0; for (let i = 0; i < cr.length; i++) s += hmap[cr[i]]; return s; };
    function add(crates, player, g, parent, from, to) {
      const id = nodes.length;
      nodes.push({ crates, player, g, parent, from, to });
      f[id] = g + hOf(crates);
      hpush(id);
    }

    // the shortest walk between two squares under the current crates, as direction indexes
    function walkPath(from, to) {
      if (from === to) return [];
      const prev = new Int32Array(size).fill(-1);
      const dir = new Int8Array(size).fill(-1);
      const q = [from];
      prev[from] = from;
      for (let head = 0; head < q.length; head++) {
        const p = q[head];
        for (let k = 0; k < 4; k++) {
          const n = p + D[k];
          if (wall[n] || occ[n] || prev[n] !== -1) continue;
          prev[n] = p;
          dir[n] = k;
          if (n === to) {
            const out = [];
            for (let c = to; c !== from; c = prev[c]) out.push(dir[c]);
            return out.reverse();
          }
          q.push(n);
        }
      }
      return null;
    }

    // walk the chain of pushes back to the start and fill in the player's walks between them
    function rebuild(id) {
      const chain = [];
      for (let n = id; n !== -1; n = nodes[n].parent) chain.push(n);
      chain.reverse();
      const moves = [];
      let player = lv.player;
      for (let i = 1; i < chain.length; i++) {
        const nd = nodes[chain[i]];
        const d = nd.to - nd.from;
        setOcc(nodes[chain[i - 1]].crates);
        const path = walkPath(player, nd.from - d);
        if (!path) return null;
        for (let j = 0; j < path.length; j++) moves.push(path[j]);
        moves.push(D.indexOf(d));
        player = nd.from;
      }
      return moves;
    }

    // state keys: crate indexes plus the player's region, packed into a short string
    const keyOf = (cr, norm) => String.fromCharCode.apply(null, cr) + String.fromCharCode(norm);
    const start = lv.crates.slice().sort((a, b) => a - b);
    setOcc(start);
    add(start, flood(lv.player), 0, -1, 0, 0);
    seen.add(keyOf(start, nodes[0].player));

    let expansions = 0;
    while (heap.length) {
      if (++expansions > budget) return null;
      const id = hpop();
      const nd = nodes[id];
      const cr = nd.crates;
      if (cr.every((c) => goal[c])) {
        const moves = rebuild(id);
        return moves ? { pushes: nd.g, moves, nodes: expansions } : null;
      }
      setOcc(cr);
      flood(nd.player);
      for (let i = 0; i < size; i++) reach[i] = vis[i] === gen ? 1 : 0;
      for (let ci = 0; ci < cr.length; ci++) {
        const c = cr[ci];
        for (let k = 0; k < 4; k++) {
          const to = c + D[k], from = c - D[k];
          if (wall[to] || occ[to] || dead[to]) continue;
          if (wall[from] || occ[from] || !reach[from]) continue;
          occ[c] = 0; occ[to] = 1;
          const stuck = frozen(to);
          const norm = stuck ? 0 : flood(c);
          occ[c] = 1; occ[to] = 0;
          if (stuck) continue;
          const next = cr.slice();
          next[ci] = to;
          next.sort((a, b) => a - b);
          const key = keyOf(next, norm);
          if (seen.has(key)) continue;
          seen.add(key);
          add(next, norm, nd.g + 1, id, c, to);
        }
      }
    }
    return null;
  }

  // a room of random walls with every floor square connected
  function carveRoom(spec, rnd) {
    const { w, h } = spec;
    const size = w * h;
    const wall = new Uint8Array(size);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
    const inner = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) inner.push(y * w + x);
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    let added = 0;
    for (let guard = 0; added < spec.walls && guard < 300; guard++) {
      const i = pick(inner);
      if (wall[i]) continue;
      wall[i] = 1;
      if (connected(w, wall, inner)) added++; else wall[i] = 0;
    }
    const open = inner.filter((i) => !wall[i]);
    if (open.length < spec.crates * 5 + 4) return null;
    const corner = (i) => (wall[i - w] || wall[i + w]) && (wall[i - 1] || wall[i + 1]);
    const goal = new Uint8Array(size);
    const crates = [];
    // goals sit apart and never in a corner: a crate in a corner could not be pulled out again
    for (let guard = 0; crates.length < spec.crates && guard < 400; guard++) {
      const i = pick(open);
      if (goal[i] || corner(i)) continue;
      if (crates.some((c) => Math.abs((c % w) - (i % w)) + Math.abs(((c / w) | 0) - ((i / w) | 0)) < 2)) continue;
      goal[i] = 1;
      crates.push(i);
    }
    if (crates.length < spec.crates) return null;
    let player = pick(open);
    for (let guard = 0; goal[player] && guard < 200; guard++) player = pick(open);
    if (goal[player]) return null;
    return buildLevel(w, h, wall, goal, crates, player);
  }

  function connected(w, wall, inner) {
    const open = inner.filter((i) => !wall[i]);
    if (!open.length) return false;
    const seen = new Set([open[0]]);
    const stack = [open[0]];
    const D = [1, w, -1, -w];
    while (stack.length) {
      const p = stack.pop();
      for (let k = 0; k < 4; k++) {
        const q = p + D[k];
        if (wall[q] || seen.has(q)) continue;
        seen.add(q);
        stack.push(q);
      }
    }
    return seen.size === open.length;
  }

  // Play the room backwards: the crates start on the goals and the player *pulls* them away in short
  // runs. Every arrangement reached this way can be pushed back to the solved one, so the deepest
  // arrangement found is a puzzle that is solvable by construction.
  function pullBack(lv, spec, rnd) {
    const { wall, goal, hmap, D } = lv;
    const size = wall.length;
    const occ = new Uint8Array(size);
    const vis = new Uint8Array(size);
    let crates = lv.crates.slice();
    let player = lv.player;
    for (const c of crates) occ[c] = 1;
    let best = null, bestScore = -1, any = null, anyScore = -1;
    let lastCrate = -1, lines = 0, changes = 0, pulled = 0;

    // where the player could walk to right now (crates block the way)
    function reach(from) {
      vis.fill(0);
      const stack = [from];
      vis[from] = 1;
      while (stack.length) {
        const p = stack.pop();
        for (let k = 0; k < 4; k++) {
          const q = p + D[k];
          if (wall[q] || occ[q] || vis[q]) continue;
          vis[q] = 1;
          stack.push(q);
        }
      }
    }

    for (let s = 0; s < spec.pulls; s++) {
      reach(player);
      // every crate that can be pulled, and the direction the player would back away in
      const options = [];
      for (let ci = 0; ci < crates.length; ci++) {
        const c = crates[ci];
        for (let k = 0; k < 4; k++) {
          const stand = c + D[k], back = stand + D[k];
          if (wall[stand] || occ[stand] || !vis[stand]) continue;
          if (wall[back] || occ[back]) continue;
          options.push([ci, k]);
        }
      }
      if (!options.length) break;
      const [ci, k] = options[Math.floor(rnd() * options.length)];
      let c = crates[ci];
      player = c + D[k];                       // the player can always walk there: it was reachable
      lines++;
      if (ci !== lastCrate) { changes++; lastCrate = ci; }
      const run = 1 + Math.floor(rnd() * 3);   // drag it a little way in one direction
      for (let n = 0; n < run; n++) {
        const back = player + D[k];
        if (wall[back] || occ[back]) break;
        occ[c] = 0;
        occ[player] = 1;
        crates[ci] = player;
        c = player;
        player = back;
        pulled++;
      }
      let off = 0;
      for (const cc of crates) if (!goal[cc]) off++;
      // the matching is the honest measure of how much work is left; the rest is flavour
      const score = matchCost(lv, crates) * 6 + lines * 2 + changes * 3;
      const all = off === crates.length;          // a room where nothing starts delivered reads better
      if (score > (all ? bestScore : anyScore)) {
        const snap = { crates: crates.slice(), player, pulls: pulled };
        if (all) { bestScore = score; best = snap; } else { anyScore = score; any = snap; }
      }
    }
    best = best || any;
    if (!best || best.crates.every((c) => goal[c])) return null;
    const out = buildLevel(lv.w, lv.h, lv.wall.slice(), lv.goal.slice(), best.crates, best.player);
    out.pulls = best.pulls;
    out.bound = matchCost(out, best.crates);      // the guaranteed floor under the room's push count
    return out;
  }

  // spec: { w, h, crates, walls, pulls, minPushes, mul, budget, solves }
  // Rooms that were not dragged far enough are thrown away before the solver ever sees them, so the
  // expensive check only runs on candidates that look deep.
  function generateLevel(spec, rnd, tries = 40) {
    const maxSolves = spec.solves || 6;
    let solves = 0, fallback = null;
    for (let attempt = 0; attempt < tries && solves < maxSolves; attempt++) {
      const room = carveRoom(spec, rnd);
      if (!room) continue;
      const puz = pullBack(room, spec, rnd);
      if (!puz) continue;
      if (spec.minPushes && puz.bound < spec.minPushes) continue;   // provably too easy: skip the solver
      // a room reads better when nothing starts delivered; only settle for one late on
      if (attempt < tries - 6 && puz.crates.some((c) => puz.goal[c])) continue;
      solves++;
      const sol = solveLevel(puz, spec.budget || 60000);     // the second opinion: no solution, no room
      if (!sol) continue;
      puz.solution = sol.moves;
      puz.pushes = sol.pushes;
      puz.spec = spec;
      if (!spec.minPushes || sol.pushes >= spec.minPushes) return puz;
      if (!fallback || sol.pushes > fallback.pushes) fallback = puz;   // keep the hardest near-miss
    }
    return fallback;
  }

  // ---------------------------------------------------------------------------
  // Levels — the classic ladder and the generated ones
  // ---------------------------------------------------------------------------
  // The thirty Classic rooms, in classic Sokoban notation: # wall, . goal, $ crate, * crate on goal,
  // @ player, + player on goal. Difficulty rises from a single push to a twenty-push tangle, and every
  // room was checked by solveLevel before it shipped (the counts are its optimal push / move totals).
  const CLASSIC_LEVELS = [
    // 1 · 1 pushes / 1 moves
    [
      '#######',
      '#     #',
      '#  @  #',
      '#  $  #',
      '#  .  #',
      '#     #',
      '#######',
    ].join('\n'),
    // 2 · 4 pushes / 30 moves
    [
      '#######',
      '# . # #',
      '# @ $ #',
      '# $.  #',
      '#  #  #',
      '#     #',
      '#######',
    ].join('\n'),
    // 3 · 7 pushes / 25 moves
    [
      '#######',
      '#   @ #',
      '#  $$ #',
      '#  #  #',
      '#.    #',
      '# # . #',
      '#######',
    ].join('\n'),
    // 4 · 6 pushes / 21 moves
    [
      '#######',
      '# #  ##',
      '#   $@#',
      '# .   #',
      '#.  $ #',
      '#     #',
      '#######',
    ].join('\n'),
    // 5 · 6 pushes / 35 moves
    [
      '#######',
      '#  .  #',
      '#    .#',
      '#@$ # #',
      '##  $ #',
      '#     #',
      '#######',
    ].join('\n'),
    // 6 · 8 pushes / 25 moves
    [
      '########',
      '# .    #',
      '# # +$ #',
      '### $#.#',
      '#      #',
      '#  $   #',
      '#     ##',
      '########',
    ].join('\n'),
    // 7 · 9 pushes / 34 moves
    [
      '########',
      '##     #',
      '# $  # #',
      '#  ## .#',
      '# $  . #',
      '#     $#',
      '# .  #@#',
      '########',
    ].join('\n'),
    // 8 · 10 pushes / 45 moves
    [
      '########',
      '#    . #',
      '## $ $##',
      '# ##   #',
      '#@$  . #',
      '##    .#',
      '#      #',
      '########',
    ].join('\n'),
    // 9 · 12 pushes / 43 moves
    [
      '########',
      '#      #',
      '# ## .$#',
      '##  #  #',
      '# $   .#',
      '#@$  . #',
      '# #    #',
      '########',
    ].join('\n'),
    // 10 · 11 pushes / 46 moves
    [
      '#########',
      '# ##    #',
      '#  .$@# #',
      '#    .  #',
      '##$#.   #',
      '##      #',
      '# $ #   #',
      '#    #  #',
      '#########',
    ].join('\n'),
    // 11 · 12 pushes / 51 moves
    [
      '#########',
      '#   $.  #',
      '# # $ # #',
      '#  .    #',
      '#      ##',
      '#     $ #',
      '### # @##',
      '#  .   ##',
      '#########',
    ].join('\n'),
    // 12 · 13 pushes / 47 moves
    [
      '#########',
      '# #     #',
      '# @$ #  #',
      '# # $   #',
      '## #  # #',
      '#    ## #',
      '#   . . #',
      '#    .$ #',
      '#########',
    ].join('\n'),
    // 13 · 15 pushes / 98 moves
    [
      '#########',
      '# ##    #',
      '#    . ##',
      '# $     #',
      '# @#  # #',
      '# # ##  #',
      '# $  $  #',
      '#  . .  #',
      '#########',
    ].join('\n'),
    // 14 · 13 pushes / 55 moves
    [
      '##########',
      '## . ##@ #',
      '#      $##',
      '# # #$#  #',
      '#      . #',
      '#   #    #',
      '##     $*#',
      '## .     #',
      '##########',
    ].join('\n'),
    // 15 · 13 pushes / 61 moves
    [
      '##########',
      '#  .     #',
      '#   #  # #',
      '#.$ #    #',
      '#   ##$$ #',
      '##.   @ .#',
      '#    $## #',
      '##  #    #',
      '##########',
    ].join('\n'),
    // 16 · 14 pushes / 62 moves
    [
      '##########',
      '#  #     #',
      '#  ##  $ #',
      '#.#    # #',
      '#$.@ #$ ##',
      '#  $     #',
      '##  .   .#',
      '##     # #',
      '##########',
    ].join('\n'),
    // 17 · 15 pushes / 57 moves
    [
      '##########',
      '###  .  ##',
      '# #  # #@#',
      '#  #$   $#',
      '#    $ $.#',
      '#  #     #',
      '#.# .    #',
      '#      # #',
      '##########',
    ].join('\n'),
    // 18 · 14 pushes / 88 moves
    [
      '##########',
      '#    # # #',
      '#.    .$ #',
      '# .      #',
      '##    ####',
      '#  $ ## ##',
      '#    $@ ##',
      '##  $ .  #',
      '#     #  #',
      '##########',
    ].join('\n'),
    // 19 · 15 pushes / 65 moves
    [
      '##########',
      '#     .  #',
      '# # $$ ###',
      '#  .   . #',
      '# $  # ###',
      '###    @ #',
      '# ##   $ #',
      '#.       #',
      '#   #  # #',
      '##########',
    ].join('\n'),
    // 20 · 17 pushes / 83 moves
    [
      '##########',
      '#        #',
      '##  $.# ##',
      '#     .$@#',
      '#.$# #  ##',
      '#   #    #',
      '# #      #',
      '# $ # # .#',
      '#  #  #  #',
      '##########',
    ].join('\n'),
    // 21 · 16 pushes / 75 moves
    [
      '##########',
      '#  ##    #',
      '# $# $ . #',
      '#     #$ #',
      '#      @ #',
      '#  #  #$ #',
      '##    .  #',
      '##  .#  .#',
      '#  #  ## #',
      '##########',
    ].join('\n'),
    // 22 · 17 pushes / 151 moves
    [
      '###########',
      '#    .   ##',
      '#.  # $ ###',
      '# #   ##  #',
      '#  #  $  .#',
      '#   # # # #',
      '# #    ## #',
      '#   .     #',
      '# $ #   $@#',
      '#         #',
      '###########',
    ].join('\n'),
    // 23 · 16 pushes / 98 moves
    [
      '###########',
      '#         #',
      '##   $    #',
      '## $@.#.# #',
      '##  $    ##',
      '#  # # #  #',
      '#     ##. #',
      '# #   #   #',
      '# ## $.   #',
      '#         #',
      '###########',
    ].join('\n'),
    // 24 · 21 pushes / 89 moves
    [
      '###########',
      '#   @     #',
      '# $ $   #.#',
      '##     ## #',
      '##        #',
      '#   .     #',
      '##### #   #',
      '##  #  # .#',
      '#   .  $$ #',
      '#  # #    #',
      '###########',
    ].join('\n'),
    // 25 · 15 pushes / 59 moves
    [
      '###########',
      '#  ## .   #',
      '## .    $ #',
      '#         #',
      '# #    $  #',
      '## #   @$ #',
      '## ##  #. #',
      '#    #    #',
      '##      $ #',
      '#   .  ####',
      '###########',
    ].join('\n'),
    // 26 · 22 pushes / 155 moves
    [
      '############',
      '#  @ ##  # #',
      '###$       #',
      '# # #      #',
      '#      . $ #',
      '#   .   #$ #',
      '#   # .    #',
      '#      #$$ #',
      '#   .##    #',
      '#    ## .# #',
      '# ##  #    #',
      '############',
    ].join('\n'),
    // 27 · 19 pushes / 117 moves
    [
      '############',
      '#  .@      #',
      '#   $ . # ##',
      '## . #     #',
      '#         ##',
      '## # $ # # #',
      '#    #     #',
      '##$ #   # ##',
      '#   #   #  #',
      '##.$#    $ #',
      '#        . #',
      '############',
    ].join('\n'),
    // 28 · 21 pushes / 142 moves
    [
      '############',
      '#  # #     #',
      '#  #    #  #',
      '## #       #',
      '## $ #  #  #',
      '#    @    .#',
      '####.$#  # #',
      '##    #  # #',
      '# $  .  .  #',
      '# $  #  $  #',
      '#        . #',
      '############',
    ].join('\n'),
    // 29 · 19 pushes / 122 moves
    [
      '############',
      '# @#  ###  #',
      '# $ #      #',
      '#        ###',
      '# . #  #   #',
      '#.  #  # # #',
      '#    # #$# #',
      '##    .   ##',
      '#       #$ #',
      '# $    $   #',
      '# .     .  #',
      '############',
    ].join('\n'),
    // 30 · 21 pushes / 116 moves
    [
      '############',
      '#   .      #',
      '# #. # .   #',
      '#          #',
      '#          #',
      '# #*   #$###',
      '# $ #  #  ##',
      '#     $    #',
      '# ##    # ##',
      '## ###    ##',
      '#    .   $@#',
      '############',
    ].join('\n'),
  ];

  // ...and the solver's own answer to each one, as direction digits (0 right, 1 down, 2 left, 3 up).
  // It is the yardstick for the move-efficiency bonus, and what ArcadeTest.solve() replays.
  const CLASSIC_SOLUTIONS = [
    '1', // 1
    '010032111222330110033323221103', // 2
    '1132321130001112232330011', // 3
    '122330101120321220032', // 4
    '30011022301010322233011003122232330', // 5
    '0301222110112333303211103', // 6
    '3222223301100033033222211210001003', // 7
    '010033330112332210300112311012223003323010101', // 8
    '3021002300211000333213330112122110033312210', // 9
    '1112223100332322101101123333230100100033322211', // 10
    '332332122233001111003333001121222333011112130003322', // 11
    '01023301111210023333300011111120333322033221111', // 12
    '21110003010033212122223000222333300000101111220033332222322111100001003321212030012322222330323000', // 13
    '1101122233101003323222011011100322321012232333300001011', // 14
    '0011222310003322212233320111003200302331003322220000111212222', // 15
    '21230001203300101122303333001232111012122223001003201022223301', // 16
    '122112233310012030121100322322220033230111223211030001012', // 17
    '1212233033030003212212112331111003032112230233033211110322333011103233320001122123001110', // 18
    '23333221010322210021100001232222332210300112301001012222200333300', // 19
    '21112222121233100300003333322110233001111210222232323003021002221101122330010000301', // 20
    '103332232111222233301210010033210100312213321113030001112230332212103300011', // 21
    '3222233302111112223030033300221101011032223333000222111222123310000333333001232221100111010100321222333333111112222333010100011003223222322331010100012', // 22
    '12230121100110232323303300021122211000110010303323322233030122112113323011121030121100003311222230', // 23
    '22210100011110110032003322322333321321130121000002222221030000011101122301032222000330333', // 24
    '21100012222122330100000333322003322112212300331221230000011', // 25
    '01000000112011112231003322200033213322111232333232100000001111220333221122101203303300111223223332211000030012322122221030001010010123213323221121223301210', // 26
    '211011030332200010111223221221030300111112223332333001121233100333332101111223333230100110103311221212101100000003321', // 27
    '2223010111112223023000221030303230112121100003333332322130001111111222233030330002221121022110310003303330222332211011102322101100330101003321', // 28
    '21100111111123333032010100000132223333001113332211111110000332122222000003323333222222233011000000111121122223210000000012', // 29
    '23332331011112322333331110110123233333311110111233223233112230100003333303211112223300033201111112223100000333032123', // 30
  ];

  // small 7×7 two-crate rooms up to big 12×12 five-crate ones
  const LADDER = [
    { w: 7, h: 7, crates: 2, walls: 2, pulls: 6, minPushes: 4, mul: 1 },
    { w: 8, h: 7, crates: 2, walls: 4, pulls: 8, minPushes: 5, mul: 1 },
    { w: 8, h: 8, crates: 3, walls: 5, pulls: 10, minPushes: 6, mul: 2 },
    { w: 9, h: 8, crates: 3, walls: 7, pulls: 12, minPushes: 7, mul: 2 },
    { w: 9, h: 9, crates: 3, walls: 9, pulls: 14, minPushes: 8, mul: 3 },
    { w: 10, h: 9, crates: 4, walls: 10, pulls: 16, minPushes: 9, mul: 3 },
    { w: 10, h: 10, crates: 4, walls: 12, pulls: 18, minPushes: 10, mul: 4, budget: 40000 },
    { w: 11, h: 10, crates: 4, walls: 14, pulls: 20, minPushes: 11, mul: 4, budget: 40000 },
    { w: 11, h: 11, crates: 5, walls: 16, pulls: 22, minPushes: 12, mul: 5, budget: 30000 },
    { w: 12, h: 12, crates: 5, walls: 19, pulls: 24, minPushes: 13, mul: 5, budget: 30000 },
  ];
  const DAILY_SPEC = { w: 10, h: 9, crates: 4, walls: 10, pulls: 16, minPushes: 10, mul: 3 };

  function specFor(n) {
    const base = LADDER[Math.min(n, LADDER.length) - 1];
    if (n <= LADDER.length) return base;
    const over = n - LADDER.length;
    return Object.assign({}, base, {
      pulls: base.pulls + Math.min(over, 8),
      minPushes: base.minPushes + Math.min(over, 6),
    });
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  let scale = 1, offX = 0, offY = 0, sky = null;
  const view = setupCanvas(canvas, (v) => {
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
    sky = null;
  });
  const ctx = view.ctx;

  let wrand = Math.random;
  let state = 'title', paused = false;
  let cur = null, crates = [], player = 0, face = 1;
  let undoStack = [], moves = 0, pushes = 0, undos = 0, totalMoves = 0;
  let score = 0, levelNo = 1, time = 0, levelTime = 0, par = 30, limit = 0, skips = SKIPS;
  let anim = null, parts = [], banner = null, solvedT = 0, shake = 0, hint = 0;
  let wonRun = false, posted = false, playedLogged = false;
  let high = store.get(HIGH_KEY, 0);
  let TILE = 40, BX = 0, BY = 0;

  let attractT = 0, attractI = 0;

  const xOf = (i) => i % cur.w, yOf = (i) => (i / cur.w) | 0;
  const onGoal = (i) => !!cur.goal[i];
  const solved = () => crates.every((c) => cur.goal[c]);
  const cratesHome = () => crates.reduce((n, c) => n + (cur.goal[c] ? 1 : 0), 0);

  function layout() {
    TILE = Math.floor(Math.min(BOARD_W / cur.w, BOARD_H / cur.h));
    BX = Math.round((FW - TILE * cur.w) / 2);
    BY = Math.round(BOARD_TOP + (BOARD_H - TILE * cur.h) / 2);
  }

  // Building a big room costs a moment, so the next one is built quietly while the player thinks
  // about this one and is waiting by the time they clear it.
  const specKey = (s) => s.w + 'x' + s.h + ':' + s.crates + ':' + s.pulls + ':' + s.minPushes;
  let pending = null, pendingTimer = 0;
  function preGenerate() {
    if (CLASSIC || DAILY) return;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (state !== 'play' || pending) return;
      const spec = specFor(levelNo + 1);
      const lv = generateLevel(spec, wrand);
      if (lv) pending = { key: specKey(spec), lv };
    }, 700);
  }

  // a Classic room comes with the solver's own answer, so nothing has to be solved at load time
  function classicLevel(i, mul) {
    const lv = parseLevel(CLASSIC_LEVELS[i]);
    lv.solution = (CLASSIC_SOLUTIONS[i] || '').split('').map(Number);
    lv.spec = { mul: mul || 1 };
    return lv;
  }

  function loadLevel(n) {
    levelNo = n;
    let lv = null;
    if (CLASSIC) {
      lv = classicLevel(Math.min(n, CLASSIC_LEVELS.length) - 1, Math.min(5, 1 + Math.floor((n - 1) / 6)));
    } else if (DAILY) {
      lv = generateLevel(DAILY_SPEC, wrand) || classicLevel(11, 3);
      if (!lv.spec) lv.spec = DAILY_SPEC;
    } else {
      const spec = specFor(n);
      if (pending && pending.key === specKey(spec)) lv = pending.lv;
      else lv = generateLevel(spec, wrand) || generateLevel(LADDER[0], wrand) || classicLevel(0, 1);
      pending = null;
      if (!lv.spec) lv.spec = spec;
    }
    if (!lv.solution || !lv.solution.length) {
      const sol = solveLevel(lv, 150000);
      lv.solution = sol ? sol.moves : null;
    }
    cur = lv;
    crates = lv.crates.slice();
    player = lv.player;
    face = 1;
    moves = 0; pushes = 0; levelTime = 0;
    undoStack = [];
    anim = null; banner = null; solvedT = 0;
    const ref = (cur.solution && cur.solution.length) || 40;
    par = 10 + ref * 0.9;
    limit = CLASSIC || DAILY ? 0 : Math.round(par * 2.4);
    hint = levelNo === 1 ? 4 : 0;
    layout();
    preGenerate();
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('sokoban') : Math.random;
    score = 0; time = 0; totalMoves = 0; undos = 0; skips = SKIPS;
    wonRun = false; posted = false; playedLogged = false;
    parts = []; shake = 0;
    pending = null;
    clearTimeout(pendingTimer);
    loadLevel(1);
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
    // the room is built before the player touches anything, so the play is counted on the first move
    if (window.Leaderboard) Leaderboard.startRun(BOARD, { play: false });
  }

  // ---------------------------------------------------------------------------
  // Moving, undo and reset
  // ---------------------------------------------------------------------------
  function applyMove(k, instant) {
    const from = player, to = from + cur.D[k];
    face = k;
    if (cur.wall[to]) {
      Sound.noise(0.05, 0.03, 0, 320);
      shake = Math.max(shake, 0.12);
      return null;
    }
    const ci = crates.indexOf(to);
    let rec = null;
    if (ci >= 0) {
      const beyond = to + cur.D[k];
      if (cur.wall[beyond] || crates.includes(beyond)) {
        Sound.noise(0.05, 0.03, 0, 320);
        shake = Math.max(shake, 0.12);
        return null;
      }
      const wasHome = onGoal(to);
      crates[ci] = beyond;
      player = to;
      rec = { player: from, ci, crate: to };
      if (!instant) {
        anim = { t: 0, from, to, ci, cFrom: to, cTo: beyond };
        if (onGoal(beyond)) thunk(beyond);
        else Sound.tone(150, 90, 0.09, 'triangle', 0.035);
        if (wasHome && !onGoal(beyond)) Sound.tone(220, 160, 0.07, 'sine', 0.02);
      }
    } else {
      player = to;
      rec = { player: from, ci: -1 };
      if (!instant) {
        anim = { t: 0, from, to, ci: -1 };
        Sound.tone(520, 470, 0.035, 'sine', 0.012);
      }
    }
    if (instant) anim = null;
    return rec;
  }

  // the satisfying part: a crate settling onto a goal pad
  function thunk(i) {
    Sound.tone(90, 55, 0.18, 'sine', 0.075);
    Sound.noise(0.12, 0.06, 0, 700);
    Sound.tone(660, 990, 0.1, 'triangle', 0.025, 0.02);
    burst(BX + (xOf(i) + 0.5) * TILE, BY + (yOf(i) + 0.5) * TILE, '#8bd450', 10, 130);
    shake = Math.max(shake, 0.22);
  }

  function tryMove(k, instant) {
    if (state !== 'play' || paused || solvedT > 0 || !(k >= 0 && k < 4)) return false;
    const rec = applyMove(k, instant);
    if (!rec) return false;
    undoStack.push(rec);
    moves++;
    totalMoves++;
    if (rec.ci >= 0) pushes++;
    hint = 0;
    if (!playedLogged) {
      playedLogged = true;
      if (window.Leaderboard) Leaderboard.played(BOARD);
    }
    if (solved()) levelClear();
    return true;
  }

  function undo() {
    if (state !== 'play' || paused || solvedT > 0) return false;
    const rec = undoStack.pop();
    if (!rec) { toast('Nothing to undo'); return false; }
    if (rec.ci >= 0) crates[rec.ci] = rec.crate;
    player = rec.player;
    moves = Math.max(0, moves - 1);
    if (rec.ci >= 0) pushes = Math.max(0, pushes - 1);
    undos++;
    anim = null;
    Sound.tone(620, 300, 0.1, 'triangle', 0.028);
    return true;
  }

  function resetLevel(quiet) {
    if (state !== 'play' && !quiet) return;
    crates = cur.crates.slice();
    player = cur.player;
    face = 1;
    undoStack = [];
    moves = 0; pushes = 0;
    anim = null; solvedT = 0; banner = null;
    if (!quiet) {
      Sound.arp([440, 330, 262], 0.06, 'triangle', 0.03);
      toast('Room reset');
    }
  }

  // ---------------------------------------------------------------------------
  // Scoring and the run
  // ---------------------------------------------------------------------------
  const mulOf = () => (cur.spec && cur.spec.mul) || 1;

  function levelClear() {
    const mul = mulOf();
    const base = 500 * mul;
    const ref = (cur.solution && cur.solution.length) || moves;
    const eff = Math.round(base * 0.6 * clamp(ref / Math.max(moves, 1), 0, 1));
    const fast = Math.round(base * 0.4 * clamp(1 - levelTime / par, 0, 1));
    const gain = base + eff + fast;
    score += gain;
    banner = {
      text: CLASSIC && levelNo >= CLASSIC_LEVELS.length ? 'ALL CLEAR' : 'ROOM CLEAR',
      sub: '+' + gain.toLocaleString() + (eff ? ' · ' + Math.round((ref / Math.max(moves, 1)) * 100) + '% EFFICIENT' : ''),
      t: 0,
    };
    solvedT = CLEAR_T;
    for (const c of crates) burst(BX + (xOf(c) + 0.5) * TILE, BY + (yOf(c) + 0.5) * TILE, '#8bd450', 14, 220);
    Sound.arp([523, 659, 784, 1046], 0.075, 'square', 0.045);
    Sound.tone(110, 82, 0.3, 'sine', 0.05, 0.02);
  }

  function advance() {
    solvedT = 0;
    if (DAILY) { endGame(true); return; }
    if (CLASSIC && levelNo >= CLASSIC_LEVELS.length) { wonRun = true; endGame(true); return; }
    loadLevel(levelNo + 1);
    toast(CLASSIC ? 'Room ' + levelNo + ' of ' + CLASSIC_LEVELS.length : 'Room ' + levelNo);
  }

  function skipRoom(timedOut) {
    if (state !== 'play' || CLASSIC || DAILY) { if (!timedOut) toast('No skipping here — undo or reset'); return; }
    if (skips <= 0) {
      if (timedOut) endGame(false); else toast('No skips left — undo (U) or reset (R)');
      return;
    }
    skips--;
    const cost = Math.min(score, 500 * mulOf());
    score -= cost;
    Sound.tone(240, 70, 0.35, 'sawtooth', 0.05);
    Sound.noise(0.3, 0.07, 0, 600);
    toast((timedOut ? 'OUT OF TIME' : 'SKIPPED') + ' · −' + cost.toLocaleString() + ' · ' + skips + ' left');
    loadLevel(levelNo + 1);
  }

  const fmtTime = (s) => Math.floor(Math.max(0, s) / 60) + ':' + String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0');

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    if (won) wonRun = true;
    paused = false;
    if (score > high) { high = score; store.set(HIGH_KEY, high); }
    $('o-score').textContent = score.toLocaleString();
    $('o-rooms').textContent = String(CLASSIC || DAILY ? levelNo : levelNo - 1 + (solved() ? 1 : 0));
    $('o-moves').textContent = totalMoves.toLocaleString();
    $('o-time').textContent = fmtTime(time);
    const msg = won
      ? (CLASSIC ? 'All thirty rooms cleared in ' + fmtTime(time) + '.' : 'Daily room solved in ' + fmtTime(time) + '.')
      : 'The clock ran out and you were out of skips.';
    Arcade.endScreen(won, msg);
    $('again-btn').textContent = won ? 'PLAY AGAIN' : 'PUSH AGAIN';
    $('over').hidden = false;
    if (!posted && window.Leaderboard) {
      posted = true;
      Leaderboard.offer(BOARD, { score, won: !!won, time }, document.querySelector('#over .panel'));
    }
  }

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------
  function burst(x, y, color, n, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random() * 0.9);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, t: 0, life: 0.35 + Math.random() * 0.45, color, s: 2 + Math.random() * 4 });
    }
  }

  function update(dt) {
    if (anim) { anim.t += dt; if (anim.t >= MOVE_T) anim = null; }
    for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 620 * dt; p.vx *= 0.97; }
    parts = parts.filter((p) => p.t < p.life);
    if (banner) { banner.t += dt; if (banner.t > 1.8) banner = null; }
    if (shake > 0) shake = Math.max(0, shake - dt * 1.3);
    if (hint > 0) hint -= dt;
    if (state !== 'play' || paused) return;
    time += dt;
    levelTime += dt;
    if (solvedT > 0) {
      solvedT -= dt;
      if (solvedT <= 0) advance();
      return;
    }
    if (limit && levelTime >= limit) skipRoom(true);
  }

  // ---------------------------------------------------------------------------
  // Drawing — brick walls, wooden crates, glowing pads and a little warehouse hand
  // ---------------------------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  function drawFloor(x, y, t, dark) {
    ctx.fillStyle = dark ? '#0d1119' : '#111723';
    ctx.fillRect(x, y, t, t);
    ctx.strokeStyle = 'rgba(139,212,80,0.07)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, t - 1, t - 1);
  }

  function drawWall(x, y, t) {
    ctx.fillStyle = '#242c3d';
    ctx.fillRect(x, y, t, t);
    const bh = t / 2;
    ctx.fillStyle = '#323c53';
    for (let r = 0; r < 2; r++) {
      const off = r % 2 ? t / 2 : 0;
      for (let c = -1; c < 2; c++) {
        const bx = x + off + c * t, by = y + r * bh;
        ctx.fillRect(Math.max(x, bx) + 1, by + 1, Math.min(bx + t, x + t) - Math.max(x, bx) - 2, bh - 2);
      }
    }
    ctx.fillStyle = 'rgba(139,212,80,0.12)';
    ctx.fillRect(x, y, t, 2);
  }

  function drawGoal(x, y, t, glow) {
    drawFloor(x, y, t, true);
    const c = t / 2, r = t * 0.3;
    ctx.save();
    ctx.translate(x + c, y + c);
    ctx.globalAlpha = 0.55 + 0.45 * glow;
    ctx.strokeStyle = '#8bd450';
    ctx.lineWidth = Math.max(2, t * 0.06);
    ctx.shadowColor = '#8bd450';
    ctx.shadowBlur = 10 + glow * 12;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(139,212,80,0.22)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCrate(x, y, t, home) {
    const p = Math.max(2, t * 0.07);
    const g = ctx.createLinearGradient(x, y, x + t, y + t);
    if (home) { g.addColorStop(0, '#9fe063'); g.addColorStop(1, '#4e8f2a'); }
    else { g.addColorStop(0, '#b07a3f'); g.addColorStop(1, '#6b4420'); }
    ctx.save();
    if (home) { ctx.shadowColor = '#8bd450'; ctx.shadowBlur = 14; }
    ctx.fillStyle = g;
    roundRect(x + p, y + p, t - p * 2, t - p * 2, t * 0.1);
    ctx.fill();
    ctx.restore();
    // planks and the diagonal brace
    ctx.strokeStyle = home ? 'rgba(20,50,10,0.45)' : 'rgba(50,28,10,0.55)';
    ctx.lineWidth = Math.max(1.5, t * 0.045);
    ctx.beginPath();
    ctx.moveTo(x + p * 1.6, y + p * 1.6);
    ctx.lineTo(x + t - p * 1.6, y + t - p * 1.6);
    ctx.moveTo(x + t - p * 1.6, y + p * 1.6);
    ctx.lineTo(x + p * 1.6, y + t - p * 1.6);
    ctx.stroke();
    // metal corners
    const m = t * 0.17;
    ctx.fillStyle = home ? '#dff6c4' : '#b9c3d1';
    for (const [cx, cy] of [[x + p, y + p], [x + t - p - m, y + p], [x + p, y + t - p - m], [x + t - p - m, y + t - p - m]]) {
      ctx.fillRect(cx, cy, m, m * 0.34);
      ctx.fillRect(cx, cy, m * 0.34, m);
    }
    ctx.strokeStyle = home ? 'rgba(223,246,196,0.9)' : 'rgba(210,220,235,0.35)';
    ctx.lineWidth = 1.5;
    roundRect(x + p, y + p, t - p * 2, t - p * 2, t * 0.1);
    ctx.stroke();
  }

  function drawPlayer(x, y, t, dir) {
    const cx = x + t / 2, cy = y + t / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, t * 0.34, t * 0.26, t * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    const bg = ctx.createLinearGradient(0, -t * 0.1, 0, t * 0.34);
    bg.addColorStop(0, '#6cc7ff');
    bg.addColorStop(1, '#2b6fa8');
    ctx.fillStyle = bg;
    roundRect(-t * 0.21, -t * 0.06, t * 0.42, t * 0.4, t * 0.1);
    ctx.fill();
    // head
    ctx.fillStyle = '#ffd9a8';
    ctx.beginPath();
    ctx.arc(0, -t * 0.18, t * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffb703';                       // hard hat
    ctx.beginPath();
    ctx.arc(0, -t * 0.2, t * 0.17, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-t * 0.21, -t * 0.21, t * 0.42, t * 0.04);
    // face: the eyes look where the next push is going
    if (dir !== 3) {
      const ox = dir === 0 ? t * 0.05 : dir === 2 ? -t * 0.05 : 0;
      ctx.fillStyle = '#20313f';
      ctx.beginPath();
      ctx.arc(ox - t * 0.055, -t * 0.15, t * 0.028, 0, Math.PI * 2);
      ctx.arc(ox + t * 0.055, -t * 0.15, t * 0.028, 0, Math.PI * 2);
      ctx.fill();
    }
    // arms reach toward the crate
    ctx.strokeStyle = '#6cc7ff';
    ctx.lineWidth = Math.max(2, t * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const ax = dir === 0 ? t * 0.3 : dir === 2 ? -t * 0.3 : 0;
    const ay = dir === 1 ? t * 0.28 : dir === 3 ? -t * 0.16 : t * 0.06;
    ctx.moveTo(-t * 0.16, t * 0.04);
    ctx.lineTo(ax * 0.7 - t * 0.04, ay);
    ctx.moveTo(t * 0.16, t * 0.04);
    ctx.lineTo(ax * 0.7 + t * 0.04, ay);
    ctx.stroke();
    ctx.restore();
  }

  function drawBackdrop(W, H) {
    if (!sky) {
      sky = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.8);
      sky.addColorStop(0, '#111a15');
      sky.addColorStop(1, '#05070a');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(139,212,80,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (W / 2) % 44; x < W; x += 44) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = (H / 2) % 44; y < H; y += 44) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
  }

  const easeOut = (p) => 1 - (1 - p) * (1 - p);

  function render(now) {
    const W = view.W, H = view.H;
    ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    drawBackdrop(W, H);
    if (!cur) return;
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 12, (Math.random() - 0.5) * shake * 12);

    const bw = TILE * cur.w, bh = TILE * cur.h;
    ctx.save();
    ctx.shadowColor = 'rgba(139,212,80,0.45)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#080b10';
    roundRect(BX - 10, BY - 10, bw + 20, bh + 20, 16);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(139,212,80,0.5)';
    ctx.lineWidth = 2;
    roundRect(BX - 10, BY - 10, bw + 20, bh + 20, 16);
    ctx.stroke();

    const glow = 0.5 + 0.5 * Math.sin(now / 420);
    for (let y = 0; y < cur.h; y++) {
      for (let x = 0; x < cur.w; x++) {
        const i = y * cur.w + x, px = BX + x * TILE, py = BY + y * TILE;
        if (cur.wall[i]) drawWall(px, py, TILE);
        else if (cur.goal[i]) drawGoal(px, py, TILE, glow);
        else drawFloor(px, py, TILE, (x + y) % 2 === 0);
      }
    }

    const p = anim ? easeOut(clamp(anim.t / MOVE_T, 0, 1)) : 1;
    for (let ci = 0; ci < crates.length; ci++) {
      const c = crates[ci];
      let x = xOf(c), y = yOf(c);
      if (anim && anim.ci === ci) {
        const fx = anim.cFrom % cur.w, fy = (anim.cFrom / cur.w) | 0;
        x = fx + (x - fx) * p;
        y = fy + (y - fy) * p;
      }
      drawCrate(BX + x * TILE, BY + y * TILE, TILE, onGoal(c));
    }

    let px = xOf(player), py = yOf(player);
    if (anim) {
      const fx = anim.from % cur.w, fy = (anim.from / cur.w) | 0;
      px = fx + (px - fx) * p;
      py = fy + (py - fy) * p;
    }
    drawPlayer(BX + px * TILE, BY + py * TILE, TILE, face);

    for (const q of parts) {
      ctx.globalAlpha = Math.max(0, 1 - q.t / q.life);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
    }
    ctx.globalAlpha = 1;

    // the room's name sits above the board
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px "Press Start 2P", monospace';
    const title = DAILY ? 'DAILY ROOM' : CLASSIC ? 'ROOM ' + levelNo + ' / ' + CLASSIC_LEVELS.length : 'ROOM ' + levelNo;
    ctx.fillText(title, FW / 2, BY - 34);

    if (hint > 0 && state === 'play') {
      ctx.globalAlpha = clamp(hint, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.fillText('ARROWS OR SWIPE TO PUSH · U UNDO · R RESET', FW / 2, BY + bh + 34);
      ctx.globalAlpha = 1;
    }

    if (banner) {
      const a = banner.t < 0.15 ? banner.t / 0.15 : banner.t > 1.4 ? (1.8 - banner.t) / 0.4 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.shadowColor = '#8bd450';
      ctx.shadowBlur = 22;
      ctx.fillStyle = '#fff';
      ctx.font = '24px "Press Start 2P", monospace';
      ctx.fillText(banner.text, FW / 2, BY + bh / 2 - 16);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8bd450';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillText(banner.sub, FW / 2, BY + bh / 2 + 22);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (paused && state === 'play') {
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#8bd450';
      ctx.font = '24px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PAUSED', W / 2, H / 2 - 14);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.fillText('P TO RESUME', W / 2, H / 2 + 24);
    }
  }

  // ---------------------------------------------------------------------------
  // HUD and input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    const live = state !== 'title';
    set('score', (live ? score : 0).toLocaleString());
    set('best', 'BEST ' + high.toLocaleString());
    set('level', (DAILY ? 'DAILY' : 'ROOM ') + (DAILY ? '' : levelNo));
    set('crates', live && cur ? cratesHome() + ' / ' + crates.length : '—');
    set('extras', !live ? '' : (CLASSIC || DAILY ? '' : skips + ' skips · ') + undos + (undos === 1 ? ' undo' : ' undos'));
    set('time-label', limit ? 'TIME LEFT' : 'TIME');
    set('time', live ? fmtTime(limit ? limit - levelTime : time) : '0:00');
    set('stats', live ? moves + ' moves · ' + pushes + ' pushes' : '');
    const low = !!limit && live && limit - levelTime < 15;
    if (last.low !== low) { last.low = low; $('time').classList.toggle('low', low); }
  }

  const KEYMAP = { arrowright: 0, d: 0, arrowdown: 1, s: 1, arrowleft: 2, a: 2, arrowup: 3, w: 3 };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) {
      e.preventDefault();
      tryMove(KEYMAP[k]);
    } else if (k === 'u' || k === 'z') {
      e.preventDefault();
      undo();
    } else if (k === 'r') {
      resetLevel();
    } else if (k === 'k') {
      if (state === 'play') skipRoom(false);
    } else if (k === 'p' || k === 'escape') {
      if (state === 'play') { paused = !paused; if (!paused) Sound.init(); }
    } else if (k === 'm') {
      $('sound-btn').click();
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (state !== 'play' && !e.repeat) start();
    }
  });

  swipe(canvas, (d) => tryMove(d), () => { if (paused) paused = false; });
  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('undo-btn').addEventListener('click', () => { undo(); $('undo-btn').blur(); });
  $('reset-btn').addEventListener('click', () => { resetLevel(); $('reset-btn').blur(); });
  $('skip-btn').addEventListener('click', () => { skipRoom(false); $('skip-btn').blur(); });
  if (CLASSIC || DAILY) $('skip-btn').hidden = true;
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'play') paused = true;
    if (!document.hidden) lastT = performance.now();
  });

  // ---------------------------------------------------------------------------
  // Local development helper (see docs/ADDING_A_GAME.md)
  // ---------------------------------------------------------------------------
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'sokoban',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) update(dt); },
      move: (dir) => tryMove(typeof dir === 'string' ? KEYMAP[dir.toLowerCase()] : dir),
      undo,
      reset: () => resetLevel(true),
      skip: () => skipRoom(false),
      peek: () => ({
        state, score, level: levelNo, moves, pushes, undos, skips,
        crates: crates.length, home: cratesHome(), solved: !!cur && solved(),
        time: Math.round(time), levelTime: Math.round(levelTime), limit,
        w: cur ? cur.w : 0, h: cur ? cur.h : 0,
        par: Math.round(par), solution: cur && cur.solution ? cur.solution.length : 0,
        high, paused, won: wonRun, mode: DAILY ? 'daily' : CLASSIC ? 'classic' : 'infinite',
        board: cur ? levelToString(cur, crates, player) : '',
      }),
      set: (key, value) => {
        if (key === 'score') score = value;
        else if (key === 'level') loadLevel(value);
        else if (key === 'moves') moves = value;
        else if (key === 'skips') skips = value;
        else if (key === 'time') time = value;
        else if (key === 'levelTime') levelTime = value;
      },
      // replay the room's stored solution from its starting position
      solve: () => {
        if (state !== 'play' || !cur || !cur.solution) return false;
        resetLevel(true);
        for (const k of cur.solution) {
          if (solvedT > 0) break;
          tryMove(k, true);
        }
        return solved();
      },
      win: () => {
        if (state !== 'play') start();
        if (CLASSIC) { levelNo = CLASSIC_LEVELS.length; loadLevel(levelNo); }
        if (cur && cur.solution) for (const k of cur.solution) { if (solvedT > 0) break; tryMove(k, true); }
        if (solvedT > 0) advance();
        return state;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Main loop — the title screen replays a small room behind the panel
  // ---------------------------------------------------------------------------
  cur = generateLevel(LADDER[0], Math.random) || classicLevel(0, 1);
  crates = cur.crates.slice();
  player = cur.player;
  layout();

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(dt);
    if (state === 'title') {
      attractT += dt;
      if (attractT > 0.3) {
        attractT = 0;
        const sol = cur.solution || [];
        if (attractI < sol.length) applyMove(sol[attractI++], false);
        else if (++attractI > sol.length + 8) { resetLevel(true); attractI = 0; }
      }
    }
    render(now);
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
