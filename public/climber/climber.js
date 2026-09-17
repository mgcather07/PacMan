/*
 * Barrel Climber — a Donkey Kong style single-screen platformer.
 *   Infinite  (/climber/)                towers forever: girders, rivets, conveyors and elevators
 *   Classic   (/climber/?mode=classic)   twelve hand-tuned towers you can win
 *   Daily     (/climber/?daily=…)        Infinite rules, every world decision seeded (see docs/ADDING_A_GAME.md)
 */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, bindPadButtons, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 480, FIELD_H = 640;
  const WALL = 12;
  const FLOOR_H = 92, GROUND_Y = 588;
  const floorY = (i) => GROUND_Y - i * FLOOR_H;   // 0 is the bottom floor, 5 the top girder
  const TOP_Y = floorY(5);                        // 128
  const PRIZE_Y = TOP_Y - 72;                     // the little platform the prize sits on, out of jumping reach
  const GT = 9;                                   // girder thickness
  const SLOPE = 9, GAP = 56;                      // girder tilt, and the gap barrels roll off
  const PW = 16, PH = 30;                         // the climber's box; his y is at his feet
  const PX = 2;                                   // sprite pixel size
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('climber') || (CLASSIC ? 'climber-classic' : 'climber');
  const FINAL_STAGE = 12;

  // Movement, tuned by hand. A tap jumps 52px and a held jump 62px, over 0.58–0.68s: high enough
  // that a barrel rolling at you passes underneath with room at either end, low enough that the floor
  // above (92px) and the prize platform (72px) still need a ladder.
  const GRAV = 1250, JUMP_V = 360, MAX_FALL = 700;
  const RUN = 118, ACCEL = 900, AIR_ACCEL = 620, FRICTION = 1400, AIR_DRAG = 260, TURN = 2.2;
  const COYOTE = 0.09, BUFFER = 0.13, HOLD_T = 0.12, HOLD_G = 0.72;
  const CLIMB = 88, CONV = 46, HAMMER_T = 7.5, BONUS_TICK = 1.0;   // 100 bonus a second

  const COL = {
    girder: '#c93a1e', girderLit: '#ff7a52', girderDark: '#6e1b08', rivet: '#ffd23f',
    ladder: '#7fd4ff', ladderDark: '#2f7fb0', barrel: '#d98a3a', barrelDark: '#8a4f18',
    fire: '#ff8c1a', hammer: '#cfd8e3', prize: '#ff5c8a', accent: '#9d4edd',
  };
  const ITEMS = { hat: 300, umbrella: 500, bag: 800 };

  // ---------------------------------------------------------------------------
  // Pixel sprites: '.' is transparent, digits index the palette below
  // ---------------------------------------------------------------------------
  const MAN_P = { 1: '#ff3b5c', 2: '#2f6bff', 3: '#ffcc99', 4: '#2a1c12' };
  const MAN = {
    stand: [
      '............', '...1111.....', '..111111....', '..133331....',
      '..333343....', '..333333....', '...3333.....', '..111111....',
      '.3111111....', '.3111111....', '..222222....', '..222222....',
      '..22..22....', '..22..22....', '.444..444...', '.444..444...',
    ],
    run1: [
      '............', '...1111.....', '..111111....', '..133331....',
      '..333343....', '..333333....', '...3333.....', '.1111111....',
      '31111113....', '.1111111....', '..222222....', '..222222....',
      '.222..222...', '.22....22...', '444....444..', '............',
    ],
    run2: [
      '............', '...1111.....', '..111111....', '..133331....',
      '..333343....', '..333333....', '...3333.....', '..111111....',
      '.3111113....', '..111111....', '..222222....', '..222222....',
      '..222222....', '..22..22....', '.444.444....', '............',
    ],
    run3: [
      '............', '...1111.....', '..111111....', '..133331....',
      '..333343....', '..333333....', '...3333.....', '.1111111....',
      '.11111113...', '.1111111....', '..222222....', '..222222....',
      '..222..222..', '...22...22..', '..444...444.', '............',
    ],
    jump: [
      '..3......3..', '..3.1111.3..', '..31111113..', '...133331...',
      '...333343...', '...333333...', '....3333....', '...111111...',
      '...111111...', '...222222...', '...222222...', '..22....22..',
      '.222....222.', '.44......44.', '.44......44.', '............',
    ],
    climb1: [
      '............', '...1111.....', '..111111....', '..111111....',
      '..311113....', '..311113....', '...1111.....', '..111111....',
      '..111111....', '..222222....', '..222222....', '..222222....',
      '..22..22....', '..22..22....', '.444..444...', '............',
    ],
    climb2: [
      '............', '...1111.....', '..111111....', '.3111113....',
      '.3111113....', '..111111....', '...1111.....', '..111111....',
      '..111111....', '..222222....', '..222222....', '..222222....',
      '..22..22....', '.22....22...', '444....444..', '............',
    ],
    dead: [
      '............', '............', '............', '...1111.....',
      '..111111....', '..133331....', '..344443....', '..333333....',
      '...3333.....', '.3111113....', '.3111113....', '..222222....',
      '.22....22...', '.44....44...', '............', '............',
    ],
  };

  const APE_P = { 2: '#a0603a', 3: '#f0c48a', 4: '#2a1408' };
  const APE = {
    calm: [
      '....2222222222....', '...222222222222...', '...223333333322...', '...233443344332...',
      '...233443344332...', '...233333333332...', '...223344443322...', '....2233333322....',
      '.2222333333332222.', '.2222333333332222.', '.2222333333332222.', '.2222333333332222.',
      '.2222222222222222.', '...222222222222...', '...2222....2222...',
    ],
    beat: [
      '....2222222222....', '...222222222222...', '...223333333322...', '...233443344332...',
      '...233443344332...', '.2223333333333222.', '.2222334444332222.', '.22.2233333322.22.',
      '...223333333322...', '...223333333322...', '...223333333322...', '...223333333322...',
      '...222222222222...', '...222222222222...', '...2222....2222...',
    ],
  };

  function drawSprite(g, rows, pal, x, y, px, flip) {
    const w = rows[0].length;
    g.save();
    g.translate(Math.round(x), Math.round(y));
    if (flip) { g.translate(w * px, 0); g.scale(-1, 1); }
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < w; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        g.fillStyle = pal[ch];
        g.fillRect(c * px, r * px, px, px);
      }
    }
    g.restore();
  }

  // ---------------------------------------------------------------------------
  // Canvas: a fixed tower scaled to the window, sitting high enough for the phone pad
  // ---------------------------------------------------------------------------
  let FH = 700, fieldY = 30;
  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    FH = clamp(Math.round((FW * v.H) / v.W), FIELD_H + 40, FIELD_H + 560);
    fieldY = Math.round(clamp((FH - FIELD_H) * 0.34, 20, 122));
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
    v.ctx.imageSmoothingEnabled = false;
  });
  const ctx = view.ctx;
  ctx.imageSmoothingEnabled = false;

  // ---------------------------------------------------------------------------
  // Seeded randomness: the stage order comes from the world stream, every layout and
  // timing decision inside a stage from that stage's own seed (so a retry is identical)
  // ---------------------------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let wrand = Math.random;      // world stream: which tower comes next, and its seed
  let srand = Math.random;      // this stage's stream: layout, barrel timing, fireball paths
  const sr = (a, b) => a + srand() * (b - a);
  const spick = (arr) => arr[Math.floor(srand() * arr.length)];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let state = 'title';
  let paused = false;
  let girders, ladders, rivets, items, hammers, foes, particles, popups, goal, ape, lifts;
  let player, def, stage, stageSeeds, score, lives, bonus, bonusT, time, jumps, smashes, lastType;
  let shake, flash, banner, cleared, spawnT, springT, convT, foeId, springG;
  let high = store.get(Arcade.modeKey('climber.high'), 0);

  // Classic: twelve hand-tuned towers. seed fixes the layout so everyone climbs the same twelve.
  const CLASSIC_STAGES = [
    { type: 'girders',   seed: 10117, barrelEvery: 3.0, barrelSpeed: 84, ladderOdds: 0.15, fires: 0, hammers: 1, bonus: 6000 },
    { type: 'girders',   seed: 20223, barrelEvery: 2.5, barrelSpeed: 88, ladderOdds: 0.28, fires: 1, hammers: 1, bonus: 6000 },
    { type: 'rivets',    seed: 30331, barrelEvery: 0,   barrelSpeed: 0,  ladderOdds: 0,    fires: 2, hammers: 1, bonus: 7000 },
    { type: 'conveyor',  seed: 40447, barrelEvery: 2.4, barrelSpeed: 88, ladderOdds: 0.2,  fires: 2, hammers: 1, bonus: 6200 },
    { type: 'girders',   seed: 50559, barrelEvery: 2.1, barrelSpeed: 92, ladderOdds: 0.35, fires: 2, hammers: 1, bonus: 6000 },
    { type: 'elevator',  seed: 60661, barrelEvery: 0,   barrelSpeed: 0,  ladderOdds: 0,    fires: 2, hammers: 1, bonus: 6000 },
    { type: 'rivets',    seed: 70773, barrelEvery: 0,   barrelSpeed: 0,  ladderOdds: 0,    fires: 3, hammers: 1, bonus: 6800 },
    { type: 'conveyor',  seed: 80887, barrelEvery: 2.0, barrelSpeed: 96, ladderOdds: 0.3,  fires: 3, hammers: 1, bonus: 6000 },
    { type: 'girders',   seed: 90997, barrelEvery: 1.7, barrelSpeed: 100, ladderOdds: 0.45, fires: 3, hammers: 1, bonus: 6400 },
    { type: 'elevator',  seed: 11009, barrelEvery: 0,   barrelSpeed: 0,  ladderOdds: 0,    fires: 3, hammers: 1, bonus: 6400 },
    { type: 'rivets',    seed: 12101, barrelEvery: 0,   barrelSpeed: 0,  ladderOdds: 0,    fires: 4, hammers: 1, bonus: 6600 },
    { type: 'girders',   seed: 13203, barrelEvery: 1.4, barrelSpeed: 108, ladderOdds: 0.55, fires: 4, hammers: 2, bonus: 5600 },
  ];
  const TYPES = ['girders', 'rivets', 'conveyor', 'elevator'];

  function stageDef(n) {
    if (CLASSIC) return CLASSIC_STAGES[Math.min(n, FINAL_STAGE) - 1];
    const d = Math.min(1, (n - 1) / 16);
    let type = 'girders';
    if (n > 1) {
      type = TYPES[Math.floor(wrand() * TYPES.length)];
      if (type === lastType) type = TYPES[(TYPES.indexOf(type) + 1) % TYPES.length];
    }
    lastType = type;
    return {
      type,
      seed: Math.floor(wrand() * 2147483647),
      barrelEvery: 2.8 - d * 1.5,
      barrelSpeed: 84 + d * 24,
      ladderOdds: 0.15 + d * 0.45,
      fires: Math.min(5, Math.floor((n - 1) / 2)),
      hammers: n % 5 === 0 ? 2 : 1,
      bonus: Math.max(4200, 6000 - (n - 1) * 150) + (type === 'rivets' ? 1400 : type === 'elevator' ? 800 : 0),
    };
  }

  // ---------------------------------------------------------------------------
  // Girders and ladders
  // ---------------------------------------------------------------------------
  function addG(x1, y1, x2, y2, extra) {
    const g = Object.assign({ x1, y1, x2, y2, holes: [], conv: 0, lift: null }, extra || {});
    girders.push(g);
    return g;
  }

  // the surface height of a girder at x, or null when x is past an end or over a hole
  function girderY(g, x) {
    if (!g || x < g.x1 || x > g.x2) return null;
    for (const h of g.holes) if (x > h[0] && x < h[1]) return null;
    return g.y1 + ((g.y2 - g.y1) * (x - g.x1)) / (g.x2 - g.x1 || 1);
  }
  const downhill = (g) => (g.y2 > g.y1 ? 1 : g.y2 < g.y1 ? -1 : 0);
  // which way off a flat girder a barrel can actually leave (the end that is not against a wall)
  const openDir = (g) => (g.x2 < FW - WALL - 2 ? 1 : g.x1 > WALL + 2 ? -1 : 0);

  // the drawable pieces of a girder once its holes are cut out
  function spans(g) {
    let out = [[g.x1, g.x2]];
    for (const h of g.holes) {
      const next = [];
      for (const [a, b] of out) {
        if (h[1] <= a || h[0] >= b) { next.push([a, b]); continue; }
        if (h[0] > a) next.push([a, h[0]]);
        if (h[1] < b) next.push([h[1], b]);
      }
      out = next;
    }
    return out;
  }

  function linkLadder(x, gTop, gLow, short) {
    x = Math.round(x);
    const top = girderY(gTop, x), bottom = girderY(gLow, x);
    if (top === null || bottom === null || bottom - top < 30) return null;
    const l = { x, top: short ? top + 36 : top, bottom, short: !!short, gTop, gLow };
    ladders.push(l);
    return l;
  }

  // the closest surface to y at x, within a window — how the climber stays glued to a slope
  function surfaceNear(x, y, up, down) {
    let best = null;
    for (const g of girders) {
      const sy = girderY(g, x);
      if (sy === null || sy < y - up || sy > y + down) continue;
      if (!best || Math.abs(sy - y) < Math.abs(best.sy - y)) best = { g, sy };
    }
    return best;
  }

  // the girder a falling body crosses between y0 and y1
  function landOn(x, y0, y1) {
    let best = null;
    for (const g of girders) {
      const sy = girderY(g, x);
      if (sy === null) continue;
      if (y0 <= sy + 2.5 && y1 >= sy) { if (!best || sy < best.sy) best = { g, sy }; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Stage building
  // ---------------------------------------------------------------------------
  function placeItem(g, x, kind) {
    const y = girderY(g, x);
    if (y === null) return;
    items.push({ x, y, kind, t: 0, got: false });
  }
  // hammers are kept clear of ladders: grabbing one you cannot climb with, right where you step
  // off a ladder, is the one bit of Donkey Kong nobody misses
  // hammers are nudged clear of ladders: you cannot climb holding one, so having to walk past a
  // ladder you wanted is enough of a cost without standing on top of it
  function placeHammer(g, x) {
    const clear = (v) => ladders.every((l) => Math.abs(l.x - v) > 30) && v > g.x1 + 18 && v < g.x2 - 18;
    if (!clear(x)) {
      for (let d = 34; d <= 200 && !clear(x); d += 34) {
        if (clear(x - d)) x -= d;
        else if (clear(x + d)) x += d;
      }
    }
    const y = girderY(g, clamp(x, g.x1 + 18, g.x2 - 18));
    if (y === null) return;
    hammers.push({ x: clamp(x, g.x1 + 18, g.x2 - 18), y: y - 26, used: false, t: 0 });
  }

  function scatterExtras(floors, lo, hi) {
    const kinds = ['hat', 'umbrella', 'bag'];
    const n = 1 + (srand() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const g = floors[1 + Math.floor(srand() * (floors.length - 2))];
      placeItem(g, Math.round(sr(lo, hi)), spick(kinds));
    }
    for (let i = 0; i < (def.hammers || 1); i++) {
      const g = floors[1 + Math.floor(srand() * Math.max(1, floors.length - 2))];
      placeHammer(g, Math.round(sr(lo, hi)));
    }
  }

  function addFires(floors, n) {
    for (let i = 0; i < n; i++) {
      const g = floors[Math.min(floors.length - 1, 1 + Math.floor(srand() * (floors.length - 1)))];
      const x = Math.round(sr(g.x1 + 30, g.x2 - 30));
      const y = girderY(g, x);
      if (y === null) continue;
      foes.push({ id: foeId++, kind: 'fire', x, px: x, y, g, dir: srand() < 0.5 ? -1 : 1, speed: 38 + srand() * 22, think: sr(0.4, 1.4), lad: null, climbDir: 0, t: srand() * 3 });
    }
  }

  // the classic tower: six sloped girders, the ape at the top left, the prize above the far right
  function buildGirderTower() {
    const floors = [];
    floors[0] = addG(0, GROUND_Y + 5, FW, GROUND_Y - 5);   // rolls down to the left, into the drum
    for (let i = 1; i <= 5; i++) {
      const right = i % 2 === 1;
      const y = floorY(i);
      floors[i] = right ? addG(WALL, y - SLOPE, FW - WALL - GAP, y + SLOPE)
        : addG(WALL + GAP, y + SLOPE, FW - WALL, y - SLOPE);
    }
    for (let i = 0; i < 5; i++) {
      const lo = i === 4 ? 180 : 82, hi = 396;
      const x = Math.round(sr(lo, hi));
      linkLadder(x, floors[i + 1], floors[i], false);
      if (srand() < 0.6) {
        let x2 = Math.round(sr(lo, hi));
        if (Math.abs(x2 - x) < 76) x2 = clamp(x + (x2 > x ? 86 : -86), lo, hi);
        linkLadder(x2, floors[i + 1], floors[i], i >= 1 && i <= 3 && srand() < 0.5);
      }
    }
    const plat = addG(296, PRIZE_Y, FW - WALL, PRIZE_Y);
    linkLadder(336, plat, floors[5], false);
    goal = { x: 430, y: PRIZE_Y, t: 0 };
    ape = { x: 78, y: girderY(floors[5], 78), throws: true, t: 0, anim: 0, slam: sr(3, 6) };
    player.x = 52; player.y = girderY(floors[0], 52);
    scatterExtras(floors, 100, 380);
    addFires(floors, def.fires);
  }

  // rivets: flat girders whose ends fall away as you walk over them
  function buildRivetTower() {
    const floors = [];
    floors[0] = addG(0, GROUND_Y, FW, GROUND_Y);
    for (let i = 1; i <= 5; i++) floors[i] = addG(WALL, floorY(i), FW - WALL, floorY(i));
    // a rivet sits just inside each end; pulling it drops the girder behind you, never under you
    for (let i = 1; i <= 4; i++) {
      rivets.push({ x: WALL + 72, y: floorY(i), g: floors[i], side: -1, got: false });
      rivets.push({ x: FW - WALL - 72, y: floorY(i), g: floors[i], side: 1, got: false });
    }
    // ladders reach the four rivet floors; the top girder is the ape's perch, and his alone
    for (let i = 0; i < 4; i++) {
      const x = Math.round(sr(150, 330));
      linkLadder(x, floors[i + 1], floors[i], false);
      if (srand() < 0.5) linkLadder(clamp(x + (srand() < 0.5 ? -96 : 96), 140, 340), floors[i + 1], floors[i], false);
    }
    goal = null;   // pulling the last rivet drops the ape
    ape = { x: FW / 2 - 36, y: floorY(5), throws: false, t: 0, anim: 0, slam: sr(2.5, 5) };
    player.x = 60; player.y = GROUND_Y;
    scatterExtras(floors, 140, 340);
    addFires(floors, def.fires + 1);
  }

  // conveyors: flat belts that shove you and the barrels along, and flip every few seconds
  function buildConveyorTower() {
    const floors = [];
    floors[0] = addG(0, GROUND_Y, FW, GROUND_Y);
    for (let i = 1; i <= 5; i++) {
      const right = i % 2 === 1;
      const y = floorY(i);
      floors[i] = right ? addG(WALL, y, FW - WALL - GAP, y) : addG(WALL + GAP, y, FW - WALL, y);
      floors[i].conv = (right ? 1 : -1) * CONV;
    }
    for (let i = 0; i < 5; i++) {
      const lo = i === 4 ? 180 : 82, hi = 396;
      const x = Math.round(sr(lo, hi));
      linkLadder(x, floors[i + 1], floors[i], false);
      if (srand() < 0.5) linkLadder(clamp(x + (srand() < 0.5 ? -96 : 96), lo, hi), floors[i + 1], floors[i], false);
    }
    const plat = addG(296, PRIZE_Y, FW - WALL, PRIZE_Y);
    linkLadder(336, plat, floors[5], false);
    goal = { x: 430, y: PRIZE_Y, t: 0 };
    ape = { x: 70, y: TOP_Y, throws: true, t: 0, anim: 0, slam: sr(3, 6) };
    player.x = 52; player.y = GROUND_Y;
    convT = sr(5, 8);
    scatterExtras(floors, 100, 380);
    addFires(floors, def.fires + 1);
  }

  // elevators: a shaft of rising platforms, a shaft of sinking ones, and springs along the top
  // elevators: a shaft of rising platforms to ride, a shaft of sinking ones to come back down,
  // and springs bouncing along the top girder
  function buildElevatorTower() {
    const base = addG(0, GROUND_Y, FW, GROUND_Y);
    const l1 = addG(0, floorY(1), 150, floorY(1));
    const l2 = addG(0, floorY(2), 150, floorY(2));
    linkLadder(36, l1, base, false);
    linkLadder(112, l2, l1, false);
    addG(0, floorY(4), 96, floorY(4));   // the ape watches from a ledge nobody can reach
    // the rising shaft starts where the left tower ends, so you walk on instead of leaping a gap
    for (let k = 0; k < 4; k++) lifts.push(addG(150, 0, 202, 0, { lift: { dir: -1, off: k * 105, speed: 52, span: 420, low: 560 } }));
    for (let k = 0; k < 3; k++) lifts.push(addG(416, 0, 468, 0, { lift: { dir: 1, off: k * 140, speed: 52, span: 420, low: 560 } }));
    const m1 = addG(206, floorY(3), 300, floorY(3));
    const m2 = addG(206, floorY(4), 380, floorY(4));
    const top = addG(240, TOP_Y, 410, TOP_Y);
    linkLadder(250, m2, m1, false);
    linkLadder(350, top, m2, false);
    if (srand() < 0.6) linkLadder(300, m2, m1, true);
    springG = top;
    goal = { x: 286, y: TOP_Y, t: 0 };
    ape = { x: 8, y: floorY(4), throws: false, t: 0, anim: 0, slam: sr(2, 4) };
    player.x = 52; player.y = GROUND_Y;
    springT = sr(1.5, 3);
    placeItem(m1, 280, 'hat');
    placeItem(l2, 100, srand() < 0.5 ? 'umbrella' : 'bag');
    placeHammer(m2, Math.round(sr(280, 360)));
    addFires([base, l1, l2, m1, m2, top], Math.max(2, def.fires));
  }

  function buildStage() {
    girders = []; ladders = []; rivets = []; items = []; hammers = []; foes = []; lifts = [];
    particles = []; popups = []; goal = null; ape = null;
    foeId = 1;
    springG = null;
    spawnT = 2.2; springT = 3; convT = 6;
    if (def.type === 'rivets') buildRivetTower();
    else if (def.type === 'conveyor') buildConveyorTower();
    else if (def.type === 'elevator') buildElevatorTower();
    else buildGirderTower();
    Object.assign(player, {
      vx: 0, vy: 0, onGround: true, coyote: 0, buffer: 0, hold: 0, facing: 1, climb: null,
      runT: 0, hammer: 0, swing: 0, smashRun: 0, dead: 0, support: null, jumped: [], airborne: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Rounds
  // ---------------------------------------------------------------------------
  function startStage(n) {
    stage = n;
    if (!stageSeeds[n]) {
      const d = stageDef(n);
      stageSeeds[n] = d;
    }
    def = stageSeeds[n];
    srand = mulberry32(def.seed >>> 0);
    buildStage();
    bonus = def.bonus;
    bonusT = BONUS_TICK;
    cleared = 0;
    banner = { text: CLASSIC ? `TOWER ${n}/${FINAL_STAGE}` : `TOWER ${n}`, t: 0 };
    Sound.arp([392, 523, 659], 0.09, 'square', 0.035);
  }

  function restartStage() {
    srand = mulberry32(def.seed >>> 0);
    buildStage();
    bonus = def.bonus;
    bonusT = BONUS_TICK;
    cleared = 0;
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('climber') : Math.random;
    lastType = null;
    stageSeeds = {};
    player = { x: 60, y: GROUND_Y, vx: 0, vy: 0, facing: 1, dead: 0, jumped: [] };
    score = 0; lives = 3; time = 0; jumps = 0; smashes = 0;
    shake = 0; flash = 0; banner = null;
    startStage(1);
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
    if (window.Leaderboard) Leaderboard.startRun(BOARD);
  }

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-stage').textContent = CLASSIC ? `${Math.min(stage, FINAL_STAGE)}/${FINAL_STAGE}` : stage;
    $('o-jumps').textContent = jumps.toLocaleString();
    $('o-smash').textContent = smashes.toLocaleString();
    Arcade.endScreen(won, won ? 'Twelve towers climbed. The ape finally lets go.' : `You reached tower ${stage}.`);
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won, time: Math.round(time) }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------
  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: '+' + n, t: 0 });
    if (score >= (player.nextLife || 20000)) {
      player.nextLife = (player.nextLife || 20000) + 40000;
      lives++;
      toast('EXTRA CLIMBER!');
      Sound.arp([523, 659, 784, 1046], 0.07);
    }
    if (score > high) { high = score; store.set(Arcade.modeKey('climber.high'), high); }
  }

  function burst(x, y, color, n, speed = 190) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(30, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, t: 0, life: rand(0.25, 0.7), c: Math.random() < 0.3 ? '#fff' : color, s: rand(2, 4) });
    }
  }

  function clearStage() {
    if (state !== 'play' || cleared > 0) return;
    cleared = 1.9;
    addScore(bonus, player.x, player.y - 42);
    toast(`TOP! BONUS +${bonus.toLocaleString()}`);
    Sound.arp([523, 659, 784, 1046, 1318], 0.1, 'square', 0.05);
    burst(player.x, player.y - 16, COL.prize, 26, 240);
    player.hammer = 0;
  }

  function finishClear() {
    cleared = 0;
    if (CLASSIC && stage >= FINAL_STAGE) endGame(true);
    else startStage(stage + 1);
  }

  function die(reason) {
    if (state !== 'play' || player.dead > 0 || cleared > 0) return;
    player.dead = 1.5;
    player.vx = 0; player.vy = 0; player.climb = null; player.hammer = 0;
    lives--;
    shake = 10; flash = 0.22;
    Sound.tone(420, 90, 0.7, 'sawtooth', 0.05);
    Sound.noise(0.5, 0.12, 0.1, 900);
    if (reason === 'time') toast('OUT OF TIME!');
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const keys = new Set();
  let prevJump = false, prevUp = false;

  function canClimbUp() {
    for (const l of ladders) {
      if (Math.abs(player.x - l.x) > 11) continue;
      if (player.y > l.top + 2 && player.y <= l.bottom + 3) return l;
    }
    return null;
  }
  function canClimbDown() {
    for (const l of ladders) {
      if (Math.abs(player.x - l.x) > 11) continue;
      if (Math.abs(player.y - l.top) < 5 && l.bottom > l.top + 20) return l;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // The climber
  // ---------------------------------------------------------------------------
  function updatePlayer(dt) {
    const p = player;
    if (p.dead > 0) {
      p.dead -= dt;
      p.deadT = (p.deadT || 0) + dt;
      if (p.dead <= 0) {
        if (lives <= 0) endGame(false);
        else { p.deadT = 0; restartStage(); }
      }
      return;
    }

    const left = keys.has('left'), right = keys.has('right'), up = keys.has('up'), down = keys.has('down');
    const jumpHeld = keys.has('jump') || (up && !p.climb);
    // UP doubles as jump when there is no ladder to grab; both get a short input buffer
    let jumpEdge = keys.has('jump') && !prevJump;
    if (up && !prevUp && !p.climb && !canClimbUp()) jumpEdge = true;
    if (jumpEdge) p.buffer = BUFFER;
    if (p.buffer > 0) p.buffer -= dt;
    if (p.hammer > 0) {
      p.hammer -= dt;
      p.swing += dt;
      if (p.hammer <= 0) { p.hammer = 0; p.smashRun = 0; toast('HAMMER GONE'); }
    }

    // --- on a ladder ---
    if (p.climb) {
      const l = p.climb;
      p.x = l.x;
      p.vx = 0;
      let move = 0;
      if (up) move -= 1;
      if (down) move += 1;
      p.y += move * CLIMB * dt;
      if (move) {
        const before = Math.floor(p.runT / 14);
        p.runT += CLIMB * dt;
        if (Math.floor(p.runT / 14) !== before) Sound.tone(260, 300, 0.035, 'square', 0.014);
      }
      if (p.y <= l.top) { p.y = l.top; p.climb = null; p.onGround = true; p.support = l.gTop; p.vy = 0; }
      else if (p.y >= l.bottom) { p.y = l.bottom; p.climb = null; p.onGround = true; p.support = l.gLow; p.vy = 0; }
      else if (left || right) {
        // step off where a girder meets the ladder, otherwise keep hold
        const near = surfaceNear(p.x, p.y, 9, 9);
        if (near) { p.y = near.sy; p.climb = null; p.onGround = true; p.support = near.g; p.facing = right ? 1 : -1; }
      }
      if (p.climb && p.buffer > 0) {   // let go and drop
        p.climb = null; p.onGround = false; p.vy = 0; p.buffer = 0; p.coyote = 0;
        p.vx = (left ? -1 : right ? 1 : 0) * 70;
        Sound.tone(300, 200, 0.08, 'square', 0.02);
      }
      return;
    }

    // --- grab a ladder ---
    if (p.onGround && p.hammer <= 0) {
      if (up) { const l = canClimbUp(); if (l) { p.climb = l; p.x = l.x; p.onGround = false; p.vy = 0; p.vx = 0; p.buffer = 0; return; } }
      if (down) { const l = canClimbDown(); if (l) { p.climb = l; p.x = l.x; p.y = l.top + 1; p.onGround = false; p.vy = 0; p.vx = 0; p.buffer = 0; return; } }
    }

    // --- run ---
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    const accel = p.onGround ? ACCEL : AIR_ACCEL;
    if (dir) {
      p.facing = dir;
      p.vx += dir * accel * (dir * p.vx < 0 ? TURN : 1) * dt;
      p.vx = clamp(p.vx, -RUN, RUN);
    } else {
      const drag = (p.onGround ? FRICTION : AIR_DRAG) * dt;
      p.vx -= Math.sign(p.vx) * Math.min(Math.abs(p.vx), drag);
    }
    p.runT += Math.abs(p.vx) * dt;

    // --- jump ---
    if (p.buffer > 0 && (p.onGround || p.coyote > 0) && p.hammer <= 0) {
      p.vy = -JUMP_V;
      p.onGround = false;
      p.coyote = 0;
      p.buffer = 0;
      p.hold = HOLD_T;
      p.support = null;
      p.jumped = [];
      Sound.tone(360, 720, 0.1, 'square', 0.03);
    }

    // --- move horizontally, with the belt under your feet ---
    const conv = p.onGround && p.support ? p.support.conv : 0;
    p.x += (p.vx + conv) * dt;
    p.x = clamp(p.x, WALL + PW / 2, FW - WALL - PW / 2);

    // --- gravity and landing ---
    if (!p.onGround) {
      const g = p.vy < 0 && p.hold > 0 && jumpHeld ? GRAV * HOLD_G : GRAV;
      if (p.hold > 0) p.hold -= dt;
      p.vy = Math.min(MAX_FALL, p.vy + g * dt);
      const y0 = p.y;
      p.y += p.vy * dt;
      if (p.coyote > 0) p.coyote -= dt;
      if (p.vy >= 0) {
        const hit = landOn(p.x, y0, p.y);
        if (hit) {
          p.y = hit.sy; p.vy = 0; p.onGround = true; p.support = hit.g; p.hold = 0;
          Sound.noise(0.06, 0.035, 0, 600);
          scoreJumps();
        }
      }
      if (p.y > FIELD_H + 40) die('fall');
    } else {
      // glued to the slope under his feet; running off an end starts the coyote window
      const near = surfaceNear(p.x, p.y, 8, 10);
      if (near) { p.y = near.sy; p.support = near.g; p.vy = 0; }
      else { p.onGround = false; p.coyote = COYOTE; p.support = null; p.jumped = []; }
    }
  }

  function scoreJumps() {
    const n = player.jumped.length;
    player.jumped = [];
    if (!n) return;
    jumps += n;
    const pts = [0, 100, 200, 300][Math.min(n, 3)];
    addScore(pts, player.x, player.y - 40);
    Sound.arp(n > 1 ? [660, 880, 1180] : [660, 990], 0.05, 'triangle', 0.045);
    if (n > 1) toast(n === 2 ? 'DOUBLE JUMP! +200' : 'TRIPLE JUMP! +300');
  }

  // ---------------------------------------------------------------------------
  // The ape and his barrels
  // ---------------------------------------------------------------------------
  function spawnBarrel() {
    foes.push({
      id: foeId++, kind: 'barrel', x: ape.x + 44, y: ape.y - 34, vy: 0, dir: 1, rot: 0,
      speed: def.barrelSpeed, g: null, lad: null, seen: null,
    });
    ape.anim = 0.45;
    Sound.tone(150, 70, 0.22, 'sawtooth', 0.045);
  }

  function updateApe(dt) {
    if (!ape) return;
    ape.t += dt;
    if (ape.anim > 0) ape.anim -= dt;
    ape.slam -= dt;
    if (ape.slam <= 0) {
      ape.slam = sr(3.5, 7);
      ape.anim = 0.5;
      shake = Math.max(shake, 7);
      Sound.noise(0.28, 0.13, 0, 340);
      Sound.tone(90, 60, 0.3, 'sawtooth', 0.05);
    }
    if (ape.throws && def.barrelEvery > 0 && cleared <= 0) {
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = sr(def.barrelEvery * 0.72, def.barrelEvery * 1.3);
        // a hard ceiling on live barrels: a screen you cannot read is not difficulty
        if (foes.filter((f) => f.kind === 'barrel').length < 8) spawnBarrel();
      }
    }
    if (def.type === 'elevator' && cleared <= 0) {
      springT -= dt;
      if (springT <= 0) {
        springT = sr(2.2, 3.8);
        if (springG) {
          foes.push({ id: foeId++, kind: 'spring', x: springG.x2 - 16, y: TOP_Y, vx: -78, vy: -120, g: springG, t: 0 });
          Sound.tone(900, 260, 0.12, 'square', 0.03);
        }
      }
    }
  }

  function updateBarrel(b, dt) {
    if (b.lad) {
      b.y += 104 * dt;
      b.rot += dt * 6;
      if (b.y >= b.lad.bottom) { b.y = b.lad.bottom; b.g = b.lad.gLow; b.lad = null; b.dir = downhill(b.g) || openDir(b.g) || b.dir; }
      return;
    }
    if (!b.g) {
      b.vy = Math.min(MAX_FALL, b.vy + GRAV * dt);
      const y0 = b.y;
      b.y += b.vy * dt;
      b.rot += dt * 4;
      const hit = landOn(b.x, y0, b.y);
      if (hit) {
        b.y = hit.sy; b.vy = 0; b.g = hit.g; b.seen = null;
        b.dir = downhill(hit.g) || openDir(hit.g) || b.dir;
        Sound.noise(0.07, 0.04, 0, 500);
      }
      if (b.y > FIELD_H + 60) b.dead = true;
      return;
    }
    const g = b.g;
    const dh = downhill(g);
    // barrels always head for the open end of a girder; a slope or a belt running the same way only
    // makes them faster, so there is no such thing as a barrel too slow to hop
    const speed = b.speed * (dh === 0 ? 1 : dh === b.dir ? 1.18 : 0.82) + Math.max(0, b.dir * g.conv);
    const vx = b.dir * speed;
    b.x += vx * dt;
    b.rot += (vx * dt) / 7;
    if (b.x < 2 || b.x > FW - 2) { b.dead = true; return; }
    const sy = girderY(g, b.x);
    if (sy === null) {
      const atLeft = b.x <= g.x1, atRight = b.x >= g.x2;
      const solid = (atLeft && g.x1 <= WALL + 2) || (atRight && g.x2 >= FW - WALL - 2);
      if (solid) { b.dir = -b.dir; b.x = clamp(b.x, g.x1 + 1, g.x2 - 1); b.y = girderY(g, b.x) || b.y; }
      else { b.g = null; b.vy = 30; }
      return;
    }
    b.y = sy;
    for (const l of ladders) {
      if (l.short || Math.abs(b.x - l.x) > 4 || Math.abs(b.y - l.top) > 7) continue;
      if (b.seen === l) break;
      b.seen = l;
      if (srand() < def.ladderOdds) { b.lad = l; b.x = l.x; b.y = l.top; b.g = null; }
      break;
    }
  }

  function updateFire(f, dt) {
    f.t += dt;
    if (f.lad) {
      f.y += f.climbDir * 66 * dt;
      if (f.climbDir < 0 && f.y <= f.lad.top) { f.y = f.lad.top; f.g = f.lad.gTop; f.lad = null; f.px = f.x; }
      if (f.climbDir > 0 && f.y >= f.lad.bottom) { f.y = f.lad.bottom; f.g = f.lad.gLow; f.lad = null; f.px = f.x; }
      return;
    }
    f.think -= dt;
    if (f.think <= 0) {
      f.think = sr(0.6, 1.7);
      if (player && Math.abs(player.y - f.y) < 36 && player.dead <= 0) f.dir = player.x < f.x ? -1 : 1;
      else if (srand() < 0.35) f.dir = -f.dir;
      for (const l of ladders) {
        if (l.short || Math.abs(f.x - l.x) > 13) continue;
        if (Math.abs(f.y - l.bottom) < 6 && srand() < 0.55) { f.lad = l; f.x = l.x; f.climbDir = -1; f.g = null; return; }
        if (Math.abs(f.y - l.top) < 6 && srand() < 0.45) { f.lad = l; f.x = l.x; f.climbDir = 1; f.g = null; return; }
      }
    }
    f.x += f.dir * f.speed * dt;
    const sy = girderY(f.g, f.x);
    if (sy === null) {
      f.x = f.px === undefined ? clamp(f.x, f.g.x1 + 4, f.g.x2 - 4) : f.px;
      f.dir = -f.dir;
      const back = girderY(f.g, f.x);
      if (back !== null) f.y = back;
    } else { f.y = sy; f.px = f.x; }
  }

  function updateSpring(s, dt) {
    s.t += dt;
    s.vy += GRAV * 0.8 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.g) {
      const sy = girderY(s.g, s.x);
      if (sy === null) s.g = null;
      else if (s.y >= sy && s.vy > 0) { s.y = sy; s.vy = -215; Sound.tone(1100, 600, 0.07, 'square', 0.025); }
    }
    if (s.y > FIELD_H + 50 || s.x < -30) s.dead = true;
  }

  // ---------------------------------------------------------------------------
  // Contact
  // ---------------------------------------------------------------------------
  // hurt boxes are a little smaller than the sprites: a barrel that clips your heel should roll on
  function foeBox(f) {
    if (f.kind === 'barrel') return { x: f.x - 7.5, y: f.y - 11, w: 15, h: 11 };
    if (f.kind === 'spring') return { x: f.x - 6, y: f.y - 13, w: 12, h: 13 };
    return { x: f.x - 6, y: f.y - 15, w: 12, h: 15 };
  }
  const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function smash(f) {
    f.dead = true;
    smashes++;
    const pts = [300, 500, 800][Math.min(player.smashRun, 2)];
    player.smashRun++;
    addScore(pts, f.x, f.y - 24);
    burst(f.x, f.y - 10, f.kind === 'barrel' ? COL.barrel : COL.fire, 16, 220);
    shake = Math.max(shake, 5);
    Sound.noise(0.16, 0.1, 0, 2200);
    Sound.tone(520, 180, 0.12, 'square', 0.04);
  }

  function contact() {
    const p = player;
    if (p.dead > 0 || cleared > 0) return;
    const box = { x: p.x - 5.5, y: p.y - 26, w: 11, h: 26 };            // what barrels and fire can hit
    const reach = { x: p.x - 10, y: p.y - PH, w: 20, h: PH };           // what you can pick up
    const hammerBox = p.hammer > 0
      ? { x: p.facing > 0 ? p.x + 2 : p.x - 32, y: p.y - 44, w: 30, h: 48 }
      : null;
    for (const f of foes) {
      if (f.dead) continue;
      const fb = foeBox(f);
      if (hammerBox && hits(hammerBox, fb)) { smash(f); continue; }
      if (hits(box, fb)) { die('hit'); return; }
      // jumped clean over it?
      if (!p.onGround && !p.climb && p.y < f.y - 10 && Math.abs(f.x - p.x) < 24 && !p.jumped.includes(f.id)) p.jumped.push(f.id);
    }
    for (const it of items) {
      if (it.got) continue;
      if (hits(reach, { x: it.x - 12, y: it.y - 20, w: 24, h: 20 })) {
        it.got = true;
        addScore(ITEMS[it.kind], it.x, it.y - 26);
        toast(`${it.kind.toUpperCase()} +${ITEMS[it.kind]}`);
        burst(it.x, it.y - 10, COL.prize, 12, 150);
        Sound.arp([660, 990, 1320], 0.05, 'triangle', 0.05);
      }
    }
    for (const h of hammers) {
      if (h.used || p.climb) continue;   // you cannot take a hammer off a ladder
      if (hits(reach, { x: h.x - 12, y: h.y - 6, w: 24, h: 30 })) {
        h.used = true;
        p.hammer = HAMMER_T;
        p.swing = 0;
        p.smashRun = 0;
        p.climb = null;
        toast('HAMMER!');
        Sound.arp([392, 523, 659, 880], 0.06, 'square', 0.05);
      }
    }
    for (const r of rivets) {
      if (r.got) continue;
      if (Math.abs(p.x - r.x) < 13 && Math.abs(p.y - r.y) < 16 && p.onGround) {
        r.got = true;
        addScore(100, r.x, r.y - 26);
        if (r.side < 0) r.g.x1 = WALL + 60;
        else r.g.x2 = FW - WALL - 60;
        burst(r.x, r.y, COL.rivet, 10, 160);
        shake = Math.max(shake, 4);
        Sound.tone(880, 300, 0.1, 'square', 0.04);
        if (rivets.every((rr) => rr.got)) clearStage();
      }
    }
    if (ape && hits(box, { x: ape.x + 14, y: ape.y - 48, w: 44, h: 46 })) { die('ape'); return; }
    if (goal && Math.abs(p.x - goal.x) < 24 && Math.abs(p.y - goal.y) < 36) clearStage();
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    time += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 22);
    if (flash > 0) flash -= dt;
    if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.9);
    if (goal) goal.t += dt;
    for (const it of items) it.t += dt;
    for (const h of hammers) h.t += dt;
    if (state !== 'play') return;

    if (cleared > 0) {
      cleared -= dt;
      if (cleared <= 0) finishClear();
      return;
    }

    // the bonus timer is the clock on the whole stage
    if (player.dead <= 0) {
      bonusT -= dt;
      if (bonusT <= 0) {
        bonusT += BONUS_TICK;
        bonus -= 100;
        if (bonus <= 300) Sound.tone(300, 260, 0.07, 'square', 0.03);
        if (bonus <= 0) { bonus = 0; die('time'); }
      }
    }

    // elevators
    for (const g of lifts) {
      const L = g.lift;
      const t = ((time * L.speed + L.off) % L.span + L.span) % L.span;
      const y = L.dir < 0 ? L.low - t : L.low - L.span + t;
      g.y1 = y; g.y2 = y;
    }
    // conveyors flip every few seconds
    if (def.type === 'conveyor') {
      convT -= dt;
      if (convT <= 0) {
        convT = sr(5, 8.5);
        for (const g of girders) g.conv = -g.conv;
        Sound.tone(220, 180, 0.18, 'sawtooth', 0.03);
        toast('BELTS REVERSED');
      }
    }

    updateApe(dt);
    updatePlayer(dt);
    prevJump = keys.has('jump');
    prevUp = keys.has('up');
    for (const f of foes) {
      if (f.dead) continue;
      if (f.kind === 'barrel') updateBarrel(f, dt);
      else if (f.kind === 'fire') updateFire(f, dt);
      else updateSpring(f, dt);
    }
    foes = foes.filter((f) => !f.dead);
    contact();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function drawGirder(g) {
    if (g.lift) {
      const x = g.x1, y = g.y1, w = g.x2 - g.x1;
      ctx.fillStyle = COL.girderDark; ctx.fillRect(x, y, w, GT + 2);
      ctx.fillStyle = '#5a7fb0'; ctx.fillRect(x, y, w, GT);
      ctx.fillStyle = '#a8cdf0'; ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = COL.rivet;
      for (let i = 4; i < w - 3; i += 12) ctx.fillRect(x + i, y + 4, 2, 2);
      return;
    }
    const a = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
    const k = 1 / Math.cos(a);
    for (const [a1, a2] of spans(g)) {
      const len = (a2 - a1) * k;
      if (len <= 0) continue;
      ctx.save();
      ctx.translate(a1, g.y1 + ((g.y2 - g.y1) * (a1 - g.x1)) / (g.x2 - g.x1 || 1));
      ctx.rotate(a);
      ctx.fillStyle = COL.girderDark; ctx.fillRect(0, GT - 3, len, 5);
      ctx.fillStyle = g.conv ? '#3b4a63' : COL.girder; ctx.fillRect(0, 0, len, GT);
      ctx.fillStyle = g.conv ? '#7fa3cf' : COL.girderLit; ctx.fillRect(0, 0, len, 3);
      if (g.conv) {
        ctx.fillStyle = '#cfe4ff';
        const off = ((time * g.conv) % 14 + 14) % 14;
        for (let i = -14 + off; i < len; i += 14) { ctx.fillRect(i + 3, 4, 5, 2); ctx.fillRect(i + (g.conv > 0 ? 8 : 1), 3, 2, 4); }
      } else {
        ctx.fillStyle = COL.rivet;
        for (let i = 6; i < len - 4; i += 16) ctx.fillRect(i, 4, 2, 2);
      }
      ctx.restore();
    }
  }

  function drawLadder(l) {
    const h = l.bottom - l.top;
    ctx.fillStyle = COL.ladderDark;
    ctx.fillRect(l.x - 9, l.top, 3, h);
    ctx.fillRect(l.x + 6, l.top, 3, h);
    ctx.fillStyle = COL.ladder;
    ctx.fillRect(l.x - 9, l.top, 2, h);
    ctx.fillRect(l.x + 6, l.top, 2, h);
    for (let y = l.top + 5; y < l.bottom - 1; y += 9) ctx.fillRect(l.x - 8, y, 16, 2);
    if (l.short) {
      ctx.fillStyle = '#ff5c5c';
      ctx.fillRect(l.x - 10, l.top - 3, 20, 2);
    }
  }

  function drawBarrel(b) {
    const w = 20, h = 16;
    ctx.save();
    ctx.translate(Math.round(b.x), Math.round(b.y - h / 2));
    ctx.fillStyle = COL.barrelDark;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = COL.barrel;
    ctx.fillRect(-w / 2 + 1, -h / 2 + 2, w - 2, h - 4);
    ctx.fillStyle = '#f5c07a';
    ctx.fillRect(-w / 2 + 1, -h / 2 + 2, w - 2, 2);
    ctx.fillStyle = COL.barrelDark;
    const off = ((b.rot * 6) % 8 + 8) % 8;
    for (let i = -w / 2 + off - 8; i < w / 2; i += 8) {
      const x = clamp(i, -w / 2 + 1, w / 2 - 2);
      ctx.fillRect(x, -h / 2 + 2, 2, h - 4);
    }
    ctx.fillStyle = '#7a4212';
    ctx.fillRect(-w / 2, -h / 2 + 4, w, 2);
    ctx.fillRect(-w / 2, h / 2 - 6, w, 2);
    ctx.restore();
  }

  function drawFire(f) {
    const flick = Math.sin(f.t * 18) * 2 + Math.sin(f.t * 31) * 1.2;
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y));
    ctx.fillStyle = '#ff4d1a';
    ctx.fillRect(-9, -18, 18, 18);
    ctx.fillStyle = COL.fire;
    ctx.fillRect(-7, -16, 14, 16);
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(-4, -12 + flick * 0.3, 8, 12);
    ctx.fillStyle = '#ff4d1a';
    ctx.fillRect(-8, -24 - flick, 4, 7);
    ctx.fillRect(4, -22 + flick, 4, 6);
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(-2, -26 - flick, 4, 8);
    ctx.fillStyle = '#0b0416';
    ctx.fillRect(-5 + (f.dir > 0 ? 1 : -1), -13, 3, 4);
    ctx.fillRect(2 + (f.dir > 0 ? 1 : -1), -13, 3, 4);
    ctx.fillStyle = '#8ff0ff';
    ctx.fillRect(-5 + (f.dir > 0 ? 1 : -1), -13, 3, 2);
    ctx.fillRect(2 + (f.dir > 0 ? 1 : -1), -13, 3, 2);
    ctx.restore();
  }

  function drawSpring(s) {
    const sq = Math.max(0, Math.min(1, -s.vy / 220));
    ctx.save();
    ctx.translate(Math.round(s.x), Math.round(s.y));
    ctx.fillStyle = '#7dd3ff';
    for (let i = 0; i < 4; i++) ctx.fillRect(-8, -4 - i * (3 + sq * 2), 16, 2);
    ctx.fillStyle = '#cfefff';
    ctx.fillRect(-9, -18 - sq * 6, 18, 3);
    ctx.fillStyle = '#2f7fb0';
    ctx.fillRect(-9, -2, 18, 2);
    ctx.restore();
  }

  function drawItem(it) {
    const bob = Math.sin(it.t * 3) * 2;
    const x = Math.round(it.x), y = Math.round(it.y - 4 + bob);
    ctx.save();
    ctx.translate(x, y);
    if (it.kind === 'hat') {
      ctx.fillStyle = '#ff3b5c'; ctx.fillRect(-7, -12, 14, 8);
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(-10, -5, 20, 3);
      ctx.fillStyle = '#ff7a95'; ctx.fillRect(-6, -11, 12, 2);
    } else if (it.kind === 'umbrella') {
      ctx.fillStyle = '#7dff6a'; ctx.fillRect(-11, -12, 22, 4);
      ctx.fillRect(-8, -16, 16, 4);
      ctx.fillStyle = '#3aa832'; ctx.fillRect(-3, -19, 6, 3);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(-1, -8, 2, 10);
      ctx.fillRect(-5, 0, 5, 2);
    } else {
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(-9, -11, 18, 11);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(-9, -11, 18, 3);
      ctx.strokeStyle = '#ffe98a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -11, 6, Math.PI, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHammer(x, y, angle) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(angle);
    ctx.fillStyle = '#a0603a';
    ctx.fillRect(-2, 0, 4, 18);
    ctx.fillStyle = '#6b7a8c';
    ctx.fillRect(-10, -10, 20, 12);
    ctx.fillStyle = COL.hammer;
    ctx.fillRect(-9, -9, 18, 5);
    ctx.fillStyle = '#39424d';
    ctx.fillRect(-3, -8, 6, 9);
    ctx.restore();
  }

  function drawPrize(g) {
    const pulse = 1 + Math.sin(g.t * 4) * 0.12;
    ctx.save();
    ctx.translate(Math.round(g.x), Math.round(g.y));
    ctx.fillStyle = '#4c1d7a';
    ctx.fillRect(-12, -8, 24, 8);
    ctx.fillStyle = COL.accent;
    ctx.fillRect(-12, -8, 24, 3);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = COL.prize;
    const heart = ['.11.11.', '1111111', '1111111', '.11111.', '..111..', '...1...'];
    for (let r = 0; r < heart.length; r++) for (let c = 0; c < 7; c++) if (heart[r][c] === '1') ctx.fillRect(-14 + c * 4, -38 + r * 4, 4, 4);
    ctx.restore();
  }

  function drawApe() {
    const frame = ape.anim > 0 || Math.sin(ape.t * 1.7) > 0.93 ? APE.beat : APE.calm;
    const px = 4;
    const x = ape.x, y = ape.y - APE.calm.length * px;
    drawSprite(ctx, frame, APE_P, x, y, px);
    // a white glint in each eye
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(x) + 6 * px, Math.round(y) + 3 * px, px, px);
    ctx.fillRect(Math.round(x) + 10 * px, Math.round(y) + 3 * px, px, px);
  }

  function manFrame(p) {
    if (p.dead > 0) return MAN.dead;
    if (p.climb) return Math.floor(p.runT / 12) % 2 ? MAN.climb2 : MAN.climb1;
    if (!p.onGround) return MAN.jump;
    if (Math.abs(p.vx) < 8) return MAN.stand;
    return [MAN.run1, MAN.run2, MAN.run3, MAN.run2][Math.floor(p.runT / 11) % 4];
  }

  function drawPlayer() {
    const p = player;
    const w = MAN.stand[0].length * PX, h = MAN.stand.length * PX;
    const x = p.x - w / 2, y = p.y - h + 1;
    ctx.save();
    if (p.dead > 0) {
      ctx.translate(p.x, p.y - h / 2);
      ctx.rotate(Math.min(Math.PI, (p.deadT || 0) * 5));
      ctx.translate(-p.x, -(p.y - h / 2));
    }
    drawSprite(ctx, manFrame(p), MAN_P, x, y, PX, p.facing < 0 && !p.climb);
    ctx.restore();
    if (p.hammer > 0 && p.dead <= 0) {
      const up = Math.floor(p.swing / 0.22) % 2 === 0;
      const hx = p.x + p.facing * (up ? 6 : 17);
      const hy = up ? p.y - 44 : p.y - 16;
      drawHammer(hx, hy, up ? (p.facing > 0 ? 0.3 : -0.3) : (p.facing > 0 ? 1.9 : -1.9));
      if (p.hammer < 2 && Math.floor(p.hammer * 8) % 2) {
        ctx.globalAlpha = 0.35;
        drawHammer(hx, hy, up ? 0.3 : 1.9);
        ctx.globalAlpha = 1;
      }
    }
  }

  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#05030c';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * offX, DPR * offY);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();

    const bg = ctx.createLinearGradient(0, 0, 0, FH);
    bg.addColorStop(0, '#1b0b33'); bg.addColorStop(1, '#0a0518');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);

    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    ctx.translate(0, fieldY);
    ctx.beginPath(); ctx.rect(-40, -fieldY, FW + 80, FH); ctx.clip();

    // girder-work behind the tower
    ctx.strokeStyle = 'rgba(157,78,221,0.14)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(-20 + i * 82, -30);
      ctx.lineTo(60 + i * 82, FIELD_H + 20);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(157,78,221,0.10)';
    ctx.fillRect(0, 0, 6, FIELD_H);
    ctx.fillRect(FW - 6, 0, 6, FIELD_H);

    if (girders) {
      for (const l of ladders) drawLadder(l);
      for (const g of girders) drawGirder(g);
      ctx.fillStyle = COL.rivet;
      for (const r of rivets) {
        if (r.got) continue;
        ctx.fillRect(r.x - 4, r.y - 7, 8, 8);
        ctx.fillStyle = '#fff4b8'; ctx.fillRect(r.x - 3, r.y - 6, 3, 3);
        ctx.fillStyle = COL.rivet;
      }
      for (const it of items) if (!it.got) drawItem(it);
      for (const h of hammers) if (!h.used) drawHammer(h.x, h.y + Math.sin(h.t * 3) * 2, 0);
      if (goal) drawPrize(goal);
      if (ape) drawApe();
      // the oil drum barrels roll into
      ctx.fillStyle = '#2b3a4a';
      ctx.fillRect(10, GROUND_Y + 6, 28, 34);
      ctx.fillStyle = COL.fire;
      ctx.fillRect(12, GROUND_Y + 8, 24, 5);
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(16 + Math.sin(time * 9) * 2, GROUND_Y + 2, 6, 6);
      for (const f of foes) {
        if (f.kind === 'barrel') drawBarrel(f);
        else if (f.kind === 'fire') drawFire(f);
        else drawSpring(f);
      }
      drawPlayer();
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.9);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.text, p.x, p.y - p.t * 32);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.7 ? (2.2 - banner.t) / 0.5 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff';
      ctx.font = '20px "Press Start 2P", monospace';
      ctx.shadowColor = COL.accent; ctx.shadowBlur = 18;
      ctx.fillText(banner.text, FW / 2, fieldY + FIELD_H * 0.45);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,120,160,${Math.min(0.5, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000b'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = COL.accent;
      ctx.font = '24px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < FH; y += 4) ctx.fillRect(0, y, FW, 1);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('lives', '▮'.repeat(Math.max(0, Math.min(lives || 0, 6))));
    set('stage', state === 'title' ? '' : `TOWER ${stage}${CLASSIC ? '/' + FINAL_STAGE : ''}`);
    set('bonus', state === 'title' ? '' : `BONUS ${bonus}`);
    $('bonus').className = bonus <= 1000 ? 'low' : '';
    const bits = [];
    if (player && player.hammer > 0) bits.push(`HAMMER ${Math.ceil(player.hammer)}`);
    if (def && def.type !== 'girders' && state !== 'title') bits.push(def.type.toUpperCase());
    set('power', bits.join(' · '));
  }

  const KEYMAP = {
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
    arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) {
      e.preventDefault();
      if (state === 'play') keys.add(KEYMAP[k]);
      else if ((k === 'arrowup' || k === 'w') && !e.repeat) start();
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if ((state === 'title' || state === 'over') && !e.repeat) start();
      else if (state === 'play') { if (paused) paused = false; keys.add('jump'); }
    } else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) keys.delete(KEYMAP[k]);
    if (k === ' ' || k === 'enter') keys.delete('jump');
  });
  window.addEventListener('blur', () => keys.clear());

  bindPadButtons(keys);
  canvas.addEventListener('pointerdown', () => { if (state === 'play' && paused) paused = false; });

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // title-screen legend
  (function legend() {
    const draw = (id, fn) => {
      const c = $(id);
      if (!c) return;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.save();
      g.translate(12, 12);
      fn(g);
      g.restore();
    };
    draw('lg-barrel', (g) => {
      g.fillStyle = COL.barrelDark; g.fillRect(-10, -8, 20, 16);
      g.fillStyle = COL.barrel; g.fillRect(-9, -6, 18, 12);
      g.fillStyle = '#7a4212'; g.fillRect(-10, -4, 20, 2); g.fillRect(-10, 2, 20, 2);
      g.fillStyle = COL.barrelDark; g.fillRect(-3, -6, 2, 12); g.fillRect(4, -6, 2, 12);
    });
    draw('lg-hammer', (g) => {
      g.fillStyle = '#a0603a'; g.fillRect(-2, -2, 4, 14);
      g.fillStyle = COL.hammer; g.fillRect(-9, -10, 18, 8);
      g.fillStyle = '#39424d'; g.fillRect(-3, -9, 6, 6);
    });
    draw('lg-fire', (g) => {
      g.fillStyle = '#ff4d1a'; g.fillRect(-8, -4, 16, 14);
      g.fillStyle = COL.fire; g.fillRect(-6, -2, 12, 12);
      g.fillStyle = '#ffe066'; g.fillRect(-3, -10, 6, 8);
      g.fillStyle = '#8ff0ff'; g.fillRect(-4, 0, 3, 3); g.fillRect(2, 0, 3, 3);
    });
    draw('lg-rivet', (g) => {
      g.fillStyle = COL.girder; g.fillRect(-11, 2, 22, 7);
      g.fillStyle = COL.girderLit; g.fillRect(-11, 2, 22, 2);
      g.fillStyle = COL.rivet; g.fillRect(-4, -6, 8, 8);
      g.fillStyle = '#fff4b8'; g.fillRect(-3, -5, 3, 3);
    });
    draw('lg-hat', (g) => {
      g.fillStyle = '#ff3b5c'; g.fillRect(-7, -8, 14, 8);
      g.fillStyle = '#ff7a95'; g.fillRect(-6, -7, 12, 2);
      g.fillStyle = '#ffd23f'; g.fillRect(-10, -1, 20, 3);
    });
    draw('lg-umbrella', (g) => {
      g.fillStyle = '#7dff6a'; g.fillRect(-11, -4, 22, 4); g.fillRect(-8, -8, 16, 4);
      g.fillStyle = '#3aa832'; g.fillRect(-3, -11, 6, 3);
      g.fillStyle = '#c9a227'; g.fillRect(-1, 0, 2, 9); g.fillRect(-5, 9, 5, 2);
    });
    draw('lg-bag', (g) => {
      g.fillStyle = '#ffd23f'; g.fillRect(-9, -2, 18, 11);
      g.fillStyle = '#c9a227'; g.fillRect(-9, -2, 18, 3);
      g.strokeStyle = '#ffe98a'; g.lineWidth = 2;
      g.beginPath(); g.arc(0, -2, 6, Math.PI, TAU); g.stroke();
    });
    draw('lg-prize', (g) => {
      g.fillStyle = COL.prize;
      const heart = ['.11.11.', '1111111', '1111111', '.11111.', '..111..', '...1...'];
      for (let r = 0; r < heart.length; r++) for (let c = 0; c < 7; c++) if (heart[r][c] === '1') g.fillRect(-11 + c * 3, -9 + r * 3, 3, 3);
    });
  })();

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'climber',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => ({
        state, paused, score, lives, stage, bonus, type: def ? def.type : null,
        x: Math.round(player.x), y: Math.round(player.y),
        onGround: !!player.onGround, climbing: !!player.climb, hammer: Math.max(0, Math.round(player.hammer || 0)),
        barrels: foes ? foes.filter((f) => f.kind === 'barrel').length : 0,
        fires: foes ? foes.filter((f) => f.kind === 'fire').length : 0,
        springs: foes ? foes.filter((f) => f.kind === 'spring').length : 0,
        rivets: rivets ? rivets.filter((r) => !r.got).length : 0,
        jumps, smashes, dying: player.dead > 0, cleared: cleared > 0, time: Math.round(time),
      }),
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'lives') lives = v;
        else if (k === 'bonus') bonus = v;
        else if (k === 'stage') startStage(v);
        else if (k === 'hammer') player.hammer = v;
      },
      press: (k) => keys.add(k),
      release: (k) => keys.delete(k),
      foes: () => foes.map((f) => ({ kind: f.kind, x: Math.round(f.x), y: Math.round(f.y) })),
      layout: () => ({
        girders: girders.map((g) => ({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, conv: g.conv, lift: !!g.lift })),
        ladders: ladders.map((l) => ({ x: l.x, top: l.top, bottom: l.bottom, short: l.short })),
        rivets: rivets.map((r) => ({ x: r.x, y: r.y, got: r.got })),
        items: items.map((i) => ({ x: i.x, y: i.y, kind: i.kind, got: i.got })),
        hammers: hammers.map((h) => ({ x: h.x, y: h.y, used: h.used })),
        goal, ape: ape && { x: ape.x, y: ape.y },
      }),
      moveTo: (x, y) => { player.x = x; if (y !== undefined) player.y = y; player.climb = null; },
      sweep: () => { foes.length = 0; spawnT = 999; springT = 999; },
      clear: () => clearStage(),
      win: () => {
        if (!CLASSIC) return false;
        stage = FINAL_STAGE;
        clearStage();
        finishClear();
        return true;
      },
    };
  }

  // attract mode: a quiet tower sits behind the title screen
  newGame();
  state = 'title';
  banner = null;
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    if (state === 'title') { updateApe(dt); for (const f of foes) if (f.kind === 'barrel') updateBarrel(f, dt); foes = foes.filter((f) => !f.dead); }
    render();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
