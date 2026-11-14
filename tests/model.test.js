// Unit tests for js/model.js — run with:  node --test tests/
// Uses only node's built-in test runner and assert (no dependencies).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const M = require(path.join(__dirname, '..', 'js', 'model.js'));

const close = (a, b, rel, msg) =>
  assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: got ${a}, expected ${b} ±${rel * 100}%`);

test('water saturation pressure matches IAPWS steam tables', () => {
  // IAPWS-IF97 reference values, kPa
  for (const [T, p] of [[25, 3.1699], [60, 19.946], [100, 101.42], [140, 361.53], [160, 618.23], [170, 792.18], [200, 1554.9]]) {
    close(M.psat(T) / 1000, p, 0.003, `psat(${T})`);
  }
});

test('latent heat within 0.6 % of steam tables, 0–200 °C', () => {
  for (const [T, h] of [[0, 2500.9], [25, 2441.7], [50, 2382.0], [100, 2256.4], [150, 2113.7], [175, 2031.7], [200, 1940.7]]) {
    close(M.hfg(T), h, 0.006, `hfg(${T})`);
  }
});

test('dry gas MW and cp match balance.py', () => {
  close(M.MWD, 10.886, 0.001, 'MW');
  close(M.CPD, 31.27, 0.001, 'cp');
});

test('geometry reproduces drawing GP10.5×3-6-226-4.0S-23.4', () => {
  const g = M.geometry(M.DEFAULTS);
  close(g.finRatio, 23.4, 0.01, 'fin ratio');
  close(g.Abare / M.DEFAULTS.bundles, 226, 0.01, 'bare area per bundle');
  close(g.Ao / M.DEFAULTS.bundles, 5288, 0.01, 'finned area per bundle');
  close(g.Pt, 0.0657, 0.01, 'transverse pitch');
  assert.ok(g.sigma > 0.4 && g.sigma < 0.65, 'free-flow fraction plausible');
});

test('gas duty reproduces balance.py scenarios.json (same method)', () => {
  // balance.py integrates with CoolProp; ours uses Wagner–Pruss + Watson → < 1.5 %
  const scen = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'scenarios.json'), 'utf8'));
  const Pin = M.DEFAULTS.Pin, Pout = M.DEFAULTS.Pout;
  for (const s of scen) {
    const nd = s.FI / M.NM3_PER_KMOL / 3600;
    const nv = nd * M.wsat(s.Tin, Pin);
    const d = M.gasDutyFine(s.Tin, s.Tout, nd, nv, Pin, Pout, 200);
    close(d.Q / 1000, s.Q, 0.015, `${s.name} Q`);
    close(d.Ql / 1000, s.Qlat, 0.02, `${s.name} Qlat`);
    close(nv * M.MW_W * 3600, s.vap_in, 0.01, `${s.name} vapour in`);
  }
});

test('fin efficiency: 1 at h→0, falls with h, Al better than steel', () => {
  const g = M.geometry(M.DEFAULTS);
  close(M.finEfficiency(g, 1e-6, 220), 1, 1e-4, 'limit');
  const a = M.finEfficiency(g, 40, 220), b = M.finEfficiency(g, 80, 220), c = M.finEfficiency(g, 40, 45);
  assert.ok(a > b && a > c && a > 0.8 && a < 0.97, `eta ${a} ${b} ${c}`);
});

test('Briggs–Young h rises as velocity^0.681', () => {
  const g = M.geometry(M.DEFAULTS), air = M.airProps(20, 101325);
  const h1 = M.briggsYoung(g, 4, air).h, h2 = M.briggsYoung(g, 8, air).h;
  close(h2 / h1, Math.pow(2, 0.681), 1e-9, 'exponent');
  assert.ok(h1 > 25 && h1 < 80, `h ${h1}`);
});

test('blockage raises the row pressure drop and cuts the airflow', () => {
  const g = M.geometry(M.DEFAULTS), air = M.airProps(20, 101325);
  const clean = M.rowDP(g, 300, 0, air), half = M.rowDP(g, 300, 0.5, air);
  assert.ok(half > 2 * clean, `dp ${clean} → ${half}`);
  // with several fans the bundle dominates the system curve (one big fan: the fan ring does)
  const a = M.solve({ nFans: 6, blockage: 0 }), b = M.solve({ nFans: 6, blockage: 0.6 });
  assert.ok(b.airflow.Q < 0.85 * a.airflow.Q, 'airflow falls');
  assert.ok(b.UA < a.UA, 'UA falls');
});

test('fan operating point lies on both curves and follows affinity laws', () => {
  const r = M.solve({ fanPct: 100 });
  close(r.airflow.dp, r.airflow.sys.total, 1e-3, 'fan Δp = system Δp');
  // affinity laws on the fan curve itself: Δp(sQ, s) = s² Δp(Q, 1)
  const fp = M.fanParams(r.params, r.air), n = r.params.nFans, Q = r.airflow.Q;
  for (const s of [0.5, 0.8]) close(M.fanDP(fp, n, s * Q, s), s * s * M.fanDP(fp, n, Q, 1), 1e-9, 'fan Δp ∝ speed²');
  // operating point at half speed: Q/Q100 = 0.5 for a purely quadratic system, lower when the
  // bundle Δp goes as Q^1.7 (Robinson–Briggs) — never above 0.5
  const r50 = M.solve({ fanPct: 50 }), q = r50.airflow.Q / r.airflow.Q;
  assert.ok(q > 0.42 && q <= 0.5 + 1e-9, `Q ratio ${q}`);
  const pw = r50.airflow.powerShaft / r.airflow.powerShaft;
  close(pw, q * r50.airflow.dp / r.airflow.dp, 1e-6, 'power = Q·Δp/η');
  assert.ok(pw < 0.125 * 1.01, 'power at half speed ≈ 1/8 or less');
});

test('energy balance closes < 1 % across operating range', () => {
  for (const o of [{}, { Tin: 137, Tamb: 35 }, { Rf: 0.4, blockage: 0.5 }, { Tamb: -30 }, { Tamb: 45, fanPct: 100, Rf: 0.2 }, { passes: 2 }]) {
    const r = M.solve(o);
    assert.ok(r.closure < 0.01, `gas closure ${r.closure} for ${JSON.stringify(o)}`);
    assert.ok(r.airClosure < 0.01, `air closure ${r.airClosure} for ${JSON.stringify(o)}`);
    assert.ok(r.converged, 'solver converged');
  }
});

test('physical sanity: monotone responses', () => {
  const base = { Rf: 0.4, blockage: 0.5 };
  const t = o => M.solve(Object.assign({}, base, o)).Tout;
  assert.ok(t({ Tamb: 30 }) > t({ Tamb: 5 }), 'hotter air → hotter outlet');
  assert.ok(t({ fanPct: 100 }) < t({ fanPct: 60 }), 'more fan → cooler outlet');
  assert.ok(t({ Rf: 0.6 }) > t({ Rf: 0.2 }), 'more fouling → hotter outlet');
  assert.ok(t({ Tin: 167 }) > t({ Tin: 137 }), 'hotter inlet → hotter outlet');
  const r = M.solve(base);
  assert.ok(r.Tout > r.params.Tamb && r.Tout < r.params.Tin, 'outlet between ambient and inlet');
  assert.ok(r.Ql / r.Q > 0.6, 'mostly latent');
});

test('the top (first-pass) row does the most work', () => {
  const r = M.solve({ Rf: 0.4, blockage: 0.5 });
  const top = r.rows[r.rows.length - 1].Q, bottom = r.rows[0].Q;
  assert.ok(top > bottom, `top ${top} bottom ${bottom}`);
});

test('fouled bundle: extra fan power buys little duty', () => {
  const dQ = o => M.solve(Object.assign({ fanPct: 100 }, o)).Q - M.solve(Object.assign({ fanPct: 80 }, o)).Q;
  const fouled = { Rf: 0.4, blockage: 0.5 };
  const pow = o => M.solve(Object.assign({ fanPct: 100 }, o)).airflow.powerShaft - M.solve(Object.assign({ fanPct: 80 }, o)).airflow.powerShaft;
  assert.ok(pow(fouled) > 0, 'power still rises');
  assert.ok(dQ(fouled) / pow(fouled) < 50, 'kW duty per kW fan small when fouled');
});

test('calibration reproduces the plant outlet temperatures', () => {
  const c = M.calibrate({ blockage: 0.5 });
  for (const p of c.points.filter(p => !p.target.clean)) {
    assert.ok(Math.abs(p.result.Tout - p.target.Tout) < 0.3, `${p.target.key}: ${p.result.Tout} vs ${p.target.Tout}`);
    close(p.result.Q / 1000, p.target.Q, 0.06, `${p.target.key} duty`);
    assert.ok(p.cf > 0 && p.cf < 1, 'cleanliness factor in (0,1)');
  }
});

test('solution 1: hood, cage and filters add air-side pressure drop', () => {
  const r = M.solve({ hood: true, cage: true, filters: true });
  assert.ok(r.airflow.sys.hood > 0 && r.airflow.sys.cage > 0 && r.airflow.sys.filter > 0);
  assert.ok(r.airflow.Q < M.solve({}).airflow.Q, 'extra resistance → less air at the same fan output');
});

test('solution 2: water spray cools the air toward the wet bulb, not below it', () => {
  const wb = M.wetBulb(38, 21);
  assert.ok(wb > 19 && wb < 23, `wet bulb ${wb}`);           // psychrometric chart: ~21 °C
  const r = M.solve({ Tamb: 38, RH: 21, spray: true });
  assert.ok(r.airflow.Tin < 38 && r.airflow.Tin > wb, `air ${r.airflow.Tin}`);
  assert.ok(r.sprayWater > 0);
  assert.equal(M.solve({ Tamb: 2, RH: 80, spray: true }).airflow.Tin, 2, 'off below 5 °C');
});

test('cases: normal reproduces the plant, solutions do better', () => {
  const s = M.WEATHER.find(w => w.key === 'summer');
  const n = M.solve(Object.assign(M.caseParams('normal', s), { fanPct: 99.4 }));
  assert.ok(Math.abs(n.Tout - 72.3) < 0.5, `normal summer ${n.Tout}`);
  for (const w of M.WEATHER) {
    const base = M.autoFan(M.caseParams('normal', w));
    for (const k of ['s1', 's2', 's12']) {
      const r = M.autoFan(M.caseParams(k, w));
      assert.ok(r.Tout <= Math.max(M.SETPOINT + 0.5, base.Tout), `${k} ${w.key}: ${r.Tout} vs ${base.Tout}`);
      assert.ok(r.airflow.powerElectric <= base.airflow.powerElectric * 1.001, `${k} ${w.key} fan power`);
    }
  }
});

test('a taller hood (bigger side outlet) costs less airflow', () => {
  const q = H => M.solve({ hood: true, hoodH: H, fanPct: 100 }).airflow.Q;
  const free = M.solve({ fanPct: 100 }).airflow.Q;
  assert.ok(q(1) < q(2) && q(2) < q(5) && q(5) < free, 'monotone in height');
  assert.ok(q(5) > 0.99 * free, 'default 5 m hood costs < 1 % of the air');
  assert.ok(q(1) < 0.92 * free, 'a 1 m hood chokes the air');
});
