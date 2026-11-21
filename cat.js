/* Мелок — меловой кот. Покадровая (12 кадр/с) рисованная анимация на canvas:
   кот собран из объёмных «болванок», каждый кадр обводится заново дрожащей меловой линией. */
(function () {
  'use strict';
  const cv = document.getElementById('cat');
  if (!cv) return;
  const ctx = cv.getContext('2d');

  // ---------- сцена ----------
  const W = 720, H = 520, U = 112, OX = W / 2 - 30, OY = H - 95;
  const PITCH = 0.25, CP = Math.cos(PITCH), SP = Math.sin(PITCH);
  const CAM = [0, SP, CP];
  const R = 1.27;          // радиус круга, по которому кот обходит бутылку
  const RB = 0.38;         // радиус бутылки
  const LW = 3.5;          // толщина мела
  const CHALK = '#f6f1e7';
  const TAU = Math.PI * 2;
  const FPS = 12, T = 13, A0 = 0.72, TW0 = 2.75, TW1 = 9.6, STRIDE = 0.5;

  // ---------- математика ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const frac = x => x - Math.floor(x);
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const comb = (...pairs) => { const o = [0, 0, 0]; for (let i = 0; i < pairs.length; i += 2) { o[0] += pairs[i][0] * pairs[i + 1]; o[1] += pairs[i][1] * pairs[i + 1]; o[2] += pairs[i][2] * pairs[i + 1]; } return o; };
  const UP = [0, 1, 0];
  const backOut = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  const trap = (k, e) => k < e ? k * k / (2 * e * (1 - e)) : k > 1 - e ? 1 - (1 - k) * (1 - k) / (2 * e * (1 - e)) : (k - e / 2) / (1 - e);

  const proj = p => [OX + p[0] * U, OY - (p[1] * CP - p[2] * SP) * U];
  // координаты «вдоль кота»: u — вперёд по дуге, h — высота, w — наружу от бутылки
  let SO = 0;
  const loc = (a, u, h, w) => { const au = a + u / (R + SO), rr = R + w; return [rr * Math.cos(au), h, rr * Math.sin(au)]; };
  const headingAt = (a, u) => { const au = a + u / (R + SO); return [-Math.sin(au), 0, Math.cos(au)]; };
  const outwardAt = (a, u) => { const au = a + u / (R + SO); return [Math.cos(au), 0, Math.sin(au)]; };

  // ---------- шум (дрожание линии) ----------
  function hash(i, j, s) {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y, s) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash(i, j, s), hash(i + 1, j, s), sx), lerp(hash(i, j + 1, s), hash(i + 1, j + 1, s), sx), sy) * 2 - 1;
  }
  let SEED = 1;
  function wob(pt, extra) {
    const x = pt[0], y = pt[1];
    let dx = 1.6 * vnoise(x / 50, y / 50, SEED) + 0.35 * vnoise(x / 9, y / 9, SEED + 3);
    let dy = 1.6 * vnoise(x / 50 + 40, y / 50 + 17, SEED + 1) + 0.35 * vnoise(x / 9 + 9, y / 9 + 5, SEED + 4);
    if (extra) { dx += extra * vnoise(x / 15, y / 15, SEED + 11); dy += extra * vnoise(x / 15 + 7, y / 15 + 3, SEED + 12); }
    return [x + dx, y + dy];
  }

  // ---------- геометрия на экране ----------
  function circPts(c, r, n) { const o = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; o.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } return o; }
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    lo.pop(); up.pop(); return lo.concat(up);
  }
  function densify(pts, closed, step = 8) {
    const o = [], n = pts.length, m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n], d = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(d / step));
      for (let j = 0; j < k; j++) o.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]);
    }
    if (!closed) o.push(pts[n - 1]);
    return o;
  }
  const circ = (p, r) => circPts(proj(p), r * U, 26);
  const cap = (a, ra, b, rb) => densify(hull(circPts(proj(a), ra * U, 18).concat(circPts(proj(b), rb * U, 18))), true);
  const poly3 = pts => densify(hull(pts.map(proj)), true, 6);
  const G = z => ({ z, shapes: [], erasers: [], strokes: [], dots: [], fills: [] });

  function ik(J, F, L1, L2, bend) {
    let d = sub(F, J), D = len(d); const mx = L1 + L2 - 0.002;
    if (D > mx) { F = add(J, mul(d, mx / D)); d = sub(F, J); D = mx; }
    const dir = mul(d, 1 / D), a1 = (L1 * L1 - L2 * L2 + D * D) / (2 * D), hh = Math.sqrt(Math.max(0, L1 * L1 - a1 * a1));
    const b = norm(sub(bend, mul(dir, dot(bend, dir))));
    return [add(add(J, mul(dir, a1)), mul(b, hh)), F];
  }

  // ---------- хронометраж ----------
  function pose(t) {
    let st;
    if (t < 2) st = 0;
    else if (t < 2.25) st = -0.12 * Math.sin((t - 2) / 0.25 * Math.PI);
    else if (t < 2.85) st = backOut((t - 2.25) / 0.6);
    else if (t < TW1 - 0.05) st = 1;
    else st = 1 - smooth(TW1 - 0.05, TW1 + 0.6, t);
    const k = clamp((t - TW0) / (TW1 - TW0));
    const travel = trap(k, 0.1) * TAU;
    const a = A0 + travel;
    const wk = smooth(2.1, 2.9, t) * (1 - smooth(TW1 - 0.3, TW1 + 0.5, t));
    const rub = smooth(TW0 + 1.0, TW0 + 1.9, t) * (1 - smooth(TW1 - 1.9, TW1 - 1.0, t));
    const so = 1 - smooth(TW0, TW0 + 1.7, t) * (1 - smooth(TW1 - 1.7, TW1, t));
    const fr = Math.max(0, Math.sin(a));
    let eyes = 'open';
    if (rub > 0.45) eyes = 'happy';
    else if ((t > 1.0 && t < 1.13) || (t > 11.2 && t < 11.33) || (t > 12.2 && t < 12.3)) eyes = 'blink';
    return {
      st, a, wk, rub, eyes, so,
      amp: clamp(Math.min(k, 1 - k) / 0.06),
      look: lerp(1, 0.34 + 0.4 * fr, wk),
      ph: travel * R * 0.65 / STRIDE,
      tilt: 0.12 * smooth(1.4, 1.6, t) * (1 - smooth(1.9, 2.1, t)) - 0.1 * smooth(10.6, 10.9, t) * (1 - smooth(11.8, 12.2, t)),
      twitch: (t > 0.45 && t < 0.62) || (t > 12.55 && t < 12.72) ? 1 : 0,
      flick: Math.max(0, Math.sin(t * 3.1)) * (1 - wk),
      wobble: (0.03 * Math.sin(t * 4.3) + 0.012 * Math.sin(t * 9.1)) * rub
    };
  }

  // ---------- кот ----------
  function buildCat(t, groups) {
    const P = pose(t), a = P.a, st = P.st, s1 = clamp(st), rub = P.rub;
    const bob = 0.03 * Math.sin(P.ph * TAU * 2) * P.amp;
    SO = 1.0 * P.so;
    const tw = -0.3 * rub, so = SO, LL = (u, h, w) => loc(a, u, h, w + so);
    const br = 0.012 * Math.sin(t * 2.4) * (1 - P.wk);

    const hipsU = lerp(-0.3, -0.5, s1), hipsH = lerp(0.6, 0.86, st) + bob * 0.5;
    const bellyU = -0.05, bellyH = lerp(0.76, 0.85, st) + bob;
    const chestU = lerp(0.3, 0.36, s1), chestH = lerp(0.88, 0.88, st) - bob * 0.5 + br;
    const neckU = chestU + lerp(0.1, 0.22, s1), neckH = chestH + lerp(0.3, 0.22, s1);
    const nz = Math.sin(t * 5.2) * rub;
    const headU = chestU + lerp(0.22, 0.5, s1) + 0.07 * nz;
    const headH = lerp(1.6, 1.4, st) - 0.05 * rub + 0.035 * Math.cos(t * 5.2) * rub + br;
    const HR = 0.55, CK = 0.21;

    const hips = LL(hipsU, hipsH, tw), belly = LL(bellyU, bellyH, tw * 1.1), chest = LL(chestU, chestH, tw);
    const neck = LL(neckU, neckH, tw * 1.3);
    const mid = (p, q) => lerp3(p, q, 0.5);
    const sph = [
      { p: hips, r: lerp(0.6, 0.47, s1) }, { p: mid(hips, belly), r: lerp(0.64, 0.48, s1) }, { p: belly, r: lerp(0.65, 0.48, s1) },
      { p: mid(belly, chest), r: lerp(0.57, 0.47, s1) }, { p: chest, r: 0.46 }, { p: mid(chest, neck), r: 0.44 }, { p: neck, r: 0.38 }
    ];
    // туловище — всегда один силуэт
    const C0 = LL(headU, headH, -0.1 * rub);
    const g0 = G((C0[2] + neck[2]) / 2 || 0.001), torsoEr = [];
    groups.push(g0);
    const shr = LW + 1.2;
    sph.forEach((s, i) => {
      s.g = g0;
      g0.shapes.push(circ(s.p, s.r));
      torsoEr.push(circPts(proj(s.p), s.r * U - shr, 22));
      if (i > 0) {
        const q = sph[i - 1];
        g0.shapes.push(cap(q.p, q.r, s.p, s.r));
        torsoEr.push(hull(circPts(proj(q.p), q.r * U - shr, 16).concat(circPts(proj(s.p), s.r * U - shr, 16))));
      }
    });
    const relZ = (p, s, bias) => g0.z + bias;

    // пушок на груди
    {
      const hd = headingAt(a, chestU), s = sph[4];
      for (const b of [0.0, 0.24, 0.48, 0.72, 0.96, 1.2]) {
        const d = (x) => comb(hd, Math.cos(x), UP, -Math.sin(x));
        s.g.shapes.push(poly3([add(chest, mul(d(b - 0.13), 0.445)), add(chest, mul(d(b + 0.13), 0.445)), add(chest, mul(d(b + 0.1), 0.555 + 0.025 * Math.sin(b * 9)))]));
      }
    }

    // --- лапы ---
    const legs = [
      { front: false, sgn: 1, off: 0 }, { front: true, sgn: 1, off: 0.25 },
      { front: false, sgn: -1, off: 0.5 }, { front: true, sgn: -1, off: 0.75 }
    ];
    for (const L of legs) {
      const p = frac(P.ph + L.off), duty = 0.65; let x, lift = 0;
      if (p < duty) x = STRIDE / 2 - STRIDE * (p / duty);
      else { const tt = (p - duty) / (1 - duty); x = -STRIDE / 2 + STRIDE * (tt * tt * (3 - 2 * tt)); lift = 0.2 * Math.sin(Math.PI * tt); }
      x *= P.amp; lift *= P.amp;
      let J, F, K, r0, r1, r2, bend, att, fu;
      if (L.front) {
        J = LL(chestU + 0.05, chestH - 0.2, tw + L.sgn * 0.2);
        fu = chestU + 0.1 + 0.1 * (1 - s1) + x;
        F = LL(fu, 0.15 + lift, tw * 0.5 + L.sgn * 0.21);
        bend = mul(headingAt(a, chestU), -1);
        [K, F] = ik(J, F, 0.28, 0.28, bend);
        r0 = 0.17; r1 = 0.15; r2 = 0.14; att = sph[4];
      } else {
        J = LL(hipsU, hipsH - lerp(0.2, 0.18, s1), tw + L.sgn * lerp(0.36, 0.27, s1));
        fu = lerp(hipsU + 0.62, hipsU - 0.08 + x, s1);
        F = LL(fu, 0.15 + lift, tw * 0.5 * s1 + L.sgn * lerp(0.55, 0.27, s1));
        const hd = headingAt(a, hipsU);
        bend = norm(comb(UP, 1 - s1, hd, 0.3 * (1 - s1) - s1));
        [K, F] = ik(J, F, 0.3, 0.3, bend);
        r0 = lerp(0.42, 0.33, s1); r1 = 0.16; r2 = 0.14; att = sph[0];
      }
      const hdF = headingAt(a, fu), lat = outwardAt(a, fu);
      const g = G(relZ(J, att, J[2] >= att.p[2] ? 0.002 : -0.002));
      g.shapes.push(circ(J, r0), cap(J, r0, K, r1), cap(K, r1, F, r2));
      // лапка с тремя пальчиками-фестонами
      const toe = k => comb(F, 1, lat, k * 0.115, hdF, 0.06 - Math.abs(k) * 0.03, UP, -0.05);
      for (const k of [-1, 0, 1]) g.shapes.push(circ(toe(k), 0.1));
      g.shapes.push(cap(toe(-1), 0.1, toe(1), 0.1));
      for (const k of [-0.5, 0.5]) {
        const b = comb(toe(k), 1, hdF, 0.07);
        g.strokes.push({ pts: [proj(comb(b, 1, UP, -0.06)), proj(comb(b, 1, UP, 0.03))], w: 0.9 });
      }
      if (s1 > 0.5) g.erasers.push(...torsoEr);
      else if (L.front) g.erasers.push(circPts(proj(J), r0 * U + LW + 0.5, 22));
      else g.erasers.push(circPts(proj(add(J, [0, 0.13, 0])), r0 * 0.86 * U, 22));
      groups.push(g);
    }

    // --- хвост ---
    {
      const baseU = hipsU - 0.4, baseH = hipsH + 0.12, N = 10, pts = [];
      const aBase = a + baseU / R, wSit = 1 - P.wk, wWrap = P.wk * rub, wUp = P.wk * (1 - rub);
      for (let i = 0; i < N; i++) {
        const tt = i / (N - 1);
        const up = LL(baseU - 0.2 * Math.sin(tt * 2.2) + 0.55 * Math.max(0, tt - 0.7), baseH + 1.0 * tt - 0.7 * Math.max(0, tt - 0.8), tw + 0.06 * tt * Math.sin(t * 3 + tt * 2));
        const ang = aBase - tt * 2.0, rad = lerp(R + tw, RB + 0.15, smooth(0, 0.62, tt)), hh = lerp(baseH, 1.35, smooth(0, 1, tt));
        const wrap = [rad * Math.cos(ang), hh, rad * Math.sin(ang)];
        const f = tt * 2.5;
        const sit = LL(hipsU - 0.72 * Math.cos(f), 0.14 + P.flick * 0.9 * Math.max(0, tt - 0.75), -0.78 * Math.sin(f));
        pts.push({ p: comb(sit, wSit, up, wUp, wrap, wWrap), r: lerp(0.105, 0.085, tt) });
      }
      let g = null, n = 0;
      pts.forEach((s, i) => {
        if (!g || (pts[i - 1].p[2] < 0) !== (s.p[2] < 0)) { if (g) { g.z /= n; groups.push(g); } g = G(0); n = 0; if (i === 0) g.erasers.push(circPts(proj(s.p), s.r * U + LW + 0.5, 16)); }
        g.z += s.p[2]; n++;
        if (i < N - 1) g.shapes.push(cap(s.p, s.r, pts[i + 1].p, pts[i + 1].r)); else g.shapes.push(circ(s.p, s.r));
      });
      g.z /= n; groups.push(g);
    }

    // --- голова ---
    const C = LL(headU, headH, -0.1 * rub);
    const hd = headingAt(a, headU), inw = mul(outwardAt(a, headU), -1);
    let f = norm(comb(hd, 1 - P.look, [0, 0, 1], P.look, inw, 0.08 * rub));
    let r = norm(cross(UP, f)), u = cross(f, r);
    const roll = rub * (0.3 * dot(r, inw) + 0.1 * nz) + P.tilt;
    { const c = Math.cos(roll), s = Math.sin(roll); const u2 = comb(u, c, r, s), r2 = comb(r, c, u, -s); u = u2; r = r2; }
    const pt = 0.2 * P.look, fF = comb(f, Math.cos(pt), u, -Math.sin(pt)), uF = comb(u, Math.cos(pt), f, Math.sin(pt)); // морда чуть опущена
    const away = dot(hd, CAM) < -0.35 && P.look < 0.5;
    // голова и тело — один сплошной контур, как на логотипе
    const gh = g0;
    const gf = G(gh.z + 0.006); groups.push(gf);
    const dir = (x, y, z) => norm(comb(r, x, u, y, f, z || 0));
    const cL = add(C, mul(r, CK)), cR = add(C, mul(r, -CK));
    gh.shapes.push(circ(cL, HR), circ(cR, HR), cap(cL, HR, cR, HR));
    gh.shapes.push(circ(comb(C, 1, f, 0.3, u, -0.2), 0.34));
    // точка в плоскости головы: x — вбок, y — вверх (в единицах сцены от центра головы)
    const hp = (x, y, z) => comb(C, 1, r, x, u, y, f, z || 0);
    const tw1 = P.twitch * 0.07;
    // макушка: линия от кончика уха до кончика уха с прогибом и зубчиками шерсти
    {
      const top = [], N = 14;
      for (let i = 0; i <= N; i++) {
        const k = i / N, x = lerp(-0.71, 0.72, k);
        let y = 0.71 - 0.18 * Math.pow(Math.sin(Math.PI * k), 0.7);
        if (i > 0 && i < N) y += ((i % 2 ? 0.045 : -0.03) + 0.015 * Math.sin(i * 2.3)) * Math.min(1, 2.6 * Math.min(k, 1 - k));
        if (i === N) y += tw1;
        top.push(hp(x + (i % 2 ? 0.02 : 0), y));
      }
      top.push(hp(0.73, 0.12), hp(-0.73, 0.12));
      gh.shapes.push(densify(top.map(proj), true, 6));
    }
    // уши — широкие низкие «уголки» (объём нужен, чтобы в профиль ухо не пропадало)
    for (const sg of [1, -1]) {
      const tip = hp(sg * 0.715, 0.71 + (sg === 1 ? tw1 : 0));
      gh.shapes.push(poly3([tip, hp(sg * 0.74, 0.12), hp(sg * 0.28, 0.5), hp(sg * 0.52, 0.4, -0.3), hp(sg * 0.52, 0.4, 0.22)]));
    }
    if (f[2] > 0.3) {
      // внутри левого уха — округлая петля, внутри правого — маленький уголок
      gf.strokes.push({ pts: densify([hp(-0.655, 0.57), hp(-0.65, 0.36), hp(-0.6, 0.25), hp(-0.52, 0.24), hp(-0.42, 0.38)].map(proj), false), w: 0.9 });
      gf.strokes.push({ pts: densify([hp(0.45, 0.42), hp(0.63, 0.56), hp(0.64, 0.3)].map(proj), false), w: 0.9 });
    }
    // зубцы шерсти под левым ухом
    {
      const cc = add(C, mul(r, -CK)), d = x => dir(-Math.cos(x), Math.sin(x));
      for (const b of [0.34, 0.12, -0.1, -0.32]) gh.shapes.push(poly3([add(cc, mul(d(b - 0.12), HR * 0.97)), add(cc, mul(d(b + 0.12), HR * 0.97)), add(cc, mul(d(b + 0.1), HR * (1.2 + 0.04 * Math.sin(b * 23))))]));
    }

    // мордочка
    const fp = (lx, ly) => { const n = norm(comb(fF, 1, r, lx, uF, ly)); return { n, p: comb(C, 1, r, CK * 0.8 * lx, uF, CK * 0.8 * ly, n, HR) }; };
    const facePts = list => { const pts = []; let hid = 0; for (const q of list) { const v = fp(q[0], q[1]); if (dot(v.n, CAM) > 0.1) pts.push(proj(v.p)); else hid++; } return { pts, hid }; };
    const faceStroke = (list, closed, w) => {
      const { pts, hid } = facePts(list);
      if (pts.length > 1 && hid < list.length * 0.45) gf.strokes.push({ pts, closed: closed && !hid, w: w || 1 });
    };
    for (const sg of [1, -1]) {
      const ex = sg * 0.335, ey = -0.04, sl = sg * 0.5, cs = Math.cos(sl), sn = Math.sin(sl), n = 9;
      const rot = (x, y) => [ex + x * cs - y * sn, ey + x * sn + y * cs];
      const arc = (hh) => { const o = []; for (let i = 0; i <= n; i++) { const tt = i / n; o.push(rot((tt * 2 - 1) * 0.235, hh * Math.pow(Math.sin(Math.PI * tt), 1.25))); } return o; };
      if (P.eyes === 'open') {
        faceStroke(arc(0.15).concat(arc(-0.135).reverse()), true, 0.9);
        faceStroke([rot(-sg * 0.02, 0.12), rot(-sg * 0.05, -0.105)], false, 0.85);
      } else if (P.eyes === 'happy') faceStroke(arc(0.11), false);
      else faceStroke(arc(-0.04), false);
    }
    { // нос-сердечко
      const o = []; for (let i = 0; i < 14; i++) { const th = i / 14 * TAU; o.push([0.085 * Math.pow(Math.sin(th), 3), -0.33 + 0.085 * (13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th)) / 16]); }
      const { pts, hid } = facePts(o); if (!hid) gf.fills.push(pts);
    }
    { const o = []; for (let i = 0; i <= 18; i++) { const k = i / 18 * 2 - 1, x = k * 0.36 + 0.03; o.push([x, -0.5 + 0.13 * Math.pow(Math.abs(k), 1.8) + 0.03 * k]); } faceStroke(o, false); }

    return { head: proj(C), P };
  }

  // ---------- бутылка ----------
  function buildBottle(w, groups) {
    const g = G(0), c = Math.cos(w), s = Math.sin(w);
    const rot = q => { const x = q[0] - OX, y = q[1] - OY; return [OX + x * c - y * s, OY + x * s + y * c]; };
    const prof = [[RB, 0.02], [RB, 1.85], [0.355, 2.02], [0.29, 2.2], [0.2, 2.36], [0.14, 2.5], [0.125, 2.65], [0.125, 3.16], [0.155, 3.18], [0.155, 3.3]];
    const out = [];
    for (const [x, h] of prof) out.push(proj([x, h, 0]));
    for (let i = 1; i < 8; i++) { const an = Math.PI * i / 8; out.push(proj([0.155 * Math.cos(an), 3.3, -0.155 * Math.sin(an)])); }
    for (let i = prof.length - 1; i >= 0; i--) out.push(proj([-prof[i][0], prof[i][1], 0]));
    for (let i = 1; i < 10; i++) { const an = Math.PI + Math.PI * i / 10; out.push(proj([RB * Math.cos(an), 0.02, -RB * Math.sin(an)])); }
    g.shapes.push(densify(out, true).map(rot));
    const arc = (rad, h, x0, x1) => { const o = []; for (let i = 0; i <= 10; i++) { const x = lerp(x0, x1, i / 10) * rad; o.push(proj([x, h, Math.sqrt(Math.max(0, rad * rad - x * x))])); } return o.map(rot); };
    const line = (p, q) => densify([proj(p), proj(q)], false).map(rot);
    const z = x => Math.sqrt(RB * RB - x * x);
    g.strokes.push({ pts: arc(0.155, 3.3, -1, 1), w: 0.8 });
    g.strokes.push({ pts: arc(0.125, 2.72, -1, 1), w: 0.8 });
    // этикетка
    g.strokes.push({ pts: arc(RB, 1.42, -0.86, 0.86) }, { pts: arc(RB, 0.6, -0.86, 0.86) });
    const lx = RB * 0.86;
    g.strokes.push({ pts: line([-lx, 1.42, z(lx)], [-lx, 0.6, z(lx)]) }, { pts: line([lx, 1.42, z(lx)], [lx, 0.6, z(lx)]) });
    const hc = proj([0, 1.1, RB]), heart = [];
    for (let i = 0; i <= 18; i++) { const th = i / 18 * TAU, sx = Math.pow(Math.sin(th), 3), sy = (13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th)) / 16; heart.push(rot([hc[0] + sx * 9, hc[1] - sy * 9])); }
    g.strokes.push({ pts: heart, w: 0.8 });
    const wave = h => { const o = []; for (let i = 0; i <= 12; i++) { const x = lerp(-0.2, 0.2, i / 12); o.push(proj([x, h + 0.018 * Math.sin(i * 1.7), z(x)])); } return o.map(rot); };
    g.strokes.push({ pts: wave(0.84), w: 0.75 }, { pts: wave(0.74), w: 0.75 });
    // блик
    g.strokes.push({ pts: densify([proj([-0.27, 1.62, z(0.27)]), proj([-0.275, 1.84, z(0.27)]), proj([-0.235, 2.04, z(0.2)])], false).map(rot), w: 0.8 });
    groups.push(g);
  }

  // ---------- сердечки ----------
  const heartSpawns = [4.1, 5.5, 6.9, 8.2], heartCache = {};
  function buildHearts(t, groups) {
    const g = G(99);
    heartSpawns.forEach((h0, i) => {
      const age = t - h0; if (age < 0 || age > 1.25) return;
      const hp = heartCache[i] || (heartCache[i] = buildCat(h0, []).head);
      const sc = 10 * Math.min(1, age * 5) * (1 + 0.25 * i % 2), cx = hp[0] + 16 * Math.sin(age * 4 + i * 2), cy = hp[1] - 100 - 62 * age, pts = [];
      for (let k = 0; k <= 20; k++) { const th = k / 20 * TAU; pts.push([cx + Math.pow(Math.sin(th), 3) * sc, cy - (13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th)) / 16 * sc]); }
      g.strokes.push({ pts, w: age > 1.0 ? 0.6 : 0.9 });
    });
    if (g.strokes.length) groups.push(g);
  }

  // ---------- отрисовка мелом ----------
  let dpr = 1, grain = null;
  function makeGrain() {
    const c = document.createElement('canvas'); c.width = c.height = 220;
    const x = c.getContext('2d'), im = x.createImageData(220, 220);
    for (let i = 0; i < im.data.length; i += 4) {
      const q = Math.random(); const v = q < 0.05 ? 70 + Math.random() * 90 : q < 0.22 ? 170 + Math.random() * 50 : 235 + Math.random() * 20;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
    }
    x.putImageData(im, 0, 0); grain = ctx.createPattern(c, 'repeat');
  }
  function resize() { dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; makeGrain(); last = -1; }
  function path(pts, extra, closed) {
    ctx.beginPath();
    pts.forEach((p, i) => { const q = wob(p, extra); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
    if (closed) ctx.closePath();
  }
  function render(t, seed) {
    t = ((t % T) + T) % T; SEED = seed * 13 + 5;
    const groups = [];
    const info = buildCat(t, groups);
    buildBottle(info.P.wobble, groups);
    buildHearts(t, groups);
    groups.sort((p, q) => p.z - q.z);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.lineJoin = ctx.lineCap = 'round';
    for (const g of groups) {
      ctx.fillStyle = ctx.strokeStyle = CHALK; ctx.lineWidth = LW * 2;
      for (const s of g.shapes) { path(s, 0, true); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = '#000';
      for (const s of g.shapes) { path(s, 0.75, true); ctx.fill(); }
      for (const s of g.erasers) { path(s, 0, true); ctx.fill(); }
      for (const s of g.strokes) { ctx.lineWidth = LW * (s.w || 1); path(s.pts, 0, s.closed); ctx.stroke(); }
      ctx.fillStyle = CHALK;
      for (const s of g.fills) { path(s, 0, true); ctx.fill(); }
      for (const d of g.dots) { const q = wob(d.c); ctx.beginPath(); ctx.arc(q[0], q[1], d.r, 0, TAU); ctx.fill(); }
    }
    // меловая крошка
    ctx.setTransform(1, 0, 0, 1, -hash(seed, 1, 7) * 200, -hash(seed, 2, 7) * 200);
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = grain;
    ctx.fillRect(0, 0, cv.width + 220, cv.height + 220);
  }

  // ---------- цикл ----------
  let last = -1, t0 = performance.now(), frozen = null;
  function tick(now) {
    if (frozen === null) {
      const fi = Math.floor((now - t0) / 1000 * FPS);
      if (fi !== last) { last = fi; render(fi / FPS, fi >> 1); }
    }
    requestAnimationFrame(tick);
  }
  resize();
  window.addEventListener('resize', () => { const d = Math.min(2, window.devicePixelRatio || 1); if (d !== dpr) resize(); });
  // клик по сидящему коту — сразу встаёт и идёт тереться
  cv.addEventListener('click', () => {
    const t = (((performance.now() - t0) / 1000) % T + T) % T;
    if (t < 1.9 || t > 10.2) { t0 = performance.now() - 1900; last = -1; }
  });
  const q = new URLSearchParams(location.search).get('t');
  window.__cat = { renderAt(t) { frozen = t; render(t, Math.floor(t * FPS) >> 1); }, play() { frozen = null; last = -1; } };
  if (q !== null) window.__cat.renderAt(parseFloat(q));
  else if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) window.__cat.renderAt(0.5);
  requestAnimationFrame(tick);
})();
