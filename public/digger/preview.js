/* Home-page preview: a digger tunnelling through the layers while a blob chases and a rock drops. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).digger = function (canvas) {
  const ctx = canvas.getContext('2d');
  const COLS = 9, ROWS = 5;
  const LAYERS = ['#b9743a', '#c0472e', '#3a6cb6', '#2b8f5b'];
  const CAVE = '#1c1009';
  const PATH = [[0.5, 1.5], [6.5, 1.5], [6.5, 3.5], [1.5, 3.5]];
  const LEGS = [];
  let total = 0;
  for (let i = 0; i < PATH.length - 1; i++) {
    const len = Math.hypot(PATH[i + 1][0] - PATH[i][0], PATH[i + 1][1] - PATH[i][1]);
    LEGS.push(len);
    total += len;
  }

  let raf = 0, last = performance.now(), t = 0, dist = 0, dug, rock, over = 0;

  function reset() {
    dug = new Uint8Array(COLS * ROWS);
    for (let c = 0; c < COLS; c++) dug[c] = 1;            // open sky along the top
    dist = 0;
    over = 0;
    rock = { c: 4, y: 2.5, state: 'set', t: 0, vy: 0 };
  }
  reset();

  function at(d) {
    let rem = Math.max(0, d);
    for (let i = 0; i < LEGS.length; i++) {
      const a = PATH[i], b = PATH[i + 1];
      if (rem <= LEGS[i]) {
        const k = rem / LEGS[i];
        return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, dx: Math.sign(b[0] - a[0]), dy: Math.sign(b[1] - a[1]) };
      }
      rem -= LEGS[i];
    }
    const e = PATH[PATH.length - 1];
    return { x: e[0], y: e[1], dx: -1, dy: 0 };
  }

  function digger(g, x, y, s, dx, step) {
    g.save();
    g.translate(x, y);
    if (dx < 0) g.scale(-1, 1);
    g.fillStyle = '#4aa8ff';                                // helmet
    g.fillRect(-s * 0.34, -s * 0.44, s * 0.68, s * 0.26);
    g.fillStyle = '#ffd9a8';                                // face
    g.fillRect(-s * 0.3, -s * 0.2, s * 0.6, s * 0.2);
    g.fillStyle = '#16233f';
    g.fillRect(s * 0.08, -s * 0.16, s * 0.14, s * 0.12);
    g.fillStyle = '#eef3ff';                                // suit
    g.fillRect(-s * 0.3, 0, s * 0.6, s * 0.26);
    g.fillStyle = '#f4a259';                                // pack
    g.fillRect(-s * 0.42, -s * 0.04, s * 0.14, s * 0.24);
    g.fillStyle = '#2b3a67';                                // boots
    g.fillRect(-s * 0.28, s * 0.26, s * 0.2, s * 0.14);
    g.fillRect(s * 0.08 + (step ? s * 0.06 : 0), s * 0.26, s * 0.2, s * 0.14);
    g.restore();
  }

  function blob(g, x, y, s, wob) {
    g.fillStyle = '#c22b2b';
    g.beginPath();
    g.arc(x, y, s * 0.36, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ff4d4d';
    g.beginPath();
    g.arc(x, y - s * 0.04, s * 0.28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd23f';
    g.fillRect(x - s * 0.26, y - s * 0.12 + wob, s * 0.52, s * 0.18);
    g.fillStyle = '#1b1030';
    g.fillRect(x - s * 0.14, y - s * 0.09 + wob, s * 0.1, s * 0.12);
    g.fillRect(x + s * 0.05, y - s * 0.09 + wob, s * 0.1, s * 0.12);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const s = Math.min(W / COLS, H / ROWS);
    const ox = (W - s * COLS) / 2, oy = (H - s * ROWS) / 2;
    const cell = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && dug[r * COLS + c];

    // the digger tunnels along its route, the blob follows a couple of cells behind
    dist += dt * 1.7;
    const me = at(dist);
    const foe = at(dist - 2.1);
    dug[Math.floor(me.y) * COLS + Math.floor(me.x)] = 1;

    if (rock.state === 'set' && cell(rock.c, 3)) { rock.state = 'wobble'; rock.t = 0; }
    else if (rock.state === 'wobble') { rock.t += dt; if (rock.t > 0.7) { rock.state = 'fall'; rock.vy = 2; } }
    else if (rock.state === 'fall') {
      rock.vy = Math.min(12, rock.vy + 22 * dt);
      rock.y += rock.vy * dt;
      dug[Math.min(ROWS - 1, Math.floor(rock.y)) * COLS + rock.c] = 1;
      if (rock.y > ROWS - 0.5) { rock.y = ROWS - 0.5; rock.state = 'break'; rock.t = 0; }
    } else if (rock.state === 'break') rock.t += dt;
    if (dist > total + 0.6 && (rock.state !== 'break' || rock.t > 0.8)) { over += dt; if (over > 0.5) reset(); }

    // sky, then soil in layers, then the tunnels carved out of it
    ctx.fillStyle = '#221545';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#0b0603';
    ctx.fillRect(0, oy + s, W, H - oy - s);
    for (let r = 1; r < ROWS; r++) {
      ctx.fillStyle = LAYERS[Math.min(LAYERS.length - 1, r - 1)];
      ctx.fillRect(ox, oy + r * s, s * COLS, s);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      for (let c = 0; c < COLS; c++) ctx.fillRect(ox + c * s + ((c * 7 + r * 5) % 5) * s * 0.12, oy + r * s + ((c * 3 + r * 11) % 4) * s * 0.2, s * 0.16, s * 0.1);
    }
    ctx.fillStyle = '#3ddc6b';
    ctx.fillRect(ox, oy + s - Math.max(2, s * 0.09), s * COLS, Math.max(2, s * 0.09));

    ctx.fillStyle = CAVE;
    for (let r = 1; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!dug[r * COLS + c]) continue;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(ox + c * s, oy + r * s, s, s, s * 0.26);
        else ctx.rect(ox + c * s, oy + r * s, s, s);
        ctx.fill();
      }
    }

    // the rock, wobbling then falling
    if (rock.state !== 'break') {
      ctx.save();
      ctx.translate(ox + (rock.c + 0.5) * s, oy + rock.y * s);
      if (rock.state === 'wobble') ctx.rotate(Math.sin(rock.t * 32) * 0.16);
      ctx.fillStyle = '#6d7482';
      ctx.fillRect(-s * 0.36, -s * 0.36, s * 0.72, s * 0.72);
      ctx.fillStyle = '#9aa0ad';
      ctx.fillRect(-s * 0.28, -s * 0.28, s * 0.46, s * 0.4);
      ctx.fillStyle = '#cfd6e2';
      ctx.fillRect(-s * 0.22, -s * 0.22, s * 0.16, s * 0.14);
      ctx.restore();
    } else {
      ctx.fillStyle = '#9aa0ad';
      const k = Math.min(1, rock.t / 0.8);
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i / 4) * Math.PI;
        ctx.globalAlpha = 1 - k;
        ctx.fillRect(ox + (rock.c + 0.5) * s + Math.cos(a) * s * k * 1.2 - s * 0.08, oy + rock.y * s + Math.sin(a) * s * k * 0.7, s * 0.16, s * 0.16);
      }
      ctx.globalAlpha = 1;
    }

    blob(ctx, ox + foe.x * s, oy + foe.y * s, s, Math.sin(t * 8) * s * 0.02);
    digger(ctx, ox + me.x * s, oy + me.y * s, s, me.dx || 1, Math.floor(t * 8) % 2);

    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
};
