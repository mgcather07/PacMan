/*
 * Micro Racer — a top-down racer with momentum, grip and drift.
 *   Infinite (/racer/)                one endless road that keeps unrolling; outrun the cut-off line
 *   Classic  (/racer/?mode=classic)   a five-circuit championship, three laps each
 *   Daily    (/racer/?daily=…)        Infinite rules, every world choice seeded (see docs/ADDING_A_GAME.md)
 *
 * The camera rides on the player's car and turns with it, so the road always runs up the screen.
 */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, bindPadButtons, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('racer') || (CLASSIC ? 'racer-classic' : 'racer');

  const FW = 600;                       // fixed play field; it grows a little on tall screens
  let FH = 900, CAM_Y = 594;
  const STEP = 26;                      // spacing between centre-line nodes
  const MAXV = 420, ENGINE = 330, BRAKEF = 520, REVERSE = 150, TURN = 2.8;
  const CAR_L = 36, CAR_W = 20, CAR_R = 17;
  const KERB = 10, VERGE = 74;          // kerb band, and run-off between the asphalt and the barrier
  const DRIFT_V = 58;                   // sideways speed that counts as a drift
  const KMH = 0.36, MPU = 0.1;          // world units → km/h and metres
  const LAPS = 3, RACES = 5;
  const SECTOR = 4000;                  // infinite split length, in world units (~400m)
  const GRID = [1000, 600, 400, 200];   // championship points for P1..P4

  // per-surface handling: grip holds the car sideways, drag slows it, max caps the top speed
  const SURF = {
    road:  { grip: 11.0, drag: 0.22, max: 1.00 },
    kerb:  { grip: 8.5,  drag: 0.50, max: 0.95 },
    grass: { grip: 5.5,  drag: 0.95, max: 0.55 },
    sand:  { grip: 4.0,  drag: 1.45, max: 0.42 },
    oil:   { grip: 0.8,  drag: 0.15, max: 1.00 },
  };
  const CIRCUITS = [
    { name: 'AUTODROME', seed: 101, r: 700, pts: 8,  hw: 104 },
    { name: 'HARBOUR LOOP', seed: 202, r: 760, pts: 9,  hw: 100 },
    { name: 'RIDGE PASS', seed: 303, r: 820, pts: 10, hw: 96 },
    { name: 'NIGHT MILE', seed: 404, r: 880, pts: 11, hw: 92 },
    { name: 'GRAND CIRCUIT', seed: 505, r: 940, pts: 12, hw: 88 },
  ];
  const RIVALS = [
    { name: 'AZUL', color: '#3fd8ff', skill: 0.98, alat: 430 },
    { name: 'GIALLO', color: '#ffd23f', skill: 0.94, alat: 400 },
    { name: 'VIOLA', color: '#b06cff', skill: 0.90, alat: 380 },
  ];

  // every world decision (road, hazards, pick-ups, rival quirks) comes from here so dailies match
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const mulberry32 = (a) => function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let state = 'title', paused = false, time = 0;
  let track = null, cars = [], player = null, gen = null;
  let pickups = [], hazards = [], marks = [], dust = [], popups = [];
  let score = 0, scoreFrac = 0, scoredM = 0, crashes = 0, overtakes = 0, cleanCorners = 0;
  let bestDrift = 0, driftRun = 0, corner = null, skidT = 0;
  let cut = 0, cutWarn = 0;
  let raceIdx = 0, finishes = [], raceOver = null, raceIdle = 0, countdown = 0;
  let lapStart = 0, bestLap = 0, lapPath = null, sectorAt = 0, sectorRec = [], splitMsg = null, splitBest = [];
  let paceRec = [];
  let banner = null, flash = 0, camX = 0, camY = 0, camA = 0;
  let ghostPath = null, ghostPace = null, pace = null;
  let high = store.get(Arcade.modeKey('racer.high'), 0);

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    FH = clamp(Math.round((FW * v.H) / v.W), 720, 1080);
    CAM_Y = Math.round(FH * 0.66);
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
  });
  const ctx = view.ctx;

  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

  // ---------------------------------------------------------------------------
  // The track: a centre line of nodes, each with a heading, a half-width and curvature
  // ---------------------------------------------------------------------------
  function newTrack(closed) { return { nodes: [], closed, len: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 }; }

  function addNode(tr, x, y, a, hw) {
    const prev = tr.nodes[tr.nodes.length - 1];
    const n = { x, y, a, hw, s: prev ? prev.s + Math.hypot(x - prev.x, y - prev.y) : 0, curv: 0 };
    if (prev) prev.curv = angDiff(a, prev.a) / Math.max(1, n.s - prev.s);
    tr.nodes.push(n);
    tr.len = n.s;
    return n;
  }

  function nodeAt(tr, i) {
    const N = tr.nodes.length;
    if (tr.closed) return tr.nodes[((i % N) + N) % N];
    return tr.nodes[clamp(i, 0, N - 1)];
  }

  // nearest point on the centre line; hint is the car's last node index
  function project(tr, x, y, hint) {
    const N = tr.nodes.length;
    const wide = hint === undefined || hint === null;
    const lo = wide ? 0 : hint - 14, hi = wide ? N - 2 : hint + 26;
    let bestD = Infinity, bi = lo, bt = 0;
    for (let i = lo; i <= hi; i++) {
      if (!tr.closed && (i < 0 || i > N - 2)) continue;
      const A = nodeAt(tr, i), B = nodeAt(tr, i + 1);
      const dx = B.x - A.x, dy = B.y - A.y;
      const L2 = dx * dx + dy * dy || 1;
      const t = clamp(((x - A.x) * dx + (y - A.y) * dy) / L2, 0, 1);
      const px = A.x + dx * t - x, py = A.y + dy * t - y;
      const d = px * px + py * py;
      if (d < bestD) { bestD = d; bi = i; bt = t; }
    }
    const A = nodeAt(tr, bi), B = nodeAt(tr, bi + 1);
    const segLen = (B.s > A.s ? B.s - A.s : tr.len - A.s) || STEP;
    const ang = A.a + angDiff(B.a, A.a) * bt;
    const px = A.x + (B.x - A.x) * bt, py = A.y + (B.y - A.y) * bt;
    let s = A.s + bt * segLen;
    if (tr.closed) s = ((s % tr.len) + tr.len) % tr.len;
    return {
      idx: tr.closed ? ((bi % N) + N) % N : clamp(bi, 0, N - 1), s,
      lat: (x - px) * -Math.sin(ang) + (y - py) * Math.cos(ang),
      hw: lerp(A.hw, B.hw, bt), curv: lerp(A.curv, B.curv, bt), ang,
    };
  }

  function nodeIndexAt(tr, s) {
    const N = tr.nodes.length;
    let i = clamp(Math.floor(s / STEP), 0, N - 1);
    while (i > 0 && tr.nodes[i].s > s) i--;
    while (i < N - 1 && tr.nodes[i + 1].s <= s) i++;
    return i;
  }

  function pointAt(tr, s, lat = 0) {
    if (tr.closed) s = ((s % tr.len) + tr.len) % tr.len; else s = clamp(s, 0, tr.len);
    const i = nodeIndexAt(tr, s);
    const A = tr.nodes[i], B = nodeAt(tr, i + 1);
    const segLen = (B.s > A.s ? B.s - A.s : tr.len - A.s) || STEP;
    const t = clamp((s - A.s) / segLen, 0, 1);
    const ang = A.a + angDiff(B.a, A.a) * t;
    return {
      x: lerp(A.x, B.x, t) - Math.sin(ang) * lat, y: lerp(A.y, B.y, t) + Math.cos(ang) * lat,
      a: ang, hw: lerp(A.hw, B.hw, t), curv: lerp(A.curv, B.curv, t),
    };
  }

  // sharpest corner in the next `dist` units — what the drivers brake for
  function maxCurvAhead(s, dist) {
    let i = nodeIndexAt(track, track.closed ? ((s % track.len) + track.len) % track.len : clamp(s, 0, track.len));
    let k = 0;
    for (let n = 0; n < Math.ceil(dist / STEP); n++) k = Math.max(k, Math.abs(nodeAt(track, i + n).curv));
    return k;
  }
  function curvAhead(s, dist) {
    let i = nodeIndexAt(track, track.closed ? ((s % track.len) + track.len) % track.len : clamp(s, 0, track.len));
    let k = 0, n = Math.max(1, Math.round(dist / STEP));
    for (let j = 0; j < n; j++) k += nodeAt(track, i + j).curv;
    return k / n;
  }

  // ---------------------------------------------------------------------------
  // Endless road (Infinite / Daily) — generated a few hundred metres ahead of the car
  // ---------------------------------------------------------------------------
  function startInfinite() {
    track = newTrack(false);
    gen = { x: 0, y: 0, a: -Math.PI / 2, hw: 108, hwTarget: 108, segLeft: 0, curv: 0, target: 0, wind: 0, pickS: 760, hazS: 1100, trafS: 950 };
    for (let i = 0; i < 24; i++) addNode(track, gen.x, gen.y + i * -STEP, -Math.PI / 2, gen.hw);
    gen.y = -23 * STEP;
    extend(1800);
  }

  const diffOf = () => clamp((player ? player.prog : 0) / 34000, 0, 1);

  function newSegment() {
    const d = diffOf();
    const straight = wrand() < 0.34 - 0.16 * d;
    const mag = 0.0026 + wr(0, 0.0042) + 0.0048 * d;
    const coin = wrand() < 0.5 ? -1 : 1;
    const chicane = gen.target !== 0 && wrand() < 0.4;
    if (straight) {
      gen.target = 0;
      gen.segLeft = wr(180, 480);
    } else {                                            // a corner; they tighten as the run goes on
      // the road is kept from spiralling back over itself: too much winding one way forces a corner back
      const flip = gen.wind > 2.4 ? -1 : gen.wind < -2.4 ? 1 : chicane ? -Math.sign(gen.target) : coin;
      gen.target = mag * flip;
      gen.segLeft = Math.min(wr(160, 420) + 120 * d, 2.1 / mag);
    }
    gen.hwTarget = clamp(108 - 34 * d + wr(-10, 10), 64, 118);
  }

  function extend(untilS) {
    while (track.nodes[track.nodes.length - 1].s < untilS) {
      if (gen.segLeft <= 0) newSegment();
      gen.segLeft -= STEP;
      gen.curv += (gen.target - gen.curv) * 0.18;
      gen.a += gen.curv * STEP;
      gen.wind = gen.wind * 0.9993 + gen.curv * STEP;
      gen.x += Math.cos(gen.a) * STEP;
      gen.y += Math.sin(gen.a) * STEP;
      gen.hw += clamp((gen.hwTarget || 104) - gen.hw, -1.4, 1.4);
      const n = addNode(track, gen.x, gen.y, gen.a, gen.hw);
      // furniture, placed by distance so a daily lays it out the same way every time
      while (gen.pickS < n.s) { spawnPickup(gen.pickS); gen.pickS += wr(300, 620); }
      while (gen.hazS < n.s) { spawnHazard(gen.hazS); gen.hazS += wr(420, 900) - 260 * diffOf(); }
      while (gen.trafS < n.s) { spawnTraffic(gen.trafS); gen.trafS += wr(520, 1100) - 260 * diffOf(); }
    }
  }

  function spawnPickup(s) {
    const p = pointAt(track, s);
    const kinds = ['boost', 'boost', 'shield', 'oil'];
    const type = kinds[Math.floor(wrand() * kinds.length)];
    const lat = wr(-0.62, 0.62) * p.hw;
    const q = pointAt(track, s, lat);
    pickups.push({ type, s, lat, x: q.x, y: q.y, t: 0, gone: 0 });
  }

  function spawnHazard(s) {
    const p = pointAt(track, s);
    const oil = wrand() < 0.45;
    const lat = oil ? wr(-0.55, 0.55) * p.hw : (wrand() < 0.5 ? -1 : 1) * wr(0.6, 1.25) * p.hw;
    const q = pointAt(track, s, lat);
    hazards.push({ type: oil ? 'oil' : 'sand', x: q.x, y: q.y, r: oil ? wr(26, 40) : wr(40, 72), s, life: 0, owner: null });
  }

  // every random is drawn before the "is there room?" test, so the daily's world stream never shifts
  function spawnTraffic(s) {
    const p = pointAt(track, s);
    const lat = wr(-0.5, 0.5) * p.hw;
    const col = ['#8a93a0', '#6d7b8a', '#9c8f7a', '#7f9a8c'][Math.floor(wrand() * 4)];
    const seed = Math.floor(wrand() * 4294967296);
    const skill = wr(0.38, 0.55);
    if (cars.filter((c) => c.kind === 'traffic').length > 4) return;
    const q = pointAt(track, s, lat);
    const c = makeCar('traffic', col, q.x, q.y, q.a, seed);
    c.skill = skill; c.alat = 300; c.lineOff = lat / p.hw;
    c.idx = project(track, c.x, c.y).idx;
    c.s = s; c.prevS = s; c.prog = s;
    c.wasAhead = true;
    cars.push(c);
  }

  // ---------------------------------------------------------------------------
  // Closed circuits (Classic) — a smoothed star polygon, identical for every player
  // ---------------------------------------------------------------------------
  function buildCircuit(i) {
    const c = CIRCUITS[i];
    const rng = mulberry32(c.seed);
    const pts = [];
    for (let k = 0; k < c.pts; k++) {
      const ang = (k / c.pts) * TAU + (rng() - 0.5) * 0.22;
      const r = c.r * (0.68 + rng() * 0.52);
      pts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
    }
    // Catmull-Rom through the control points, then a few smoothing passes so nothing is a hairpin
    const dense = [];
    for (let k = 0; k < pts.length; k++) {
      const p0 = pts[(k - 1 + pts.length) % pts.length], p1 = pts[k];
      const p2 = pts[(k + 1) % pts.length], p3 = pts[(k + 2) % pts.length];
      for (let t = 0; t < 1; t += 0.05) {
        const t2 = t * t, t3 = t2 * t;
        dense.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < dense.length; k++) {
        const a = dense[(k - 1 + dense.length) % dense.length], b = dense[k], d = dense[(k + 1) % dense.length];
        b.x = b.x * 0.5 + (a.x + d.x) * 0.25;
        b.y = b.y * 0.5 + (a.y + d.y) * 0.25;
      }
    }
    // resample at a fixed spacing
    const tr = newTrack(true);
    let carry = 0, px = dense[0].x, py = dense[0].y;
    const push = (x, y) => {
      const prev = tr.nodes[tr.nodes.length - 1];
      const hw = c.hw + Math.sin(tr.nodes.length * 0.21) * 7;
      if (prev) addNode(tr, x, y, Math.atan2(y - prev.y, x - prev.x), hw);
      else tr.nodes.push({ x, y, a: 0, hw, s: 0, curv: 0 });
    };
    push(dense[0].x, dense[0].y);
    for (let k = 1; k <= dense.length; k++) {
      const q = dense[k % dense.length];
      let seg = Math.hypot(q.x - px, q.y - py);
      while (carry + seg >= STEP && seg > 0.0001) {
        const t = (STEP - carry) / seg;
        px = px + (q.x - px) * t; py = py + (q.y - py) * t;
        push(px, py);
        seg = Math.hypot(q.x - px, q.y - py);
        carry = 0;
      }
      carry += seg; px = q.x; py = q.y;
    }
    // close the loop: the first node's heading comes from the last leg
    const n0 = tr.nodes[0], nL = tr.nodes[tr.nodes.length - 1];
    n0.a = Math.atan2(n0.y - nL.y, n0.x - nL.x);
    n0.curv = angDiff(tr.nodes[1].a, n0.a) / STEP;
    tr.len = nL.s + Math.hypot(n0.x - nL.x, n0.y - nL.y);
    nL.curv = angDiff(n0.a, nL.a) / STEP;
    for (const n of tr.nodes) {
      tr.minX = Math.min(tr.minX, n.x); tr.maxX = Math.max(tr.maxX, n.x);
      tr.minY = Math.min(tr.minY, n.y); tr.maxY = Math.max(tr.maxY, n.y);
    }
    // pick-ups and hazards on the lap, laid out from the circuit's own seed
    pickups = []; hazards = [];
    const kinds = ['boost', 'boost', 'shield', 'oil'];
    for (let s = 300; s < tr.len - 200; s += 320 + rng() * 380) {
      const lat = (rng() - 0.5) * 1.3 * c.hw;
      const q = pointAt(tr, s, lat);
      pickups.push({ type: kinds[Math.floor(rng() * kinds.length)], s, lat, x: q.x, y: q.y, t: 0, gone: 0 });
    }
    for (let s = 500; s < tr.len - 300; s += 520 + rng() * 700) {
      const oil = rng() < 0.35;
      const lat = oil ? (rng() - 0.5) * 1.1 * c.hw : (rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 0.5) * c.hw;
      const q = pointAt(tr, s, lat);
      hazards.push({ type: oil ? 'oil' : 'sand', x: q.x, y: q.y, r: oil ? 30 : 40 + rng() * 30, s, life: 0, owner: null });
    }
    return tr;
  }

  // ---------------------------------------------------------------------------
  // Cars
  // ---------------------------------------------------------------------------
  function makeCar(kind, color, x, y, a, seed) {
    return {
      kind, color, x, y, a, vx: 0, vy: 0, speed: 0, slip: 0,
      steer: 0, steerIn: 0, throttle: 0, brake: 0, hand: false,
      idx: null, s: 0, lat: 0, hw: 100, curv: 0, prog: 0, prevS: 0, lap: 0, surf: 'road',
      boost: 0, shield: 0, boosts: 0, oils: 0, spin: 0, spinDir: 1, oilCool: 0, wallCool: 0, bump: 0,
      rng: mulberry32(seed), skill: 1, alat: 420, lineOff: 0, nextMistake: 4, mistakeT: 0, mistakeOff: 0,
      finished: false, finishT: 0, wasAhead: false, name: '',
    };
  }

  function placeCar(c, s, lat) {
    const p = pointAt(track, s, lat);
    c.x = p.x; c.y = p.y; c.a = p.a; c.vx = 0; c.vy = 0; c.speed = 0; c.slip = 0;
    c.idx = project(track, c.x, c.y).idx;
    c.s = s; c.prevS = s; c.prog = s;
  }

  function surfaceAt(c, lat, hw) {
    const al = Math.abs(lat);
    let s = al > hw + KERB ? 'grass' : al > hw ? 'kerb' : 'road';
    for (const h of hazards) {
      const dx = c.x - h.x, dy = c.y - h.y;
      if (dx * dx + dy * dy > h.r * h.r) continue;
      if (h.type === 'oil') { if (h.owner !== c || h.life > 2) return 'oil'; }
      else s = 'sand';
    }
    return s;
  }

  function driveCar(c, dt) {
    const p = project(track, c.x, c.y, c.idx);
    c.idx = p.idx; c.s = p.s; c.lat = p.lat; c.hw = p.hw; c.curv = p.curv;
    c.surf = surfaceAt(c, p.lat, p.hw);
    const sf = SURF[c.surf];

    c.steer += clamp(c.steerIn - c.steer, -1, 1) * Math.min(1, dt * 8);
    const cs = Math.cos(c.a), sn = Math.sin(c.a);
    let vf = c.vx * cs + c.vy * sn;
    let vl = -c.vx * sn + c.vy * cs;
    if (c.boost > 0) c.boost -= dt;
    if (c.shield > 0) c.shield -= dt;
    if (c.oilCool > 0) c.oilCool -= dt;
    if (c.wallCool > 0) c.wallCool -= dt;
    if (c.bump > 0) c.bump -= dt;

    const top = MAXV * sf.max * (c.boost > 0 ? 1.3 : 1);
    if (c.spin <= 0 && c.throttle > 0) vf += ENGINE * c.throttle * (c.boost > 0 ? 1.6 : 1) * clamp(1 - vf / top, -1.2, 1) * dt;
    if (c.brake > 0) vf = vf > 6 ? vf - BRAKEF * c.brake * dt : Math.max(-REVERSE, vf - ENGINE * 0.6 * dt);
    vf -= vf * sf.drag * dt;
    const grip = sf.grip * (c.hand ? 0.22 : 1) * (c.spin > 0 ? 0.3 : 1);
    vl *= Math.exp(-grip * dt);
    // rebuild the velocity around the OLD heading, then turn: the velocity keeps pointing where it
    // was, which is exactly what makes the car slide through a corner
    c.vx = cs * vf - sn * vl;
    c.vy = sn * vf + cs * vl;
    const sp = Math.abs(vf);
    const bite = clamp(sp / 110, 0, 1) * (1 - 0.22 * clamp(sp / MAXV, 0, 1)) * (c.surf === 'oil' ? 0.5 : 1);
    c.a += c.steer * TURN * bite * (c.hand ? 1.15 : 1) * (vf >= 0 ? 1 : -1) * dt;
    if (c.spin > 0) { c.spin -= dt; c.a += c.spinDir * 4.5 * dt; }
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.speed = vf; c.slip = vl;

    // barrier
    const q = project(track, c.x, c.y, c.idx);
    const limit = q.hw + VERGE;
    if (Math.abs(q.lat) > limit) {
      const sg = Math.sign(q.lat) || 1;
      const nx = -Math.sin(q.ang) * sg, ny = Math.cos(q.ang) * sg;
      const push = Math.abs(q.lat) - limit;
      c.x -= nx * push; c.y -= ny * push;
      const vn = c.vx * nx + c.vy * ny;
      if (vn > 0) { c.vx -= nx * vn * 1.4; c.vy -= ny * vn * 1.4; hitWall(c, vn, dt); }
    }
    if (Math.abs(c.slip) > DRIFT_V && sp > 90 && c.surf !== 'grass' && c.surf !== 'sand') layMarks(c, dt);
    else c.lastMark = null;
    if (c.surf === 'grass' || c.surf === 'sand') kickDust(c, dt);
  }

  function layMarks(c, dt) {
    c.markT = (c.markT || 0) - dt;
    if (c.markT > 0) return;
    c.markT = 0.045;
    const cs = Math.cos(c.a), sn = Math.sin(c.a);
    for (const sgn of [-1, 1]) {
      const ox = -CAR_L * 0.3, oy = sgn * CAR_W * 0.42;
      const x = c.x + cs * ox - sn * oy, y = c.y + sn * ox + cs * oy;
      const last = c.lastMark && c.lastMark[sgn > 0 ? 1 : 0];
      if (last) marks.push({ x1: last.x, y1: last.y, x2: x, y2: y, t: 0 });
      if (!c.lastMark) c.lastMark = [null, null];
      c.lastMark[sgn > 0 ? 1 : 0] = { x, y };
    }
    if (marks.length > 420) marks.splice(0, marks.length - 420);
  }

  function kickDust(c, dt) {
    if (Math.abs(c.speed) < 60 || Math.random() > dt * 40) return;
    const col = c.surf === 'sand' ? '#c9ae74' : '#5f8f57';
    dust.push({ x: c.x - Math.cos(c.a) * 16 + rand(-8, 8), y: c.y - Math.sin(c.a) * 16 + rand(-8, 8), vx: rand(-30, 30), vy: rand(-30, 30), t: 0, life: rand(0.3, 0.8), c: col, r: rand(2, 5) });
  }

  // a square hit costs most of your speed; scraping along the barrier just bleeds it away
  function hitWall(c, vn, dt) {
    const fresh = c.wallCool <= 0;
    const f = fresh ? clamp(1 - vn / 800, 0.5, 0.96) : Math.max(0, 1 - 1.2 * dt);
    c.vx *= f; c.vy *= f;
    c.wallCool = 0.5;
    const sparks = fresh ? 6 : (Math.random() < 0.25 ? 1 : 0);
    for (let i = 0; i < sparks; i++) dust.push({ x: c.x, y: c.y, vx: rand(-90, 90), vy: rand(-90, 90), t: 0, life: rand(0.2, 0.45), c: '#ffb347', r: rand(2, 4) });
    if (c !== player) { if (vn > 120) { c.spin = 0.5; c.spinDir = c.rng() < 0.5 ? -1 : 1; } return; }
    if (state !== 'play') return;
    if (fresh && vn > 40) crashes++;
    flash = Math.min(0.5, vn / 700);
    if (fresh) { Sound.noise(0.28, Math.min(0.16, vn / 2200), 0, 900); Sound.tone(190, 50, 0.32, 'sawtooth', 0.035); }
    if (corner) corner.clean = false;
    if (vn > 120) { c.spin = 0.45; c.spinDir = c.rng() < 0.5 ? -1 : 1; }
    if (!CLASSIC && vn > 240 && c.shield <= 0) endGame(false, 'You buried it in the barrier.');
  }

  // ---------------------------------------------------------------------------
  // The rivals: follow a racing line, brake for what is coming, make the odd mistake
  // ---------------------------------------------------------------------------
  function aiDrive(c, dt) {
    if (c.mistakeT > 0) c.mistakeT -= dt;
    else if ((c.nextMistake -= dt) <= 0) {
      c.mistakeT = 0.5 + c.rng() * 1.1;
      c.mistakeOff = (c.rng() * 2 - 1) * 1.1;
      c.nextMistake = 5 + c.rng() * 11;
    }
    const sp = c.speed;
    const ahead = pointAt(track, c.s + 70 + sp * 0.5);
    const k = curvAhead(c.s + 40, 260);
    const line = clamp(-Math.sign(k) * Math.min(1, Math.abs(k) / 0.007) * 0.5 + c.lineOff, -0.8, 0.8) * ahead.hw;
    const tx = ahead.x - Math.sin(ahead.a) * line, ty = ahead.y + Math.cos(ahead.a) * line;
    let err = angDiff(Math.atan2(ty - c.y, tx - c.x), c.a);
    if (c.mistakeT > 0) err += c.mistakeOff * 0.3;
    c.steerIn = clamp(err * 2.3, -1, 1);
    const kmax = maxCurvAhead(c.s + 30, 140 + sp * 0.9);
    let target = Math.min(Math.sqrt(c.alat / Math.max(0.0009, kmax)), MAXV * (c.boost > 0 ? 1.3 : 1)) * c.skill;
    if (c.surf === 'grass' || c.surf === 'sand') target *= 0.6;
    if (c.mistakeT > 0) target *= 0.85;
    if (c.spin > 0) target = 0;
    c.throttle = sp < target ? 1 : 0;
    c.brake = sp > target * 1.12 ? 1 : 0;
    c.hand = c.kind === 'rival' && Math.abs(k) > 0.008 && sp > target * 1.3;
    if (c.boosts > 0 && Math.abs(k) < 0.0025 && sp > MAXV * 0.55) useBoost(c);
    if (c.oils > 0 && c.oilCool <= 0 && c.rng() < dt * 0.25) dropOil(c);
  }

  // ---------------------------------------------------------------------------
  // Pick-ups, boost and oil
  // ---------------------------------------------------------------------------
  function useBoost(c) {
    if (c.boosts <= 0) return;
    c.boosts--; c.boost = 2.2;
    if (c === player) { Sound.arp([392, 587, 880], 0.05, 'square', 0.045); Sound.noise(0.3, 0.05, 0, 2600); popup('BOOST', c); }
  }

  function dropOil(c) {
    if (c.oils <= 0) return;
    c.oils--; c.oilCool = 1.5;
    hazards.push({ type: 'oil', x: c.x - Math.cos(c.a) * 34, y: c.y - Math.sin(c.a) * 34, r: 32, s: c.s, life: 0, owner: c, drop: true });
    if (c === player) { Sound.tone(220, 90, 0.25, 'sine', 0.04); popup('OIL', c); }
  }

  function takePickup(c, p) {
    p.gone = 0.001;
    if (p.type === 'boost') { c.boosts = Math.min(3, c.boosts + 1); if (c.kind !== 'player') useBoost(c); }
    else if (p.type === 'shield') c.shield = 10;
    else c.oils = Math.min(3, c.oils + 1);
    if (c !== player) return;
    Sound.arp(p.type === 'boost' ? [660, 990] : p.type === 'shield' ? [523, 784] : [330, 262], 0.06, 'square', 0.04);
    addScore(p.type === 'boost' ? 200 : p.type === 'shield' ? 150 : 100);
    popup(p.type === 'boost' ? '+200 BOOST' : p.type === 'shield' ? '+150 BUMPER' : '+100 OIL', c);
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------
  function addScore(n) {
    scoreFrac += n;
    const whole = Math.floor(scoreFrac);
    if (whole) { score += whole; scoreFrac -= whole; }
    if (score > high) { high = score; store.set(Arcade.modeKey('racer.high'), high); }
  }
  function popup(text, c, color) {
    popups.push({ text, x: c.x, y: c.y, t: 0, c: color || '#fff' });
    if (popups.length > 14) popups.shift();
  }

  function scoreCorner(dt) {
    const k = Math.abs(player.curv);
    if (k > 0.004) {
      if (!corner) corner = { peak: 0, clean: true, len: 0, gap: 0 };
      corner.peak = Math.max(corner.peak, k);
      corner.len += dt;
      corner.gap = 0;
      if (player.surf === 'grass' || player.surf === 'sand') corner.clean = false;
    } else if (corner) {
      corner.gap += dt;
      if (corner.gap > 0.35) {
        if (corner.clean && corner.len > 0.45) {
          const pts = Math.round(60 + corner.peak * 24000);
          cleanCorners++;
          addScore(pts);
          popup('CLEAN +' + pts, player, '#9fe8a0');
        }
        corner = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  function newGame() {
    wrand = DAILY ? Daily.rng('racer') : Math.random;
    score = 0; scoreFrac = 0; scoredM = 0; crashes = 0; overtakes = 0; cleanCorners = 0;
    bestDrift = 0; driftRun = 0; corner = null; time = 0; flash = 0;
    pickups = []; hazards = []; marks = []; dust = []; popups = [];
    raceIdx = 0; finishes = []; raceOver = null; raceIdle = 0; bestLap = 0;
    splitBest = []; sectorRec = []; paceRec = []; player = null; cars = [];
    pace = loadPace();
    if (CLASSIC) startRace(0);
    else startRun();
  }

  function startRun() {
    startInfinite();
    player = makeCar('player', '#e94f37', 0, 0, -Math.PI / 2, 12345);
    player.name = 'YOU';
    placeCar(player, 400, 0);
    cars.push(player);
    RIVALS.forEach((r, i) => {
      const c = makeCar('rival', r.color, 0, 0, 0, Math.floor(wrand() * 4294967296));
      c.name = r.name; c.skill = r.skill * wr(0.97, 1.02); c.alat = r.alat; c.lineOff = wr(-0.3, 0.3);
      placeCar(c, 480 + i * 90, wr(-0.5, 0.5) * 100);
      c.wasAhead = true;
      cars.push(c);
    });
    cut = -700;
    cutWarn = 0;
    lapStart = 0; sectorAt = SECTOR;
    countdown = 2.6;
    banner = { text: 'GET READY', t: 0 };
    ghostPace = pace && pace.s && pace.s.length > 2 ? pace : null;
    extend(3000);
  }

  function startRace(i) {
    raceIdx = i;
    track = buildCircuit(i);
    marks = []; dust = []; popups = []; corner = null;
    cars = [];
    const order = [0, 1, 2];
    player = makeCar('player', '#e94f37', 0, 0, 0, 12345);
    player.name = 'YOU';
    order.forEach((n, k) => {
      const r = RIVALS[n];
      const c = makeCar('rival', r.color, 0, 0, 0, r.seed || (r.name.charCodeAt(0) * 7919 + i));
      c.name = r.name; c.skill = r.skill + i * 0.004; c.alat = r.alat; c.lineOff = (c.rng() - 0.5) * 0.3;
      placeCar(c, 196 - k * 52, (k % 2 ? 1 : -1) * 34);
      cars.push(c);
    });
    placeCar(player, 40, 34);
    cars.push(player);
    countdown = 3.4;
    lapStart = 0; sectorAt = track.len / 3; sectorRec = []; splitBest = loadSplits(i);
    time = 0;
    raceIdle = 0;
    lapPath = [];
    const saved = store.get('racer.lap.' + i, null);
    ghostPath = saved && saved.p && saved.p.length > 4 ? saved : null;
    banner = { text: `RACE ${i + 1}/${RACES} · ${CIRCUITS[i].name}`, t: 0, big: true };
  }

  function start() {
    Sound.init();
    engineStart();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
    if (window.Leaderboard) Leaderboard.startRun(BOARD);
    if (matchMedia('(pointer: coarse)').matches) toast('DRAG TO STEER');
  }

  function loadPace() { return store.get(paceKey(), null); }
  function paceKey() { return DAILY ? 'racer.pace.d' + Daily.active.key : 'racer.pace'; }
  function loadSplits(i) { const v = store.get('racer.lap.' + i, null); return v && v.sec ? v.sec : []; }

  function savePace() {
    if (CLASSIC) return;
    const best = pace && pace.score || 0;
    if (score <= best) return;
    store.set(paceKey(), { score, s: paceOf() });
  }
  function paceOf() { return paceRec.slice(0, 1400); }

  function finishRace(pos) {
    if (raceOver) return;
    const pts = GRID[clamp(pos - 1, 0, 3)];
    finishes.push(pos);
    addScore(pts);
    raceOver = { t: 0, pos, pts };
    banner = { text: `P${pos} · +${pts}`, t: 0, big: true };
    Sound.arp(pos === 1 ? [523, 659, 784, 1046] : [392, 440, 523], 0.09, 'square', 0.045);
  }

  function endGame(won, message) {
    if (state !== 'play') return;
    state = 'over';
    if (driftRun > bestDrift) bestDrift = driftRun;
    $('o-score').textContent = score.toLocaleString();
    if (CLASSIC) {
      $('o-dist-l').textContent = 'FINISHES';
      $('o-dist').textContent = finishes.length ? finishes.map((p) => 'P' + p).join(' ') : '—';
      $('o-lap-l').textContent = 'BEST LAP';
    } else {
      $('o-dist-l').textContent = 'DISTANCE';
      $('o-dist').textContent = Math.round(player.prog * MPU).toLocaleString() + 'm';
      $('o-lap-l').textContent = 'BEST SPLIT';
    }
    $('o-lap').textContent = bestLap ? bestLap.toFixed(2) + 's' : '—';
    $('o-drift').textContent = bestDrift.toFixed(1) + 's';
    Arcade.endScreen(won, won ? 'Champion of the five circuits!' : message || '');
    $('over').hidden = false;
    savePace();
    if (!won) { Sound.tone(300, 60, 0.7, 'sawtooth', 0.05); }
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Laps, splits and the ghost
  // ---------------------------------------------------------------------------
  function onLapDone(c) {
    if (c !== player) return;
    const lapTime = time - lapStart;
    if (!bestLap || lapTime < bestLap) bestLap = lapTime;
    sectorRec.push(lapTime);
    if (splitBest[2]) showSplit(3, lapTime - splitBest[2]);
    const saved = store.get('racer.lap.' + raceIdx, null);
    if (!saved || lapTime < saved.t) {
      store.set('racer.lap.' + raceIdx, { t: lapTime, p: lapPath.slice(0, 600), sec: sectorRec.slice() });
      ghostPath = { t: lapTime, p: lapPath.slice(0, 600) };
      splitBest = sectorRec.slice();
      popup('NEW BEST LAP', player, '#ffd23f');
    }
    const bonus = Math.max(0, Math.round((track.len / 300 - lapTime) * 120));
    if (bonus) { addScore(bonus); popup('LAP +' + bonus, player, '#ffd23f'); }
    lapStart = time;
    lapPath = [];
    sectorRec = [];
    sectorAt = track.len / 3;
    for (const p of pickups) p.gone = 0;   // the circuit is restocked for the next lap
  }

  function checkSplit() {
    if (CLASSIC) {
      const rel = player.s;
      if (rel >= sectorAt && sectorAt < track.len) {
        const t = time - lapStart;
        const n = sectorRec.length;
        sectorRec.push(t);
        if (splitBest[n]) showSplit(n + 1, t - splitBest[n]);
        sectorAt += track.len / 3;
      }
    } else if (player.prog >= sectorAt) {
      const n = Math.round(sectorAt / SECTOR);
      const t = time - lapStart;
      if (!bestLap || t < bestLap) bestLap = t;
      if (ghostPace && ghostPace.s) {
        const bestT = timeForDistance(ghostPace.s, sectorAt);
        if (bestT) showSplit(n, time - bestT);
      }
      lapStart = time;
      sectorAt += SECTOR;
    }
  }

  function showSplit(n, delta) {
    splitMsg = { text: `S${n} ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`, slow: delta >= 0, t: 0 };
  }

  // pace samples hold the distance reached every 0.5s; this reads the clock back out of them
  function timeForDistance(samples, dist) {
    for (let i = 1; i < samples.length; i++) {
      if (samples[i] >= dist) {
        const f = (dist - samples[i - 1]) / Math.max(1, samples[i] - samples[i - 1]);
        return (i - 1 + f) * 0.5;
      }
    }
    return 0;
  }
  function distanceAtTime(samples, t) {
    const i = Math.floor(t / 0.5);
    if (i >= samples.length - 1) return samples.length ? samples[samples.length - 1] : 0;
    return lerp(samples[i], samples[i + 1], (t / 0.5) - i);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    time += dt;
    for (const d of dust) { d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 0.94; d.vy *= 0.94; }
    dust = dust.filter((d) => d.t < d.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 1.1);
    for (const m of marks) m.t += dt;
    if (marks.length && marks[0].t > 7) marks = marks.filter((m) => m.t < 7);
    for (const h of hazards) h.life += dt;
    hazards = hazards.filter((h) => !h.drop || h.life < 16);
    for (const p of pickups) { p.t += dt; if (p.gone) p.gone += dt; }
    if (flash > 0) flash -= dt * 2;
    if (banner) { banner.t += dt; if (banner.t > 2.6) banner = null; }
    if (splitMsg) { splitMsg.t += dt; if (splitMsg.t > 2.5) splitMsg = null; }
    if (countdown > 0) countdown -= dt;

    // steering / pedals
    if (state === 'title' || autoDrive) aiDrive(player, dt);
    else if (state === 'play') playerControls(dt);
    else { player.throttle = 0; player.brake = 0.4; player.steerIn = 0; player.hand = false; }
    for (const c of cars) if (c !== player) aiDrive(c, dt);
    if (countdown > 0) for (const c of cars) { c.throttle = 0; c.brake = 0; if (c !== player) c.steerIn = 0; }
    for (const c of cars) driveCar(c, dt);
    collide();

    // progress, laps, overtakes
    for (const c of cars) {
      if (track.closed) {
        if (!c.finished && c.prevS > track.len * 0.72 && c.s < track.len * 0.28) { c.lap++; if (state === 'play') onLapCross(c); }
        else if (c.prevS < track.len * 0.28 && c.s > track.len * 0.72) c.lap--;
        c.prog = c.lap * track.len + c.s;
      } else c.prog = c.s;
      c.prevS = c.s;
    }
    if (state !== 'play') { camFollow(dt); if (!track.closed) extend(player.s + 2400); return; }

    // pick-ups
    for (const p of pickups) {
      if (p.gone) continue;
      for (const c of cars) {
        if (Math.hypot(c.x - p.x, c.y - p.y) < 26) { takePickup(c, p); break; }
      }
    }

    if (!CLASSIC) infiniteRules(dt);
    else classicRules(dt);

    // drift
    const sp = Math.abs(player.speed);
    if (Math.abs(player.slip) > DRIFT_V && sp > 120 && player.surf !== 'grass' && player.surf !== 'sand') {
      driftRun += dt;
      if (!CLASSIC && countdown <= 0) addScore(50 * dt * (sp / MAXV));   // Classic scores points and lap times only
      skidT -= dt;
      if (skidT <= 0) { skidT = 0.13; Sound.noise(0.14, 0.035, 0, 2600); }
    } else if (driftRun > 0) { bestDrift = Math.max(bestDrift, driftRun); driftRun = 0; }

    checkSplit();
    if (!CLASSIC) scoreCorner(dt);
    camFollow(dt);
    if (Math.floor(time / 0.5) > paceRec.length - 1 && paceRec.length < 1500) paceRec.push(Math.round(player.prog));
    if (CLASSIC && lapPath && Math.floor((time - lapStart) / 0.12) > lapPath.length - 1) {
      lapPath.push([Math.round(player.x), Math.round(player.y), Math.round(player.a * 100) / 100]);
    }
  }

  function onLapCross(c) {
    if (!CLASSIC) return;
    if (c === player) onLapDone(c);
    if (c.lap >= LAPS) {
      c.finished = true; c.finishT = time;
      if (c === player) finishRace(cars.filter((o) => o.finished && o !== player).length + 1);
    }
  }

  function infiniteRules(dt) {
    if (countdown > 0) return;
    extend(player.s + 2600);
    // score for ground covered
    const m = player.prog * MPU;
    if (m > scoredM) { addScore((m - scoredM) * 4); scoredM = m; }
    // overtakes
    for (const c of cars) {
      if (c === player) continue;
      const ahead = c.prog > player.prog + 12;
      if (c.wasAhead && !ahead && c.prog < player.prog - 12) {
        overtakes++;
        addScore(c.kind === 'rival' ? 300 : 150);
        popup((c.kind === 'rival' ? '+300 ' : '+150 ') + (c.name || 'PASS'), player, '#8fd0ff');
      }
      c.wasAhead = ahead || (c.wasAhead && c.prog > player.prog - 12);
    }
    // keep the rivals in the fight, and clear traffic that is long gone
    for (const c of cars) {
      if (c.kind !== 'rival') continue;
      if (c.prog < player.prog - 1000 || c.prog > player.prog + 1100) {
        const s = player.prog + (c.prog < player.prog ? 900 : -500);
        placeCar(c, s, (c.rng() - 0.5) * 90);   // the car's own rng: the daily's world stream must not shift
        c.wasAhead = s > player.prog;
      }
    }
    cars = cars.filter((c) => c.kind !== 'traffic' || c.prog > player.prog - 600);
    hazards = hazards.filter((h) => h.s > player.prog - 800 || h.drop);
    pickups = pickups.filter((p) => p.s > player.prog - 600);
    // the cut-off line
    // the line keeps creeping up long after the road has stopped getting harder, so no run lasts forever
    const d = diffOf();
    const creep = 150 + 130 * d + 32 * Math.max(0, player.prog / 40000 - 1);
    cut = Math.max(cut + creep * dt, player.prog - 1150);
    const gap = player.prog - cut;
    if (gap < 260) {
      cutWarn -= dt;
      if (cutWarn <= 0) { cutWarn = 0.7; Sound.tone(160, 120, 0.2, 'square', 0.05); toast('CUT-OFF CLOSING'); }
    }
    if (gap <= 0) endGame(false, 'The cut-off line caught you.');
  }

  function classicRules(dt) {
    // if every rival is home and the player is still out there, call it a day eventually
    if (!raceOver && cars.every((c) => c === player || c.finished)) {
      raceIdle += dt;
      if (raceIdle > 75) finishRace(4);
    }
    if (raceOver) {
      raceOver.t += dt;
      if (raceOver.t > 3.4) {
        if (raceIdx >= RACES - 1) endGame(raceOver.pos === 1, raceOver.pos === 1 ? '' : `Finished the championship P${raceOver.pos} in the final race.`);
        else { raceOver = null; startRace(raceIdx + 1); }
      }
    }
  }

  function collide() {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > CAR_R * 2 || d === 0) continue;
        const nx = dx / d, ny = dy / d, push = (CAR_R * 2 - d) / 2;
        const aShield = a.shield > 0, bShield = b.shield > 0;
        a.x -= nx * push * (aShield ? 0.3 : 1); a.y -= ny * push * (aShield ? 0.3 : 1);
        b.x += nx * push * (bShield ? 0.3 : 1); b.y += ny * push * (bShield ? 0.3 : 1);
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel > 0) continue;
        const imp = -rel;
        if (!aShield) { a.vx -= nx * imp * 0.5; a.vy -= ny * imp * 0.5; }
        if (!bShield) { b.vx += nx * imp * 0.5; b.vy += ny * imp * 0.5; }
        if ((a === player || b === player) && state === 'play') {
          const p = player, o = a === player ? b : a;
          if (p.bump <= 0) {
            Sound.noise(0.14, Math.min(0.1, imp / 2600), 0, 1400);
            for (let k = 0; k < 4; k++) dust.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vx: rand(-80, 80), vy: rand(-80, 80), t: 0, life: 0.3, c: '#ffd23f', r: 3 });
          }
          p.bump = 0.25;
          if (corner) corner.clean = false;
          if (!CLASSIC && imp > 360 && p.shield <= 0 && o.kind === 'traffic') endGame(false, 'You piled into the back of traffic.');
        }
      }
    }
  }

  function camFollow(dt) {
    camX = player.x; camY = player.y;
    camA += angDiff(player.a, camA) * Math.min(1, dt * 7);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const keys = new Set();
  let touchSteer = 0, touchDrag = null, autoGas = false, autoDrive = false;
  let prevBoost = false, prevOil = false;

  function playerControls(dt) {
    const p = player;
    let steer = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    if (!steer && touchDrag) steer = touchSteer;
    p.steerIn = clamp(steer, -1, 1);
    const gas = keys.has('up') || (autoGas && state === 'play' && countdown <= 0 && !keys.has('down'));
    p.throttle = gas ? 1 : 0;
    p.brake = keys.has('down') ? 1 : 0;
    p.hand = keys.has('drift');
    const b = keys.has('boost');
    if (b && !prevBoost) useBoost(p);
    prevBoost = b;
    const o = keys.has('oil');
    if (o && !prevOil && p.oilCool <= 0) dropOil(p);
    prevOil = o;
  }

  const KEYMAP = {
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up',
    arrowdown: 'down', s: 'down', ' ': 'drift', shift: 'boost', x: 'boost', b: 'oil',
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; return; }
    if (k === 'm') { $('sound-btn').click(); return; }
    if (k === 'enter' || (k === ' ' && state !== 'play')) {
      if (state === 'title' || state === 'over') { e.preventDefault(); if (!e.repeat) start(); return; }
    }
    if (k in KEYMAP) {
      e.preventDefault();
      if (state === 'play') { if (paused) paused = false; keys.add(KEYMAP[k]); }
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) keys.delete(KEYMAP[k]);
  });
  window.addEventListener('blur', () => { keys.clear(); touchDrag = null; touchSteer = 0; });

  // touch: drag anywhere to steer (relative, so the thumb never covers the car) with auto-throttle
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    autoGas = true;
    touchDrag = { id: e.pointerId, x: e.clientX };
    touchSteer = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!touchDrag || touchDrag.id !== e.pointerId) return;
    const dx = e.clientX - touchDrag.x;
    touchSteer = clamp(dx / 64, -1, 1);
    if (Math.abs(dx) > 64) touchDrag.x = e.clientX - Math.sign(dx) * 64;
  });
  const endTouch = (e) => { if (touchDrag && touchDrag.id === e.pointerId) { touchDrag = null; touchSteer = 0; } };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);
  bindPadButtons(keys);
  if (matchMedia('(pointer: coarse)').matches) autoGas = true;

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // ---------------------------------------------------------------------------
  // Engine note — an oscillator pair that follows the revs
  // ---------------------------------------------------------------------------
  const engine = { osc: null, osc2: null, gain: null, filter: null };
  function engineStart() {
    if (engine.osc || !Sound.ac) return;
    try {
      const ac = Sound.ac;
      engine.gain = ac.createGain(); engine.gain.gain.value = 0;
      engine.filter = ac.createBiquadFilter(); engine.filter.type = 'lowpass'; engine.filter.frequency.value = 900;
      engine.osc = ac.createOscillator(); engine.osc.type = 'sawtooth';
      engine.osc2 = ac.createOscillator(); engine.osc2.type = 'square';
      engine.osc.connect(engine.filter); engine.osc2.connect(engine.filter);
      engine.filter.connect(engine.gain).connect(ac.destination);
      engine.osc.start(); engine.osc2.start();
    } catch (e) { engine.osc = null; }
  }
  function engineUpdate() {
    if (!engine.osc || !Sound.ac) return;
    const ac = Sound.ac, t = ac.currentTime;
    const v = player ? clamp(Math.abs(player.speed) / MAXV, 0, 1.3) : 0;
    const on = Sound.on && state === 'play' && !paused;
    const rev = countdown > 1 ? 0.35 + Math.abs(Math.sin(time * 9)) * 0.3 : v;
    try {
      engine.osc.frequency.setTargetAtTime(52 + rev * 165, t, 0.05);
      engine.osc2.frequency.setTargetAtTime(26 + rev * 82, t, 0.05);
      engine.filter.frequency.setTargetAtTime(420 + rev * 1700 + (player && player.boost > 0 ? 700 : 0), t, 0.08);
      engine.gain.gain.setTargetAtTime(on ? 0.012 + rev * 0.018 : 0, t, 0.08);
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function toCam(x, y) {
    const c = Math.cos(-camA - Math.PI / 2), s = Math.sin(-camA - Math.PI / 2);
    const dx = x - camX, dy = y - camY;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  function render() {
    ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    ctx.clearRect(0, 0, view.W, view.H);
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();
    ctx.fillStyle = '#16301f';
    ctx.fillRect(0, 0, FW, FH);

    ctx.save();
    ctx.translate(FW / 2, CAM_Y);
    ctx.rotate(-camA - Math.PI / 2);
    ctx.translate(-camX, -camY);
    drawGrass();
    drawSand();
    drawRoad();
    drawMarks();
    drawOil();
    drawPickups();
    drawGhost();
    for (const c of cars) if (c !== player) drawCar(c);
    drawCar(player);
    drawDust();
    drawPopups();
    ctx.restore();

    drawSpeedo();
    drawMiniMap();
    drawOverlayText();
    if (flash > 0) { ctx.fillStyle = `rgba(255,120,80,${Math.min(0.45, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = '#e94f37'; ctx.font = '26px "Press Start 2P", monospace'; ctx.textAlign = 'center';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    ctx.restore();
  }

  function drawGrass() {
    const g = 132, R = 900;
    ctx.fillStyle = '#12281a';
    for (let x = Math.floor((camX - R) / g) * g; x < camX + R; x += g) {
      for (let y = Math.floor((camY - R) / g) * g; y < camY + R; y += g) {
        const h = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        ctx.fillRect(x + h * 60, y + ((h * 7) % 1) * 60, 4 + h * 10, 3);
      }
    }
  }

  // nodes drawn around the car: wide enough that a corner folding back on itself still has its road
  function visibleRange() {
    const i = player.idx || 0;
    return [i - 40, i + 60];
  }

  function drawSand() {
    for (const h of hazards) {
      if (h.type !== 'sand') continue;
      ctx.fillStyle = '#6f5c33';
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8a7444';
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r * 0.7, 0, TAU); ctx.fill();
    }
  }

  // one batched path per colour: a phone draws a hundred nodes of road in about a dozen canvas calls
  function drawRoad() {
    const [i0, i1] = visibleRange();
    const ox = (n, o) => n.x - Math.sin(n.a) * o;
    const oy = (n, o) => n.y + Math.cos(n.a) * o;
    const stripe = (i) => (((i % 2) + 2) % 2) === 0;

    // asphalt
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const n = nodeAt(track, i);
      const x = ox(n, n.hw), y = oy(n, n.hw);
      if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = i1; i >= i0; i--) {
      const n = nodeAt(track, i);
      ctx.lineTo(ox(n, -n.hw), oy(n, -n.hw));
    }
    ctx.closePath();
    ctx.fillStyle = '#2b2f38';
    ctx.fill();

    // kerbs, only where the road actually bends
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = c ? '#f3f3f3' : '#e0413a';
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const A = nodeAt(track, i);
        if (Math.abs(A.curv) <= 0.0032 || stripe(i) !== (c === 0)) continue;
        const B = nodeAt(track, i + 1);
        for (const s2 of [-1, 1]) {
          ctx.moveTo(ox(A, s2 * A.hw), oy(A, s2 * A.hw));
          ctx.lineTo(ox(B, s2 * B.hw), oy(B, s2 * B.hw));
          ctx.lineTo(ox(B, s2 * (B.hw + KERB)), oy(B, s2 * (B.hw + KERB)));
          ctx.lineTo(ox(A, s2 * (A.hw + KERB)), oy(A, s2 * (A.hw + KERB)));
          ctx.closePath();
        }
      }
      ctx.fill();
    }

    // painted edge lines
    ctx.strokeStyle = '#d8dde4';
    ctx.lineWidth = 2;
    for (const sg of [-1, 1]) {
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const n = nodeAt(track, i);
        const x = ox(n, sg * (n.hw - 4)), y = oy(n, sg * (n.hw - 4));
        if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // centre dashes
    ctx.strokeStyle = '#ffffff55';
    ctx.lineWidth = 3;
    ctx.setLineDash([24, 32]);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const n = nodeAt(track, i);
      if (i === i0) ctx.moveTo(n.x, n.y); else ctx.lineTo(n.x, n.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // striped barriers
    ctx.lineWidth = 6;
    for (let c = 0; c < 2; c++) {
      ctx.strokeStyle = c ? '#e8e8ee' : '#e94f37';
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        if (stripe(i) !== (c === 0)) continue;
        const A = nodeAt(track, i), B = nodeAt(track, i + 1);
        for (const sg of [-1, 1]) {
          ctx.moveTo(ox(A, sg * (A.hw + VERGE)), oy(A, sg * (A.hw + VERGE)));
          ctx.lineTo(ox(B, sg * (B.hw + VERGE)), oy(B, sg * (B.hw + VERGE)));
        }
      }
      ctx.stroke();
    }

    // start line / checkpoints
    if (track.closed) drawBand(0, true);
    else {
      const first = Math.ceil(Math.max(0, player.s - 400) / SECTOR) * SECTOR;
      for (let s = first; s < player.s + 1400; s += SECTOR) drawBand(s, false);
    }
  }

  function drawBand(s, chequer) {
    const p = pointAt(track, s);
    if (Math.hypot(p.x - camX, p.y - camY) > 1200) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    const w = p.hw * 2;
    if (chequer) {
      const n = 10, cw = w / n;
      for (let r = 0; r < 2; r++) {
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = (i + r) % 2 ? '#f4f4f4' : '#1c1f26';
          ctx.fillRect(r * 9, -p.hw + i * cw, 9, cw);
        }
      }
    } else {
      ctx.fillStyle = '#ffd23f88';
      ctx.fillRect(-3, -p.hw, 6, w);
    }
    ctx.restore();
  }

  function drawMarks() {
    const buckets = [[], [], [], []];
    for (const m of marks) {
      if (Math.abs(m.x1 - camX) > 1000 || Math.abs(m.y1 - camY) > 1000) continue;
      const a = 1 - m.t / 7;
      if (a <= 0.08) continue;
      buckets[Math.min(3, Math.floor(a * 4))].push(m);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    for (let b = 0; b < 4; b++) {
      if (!buckets[b].length) continue;
      ctx.strokeStyle = `rgba(16,16,22,${0.1 + b * 0.11})`;
      ctx.beginPath();
      for (const m of buckets[b]) { ctx.moveTo(m.x1, m.y1); ctx.lineTo(m.x2, m.y2); }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  function drawOil() {
    for (const h of hazards) {
      if (h.type !== 'oil') continue;
      ctx.fillStyle = 'rgba(12,12,18,0.85)';
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(90,70,140,0.35)';
      ctx.beginPath(); ctx.arc(h.x - h.r * 0.2, h.y - h.r * 0.2, h.r * 0.5, 0, TAU); ctx.fill();
    }
  }

  function drawPickups() {
    const face = camA + Math.PI / 2;
    for (const p of pickups) {
      if (p.gone > 0.45) continue;
      if (Math.hypot(p.x - camX, p.y - camY) > 900) continue;
      const col = p.type === 'boost' ? '#ffd23f' : p.type === 'shield' ? '#3fd8ff' : '#b06cff';
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(face);
      const s = p.gone ? 1 + p.gone * 2.5 : 1 + Math.sin(p.t * 4) * 0.08;
      ctx.globalAlpha = p.gone ? Math.max(0, 1 - p.gone / 0.45) : 1;
      ctx.scale(s, s);
      ctx.fillStyle = '#0a0f14cc';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.font = '16px serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.type === 'boost' ? '🚀' : p.type === 'shield' ? '🛡️' : '🛢️', 0, 1);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function drawGhost() {
    if (state !== 'play') return;
    if (CLASSIC && ghostPath) {
      const p = ghostPath.p;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      for (let i = 0; i < p.length; i++) (i ? ctx.lineTo(p[i][0], p[i][1]) : ctx.moveTo(p[i][0], p[i][1]));
      ctx.stroke();
      ctx.setLineDash([]);
      const i = Math.floor((time - lapStart) / 0.12);
      if (i >= 0 && i < p.length) ghostCar(p[i][0], p[i][1], p[i][2]);
    } else if (!CLASSIC && ghostPace) {
      const d = distanceAtTime(ghostPace.s, time);
      if (d <= 0 || d > track.len) return;
      const q = pointAt(track, d);
      const back = pointAt(track, Math.max(0, d - 220));
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(back.x, back.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ghostCar(q.x, q.y, q.a);
    }
  }

  function ghostCar(x, y, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#ffffff';
    roundRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function drawCar(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    roundRect(-CAR_L / 2 + 3, -CAR_W / 2 + 4, CAR_L, CAR_W, 6);
    ctx.fill();
    // wheels
    ctx.fillStyle = '#14141c';
    for (const [ox, oy, turn] of [[11, -CAR_W / 2 - 1, 1], [11, CAR_W / 2 - 4, 1], [-12, -CAR_W / 2 - 1, 0], [-12, CAR_W / 2 - 4, 0]]) {
      ctx.save();
      ctx.translate(ox, oy + 2.5);
      if (turn) ctx.rotate(c.steer * 0.45);
      ctx.fillRect(-5, -2.5, 10, 5);
      ctx.restore();
    }
    // body
    ctx.fillStyle = c.color;
    roundRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    roundRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-CAR_L / 2 + 6, -CAR_W / 2 + 3, 7, CAR_W - 6);
    ctx.fillStyle = '#0d1420';
    roundRect(-2, -CAR_W / 2 + 3, 9, CAR_W - 6, 3);
    ctx.fill();
    if (c.bump > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, c.bump * 2)})`;
      roundRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 6);
      ctx.fill();
    }
    if (c.boost > 0) {
      ctx.fillStyle = 'rgba(255,190,60,0.85)';
      ctx.beginPath();
      ctx.moveTo(-CAR_L / 2, -4); ctx.lineTo(-CAR_L / 2 - 10 - Math.random() * 12, 0); ctx.lineTo(-CAR_L / 2, 4);
      ctx.closePath(); ctx.fill();
    }
    if (c.shield > 0) {
      ctx.strokeStyle = `rgba(63,216,255,${c.shield < 3 && Math.floor(c.shield * 6) % 2 ? 0.25 : 0.7})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, CAR_L * 0.72, CAR_W * 0.95, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function drawDust() {
    for (const d of dust) {
      ctx.globalAlpha = Math.max(0, 1 - d.t / d.life);
      ctx.fillStyle = d.c;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '9px "Press Start 2P", monospace';
    for (const p of popups) {
      ctx.save();
      ctx.translate(p.x, p.y - 26 - p.t * 34);
      ctx.rotate(camA + Math.PI / 2);
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.1);
      ctx.fillStyle = p.c;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // --- screen furniture -------------------------------------------------------
  function drawSpeedo() {
    const cx = 86, cy = FH - 92, r = 52;
    const sp = player ? Math.abs(player.speed) : 0;
    const frac = clamp(sp / (MAXV * 1.3), 0, 1);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(8,12,16,0.72)';
    ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(0, 0, r - 4, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
    ctx.strokeStyle = player && player.boost > 0 ? '#ffd23f' : '#e94f37';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(0, 0, r - 4, Math.PI * 0.75, Math.PI * 0.75 + frac * Math.PI * 1.5); ctx.stroke();
    ctx.strokeStyle = '#ffffff55';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * 0.75 + (i / 6) * Math.PI * 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 12), Math.sin(a) * (r - 12));
      ctx.lineTo(Math.cos(a) * (r - 20), Math.sin(a) * (r - 20));
      ctx.stroke();
    }
    const na = Math.PI * 0.75 + frac * Math.PI * 1.5;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(na) * (r - 16), Math.sin(na) * (r - 16)); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '13px "Press Start 2P", monospace';
    ctx.fillText(String(Math.round(sp * KMH)), 0, 16);
    ctx.fillStyle = '#8a93a0';
    ctx.font = '7px "Press Start 2P", monospace';
    ctx.fillText('KM/H', 0, 30);
    ctx.restore();
  }

  function drawMiniMap() {
    if (!track) return;
    const bw = 104, bh = 116, bx = FW - bw - 16, by = 104;
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,16,0.6)';
    roundRect(bx, by, bw, bh, 8);
    ctx.fill();
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    roundRect(bx, by, bw, bh, 8);
    ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
    if (track.closed) {
      const w = track.maxX - track.minX, h = track.maxY - track.minY;
      const ms = Math.min((bw - 18) / Math.max(1, w), (bh - 18) / Math.max(1, h));
      const cx = (track.minX + track.maxX) / 2, cy = (track.minY + track.maxY) / 2;
      const mx = (x) => bx + bw / 2 + (x - cx) * ms, my = (y) => by + bh / 2 + (y - cy) * ms;
      ctx.strokeStyle = '#8a93a0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i < track.nodes.length; i += 2) {
        const n = track.nodes[i];
        (i ? ctx.lineTo(mx(n.x), my(n.y)) : ctx.moveTo(mx(n.x), my(n.y)));
      }
      ctx.closePath();
      ctx.stroke();
      for (const c of cars) {
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.arc(mx(c.x), my(c.y), c === player ? 3.5 : 2.5, 0, TAU); ctx.fill();
      }
    } else {
      const ms = 0.05, ox = bx + bw / 2, oy = by + bh * 0.72;
      const at = (x, y) => { const p = toCam(x, y); return [ox + p.x * ms, oy + p.y * ms]; };
      ctx.strokeStyle = '#8a93a0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      const [i0, i1] = [player.idx - 14, player.idx + 90];
      for (let i = i0; i <= i1; i++) {
        const n = nodeAt(track, i);
        const p = at(n.x, n.y);
        (i === i0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
      }
      ctx.stroke();
      const cp = pointAt(track, Math.max(0, cut));
      const cl = at(cp.x, cp.y);
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cl[0] - 9, cl[1]); ctx.lineTo(cl[0] + 9, cl[1]); ctx.stroke();
      for (const c of cars) {
        const p = at(c.x, c.y);
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.arc(p[0], p[1], c === player ? 3.5 : 2.5, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
    ctx.restore();
  }

  function drawOverlayText() {
    ctx.save();
    ctx.textAlign = 'center';
    if (countdown > 0 && state === 'play') {
      const n = Math.ceil(countdown - 0.4);
      ctx.fillStyle = '#0009';
      ctx.fillRect(FW / 2 - 110, FH * 0.3 - 34, 220, 54);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = (3 - i) >= n && n > 0 ? '#ff3b3b' : n <= 0 ? '#3cff8a' : '#331a1a';
        ctx.beginPath(); ctx.arc(FW / 2 - 60 + i * 60, FH * 0.3 - 8, 18, 0, TAU); ctx.fill();
      }
      if (n <= 0) {
        ctx.fillStyle = '#3cff8a';
        ctx.font = '28px "Press Start 2P", monospace';
        ctx.fillText('GO!', FW / 2, FH * 0.3 + 62);
      }
    }
    if (banner) {
      const a = banner.t < 0.25 ? banner.t / 0.25 : banner.t > 2.1 ? (2.6 - banner.t) / 0.5 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = '#fff';
      ctx.font = `${banner.big ? 18 : 14}px "Press Start 2P", monospace`;
      ctx.shadowColor = '#e94f37';
      ctx.shadowBlur = 18;
      ctx.fillText(banner.text, FW / 2, FH * 0.47);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    if (state === 'play' && !CLASSIC) {
      const gap = player.prog - cut;
      if (gap < 420) {
        ctx.fillStyle = Math.floor(time * 6) % 2 ? '#ff4d4d' : '#ffae4d';
        ctx.font = '11px "Press Start 2P", monospace';
        ctx.fillText('CUT-OFF ' + Math.round(gap * MPU) + 'm', FW / 2, FH - 26);
      }
    }
    if (state === 'title') {
      ctx.fillStyle = '#ffffff55';
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillText(CLASSIC ? CIRCUITS[0].name : 'ATTRACT LAP', FW / 2, FH - 22);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const lastHud = {};
  function hud() {
    if (!player) return;
    const set = (id, v) => { if (lastHud[id] !== v) { lastHud[id] = v; const el = $(id); if (el) el.textContent = v; } };
    set('score', score.toLocaleString());
    set('high', Math.max(high, score).toLocaleString());
    const pk = [player.boosts ? '🚀×' + player.boosts : '', player.shield > 0 ? '🛡️' + Math.ceil(player.shield) : '', player.oils ? '🛢️×' + player.oils : ''].filter(Boolean).join(' ');
    set('pickups', state === 'title' ? '' : pk);
    if (state === 'title') { set('lapinfo', ''); set('timer', ''); set('dist', ''); set('split', ''); return; }
    if (CLASSIC) {
      set('lapinfo', `R${raceIdx + 1}/${RACES} · LAP ${clamp(player.lap + 1, 1, LAPS)}/${LAPS} · P${positionOf(player)}`);
      set('timer', fmt(Math.max(0, time - lapStart)));
      set('dist', bestLap ? 'BEST ' + bestLap.toFixed(2) : CIRCUITS[raceIdx].name);
    } else {
      set('lapinfo', Math.round(player.prog * MPU).toLocaleString() + 'm');
      set('timer', fmt(Math.max(0, time)));
      set('dist', 'CUT-OFF ' + Math.max(0, Math.round((player.prog - cut) * MPU)) + 'm');
    }
    const sp = $('split');
    if (sp) {
      const v = splitMsg ? splitMsg.text : '';
      if (lastHud.split !== v) { lastHud.split = v; sp.textContent = v; }
      sp.classList.toggle('slow', !!(splitMsg && splitMsg.slow));
    }
  }

  function positionOf(c) {
    const sorted = cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishT - b.finishT;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.prog - a.prog;
    });
    return sorted.indexOf(c) + 1;
  }

  // ---------------------------------------------------------------------------
  // Test hook (localhost only) — see docs/ADDING_A_GAME.md
  // ---------------------------------------------------------------------------
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'racer',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => ({
        state, paused, mode: CLASSIC ? 'classic' : DAILY ? 'daily' : 'infinite',
        score, speed: Math.round(Math.abs(player ? player.speed : 0) * KMH),
        distance: Math.round((player ? player.prog : 0) * MPU),
        lap: CLASSIC ? Math.min(player.lap + 1, LAPS) : 0,
        laps: LAPS, race: raceIdx + 1, position: CLASSIC ? positionOf(player) : 0,
        crashes, overtakes, cleanCorners, drift: Math.round(Math.max(bestDrift, driftRun) * 10) / 10,
        surf: player && player.surf, boosts: player && player.boosts, oils: player && player.oils,
        shield: player ? Math.ceil(player.shield) : 0, cut: Math.round(cut * MPU),
        countdown: Math.max(0, Math.round(countdown * 10) / 10), cars: cars.length, nodes: track ? track.nodes.length : 0,
      }),
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'countdown') countdown = v;
        else if (k === 'boosts') player.boosts = v;
        else if (k === 'oils') player.oils = v;
        else if (k === 'shield') player.shield = v;
        else if (k === 'cut') cut = v / MPU;
        else if (k === 'lap') { player.lap = v; player.prevS = player.s; }
        else if (k === 'race') { raceOver = null; startRace(clamp(v - 1, 0, RACES - 1)); }
        else if (k === 'distance') {
          const s = v / MPU;
          if (!CLASSIC) { extend(s + 2600); placeCar(player, s, 0); player.prog = s; scoredM = v; cut = s - 900; }
        }
      },
      auto: (on = true) => { autoDrive = on; player.skill = 0.95; player.alat = 410; },
      press: (k) => keys.add(k),
      release: (k) => keys.delete(k),
      win: () => {
        if (!CLASSIC) { addScore(15000); return endGame(false, 'Test finish.'); }
        raceIdx = RACES - 1;
        finishes = [1, 1, 1, 1];
        raceOver = null;
        player.finished = true;
        finishRace(1);
        raceOver.t = 4;
        classicRules(0.01);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Main loop — the title screen runs an attract lap with the car on autopilot
  // ---------------------------------------------------------------------------
  newGame();
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    if (state === 'title' && !CLASSIC && track.nodes.length > 3400) newGame();
    render();
    hud();
    engineUpdate();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
