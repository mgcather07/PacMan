/*
 * Mahjong Solitaire — Infinite (layout after layout), Classic (the 144-tile turtle) and the seeded Daily.
 *
 * Every deal is built backwards: pairs of slots are lifted off an empty layout in an order where both
 * slots are free at the time, and the tile faces are handed out in that same order. Replaying the order
 * always clears the board, so no deal can be impossible.
 */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const SINGLE = CLASSIC || DAILY;                 // one layout to clear, ranked by the fastest win
  const BOARD = (window.Daily && Daily.board('mahjong')) || (CLASSIC ? 'mahjong-classic' : 'mahjong');
  const HIGH_KEY = Arcade.modeKey('mahjong.high');
  const START_HINTS = 5, START_SHUFFLES = 3, MAX_HINTS = 9, MAX_SHUFFLES = 5;
  const PAIR_POINTS = 100, LAYOUT_POINTS = 1000;
  const RATIO = 1.34;                              // tile height / width
  const LIFT = 0.15;                               // the 3D edge, and how far each layer sits up-left
  const SANS = 'Inter, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  const CJK = '"Hiragino Sans", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", serif';

  // ---------------------------------------------------------------------------
  // The tile set: three suits of 1-9, four winds, three dragons (four of each),
  // plus four flowers and four seasons, where any flower matches any flower.
  // ---------------------------------------------------------------------------
  const FACES = [];
  'bcd'.split('').forEach((s) => { for (let r = 1; r <= 9; r++) FACES.push({ k: s + r, s, r }); });
  for (let r = 1; r <= 4; r++) FACES.push({ k: 'w' + r, s: 'w', r });
  for (let r = 1; r <= 3; r++) FACES.push({ k: 'g' + r, s: 'g', r });
  for (let r = 1; r <= 4; r++) FACES.push({ k: 'f', s: 'f', r });
  for (let r = 1; r <= 4; r++) FACES.push({ k: 's', s: 's', r });
  // 'b3' → the 3 of bamboo, 'f1' → the first flower
  const faceOf = (spec) => FACES.find((f) => f.k === spec) || FACES.find((f) => f.s === spec[0] && f.r === +spec.slice(1));

  // 72 pair tokens: the whole 144-tile set, already split into matching twos
  function fullTokens() {
    const t = [];
    FACES.forEach((f) => { if (f.s !== 'f' && f.s !== 's') { t.push([f, f]); t.push([f, f]); } });
    'fs'.split('').forEach((s) => {
      const g = FACES.filter((f) => f.s === s);
      t.push([g[0], g[1]], [g[2], g[3]]);
    });
    return t;
  }

  // ---------------------------------------------------------------------------
  // Layout shapes. Slots live on a half-tile grid: a tile covers x..x+2, y..y+2.
  // ---------------------------------------------------------------------------
  function turtle() {
    const s = [];
    const row = (y, from, to, z) => { for (let x = from; x <= to; x += 2) s.push({ x, y, z }); };
    [[0, 2, 24], [2, 6, 20], [4, 4, 22], [6, 2, 24], [8, 2, 24], [10, 4, 22], [12, 6, 20], [14, 2, 24]]
      .forEach(([y, a, b]) => row(y, a, b, 0));
    s.push({ x: 0, y: 7, z: 0 }, { x: 26, y: 7, z: 0 }, { x: 28, y: 7, z: 0 });   // the head and the tail
    for (let y = 2; y <= 12; y += 2) row(y, 8, 18, 1);
    for (let y = 4; y <= 10; y += 2) row(y, 10, 16, 2);
    for (let y = 6; y <= 8; y += 2) row(y, 12, 14, 3);
    s.push({ x: 13, y: 7, z: 4 });
    return s;
  }

  // A tier is a list of row widths in tiles; tiers are centred on each other.
  function fromRows(tiers) {
    const W = Math.max(...tiers.map((t) => Math.max(...t)));
    const H = Math.max(...tiers.map((t) => t.length));
    const s = [];
    tiers.forEach((rows, z) => {
      const y0 = H - rows.length;
      rows.forEach((w, r) => {
        const x0 = W - w;
        for (let i = 0; i < w; i++) s.push({ x: x0 + i * 2, y: y0 + r * 2, z });
      });
    });
    return s;
  }

  const SHAPES = [
    { name: 'RAMP', rows: [[8, 8, 8, 8], [6, 6, 6], [4, 4]] },
    { name: 'GARDEN', rows: [[10, 10, 10, 10], [8, 8, 8], [6, 6], [2]] },
    { name: 'PAGODA', rows: [[10, 10, 10, 10, 10], [8, 8, 8], [6, 6], [4], [2]] },
    { name: 'FORTRESS', rows: [[12, 12, 12, 12, 12], [8, 8, 8, 8], [6, 6, 6], [4, 4]] },
    { name: 'TURTLE', build: turtle },
    { name: 'CITADEL', rows: [[12, 12, 12, 12, 12, 12], [10, 10, 10, 10], [8, 8, 8], [6, 6], [4]] },
    { name: 'DYNASTY', rows: [[13, 13, 13, 13, 13, 13], [11, 11, 11, 11, 11], [8, 8, 8, 8], [6, 6], [4]] },
  ];

  // Past the hand-built shapes the table keeps growing: wider, taller, another tier on top.
  function grownShape(n) {
    const tiers = Math.min(4 + n, 6);
    const rows = [];
    let cw = Math.min(14 + Math.floor(n / 2), 15);          // never wider than the turtle, so it still fits a phone
    let ch = Math.min(6 + Math.floor((n + 1) / 2), 8);
    for (let i = 0; i < tiers; i++) {
      rows.push(new Array(ch).fill(cw));
      cw = Math.max(2, cw - 3);
      ch = Math.max(1, ch - 2);
    }
    return { name: 'TABLE ' + (SHAPES.length + n), rows };
  }

  function shapeFor(level) {
    if (SINGLE) return { name: 'TURTLE', build: turtle };
    return level <= SHAPES.length ? SHAPES[level - 1] : grownShape(level - SHAPES.length);
  }

  // ---------------------------------------------------------------------------
  // Free tiles: nothing overlapping on the layer above, and one side clear.
  // Slots never move inside a layout, so the neighbours are worked out once.
  // ---------------------------------------------------------------------------
  function neighbours(list) {
    const above = list.map(() => []), left = list.map(() => []), right = list.map(() => []);
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      for (let j = 0; j < list.length; j++) {
        if (j === i) continue;
        const o = list[j];
        if (o.z === t.z + 1) { if (Math.abs(o.x - t.x) < 2 && Math.abs(o.y - t.y) < 2) above[i].push(j); }
        else if (o.z === t.z && Math.abs(o.y - t.y) < 2) {
          if (o.x === t.x - 2) left[i].push(j);
          else if (o.x === t.x + 2) right[i].push(j);
        }
      }
    }
    return { above, left, right };
  }

  function markFree(list, nb) {
    const clear = (idx) => idx.every((j) => list[j].gone);
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      t.free = !t.gone && clear(nb.above[i]) && (clear(nb.left[i]) || clear(nb.right[i]));
    }
  }

  // Lift the layout off the table two free slots at a time. Backtracks if a choice ever strands a
  // single free tile, so the order it returns is always a real solution.
  function pairOrder(slots, wrand) {
    const work = slots.map((s) => ({ x: s.x, y: s.y, z: s.z, gone: false, free: false }));
    const nb = neighbours(work);
    const pairs = [];
    let guard = 0;
    while (pairs.length * 2 < work.length && guard++ < 4000) {
      markFree(work, nb);
      const free = [];
      for (let i = 0; i < work.length; i++) if (work[i].free) free.push(i);
      if (free.length < 2) {
        const last = pairs.pop();
        if (!last) return null;
        work[last[0]].gone = work[last[1]].gone = false;
        continue;
      }
      const a = free[Math.floor(wrand() * free.length)];
      let b = a;
      while (b === a) b = free[Math.floor(wrand() * free.length)];
      work[a].gone = work[b].gone = true;
      pairs.push([a, b]);
    }
    return pairs.length * 2 === work.length ? pairs : null;
  }

  function shuffled(arr, wrand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(wrand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Enough pair tokens for a layout of any size: whole shuffled sets, cut to length
  function tokensFor(n, wrand) {
    let out = [];
    while (out.length < n) out = out.concat(shuffled(fullTokens(), wrand));
    return out.slice(0, n);
  }

  // Deal faces onto a set of slots. `tokens` (optional) keeps an existing tile mix — that is what a
  // shuffle re-deals with.
  function deal(slots, wrand, tokens) {
    let pairs = null;
    for (let tries = 0; tries < 4 && !pairs; tries++) pairs = pairOrder(slots, wrand);
    if (!pairs) return null;
    const tok = shuffled(tokens || tokensFor(pairs.length, wrand), wrand);
    const out = slots.map((s) => ({ x: s.x, y: s.y, z: s.z, face: null, gone: false, free: false }));
    pairs.forEach(([a, b], i) => { out[a].face = tok[i][0]; out[b].face = tok[i][1]; });
    return { tiles: out, plan: pairs.map(([a, b]) => [out[a], out[b]]) };
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let state = 'title';
  let tiles = [], order = [], history = [], fx = [], hintPair = [], plan = [];
  let nbs = { above: [], left: [], right: [] };
  let sel = null, banner = null;
  let score = 0, level = 1, layouts = 0, matched = 0, time = 0, layoutTime = 0;
  let hints = START_HINTS, shuffles = START_SHUFFLES, freePairs = 0, shapeName = '';
  let hintT = 0, nextT = 0, pulse = 0, posted = false, playCounted = false, showFree = false;
  let wrand = Math.random;
  let high = store.get(HIGH_KEY, 0);
  let best = 0;                                    // classic/daily: the fastest win so far

  let tw = 40, th = 54, lift = 6, ox = 0, oy = 0, maxZ = 0, ivory = null;
  const view = setupCanvas(canvas, (v) => measure(v));
  const ctx = view.ctx;

  const alive = () => tiles.filter((t) => !t.gone);
  const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const bestKey = SINGLE ? (DAILY ? 'mahjong.best.daily' : Arcade.modeKey('mahjong.best')) : null;
  if (bestKey) best = store.get(bestKey, 0);

  // The whole layout is scaled to whatever room the window has, so it fits a phone without zooming.
  function measure(v = view) {
    if (!tiles.length) return;
    let mx = 0, my = 0;
    maxZ = 0;
    for (const t of tiles) { mx = Math.max(mx, t.x + 2); my = Math.max(my, t.y + 2); maxZ = Math.max(maxZ, t.z); }
    const cols = mx / 2, rows = my / 2;
    const top = v.W < 520 ? 78 : 92, bottom = v.W < 520 ? 74 : 80;
    const availW = Math.max(120, v.W - 16);
    const availH = Math.max(120, v.H - top - bottom);
    const kx = cols + maxZ * LIFT + 0.18;
    const ky = rows * RATIO + maxZ * LIFT + 0.18;
    tw = clamp(Math.min(availW / kx, availH / ky), 12, 92);   // never microscopic, never comically large
    th = tw * RATIO;
    lift = Math.max(2, tw * LIFT);
    const bw = cols * tw + maxZ * lift + tw * 0.18;
    const bh = rows * th + maxZ * lift + tw * 0.18;
    ox = (v.W - bw) / 2 + maxZ * lift;
    oy = top + (availH - bh) / 2 + maxZ * lift;
    ivory = null;
  }

  const tileX = (t) => ox + (t.x / 2) * tw - t.z * lift;
  const tileY = (t) => oy + (t.y / 2) * th - t.z * lift;

  // ---------------------------------------------------------------------------
  // Dealing and the run
  // ---------------------------------------------------------------------------
  function dealLayout(n) {
    level = n;
    const shape = shapeFor(n);
    shapeName = shape.name;
    let slots = shape.build ? shape.build() : fromRows(shape.rows);
    if (slots.length % 2) slots = slots.slice(0, slots.length - 1);
    const dealt = deal(slots, wrand) || deal(turtle(), wrand);
    tiles = dealt.tiles;
    plan = dealt.plan;
    nbs = neighbours(tiles);
    order = tiles.map((t, i) => i).sort((a, b) => tiles[a].z - tiles[b].z || tiles[a].y - tiles[b].y || tiles[a].x - tiles[b].x);
    history = [];
    sel = null;
    hintPair = [];
    fx = [];
    layoutTime = 0;
    nextT = 0;
    markFree(tiles, nbs);
    countPairs();
    measure();
  }

  function start() {
    score = 0; layouts = 0; matched = 0; time = 0;
    hints = START_HINTS; shuffles = START_SHUFFLES;
    posted = false; playCounted = false; banner = null;
    wrand = DAILY ? Daily.rng('mahjong') : Math.random;
    dealLayout(1);
    state = 'play';
    $('title').hidden = true;
    $('over').hidden = true;
    Sound.init();
    if (window.Leaderboard) Leaderboard.startRun(BOARD, { play: false });
  }

  function countPairs() {
    const groups = {};
    for (const t of tiles) if (!t.gone && t.free) groups[t.face.k] = (groups[t.face.k] || 0) + 1;
    freePairs = Object.values(groups).filter((n) => n >= 2).length;
  }

  function findPair() {
    const groups = {};
    for (const t of tiles) if (!t.gone && t.free) (groups[t.face.k] = groups[t.face.k] || []).push(t);
    const ready = Object.values(groups).filter((g) => g.length >= 2);
    if (!ready.length) return null;
    const g = ready[Math.floor(Math.random() * ready.length)];
    return [g[0], g[1]];
  }

  function match(a, b) {
    a.gone = b.gone = true;
    history.push([a, b]);
    matched++;
    score += PAIR_POINTS;
    sel = null;
    hintPair = [];
    fx.push({ t: 0, tile: a }, { t: 0, tile: b });
    markFree(tiles, nbs);
    countPairs();
    Sound.tone(740, 1180, 0.09, 'triangle', 0.035);
    Sound.tone(1180, 1560, 0.08, 'triangle', 0.025, 0.06);
    if (!playCounted && window.Leaderboard) { playCounted = true; Leaderboard.played(BOARD); }
    if (!alive().length) layoutCleared();
    else if (!freePairs) jammed();
  }

  function layoutCleared() {
    const bonus = Math.max(0, Math.round((tiles.length * 2 - layoutTime) * 12));
    score += LAYOUT_POINTS + bonus;
    layouts++;
    Sound.arp([523, 659, 784, 1046], 0.09, 'triangle', 0.045);
    if (SINGLE) { endGame(true); return; }
    hints = Math.min(MAX_HINTS, hints + 2);
    shuffles = Math.min(MAX_SHUFFLES, shuffles + 1);
    banner = { text: 'LAYOUT CLEARED', sub: `+${(LAYOUT_POINTS + bonus).toLocaleString()}`, t: 0, life: 1.7 };
    nextT = 1.5;
  }

  function jammed() {
    if (shuffles > 0) {
      banner = { text: 'NO MOVES', sub: 'SHUFFLE OR UNDO', t: 0, life: 2.6 };
      Sound.tone(300, 180, 0.3, 'sawtooth', 0.03);
      toast(`No free pairs left — shuffle (${shuffles} left)`);
      return;
    }
    endGame(false);
  }

  function endGame(won) {
    if (state === 'over') return;
    state = 'over';
    sel = null;
    if (!SINGLE && score > high) { high = score; store.set(HIGH_KEY, high); }
    let record = '';
    if (SINGLE && won && bestKey && (!best || time < best)) {
      best = time;
      store.set(bestKey, time);
      record = ' A new best time!';
    }
    $('o-score').textContent = Math.round(score).toLocaleString();
    $('o-layouts').textContent = SINGLE ? String(alive().length) : String(layouts);
    $('o-pairs').textContent = String(matched);
    $('o-time').textContent = fmtTime(time);
    $('again-btn').textContent = won ? 'PLAY AGAIN' : 'DEAL AGAIN';
    Arcade.endScreen(won,
      won ? `Table cleared in ${fmtTime(time)}.${record}`
        : SINGLE ? 'The table jammed with tiles still on it.' : `${layouts} layout${layouts === 1 ? '' : 's'} cleared before the table jammed.`);
    $('over').hidden = false;
    if (!posted && window.Leaderboard) {
      posted = true;
      Leaderboard.offer(BOARD, { score: Math.round(score), won: !!won, time }, document.querySelector('#over .panel'));
    }
  }

  // ---------------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------------
  function pick(t) {
    if (state !== 'play' || nextT > 0) return;
    if (!t) { sel = null; return; }
    if (!t.free) {
      Sound.tone(220, 130, 0.14, 'sawtooth', 0.03);
      toast('That tile is blocked');
      return;
    }
    if (sel === t) { sel = null; return; }
    if (sel && sel.face.k === t.face.k) { match(sel, t); return; }
    sel = t;
    Sound.tone(600, 720, 0.06, 'triangle', 0.03);
  }

  function undo() {
    if (state !== 'play' || nextT > 0) return;
    const last = history.pop();
    if (!last) { toast('Nothing to undo'); return; }
    last[0].gone = last[1].gone = false;
    matched--;
    score = Math.max(0, score - PAIR_POINTS);
    sel = null;
    hintPair = [];
    banner = null;
    markFree(tiles, nbs);
    countPairs();
    Sound.tone(700, 320, 0.13, 'triangle', 0.03);
  }

  function hint() {
    if (state !== 'play' || nextT > 0) return;
    if (hints <= 0) { toast('No hints left'); return; }
    const pair = findPair();
    if (!pair) { toast('No free pair — shuffle the table'); return; }
    hints--;
    hintPair = pair;
    hintT = 3;
    Sound.tone(880, 1320, 0.12, 'sine', 0.03);
  }

  // Re-deals the tiles still on the table, keeping the same mix and the same promise: solvable.
  function doShuffle() {
    if (state !== 'play' || nextT > 0) return;
    if (shuffles <= 0) { toast('No shuffles left'); return; }
    const left = alive();
    if (left.length < 2) return;
    const groups = {};
    for (const t of left) (groups[t.face.k] = groups[t.face.k] || []).push(t.face);
    const tokens = [];
    Object.values(groups).forEach((g) => { for (let i = 0; i + 1 < g.length; i += 2) tokens.push([g[i], g[i + 1]]); });
    const dealt = deal(left.map((t) => ({ x: t.x, y: t.y, z: t.z })), wrand, tokens);
    if (!dealt) { toast('Could not shuffle'); return; }
    left.forEach((t, i) => { t.face = dealt.tiles[i].face; });
    plan = dealt.plan.map(([a, b]) => [left[dealt.tiles.indexOf(a)], left[dealt.tiles.indexOf(b)]]);
    shuffles--;
    history = [];
    sel = null;
    hintPair = [];
    banner = null;
    markFree(tiles, nbs);
    countPairs();
    Sound.noise(0.3, 0.05, 0, 1400);
    toast(`Shuffled — ${shuffles} left`);
  }

  function togglePause() {
    if (state === 'play') { state = 'pause'; toast('Paused'); }
    else if (state === 'pause') state = 'play';
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  const SUIT_COLOR = { b: '#1d7a44', c: '#b0232a', d: '#1a5fb4', w: '#2b3b52', g: '#b0232a', f: '#c0397a', s: '#1d7a44' };
  const GRID = [
    [[1, 1]],
    [[1, 0], [1, 2]],
    [[0, 0], [1, 1], [2, 2]],
    [[0, 0], [2, 0], [0, 2], [2, 2]],
    [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
    [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
    [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
    [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
  ];
  const WIND_LETTER = ['E', 'S', 'W', 'N'], WIND_CJK = ['東', '南', '西', '北'];

  // The face art. Small tiles (phones) get a plain rank in the suit colour, which stays readable
  // where the traditional pattern would turn to mush.
  function drawFace(c, f, x, y, w, h, simple) {
    const cx = x + w / 2, cy = y + h / 2;
    const col = SUIT_COLOR[f.s];
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (f.s === 'w') {
      c.fillStyle = col;
      c.font = `700 ${Math.round(h * (simple ? 0.54 : 0.44))}px ${SANS}`;
      c.fillText(WIND_LETTER[f.r - 1], cx, cy - (simple ? 0 : h * 0.09));
      if (!simple) { c.font = `${Math.round(h * 0.28)}px ${CJK}`; c.fillText(WIND_CJK[f.r - 1], cx, cy + h * 0.26); }
      return;
    }
    if (f.s === 'g') {
      if (f.r === 1) {                                   // red dragon: the 中 box and bar
        const bw = w * 0.42, bh = h * 0.36;
        c.strokeStyle = col;
        c.lineWidth = Math.max(1.5, w * 0.08);
        c.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
        c.fillStyle = col;
        c.fillRect(cx - c.lineWidth / 2, cy - h * 0.34, c.lineWidth, h * 0.68);
      } else if (f.r === 2) {                            // green dragon
        c.fillStyle = '#1d7a44';
        c.font = `700 ${Math.round(h * 0.5)}px ${CJK}`;
        c.fillText('發', cx, cy);
      } else {                                           // white dragon: the empty blue frame
        c.strokeStyle = '#1a5fb4';
        c.lineWidth = Math.max(1.2, w * 0.05);
        c.strokeRect(cx - w * 0.26, cy - h * 0.26, w * 0.52, h * 0.52);
        c.strokeRect(cx - w * 0.18, cy - h * 0.18, w * 0.36, h * 0.36);
      }
      return;
    }
    if (f.s === 'f' || f.s === 's') {
      c.fillStyle = col;
      if (f.s === 'f') {
        for (let i = 0; i < 5; i++) {                    // a blossom
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          c.beginPath();
          c.arc(cx + Math.cos(a) * w * 0.17, cy - h * 0.06 + Math.sin(a) * w * 0.17, w * 0.13, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = '#f7c948';
        c.beginPath();
        c.arc(cx, cy - h * 0.06, w * 0.09, 0, Math.PI * 2);
        c.fill();
      } else {                                           // a leaf
        c.beginPath();
        c.moveTo(cx, cy - h * 0.28);
        c.quadraticCurveTo(cx + w * 0.3, cy - h * 0.04, cx, cy + h * 0.2);
        c.quadraticCurveTo(cx - w * 0.3, cy - h * 0.04, cx, cy - h * 0.28);
        c.fill();
      }
      c.fillStyle = '#4a4436';
      c.font = `700 ${Math.round(h * 0.2)}px ${SANS}`;
      c.fillText(String(f.r), cx, cy + h * 0.34);
      return;
    }
    if (simple || f.s === 'c') {
      c.fillStyle = col;
      c.font = `700 ${Math.round(h * (simple ? 0.5 : 0.44))}px ${SANS}`;
      c.fillText(String(f.r), cx, cy - h * (simple ? 0.04 : 0.1));
      if (simple) {                                      // a small suit mark under the rank
        c.fillStyle = col;
        if (f.s === 'd') { c.beginPath(); c.arc(cx, cy + h * 0.33, w * 0.1, 0, Math.PI * 2); c.fill(); }
        else if (f.s === 'b') c.fillRect(cx - w * 0.06, cy + h * 0.22, w * 0.12, h * 0.2);
        else { c.font = `${Math.round(h * 0.22)}px ${CJK}`; c.fillText('萬', cx, cy + h * 0.33); }
      } else {
        c.font = `${Math.round(h * 0.3)}px ${CJK}`;
        c.fillText('萬', cx, cy + h * 0.27);
      }
      return;
    }
    const gx = (i) => x + w * (0.24 + i * 0.26);
    const gy = (j) => y + h * (0.24 + j * 0.26);
    const cells = GRID[f.r - 1];
    if (f.s === 'd') {
      const rad = f.r === 1 ? w * 0.26 : w * 0.11;
      cells.forEach(([i, j], n) => {
        c.fillStyle = n % 2 ? '#b0232a' : col;
        c.beginPath();
        c.arc(gx(i), gy(j), rad, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#fffdf2';
        c.beginPath();
        c.arc(gx(i), gy(j), rad * 0.36, 0, Math.PI * 2);
        c.fill();
      });
      return;
    }
    c.fillStyle = col;                                    // bamboo sticks
    const sw = f.r === 1 ? w * 0.18 : w * 0.11, sh = f.r === 1 ? h * 0.48 : h * 0.2;
    cells.forEach(([i, j]) => {
      const px = gx(i), py = gy(j);
      c.fillRect(px - sw / 2, py - sh / 2, sw, sh);
      c.fillStyle = '#fffdf2';
      c.fillRect(px - sw / 2, py - sh * 0.08, sw, Math.max(1, sh * 0.12));
      c.fillStyle = col;
    });
  }

  // Tiles are drawn in their own space so the ivory gradient can be built once a layout, not once a tile.
  function drawTile(t, alpha, pop, glow) {
    const r = tw * 0.13;
    if (!ivory) {
      ivory = ctx.createLinearGradient(0, 0, tw, th);
      ivory.addColorStop(0, '#fffdf3');
      ivory.addColorStop(1, '#e6ddc4');
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(tileX(t), tileY(t));
    if (pop !== 1) {
      ctx.translate(tw / 2, th / 2);
      ctx.scale(pop, pop);
      ctx.translate(-tw / 2, -th / 2);
    }
    ctx.fillStyle = '#8f8465';                            // the side of the tile
    rr(0, 0, tw + lift, th + lift, r);
    ctx.fill();
    ctx.fillStyle = ivory;
    rr(0, 0, tw, th, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,34,20,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawFace(ctx, t.face, 0, 0, tw, th, tw < 34);
    const shade = Math.min(0.22, 0.06 * (maxZ - t.z)) + (showFree && !t.free ? 0.2 : 0);
    if (shade > 0) {
      ctx.fillStyle = `rgba(6,18,14,${shade})`;
      rr(0, 0, tw, th, r);
      ctx.fill();
    }
    if (glow) {
      ctx.strokeStyle = glow;
      ctx.lineWidth = Math.max(2, tw * 0.07);
      ctx.shadowColor = glow;
      ctx.shadowBlur = tw * 0.5;
      rr(1, 1, tw - 2, th - 2, r);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  let felt = null;
  function backdrop() {
    if (!felt || felt.w !== view.W || felt.h !== view.H) {
      const gr = ctx.createRadialGradient(view.W / 2, view.H * 0.38, 0, view.W / 2, view.H * 0.38, Math.max(view.W, view.H) * 0.8);
      gr.addColorStop(0, '#15503a');
      gr.addColorStop(0.55, '#0d3628');
      gr.addColorStop(1, '#06170f');
      felt = { g: gr, w: view.W, h: view.H };
    }
    ctx.fillStyle = felt.g;
    ctx.fillRect(0, 0, view.W, view.H);
  }

  function render() {
    ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    backdrop();
    if (state !== 'title') {
      const hintOn = hintT > 0 && Math.sin(pulse * 9) > -0.2;
      for (const i of order) {
        const t = tiles[i];
        if (t.gone) continue;
        const glow = t === sel ? '#ffe600'
          : hintOn && hintPair.includes(t) ? '#ff6ad5'
            : showFree && t.free ? 'rgba(217,123,123,0.85)' : null;
        drawTile(t, 1, 1, glow);
      }
      for (const f of fx) {
        const p = f.t / 0.42;
        drawTile(f.tile, Math.max(0, 1 - p), 1 + p * 0.45, null);
      }
    }

    if (banner) {
      const a = banner.t < 0.2 ? banner.t / 0.2 : banner.t > banner.life - 0.4 ? (banner.life - banner.t) / 0.4 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#d97b7b';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(clamp(view.W * 0.045, 16, 30))}px "Press Start 2P", monospace`;
      ctx.fillText(banner.text, view.W / 2, view.H / 2 - 16);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd98a';
      ctx.font = '11px "Press Start 2P", monospace';
      ctx.fillText(banner.sub, view.W / 2, view.H / 2 + 24);
      ctx.globalAlpha = 1;
    }
    if (state === 'pause') {
      ctx.fillStyle = 'rgba(4,14,10,0.72)';
      ctx.fillRect(0, 0, view.W, view.H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#d97b7b';
      ctx.font = '22px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', view.W / 2, view.H / 2 - 10);
      ctx.fillStyle = '#bbb';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillText('PRESS P TO PLAY ON', view.W / 2, view.H / 2 + 26);
    }
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    const live = state !== 'title';
    const left = live ? alive().length : 0;
    set('score', Math.round(live ? score : 0).toLocaleString());
    set('tiles', `${left} TILES`);
    set('time', fmtTime(live ? time : 0));
    set('layout', live ? (SINGLE ? shapeName : `LAYOUT ${level} · ${shapeName}`) : '');
    set('pairs', live ? `${freePairs} FREE PAIR${freePairs === 1 ? '' : 'S'}` : '');
    set('aids', live ? `💡${hints}  🔀${shuffles}` : '');
    set('high', SINGLE ? (best ? 'BEST ' + fmtTime(best) : '') : 'BEST ' + high.toLocaleString());
    set('hint-n', String(hints));
    set('shuffle-n', String(shuffles));
    const canUndo = state === 'play' && history.length > 0;
    if (last.undo !== canUndo) { last.undo = canUndo; $('undo-btn').disabled = !canUndo; }
    if (last.hintOff !== (hints <= 0)) { last.hintOff = hints <= 0; $('hint-btn').disabled = hints <= 0; }
    if (last.shufOff !== (shuffles <= 0)) { last.shufOff = shuffles <= 0; $('shuffle-btn').disabled = shuffles <= 0; }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function tileAt(px, py) {
    for (let i = order.length - 1; i >= 0; i--) {
      const t = tiles[order[i]];
      if (t.gone) continue;
      const x = tileX(t), y = tileY(t);
      if (px >= x - 2 && px <= x + tw + 2 && py >= y - 2 && py <= y + th + 2) return t;
    }
    return null;
  }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { down = null; return; }
    down = null;
    if (state === 'pause') { state = 'play'; return; }
    const r = canvas.getBoundingClientRect();
    pick(tileAt(e.clientX - r.left, e.clientY - r.top));
  });
  canvas.addEventListener('pointercancel', () => { down = null; });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'h') hint();
    else if (k === 's') doShuffle();
    else if (k === 'z' || (k === 'u' && !e.repeat)) undo();
    else if (k === 'f') { showFree = !showFree; $('free-btn').classList.toggle('on', showFree); }
    else if (k === 'n') { if (state !== 'title') newLayout(); }
    else if (k === 'p' || k === 'escape') togglePause();
    else if (k === 'm') $('sound-btn').click();
    else if ((k === ' ' || k === 'enter') && state !== 'play' && !e.repeat) { e.preventDefault(); if (state !== 'pause') start(); }
  });

  // "New" gives up on the layout you are on: in a run that costs you the run.
  function newLayout() {
    if (state === 'over') { start(); return; }
    if (SINGLE) { start(); return; }
    dealLayout(level);
    toast('New layout dealt');
  }

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('new-btn').addEventListener('click', () => { newLayout(); $('new-btn').blur(); });
  $('undo-btn').addEventListener('click', () => { undo(); $('undo-btn').blur(); });
  $('hint-btn').addEventListener('click', () => { hint(); $('hint-btn').blur(); });
  $('shuffle-btn').addEventListener('click', () => { doShuffle(); $('shuffle-btn').blur(); });
  $('free-btn').addEventListener('click', () => {
    showFree = !showFree;
    $('free-btn').classList.toggle('on', showFree);
    $('free-btn').blur();
  });
  soundButton($('sound-btn'));
  if (CLASSIC && $('mode-link')) { $('mode-link').href = '/mahjong/'; $('mode-link').textContent = 'INFINITE MODE ▶'; }
  if (window.Leaderboard) {
    Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
    Leaderboard.nameBar(document.querySelector('#title .panel'));
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'play') state = 'pause';
    lastT = performance.now();
  });

  // the title-screen legend uses the same tile art as the table
  document.querySelectorAll('.lt').forEach((cv) => {
    const c = cv.getContext('2d');
    const f = faceOf(cv.dataset.face);
    const w = cv.width, h = cv.height, l = w * 0.1;
    c.fillStyle = '#8f8465';
    c.beginPath();
    if (c.roundRect) c.roundRect(0, 0, w, h, w * 0.12); else c.rect(0, 0, w, h);
    c.fill();
    c.fillStyle = '#fffdf3';
    c.beginPath();
    if (c.roundRect) c.roundRect(0, 0, w - l, h - l, w * 0.12); else c.rect(0, 0, w - l, h - l);
    c.fill();
    if (f) drawFace(c, f, 0, 0, w - l, h - l, false);
  });

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  function update(dt) {
    pulse += dt;
    for (const f of fx) f.t += dt;
    if (fx.length) fx = fx.filter((f) => f.t < 0.42);
    if (hintT > 0) hintT -= dt;
    if (banner) { banner.t += dt; if (banner.t > banner.life) banner = null; }
    if (state !== 'play') return;
    time += dt;
    layoutTime += dt;
    if (nextT > 0) {
      nextT -= dt;
      if (nextT <= 0) dealLayout(level + 1);
    }
  }

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(dt);
    hud();
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'mahjong',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => ({
        state, score: Math.round(score), tiles: alive().length, total: tiles.length, freePairs,
        pairs: freePairs, matched, level, layouts, layout: shapeName, time: Math.round(time),
        hints, shuffles, selected: sel ? sel.face.k : null,
      }),
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'hints') hints = v;
        else if (k === 'shuffles') shuffles = v;
        else if (k === 'level') { if (state !== 'play') start(); dealLayout(v); }
      },
      // match the first free pair on the table; returns the tile matched, or null when jammed
      autoPair: () => {
        if (state !== 'play') return null;
        const pair = findPair();
        if (!pair) return null;
        const key = pair[0].face.k;
        match(pair[0], pair[1]);
        return key;
      },
      hint, shuffle: doShuffle, undo, newLayout,
      // play the next pair of the order this layout was dealt in; false if it is not playable
      solveStep: () => {
        const next = plan.find(([a, b]) => !a.gone && !b.gone);
        if (!next || !next[0].free || !next[1].free) return false;
        match(next[0], next[1]);
        return true;
      },
      // clear the table the way a win does
      win: () => {
        if (state !== 'play') start();
        const left = alive().length;
        if (!left) return;
        tiles.forEach((t) => { t.gone = true; });
        matched += left / 2;
        score += (left / 2) * PAIR_POINTS;
        fx = [];
        sel = null;
        markFree(tiles, nbs);
        countPairs();
        layoutCleared();
        if (!SINGLE) { nextT = 0; endGame(false); }   // an endless run has no win: it stops here
      },
      layout: () => tiles.map((t) => ({ x: t.x, y: t.y, z: t.z, k: t.face.k, r: t.face.r })),
    };
  }
})();
