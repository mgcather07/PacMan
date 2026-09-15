(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Deterministic hashing — the whole infinite world is a pure function of seed
  // ---------------------------------------------------------------------------
  let SEED = (Math.random() * 2 ** 31) | 0;

  function hash(x, y, salt) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((salt + SEED) | 0, 1103515245);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  const mod = (a, n) => ((a % n) + n) % n;

  // ---------------------------------------------------------------------------
  // Infinite maze
  //   Nodes sit on a lattice every S tiles. Edges between neighbouring nodes are
  //   randomly open; any node left with fewer than two exits forces extra edges
  //   open, so there are no dead ends. Everything between nodes is 2-thick wall.
  // ---------------------------------------------------------------------------
  const S = 3;
  const P_OPEN = 0.55;
  const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]; // R D L U
  const baseH = (i, j) => hash(i, j, 11) < P_OPEN; // node(i,j) <-> node(i+1,j)
  const baseV = (i, j) => hash(i, j, 23) < P_OPEN; // node(i,j) <-> node(i,j+1)

  const forcedCache = new Map();
  function forcedEdges(i, j) {
    const key = i * 100003 + j;
    let m = forcedCache.get(key);
    if (m !== undefined) return m;
    const open = [baseH(i, j), baseV(i, j), baseH(i - 1, j), baseV(i, j - 1)];
    const deg = open.filter(Boolean).length;
    m = 0;
    if (deg < 2) {
      const closed = [0, 1, 2, 3].filter((d) => !open[d]).sort((a, b) => hash(i, j, 31 + a) - hash(i, j, 31 + b));
      for (let k = 0; k < 2 - deg; k++) m |= 1 << closed[k];
    }
    if (forcedCache.size > 300000) forcedCache.clear();
    forcedCache.set(key, m);
    return m;
  }
  const openH = (i, j) => baseH(i, j) || (forcedEdges(i, j) & 1) !== 0 || (forcedEdges(i + 1, j) & 4) !== 0;
  const openV = (i, j) => baseV(i, j) || (forcedEdges(i, j) & 2) !== 0 || (forcedEdges(i, j + 1) & 8) !== 0;

  function isWall(x, y) {
    const mx = mod(x, S), my = mod(y, S);
    if (mx === 0 && my === 0) return false;
    if (mx !== 0 && my !== 0) return true;
    const i = Math.floor(x / S), j = Math.floor(y / S);
    return my === 0 ? !openH(i, j) : !openV(i, j);
  }
  const isNode = (x, y) => mod(x, S) === 0 && mod(y, S) === 0;

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------
  const DOT = 1, POWER = 2, CARD = 3;
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SUIT_COLORS = ['#e8e8ff', '#ff4d6d', '#ff4d6d', '#e8e8ff'];
  const eaten = new Set();
  const tkey = (x, y) => x + ',' + y;

  function itemAt(x, y) {
    if (eaten.has(tkey(x, y))) return 0;
    if (isNode(x, y) && (Math.abs(x) + Math.abs(y) > 6)) {
      const h = hash(x, y, 57);
      if (h < 0.022) return POWER;
      if (h < 0.028) return CARD;
    }
    return DOT;
  }
  const cardSuit = (x, y) => Math.floor(hash(x, y, 71) * 4);

  const FRUITS = [
    { e: '🍒', v: 100 }, { e: '🍓', v: 300 }, { e: '🍊', v: 500 }, { e: '🍎', v: 700 },
    { e: '🍈', v: 1000 }, { e: '🔔', v: 2000 }, { e: '🔑', v: 3000 }, { e: '👾', v: 5000 },
  ];

  // ---------------------------------------------------------------------------
  // Sound (tiny WebAudio synth)
  // ---------------------------------------------------------------------------
  const Sound = {
    ac: null,
    on: true,
    init() {
      if (this.ac) return;
      try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ac = null; }
    },
    tone(f1, f2, dur, type = 'square', vol = 0.04, delay = 0) {
      if (!this.on || !this.ac) return;
      const t = this.ac.currentTime + delay;
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ac.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    wakaFlip: false,
    waka() { this.wakaFlip = !this.wakaFlip; this.wakaFlip ? this.tone(260, 480, 0.07, 'triangle', 0.06) : this.tone(480, 260, 0.07, 'triangle', 0.06); },
    power() { this.tone(120, 900, 0.35, 'sawtooth', 0.035); },
    ghost() { this.tone(200, 1600, 0.25, 'square', 0.04); },
    fruit() { this.tone(600, 1200, 0.12, 'square', 0.04); this.tone(900, 1800, 0.12, 'square', 0.04, 0.1); },
    card() { [523, 659, 784].forEach((f, i) => this.tone(f, f * 1.01, 0.1, 'triangle', 0.06, i * 0.07)); },
    life() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.04, i * 0.08)); },
    death() { this.tone(900, 60, 1.2, 'sawtooth', 0.05); },
    start() { [262, 523, 392, 330, 523, 392, 330].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.035, i * 0.13)); },
  };

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  const GHOST_COLORS = ['#ff2a2a', '#ffb8ff', '#00e5ff', '#ffb852', '#4dff7a', '#b37bff', '#ffffff', '#ff7ac8'];
  const SPAWN_T = 0.9;

  let W = 0, H = 0, DPR = 1, T = 24;
  let state = 'title'; // title | ready | play | dying | over
  let paused = false;
  let stateT = 0;
  let time = 0;
  let pac, ghosts, fruit, popups;
  let score, lives, dotsEaten, level, frightT, combo, suits, nextLifeAt, farthest, modeT, scatter, freezeT;
  let highScore = 0;
  try { highScore = +localStorage.getItem('infpac.high') || 0; } catch (e) { /* ignore */ }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    T = Math.max(18, Math.min(34, Math.round(Math.min(W, H) / 21)));
  }
  window.addEventListener('resize', resize);
  resize();

  function newGame() {
    SEED = (Math.random() * 2 ** 31) | 0;
    forcedCache.clear();
    eaten.clear();
    pac = { x: 0, y: 0, dir: -1, next: 2, face: 2, speed: 7.2, chew: 0 };
    ghosts = [];
    fruit = null;
    popups = [];
    score = 0; lives = 3; dotsEaten = 0; level = 1; frightT = 0; combo = 0;
    suits = [false, false, false, false];
    nextLifeAt = 10000; farthest = 0; modeT = 0; scatter = false; freezeT = 0;
    eaten.add(tkey(0, 0));
    spawnGhosts();
    setState('ready');
    Sound.start();
  }

  function setState(s) { state = s; stateT = 0; }

  const ghostCount = () => Math.min(4 + Math.floor((level - 1) / 2), 8);
  const ghostSpeed = () => Math.min(6.0 + (level - 1) * 0.22, 8.0);
  const pacSpeed = () => Math.min(7.2 + (level - 1) * 0.12, 8.4);
  const frightDuration = () => Math.max(2.5, 8 - (level - 1) * 0.45);

  function spawnPoint() {
    const minR = 11, maxR = Math.max(14, Math.min(22, Math.hypot(W, H) / T / 2 + 2));
    for (let tries = 0; tries < 40; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = Math.round((pac.x + Math.cos(a) * r) / S) * S;
      const y = Math.round((pac.y + Math.sin(a) * r) / S) * S;
      if (Math.hypot(x - pac.x, y - pac.y) >= minR - 1) return { x, y };
    }
    return { x: Math.round(pac.x / S) * S + 15, y: Math.round(pac.y / S) * S };
  }

  function makeGhost(idx) {
    const p = spawnPoint();
    return { x: p.x, y: p.y, dir: -1, idx, kind: idx % 4, state: 'spawning', t: 0, eyesTarget: null };
  }

  function respawnGhost(g) {
    const p = spawnPoint();
    g.x = p.x; g.y = p.y; g.dir = -1; g.state = 'spawning'; g.t = 0;
  }

  function spawnGhosts() {
    ghosts = [];
    for (let i = 0; i < ghostCount(); i++) ghosts.push(makeGhost(i));
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------
  function advance(e, dist, onCenter) {
    let guard = 0;
    while (dist > 1e-6 && guard++ < 24) {
      if (Math.abs(e.x - Math.round(e.x)) < 1e-6 && Math.abs(e.y - Math.round(e.y)) < 1e-6) {
        e.x = Math.round(e.x);
        e.y = Math.round(e.y);
        onCenter(e);
        if (e.dir < 0) return;
        const d = DIRS[e.dir];
        if (isWall(e.x + d.x, e.y + d.y)) { e.dir = -1; return; }
      }
      if (e.dir < 0) {
        // stopped off-grid: snap to the nearest tile centre and try again next frame
        e.x = Math.round(e.x);
        e.y = Math.round(e.y);
        return;
      }
      const d = DIRS[e.dir];
      let tx = e.x, ty = e.y;
      if (d.x) tx = d.x > 0 ? Math.floor(e.x) + 1 : Math.ceil(e.x) - 1;
      else ty = d.y > 0 ? Math.floor(e.y) + 1 : Math.ceil(e.y) - 1;
      const rem = Math.abs(tx - e.x) + Math.abs(ty - e.y);
      const step = Math.min(dist, rem);
      if (step >= rem - 1e-9) { e.x = tx; e.y = ty; } else { e.x += d.x * step; e.y += d.y * step; }
      dist -= step;
      if (e === pac) pac.chew += step;
    }
  }

  function pacCenter(p) {
    if (p.next >= 0) {
      const n = DIRS[p.next];
      if (!isWall(p.x + n.x, p.y + n.y)) { p.dir = p.next; p.next = -1; }
    }
    if (p.dir >= 0 && isWall(p.x + DIRS[p.dir].x, p.y + DIRS[p.dir].y)) p.dir = -1;
    if (p.dir >= 0) p.face = p.dir;
  }

  function ghostTarget(g) {
    const f = DIRS[pac.face];
    if (g.state === 'eyes') return g.eyesTarget;
    if (scatter) {
      const corners = [[14, -14], [-14, -14], [14, 14], [-14, 14]];
      const c = corners[g.idx % 4];
      return { x: pac.x + c[0], y: pac.y + c[1] };
    }
    switch (g.kind) {
      case 0: return { x: pac.x, y: pac.y };
      case 1: return { x: pac.x + f.x * 4, y: pac.y + f.y * 4 };
      case 2: {
        const b = ghosts.find((o) => o.kind === 0 && o.state === 'normal') || g;
        const px = pac.x + f.x * 2, py = pac.y + f.y * 2;
        return { x: px * 2 - b.x, y: py * 2 - b.y };
      }
      default:
        if (Math.hypot(g.x - pac.x, g.y - pac.y) > 8) return { x: pac.x, y: pac.y };
        return { x: pac.x - 12, y: pac.y + 12 };
    }
  }

  function ghostCenter(g) {
    const opts = [];
    const rev = g.dir >= 0 ? (g.dir + 2) % 4 : -1;
    for (let d = 0; d < 4; d++) {
      if (d === rev) continue;
      if (!isWall(g.x + DIRS[d].x, g.y + DIRS[d].y)) opts.push(d);
    }
    if (!opts.length) { g.dir = rev; return; }
    if (g.state === 'fright') { g.dir = opts[(Math.random() * opts.length) | 0]; return; }
    const t = ghostTarget(g);
    let best = opts[0], bd = Infinity;
    for (const d of opts) {
      const dd = (g.x + DIRS[d].x - t.x) ** 2 + (g.y + DIRS[d].y - t.y) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    g.dir = best;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: String(n), t: 0 });
    if (score >= nextLifeAt) {
      nextLifeAt += 10000;
      lives++;
      toast('EXTRA LIFE!');
      Sound.life();
    }
    if (score > highScore) {
      highScore = score;
      try { localStorage.setItem('infpac.high', String(highScore)); } catch (e) { /* ignore */ }
    }
  }

  function eatAt(x, y) {
    const it = itemAt(x, y);
    if (!it) return;
    eaten.add(tkey(x, y));
    if (it === DOT) {
      addScore(10);
      dotsEaten++;
      Sound.waka();
      const newLevel = 1 + Math.floor(dotsEaten / 250);
      if (newLevel > level) {
        level = newLevel;
        toast('LEVEL ' + level + ' — THE GHOSTS GROW BOLDER');
        while (ghosts.length < ghostCount()) ghosts.push(makeGhost(ghosts.length));
      }
      if (dotsEaten % 70 === 0 && !fruit) spawnFruit();
    } else if (it === POWER) {
      addScore(50);
      frightT = frightDuration();
      combo = 0;
      Sound.power();
      for (const g of ghosts) {
        if (g.state === 'normal' || g.state === 'fright') {
          if (g.state === 'normal' && g.dir >= 0) g.dir = (g.dir + 2) % 4;
          g.state = 'fright';
        }
      }
    } else if (it === CARD) {
      const s = cardSuit(x, y);
      addScore(500, x, y);
      Sound.card();
      if (suits[s]) {
        toast('Another ' + SUITS[s] + ' — +500');
      } else {
        suits[s] = true;
        if (suits.every(Boolean)) {
          suits = [false, false, false, false];
          lives++;
          addScore(2000);
          toast('FULL SUIT SET! ♠♥♦♣ +1 LIFE');
          Sound.life();
        } else {
          toast('Found ' + SUITS[s] + '  (' + suits.filter(Boolean).length + '/4 suits)');
        }
      }
    }
  }

  function spawnFruit() {
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 6;
      const x = Math.round((pac.x + Math.cos(a) * r) / S) * S;
      const y = Math.round((pac.y + Math.sin(a) * r) / S) * S;
      if (Math.hypot(x - pac.x, y - pac.y) > 3) {
        const f = FRUITS[Math.min(FRUITS.length - 1, level - 1)];
        fruit = { x, y, e: f.e, v: f.v, t: 12 };
        return;
      }
    }
  }

  function update(dt) {
    time += dt;
    stateT += dt;

    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 1);

    if (state === 'ready') {
      if (stateT > 1.8) setState('play');
      return;
    }
    if (state === 'dying') {
      if (stateT > 1.8) {
        lives--;
        if (lives <= 0) {
          setState('over');
          showOver();
        } else {
          frightT = 0;
          for (const g of ghosts) respawnGhost(g);
          // Death can happen between tiles; snap back onto the grid so steering works again
          pac.x = Math.round(pac.x);
          pac.y = Math.round(pac.y);
          pac.dir = -1;
          pac.next = pac.face;
          setState('ready');
        }
      }
      return;
    }
    if (state !== 'play') return;

    if (freezeT > 0) { freezeT -= dt; return; }

    // mode cycle: 20s chase / 6s scatter
    modeT += dt;
    const cycle = modeT % 26;
    const nowScatter = cycle > 20;
    if (nowScatter !== scatter) {
      scatter = nowScatter;
      for (const g of ghosts) if (g.state === 'normal' && g.dir >= 0) g.dir = (g.dir + 2) % 4;
    }

    if (frightT > 0) {
      frightT -= dt;
      if (frightT <= 0) {
        frightT = 0;
        for (const g of ghosts) if (g.state === 'fright') g.state = 'normal';
      }
    }

    // Pac-Man
    pac.speed = pacSpeed();
    advance(pac, pac.speed * dt, pacCenter);
    eatAt(Math.round(pac.x), Math.round(pac.y));
    farthest = Math.max(farthest, Math.round(Math.hypot(pac.x, pac.y)));

    if (fruit) {
      fruit.t -= dt;
      if (Math.abs(fruit.x - pac.x) + Math.abs(fruit.y - pac.y) < 0.6) {
        addScore(fruit.v, fruit.x, fruit.y);
        Sound.fruit();
        fruit = null;
      } else if (fruit.t <= 0 || Math.hypot(fruit.x - pac.x, fruit.y - pac.y) > 40) {
        fruit = null;
      }
    }

    // Ghosts
    const gs = ghostSpeed();
    for (const g of ghosts) {
      g.t += dt;
      if (g.state === 'spawning') {
        if (g.t >= SPAWN_T) { g.state = frightT > 0 ? 'normal' : 'normal'; g.t = 0; }
        continue;
      }
      if (g.state === 'eyes') {
        advance(g, 14 * dt, ghostCenter);
        if (g.t > 2.2) respawnGhost(g);
        continue;
      }
      const inCorridorPenalty = 1;
      const sp = g.state === 'fright' ? gs * 0.55 : gs * inCorridorPenalty;
      advance(g, sp * dt, ghostCenter);
      if (Math.hypot(g.x - pac.x, g.y - pac.y) > 42) respawnGhost(g);
    }

    // Collisions
    for (const g of ghosts) {
      if (g.state !== 'normal' && g.state !== 'fright') continue;
      if (Math.hypot(g.x - pac.x, g.y - pac.y) < 0.7) {
        if (g.state === 'fright') {
          combo++;
          const pts = 200 * 2 ** Math.min(combo - 1, 3);
          addScore(pts, g.x, g.y);
          Sound.ghost();
          g.state = 'eyes';
          g.t = 0;
          const dx = g.x - pac.x || 1, dy = g.y - pac.y || 1;
          const len = Math.hypot(dx, dy);
          g.eyesTarget = { x: g.x + (dx / len) * 30, y: g.y + (dy / len) * 30 };
          freezeT = 0.35;
        } else {
          Sound.death();
          setState('dying');
          return;
        }
      }
    }

    // Keep memory bounded: forget eaten dots far behind (they quietly regrow)
    if (eaten.size > 6000 && Math.random() < dt) {
      for (const k of eaten) {
        const [x, y] = k.split(',').map(Number);
        if (Math.abs(x - pac.x) + Math.abs(y - pac.y) > 160) eaten.delete(k);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const ox = W / 2 - pac.x * T;
    const oy = H / 2 - pac.y * T;
    const x0 = Math.floor(-ox / T) - 1, x1 = Math.ceil((W - ox) / T) + 1;
    const y0 = Math.floor(-oy / T) - 1, y1 = Math.ceil((H - oy) / T) + 1;

    // Walls: collect edges facing corridors into a single path
    const walls = new Path2D();
    const d = T * 0.28;
    const fill = new Path2D();
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isWall(tx, ty)) continue;
        const L = ox + tx * T - T / 2, R = L + T, U = oy + ty * T - T / 2, D = U + T;
        const up = !isWall(tx, ty - 1), dn = !isWall(tx, ty + 1), lf = !isWall(tx - 1, ty), rt = !isWall(tx + 1, ty);
        fill.rect(L + (lf ? d : 0), U + (up ? d : 0), T - (lf ? d : 0) - (rt ? d : 0), T - (up ? d : 0) - (dn ? d : 0));
        if (up) { walls.moveTo(L + (lf ? d : 0), U + d); walls.lineTo(R - (rt ? d : 0), U + d); }
        if (dn) { walls.moveTo(L + (lf ? d : 0), D - d); walls.lineTo(R - (rt ? d : 0), D - d); }
        if (lf) { walls.moveTo(L + d, U + (up ? d : 0)); walls.lineTo(L + d, D - (dn ? d : 0)); }
        if (rt) { walls.moveTo(R - d, U + (up ? d : 0)); walls.lineTo(R - d, D - (dn ? d : 0)); }
        // inner corners
        if (!up && !lf && !isWall(tx - 1, ty - 1)) { walls.moveTo(L + d, U); walls.arc(L, U, d, 0, Math.PI / 2); }
        if (!up && !rt && !isWall(tx + 1, ty - 1)) { walls.moveTo(R, U + d); walls.arc(R, U, d, Math.PI / 2, Math.PI); }
        if (!dn && !lf && !isWall(tx - 1, ty + 1)) { walls.moveTo(L, D - d); walls.arc(L, D, d, -Math.PI / 2, 0); }
        if (!dn && !rt && !isWall(tx + 1, ty + 1)) { walls.moveTo(R - d, D); walls.arc(R, D, d, Math.PI, Math.PI * 1.5); }
      }
    }
    ctx.fillStyle = '#060622';
    ctx.fill(fill);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(60, 80, 255, 0.28)';
    ctx.lineWidth = T * 0.34;
    ctx.stroke(walls);
    ctx.strokeStyle = '#3b4bff';
    ctx.lineWidth = Math.max(2, T * 0.1);
    ctx.stroke(walls);

    // Dots & items
    const dots = new Path2D();
    const dr = Math.max(1.5, T * 0.1);
    const blink = Math.floor(time * 4) % 2 === 0;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isWall(tx, ty)) continue;
        const it = itemAt(tx, ty);
        if (!it) continue;
        const px = ox + tx * T, py = oy + ty * T;
        if (it === DOT) {
          dots.moveTo(px + dr, py);
          dots.arc(px, py, dr, 0, Math.PI * 2);
        } else if (it === POWER) {
          if (blink || state !== 'play') {
            ctx.fillStyle = '#ffd6c9';
            ctx.beginPath();
            ctx.arc(px, py, T * 0.32, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (it === CARD) {
          drawCard(px, py + Math.sin(time * 3 + tx) * T * 0.08, cardSuit(tx, ty));
        }
      }
    }
    ctx.fillStyle = '#ffb8ae';
    ctx.fill(dots);

    if (fruit && (fruit.t > 3 || blink)) {
      ctx.font = `${Math.round(T * 0.9)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fruit.e, ox + fruit.x * T, oy + fruit.y * T + 1);
    }

    // Ghosts
    for (const g of ghosts) drawGhost(g, ox + g.x * T, oy + g.y * T);

    // Pac-Man
    drawPac(ox + pac.x * T, oy + pac.y * T);

    // Popups
    ctx.font = `bold ${Math.round(T * 0.55)}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t;
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(p.text, ox + p.x * T, oy + p.y * T - p.t * T);
    }
    ctx.globalAlpha = 1;

    // Off-screen ghost radar arrows
    for (const g of ghosts) {
      if (g.state === 'eyes' || g.state === 'spawning') continue;
      const px = ox + g.x * T, py = oy + g.y * T;
      if (px > -T / 2 && px < W + T / 2 && py > -T / 2 && py < H + T / 2) continue;
      const ang = Math.atan2(py - H / 2, px - W / 2);
      const m = 18;
      const sx = Math.cos(ang), sy = Math.sin(ang);
      const k = Math.min((W / 2 - m) / Math.abs(sx || 1e-6), (H / 2 - m) / Math.abs(sy || 1e-6));
      const ax = W / 2 + sx * k, ay = H / 2 + sy * k;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = g.state === 'fright' ? '#2b4bff' : GHOST_COLORS[g.idx % GHOST_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -7);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Center messages
    if (state === 'ready') {
      ctx.font = `${Math.round(T * 0.7)}px "Press Start 2P", monospace`;
      ctx.fillStyle = '#ffe600';
      ctx.fillText('READY!', W / 2, H / 2 + T * 1.6);
    }
    if (paused && state === 'play') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = `${Math.round(T * 0.9)}px "Press Start 2P", monospace`;
      ctx.fillStyle = '#ffe600';
      ctx.fillText('PAUSED', W / 2, H / 2);
    }
  }

  function drawCard(px, py, suit) {
    const w = T * 0.62, h = T * 0.84;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.sin(time * 2 + px) * 0.12);
    ctx.shadowColor = SUIT_COLORS[suit];
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#fbfbff';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 3); else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = suit === 1 || suit === 2 ? '#e0153a' : '#111';
    ctx.font = `${Math.round(T * 0.52)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(SUITS[suit], 0, 1);
    ctx.restore();
  }

  function drawPac(px, py) {
    const r = T * 0.47;
    let mouth;
    let ang = pac.face * (Math.PI / 2);
    if (state === 'dying') {
      const t = Math.min(1, Math.max(0, (stateT - 0.3) / 1.2));
      mouth = t * Math.PI * 2;
      ang = -Math.PI / 2;
      if (t >= 1) return;
    } else if (state === 'over') {
      return;
    } else {
      mouth = Math.abs(Math.sin(pac.chew * Math.PI)) * 1.25 + 0.05;
    }
    ctx.fillStyle = '#ffe600';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, r, ang + mouth / 2, ang + Math.PI * 2 - mouth / 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawGhost(g, px, py) {
    if (state === 'dying' && stateT > 0.3) return;
    if (px < -T || px > W + T || py < -T || py > H + T) return;
    const r = T * 0.47;
    ctx.save();
    ctx.translate(px, py);
    if (g.state === 'spawning') {
      ctx.globalAlpha = Math.min(1, g.t / SPAWN_T);
      const s = 0.4 + 0.6 * ctx.globalAlpha;
      ctx.scale(s, s);
    }
    const fright = g.state === 'fright';
    if (g.state !== 'eyes') {
      let body = GHOST_COLORS[g.idx % GHOST_COLORS.length];
      if (fright) body = frightT < 2 && Math.floor(frightT * 6) % 2 === 0 ? '#f4f4ff' : '#2b3bff';
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r, Math.PI, 0);
      const bottom = r * 0.95;
      ctx.lineTo(r, bottom);
      const phase = Math.floor(time * 8) % 2;
      const n = 6;
      for (let k = 1; k <= n; k++) {
        const x = r - (2 * r * k) / n;
        const y = bottom - ((k + phase) % 2 ? r * 0.28 : 0);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    if (fright) {
      const flashing = frightT < 2 && Math.floor(frightT * 6) % 2 === 0;
      ctx.fillStyle = flashing ? '#ff2a2a' : '#ffd6c9';
      ctx.fillRect(-r * 0.4, -r * 0.35, r * 0.22, r * 0.22);
      ctx.fillRect(r * 0.18, -r * 0.35, r * 0.22, r * 0.22);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const x = -r * 0.6 + (r * 1.2 * k) / 6;
        const y = r * 0.3 + (k % 2 ? -r * 0.1 : r * 0.05);
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    } else {
      const dv = DIRS[g.dir >= 0 ? g.dir : 2];
      for (const sx of [-1, 1]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(sx * r * 0.36 + dv.x * r * 0.1, -r * 0.2 + dv.y * r * 0.1, r * 0.26, r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b2bff';
        ctx.beginPath();
        ctx.arc(sx * r * 0.36 + dv.x * r * 0.22, -r * 0.2 + dv.y * r * 0.22, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD & overlays
  // ---------------------------------------------------------------------------
  const hud = { score: $('score'), high: $('high'), level: $('level'), lives: $('lives'), suits: $('suits'), dist: $('dist') };
  const last = {};
  function setText(el, key, v) {
    if (last[key] !== v) { last[key] = v; el.textContent = v; }
  }
  function updateHud() {
    setText(hud.score, 'score', score.toLocaleString());
    setText(hud.high, 'high', highScore.toLocaleString());
    setText(hud.level, 'level', String(level));
    setText(hud.dist, 'dist', `${Math.round(pac.x / S)}, ${-Math.round(pac.y / S)}  ·  farthest ${Math.round(farthest / S)}`);
    const lv = '●'.repeat(Math.max(0, Math.min(lives, 8)));
    setText(hud.lives, 'lives', lv);
    const sv = suits.map((s) => (s ? '1' : '0')).join('');
    if (last.suits !== sv) {
      last.suits = sv;
      hud.suits.innerHTML = SUITS.map((s, i) => `<span class="suit ${suits[i] ? 'got' : ''} ${i === 1 || i === 2 ? 'red' : ''}">${s}</span>`).join('');
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function showOver() {
    $('final-score').textContent = score.toLocaleString();
    $('final-dist').textContent = Math.round(farthest / S);
    $('final-level').textContent = level;
    $('over').hidden = false;
  }

  function start() {
    Sound.init();
    if (Sound.ac && Sound.ac.state === 'suspended') Sound.ac.resume();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
  }

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('sound-btn').addEventListener('click', (e) => {
    Sound.on = !Sound.on;
    e.currentTarget.textContent = Sound.on ? '🔊' : '🔇';
    e.currentTarget.blur();
  });

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function steer(d) {
    if (state === 'title' || state === 'over') return;
    pac.next = d;
    if (pac.dir >= 0 && d === (pac.dir + 2) % 4) {
      pac.dir = d;
      pac.face = d;
      pac.next = -1;
    }
  }

  const KEYMAP = {
    ArrowRight: 0, ArrowDown: 1, ArrowLeft: 2, ArrowUp: 3,
    d: 0, s: 1, a: 2, w: 3, D: 0, S: 1, A: 2, W: 3,
  };
  window.addEventListener('keydown', (e) => {
    if (e.key in KEYMAP) {
      e.preventDefault();
      if (state === 'title') { start(); return; }
      steer(KEYMAP[e.key]);
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      if (state === 'play') paused = !paused;
    } else if (e.key === 'm' || e.key === 'M') {
      $('sound-btn').click();
    } else if ((e.key === 'Enter' || e.key === ' ') && (state === 'title' || state === 'over')) {
      e.preventDefault();
      start();
    }
  });

  let touchStart = null;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!touchStart) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    if (Math.hypot(dx, dy) > 22) {
      steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3));
      touchStart = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });
  canvas.addEventListener('touchend', () => { touchStart = null; });

  document.querySelectorAll('[data-dir]').forEach((b) => {
    const go = (e) => { e.preventDefault(); steer(+b.dataset.dir); };
    b.addEventListener('pointerdown', go);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'play') paused = true;
  });

  // ---------------------------------------------------------------------------
  // Loop — title screen shows an attract-mode world drifting behind the menu
  // ---------------------------------------------------------------------------
  newGame();
  state = 'title';
  let lastT = performance.now();
  let attract = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (state === 'title') {
      time += dt;
      attract += dt;
      // wander pac-man automatically for the backdrop
      advance(pac, 5 * dt, (p) => {
        const opts = [0, 1, 2, 3].filter((d) => d !== (p.dir + 2) % 4 && !isWall(p.x + DIRS[d].x, p.y + DIRS[d].y));
        p.dir = opts.length ? opts[(Math.random() * opts.length) | 0] : (p.dir + 2) % 4;
        p.face = p.dir;
      });
      eaten.add(tkey(Math.round(pac.x), Math.round(pac.y)));
      for (const g of ghosts) {
        if (g.state === 'spawning') { g.t += dt; if (g.t > SPAWN_T) g.state = 'normal'; continue; }
        advance(g, 4.2 * dt, ghostCenter);
      }
    } else if (!paused) {
      update(dt);
    }
    render();
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
