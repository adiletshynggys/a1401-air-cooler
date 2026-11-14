/*
 * model.js — physics of the A-1401 syngas air cooler (Air Liquide, Atyrau).
 *
 * One self-contained module, no dependencies. Works as a classic browser
 * script (exposes window.A1401) and as a CommonJS module for the node tests.
 *
 * Units: SI throughout (m, Pa, K differences, W) except where named:
 *   temperatures in °C, molar flows in kmol/s, duty in kW internally (UI shows MW),
 *   gas flow input in Nm³/h dry (0 °C, 1 atm, 22.414 Nm³/kmol — same basis as balance.py).
 *
 * Structure
 *   1. Property correlations (water Psat, latent heat, air, syngas)
 *   2. Geometry (finned tube, bundle, free-flow area)
 *   3. Air side (Briggs–Young h, Schmidt fin efficiency, Robinson–Briggs ΔP, fouling)
 *   4. Fan curve × system curve → operating point
 *   5. Tube side (Dittus–Boelter gas h + Silver–Bell–Ghaly condensation)
 *   6. Cell-by-cell counter-crossflow solver (rows × segments)
 *   7. Calibration helpers
 *
 * Every number that is not from a drawing, the P&ID, lab data or balance.py is
 * listed in ASSUMPTIONS with a reason; the UI shows those as "assumption" tags.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.A1401 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. Constants
   * ------------------------------------------------------------------ */
  const NM3_PER_KMOL = 22.414;          // Nm³/kmol at 0 °C, 1 atm (balance.py)
  const MW_W = 18.015;                  // kg/kmol water
  const CPV = 34.0;                     // kJ/kmol/K water vapour, ~110 °C (balance.py)
  const CP_AIR = 1006;                  // J/kg/K dry air
  const R_AIR = 287.05;                 // J/kg/K

  // Dry syngas composition after D-1403 (lab, Jan–Mar 2026 average) — from balance.py
  const DRY = {
    H2: { y: 0.745, MW: 2.016, cp: 29.1 },
    CO2: { y: 0.176, MW: 44.01, cp: 39.0 },
    CH4: { y: 0.048, MW: 16.04, cp: 38.0 },
    CO: { y: 0.022, MW: 28.01, cp: 29.2 },
    N2: { y: 0.009, MW: 28.01, cp: 29.1 },
  };
  const MWD = Object.values(DRY).reduce((s, c) => s + c.y * c.MW, 0);   // ≈ 10.89 kg/kmol
  const CPD = Object.values(DRY).reduce((s, c) => s + c.y * c.cp, 0);   // ≈ 31.3 kJ/kmol/K

  const FIN_K = { Al: 220, steel: 45 };   // W/m/K (Al 1060 rolled fin; carbon steel)

  /* ------------------------------------------------------------------ *
   * 1. Properties
   * ------------------------------------------------------------------ */

  /** Saturation pressure of water [Pa] — Wagner & Pruss (1993) / IAPWS-95
   *  auxiliary equation; error < 0.01 % from 0 °C to the critical point. */
  function psat(Tc) {
    const T = Tc + 273.15, Tcr = 647.096, Pcr = 22.064e6;
    const t = 1 - T / Tcr;
    const ln = (Tcr / T) * (-7.85951783 * t + 1.84408259 * Math.pow(t, 1.5)
      - 11.7866497 * t * t * t + 22.6807411 * Math.pow(t, 3.5)
      - 15.9618719 * t * t * t * t + 1.80122502 * Math.pow(t, 7.5));
    return Pcr * Math.exp(ln);
  }

  /** Latent heat of water [kJ/kg] — Watson form fitted to steam tables
   *  (2256.4 kJ/kg at 100 °C, exponent 0.32); within 0.5 % for 0–200 °C. */
  function hfg(Tc) {
    const T = Tc + 273.15;
    return 2256.4 * Math.pow((647.096 - T) / (647.096 - 373.15), 0.32);
  }

  /** kmol water per kmol dry gas at saturation, at total pressure P [Pa]. */
  function wsat(Tc, P) {
    const p = psat(Tc);
    return p >= P ? 1e6 : p / (P - p);
  }

  /** Humid-air properties approximated by dry air (ambient humidity ignored). */
  function airProps(Tc, patm) {
    const T = Tc + 273.15;
    const mu = 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4); // Sutherland
    const k = 0.0241 * Math.pow(T / 273.15, 0.81);
    return { rho: patm / (R_AIR * T), mu, k, cp: CP_AIR, Pr: CP_AIR * mu / k };
  }

  /** Wet syngas transport properties (ASSUMPTION: simple mixing rules, ±20 %).
   *  yW = water mole fraction. Returns mu [Pa s], k [W/m/K], cp [J/kg/K]. */
  function gasProps(Tc, yW) {
    const th = (Tc + 273.15) / 373.15;
    const muDry = 1.45e-5 * Math.pow(th, 0.7);   // H2-rich mixture (Wilke estimate)
    const kDry = 0.135 * Math.pow(th, 0.8);      // H2-rich mixture (Mason–Saxena estimate)
    const muW = 1.23e-5 * Math.pow(th, 1.1), kW = 0.0248 * Math.pow(th, 1.25);
    const mu = (1 - yW) * muDry + yW * muW;
    const k = (1 - yW) * kDry + yW * kW;
    const cp = 1000 * ((1 - yW) * CPD + yW * CPV) / ((1 - yW) * MWD + yW * MW_W);
    return { mu, k, cp, Pr: cp * mu / k };
  }

  /* ------------------------------------------------------------------ *
   * 2. Defaults & assumptions
   * ------------------------------------------------------------------ */
  const DEFAULTS = {
    // --- geometry: drawing model code GP10.5×3-6-226-4.0S-23.4/DR -----
    sections: 3, bundles: 6, tubeLength: 10.5, bundleWidth: 3.0, rows: 6,
    tubesPerBundle: 274,          // back-calculated: 226 m² / (π·0.025·10.5)
    tubeOD: 0.025, tubeWall: 0.0025, tubeK: 44,   // 25×2.5 Q345E
    finRootD: 0.026,              // assumption: 0.5 mm Al liner of the bimetallic tube
    finOD: 0.0569,                // back-calculated to reproduce fin ratio 23.4
    fpi: 11, finT: 0.0004, finMaterial: 'Al',
    passes: 6,                    // assumption: one row per pass, gas enters the top row
    // --- fans (forced draft, underneath) --------------------------------
    nFans: 6, fanD: 2.4, fanRpm: 480,
    psi0: 0.065,                  // shut-off static pressure coefficient Δp0/(ρ u_tip²)
    phi0: 0.28,                   // free-delivery flow coefficient Q0/(u_tip·D²)
    fanEff: 0.70, motorEff: 0.93,
    fanScale: 1.0,                // calibration factor on fan size (Q ∝ k, Δp ∝ k²)
    plenumK: 1.5,                 // inlet bell + guard + plenum + exit, in fan velocity heads
    steamCoil: false,             // 1 finned row below the bundle (air inlet side)
    // --- process ----------------------------------------------------------
    Tamb: 5, Tin: 166.9, flow: 20979, fanPct: 88.2,
    Pin: 2.739e6, Pout: 2.705e6,  // 26.90 / 26.55 kgf/cm² g (balance.py)
    patm: 101.6e3,                // Atyrau, ~ -20 m elevation
    saturatedInlet: true,
    hFilm: 2000,                  // condensate film coefficient, W/m²K (1500–3000)
    // --- fouling ------------------------------------------------------------
    blockage: 0,                  // fraction of fin-gap volume packed with debris (0–0.7)
    Rf: 0,                        // debris film resistance on the finned surface, m²K/W
    foulMode: 'uniform',          // 'bottom1' | 'bottom2' | 'uniform'
    uaMult: 1,                    // lumped multiplier, used only for plant-data inversion
    nSeg: 16,
  };

  const ASSUMPTIONS = {
    finRootD: 'Fin root Ø 26 mm: 25 mm steel tube + ~0.5 mm Al liner of the bimetallic rolled tube. Not on the drawing.',
    finOD: 'Fin OD back-calculated (with 11 fpi, 0.4 mm fins, 26 mm root) to reproduce the drawing fin ratio 23.4.',
    fpi: 'Typical for bimetallic rolled Al fins; reproduces fin ratio 23.4 with the other assumed dimensions.',
    finT: 'Typical rolled Al fin thickness; not on the drawing.',
    tubesPerBundle: 'Back-calculated: 226 m² bare / (π·0.025 m·10.5 m) = 274 tubes.',
    passes: 'One row per pass (6 passes), consistent with "gas enters the top row" and the ~34 kPa tube-side Δp in balance.py. Not confirmed.',
    nFans: 'Two fans per section (6 in total). To be confirmed with the fan datasheet.',
    fanD: 'Fan diameter ~2.4 m (team estimate). Gives only ~14 % fan coverage of the bundle face — check against the datasheet.',
    fanRpm: 'Fan speed; sets tip speed and therefore the fan curve via the affinity laws.',
    psi0: 'Generic axial-fan curve shape (shut-off pressure coefficient).',
    phi0: 'Generic axial-fan curve shape (free-delivery flow coefficient).',
    fanEff: 'Fan static efficiency, typical 0.65–0.75.',
    motorEff: 'Motor efficiency, typical IE3 motor.',
    plenumK: 'Loss coefficient of inlet bell, guard, plenum and bundle exit, in fan velocity heads.',
    hFilm: 'Condensate film coefficient inside the tube (range 1500–3000 W/m²K).',
    gasProps: 'Syngas viscosity and conductivity from simple mixing rules (±20 %).',
    Tamb: 'Ambient temperature is not in the plant dataset; calibration values are typical for the period.',
    designTamb: 'Design air temperature for the 137 → 60 °C design case is not in the files; 35 °C assumed.',
    steamCoil: 'Optional steam heating coil modelled as one extra finned row (same fins) on the air-inlet side.',
    patm: 'Atmospheric pressure at Atyrau (~20 m below sea level).',
  };

  /* ------------------------------------------------------------------ *
   * 3. Geometry
   * ------------------------------------------------------------------ */
  function geometry(p) {
    const Nf = p.fpi / 0.0254;                         // fins per metre
    const dr = p.finRootD, Df = p.finOD, t = p.finT;
    const l = (Df - dr) / 2;                           // fin height
    const s = 1 / Nf - t;                              // fin gap
    const AfinM = Nf * (2 * Math.PI / 4 * (Df * Df - dr * dr) + Math.PI * Df * t); // m²/m
    const AbareM = Math.PI * dr * (1 - Nf * t);
    const AoM = AfinM + AbareM;                        // finned outside area per metre tube
    const di = p.tubeOD - 2 * p.tubeWall;
    const tubesPerRowBundle = p.tubesPerBundle / p.rows;
    const Pt = p.bundleWidth / tubesPerRowBundle;      // transverse pitch
    const Pl = Pt * Math.sqrt(3) / 2;                  // equilateral staggered
    const Pd = Pt;                                     // diagonal pitch (equilateral)
    // free-flow fraction of the face: tube+fin blockage in the transverse plane
    const sigma = (Pt - dr - (Df - dr) * t * Nf) / Pt;
    const sigmaGap = (Df - dr) * (1 - t * Nf) / Pt;    // part of it that is between fins
    const nTubesRow = tubesPerRowBundle * p.bundles;   // all bundles in parallel
    const nTubes = p.tubesPerBundle * p.bundles;
    const Aface = p.bundles * p.tubeLength * p.bundleWidth;
    return {
      Nf, dr, Df, t, l, s, AfinM, AbareM, AoM, di, Pt, Pl, Pd, sigma, sigmaGap,
      nTubesRow, nTubes, Aface,
      finRatio: AoM / (Math.PI * p.tubeOD),
      Ao: AoM * nTubes * p.tubeLength,
      Abare: Math.PI * p.tubeOD * nTubes * p.tubeLength,
      Ai: Math.PI * di * nTubes * p.tubeLength,
      fanArea: p.nFans * Math.PI / 4 * p.fanD * p.fanD,
    };
  }

  /** Blockage fraction per row (row 0 = bottom = air inlet), plus the steam coil. */
  function rowBlockage(p) {
    const b = Math.max(0, Math.min(0.95, p.blockage));
    const rows = [], fouled = [];
    for (let r = 0; r < p.rows; r++) {
      let f = 0, w = 0;
      if (p.foulMode === 'uniform') w = 1;
      else if (p.foulMode === 'bottom1') w = r === 0 ? 1 : 0;
      else w = r === 0 ? 1 : r === 1 ? 0.5 : 0;        // 'bottom2': first row full, second half
      f = w * b;
      rows.push(f); fouled.push(w);
    }
    return { rows, fouled, coil: b };   // a coil on the inlet side always catches debris first
  }

  /* ------------------------------------------------------------------ *
   * 4. Air side
   * ------------------------------------------------------------------ */

  /** Briggs & Young (1963) high-finned staggered tubes:
   *  Nu = 0.134 Re^0.681 Pr^(1/3) (s/l)^0.2 (s/t)^0.1134, Re on fin-root diameter, G_max. */
  function briggsYoung(g, Gmax, air) {
    const Re = g.dr * Gmax / air.mu;
    const Nu = 0.134 * Math.pow(Re, 0.681) * Math.cbrt(air.Pr)
      * Math.pow(g.s / g.l, 0.2) * Math.pow(g.s / g.t, 0.1134);
    return { h: Nu * air.k / g.dr, Re };
  }

  /** Annular fin efficiency, Schmidt (1949) approximation with corrected tip length. */
  function finEfficiency(g, h, kFin) {
    if (h <= 0) return 1;
    const rb = g.dr / 2, re = g.Df / 2 + g.t / 2;
    const phi = (re / rb - 1) * (1 + 0.35 * Math.log(re / rb));
    const m = Math.sqrt(2 * h / (kFin * g.t));
    const x = m * rb * phi;
    return x < 1e-9 ? 1 : Math.tanh(x) / x;
  }

  /** Robinson & Briggs (1966) friction factor, per row: Δp = 2 f G² / ρ  (Serth form). */
  function robinsonBriggsRow(g, G, air) {
    if (!(G > 0)) return 0;
    const Re = g.dr * G / air.mu;
    const f = 9.465 * Math.pow(Re, -0.316) * Math.pow(g.Pt / g.dr, -0.927) * Math.pow(g.Pt / g.Pd, 0.515);
    return 2 * f * G * G / air.rho;
  }

  /** Pressure drop of one row with a fraction `phi` of its fin gaps packed.
   *  Packed gaps remove free area (air squeezes through the remaining gaps and the
   *  fin-tip clearance) → Robinson–Briggs at the higher mass velocity, plus a
   *  Borda–Carnot loss coefficient for the contraction/re-expansion. */
  function rowDP(g, mAir, phi, air) {
    const sig = g.sigma - phi * g.sigmaGap;
    const G = mAir / (g.Aface * sig);
    const Gc = mAir / (g.Aface * g.sigma);
    const Kbc = Math.pow(g.sigma / sig - 1, 2);          // loss coefficient of the blockage
    return robinsonBriggsRow(g, G, air) + Kbc * Gc * Gc / (2 * air.rho) * (g.sigma / sig) ** 2;
  }

  /** Air-side conductance per metre of tube for a row [W/m/K] and its parts.
   *  Unpacked fins: h_eff·(A_fin η_f + A_bare). Packed fraction: heat leaves only
   *  through the debris envelope (π·D_f per metre) — the buried fin area is lost. */
  function airRow(g, p, mAir, phi, air, foulW) {
    const Gmax = mAir / (g.Aface * g.sigma);
    const by = briggsYoung(g, Gmax, air);
    const hEff = 1 / (1 / by.h + p.Rf * (foulW === undefined ? 1 : foulW));
    const kFin = FIN_K[p.finMaterial] || FIN_K.Al;
    const etaF = finEfficiency(g, hEff, kFin);
    const Aactive = (1 - phi) * (g.AfinM * etaF + g.AbareM);
    const Apacked = phi * Math.PI * g.Df * etaF;
    const UAm = hEff * (Aactive + Apacked);
    const etaO = 1 - g.AfinM / g.AoM * (1 - etaF);
    return { h: by.h, hEff, Re: by.Re, etaF, etaO, UAm, Gmax };
  }

  /* ------------------------------------------------------------------ *
   * 5. Fans and system curve
   * ------------------------------------------------------------------ */
  function fanParams(p, air) {
    const u = Math.PI * p.fanD * p.fanRpm / 60 * p.fanScale;   // effective tip speed
    return {
      dp0: p.psi0 * air.rho * u * u,                              // Pa at 100 %
      Q0: p.phi0 * u * p.fanD * p.fanD,                           // m³/s per fan at 100 %
    };
  }
  /** Static pressure of one fan [Pa] at total flow Q [m³/s], speed fraction s (affinity laws). */
  function fanDP(fp, nFans, Q, s) {
    const q = Q / nFans;
    return Math.max(0, fp.dp0 * (s * s - (q / fp.Q0) ** 2));
  }

  /** System resistance [Pa] at total air flow Q [m³/s]. */
  function systemDP(p, g, Q, air, blk) {
    const m = Q * air.rho;
    let bundle = 0;
    const rows = [];
    for (let r = 0; r < p.rows; r++) { const d = rowDP(g, m, blk.rows[r], air); rows.push(d); bundle += d; }
    const coil = p.steamCoil ? rowDP(g, m, blk.coil, air) : 0;
    const vFan = Q / g.fanArea;
    const plenum = p.plenumK * 0.5 * air.rho * vFan * vFan;
    return { total: bundle + coil + plenum, bundle, coil, plenum, rows };
  }

  /** Intersection of fan curve and system curve (bisection on Q). */
  function operatingPoint(p, g, air, blk) {
    const fp = fanParams(p, air);
    const s = Math.max(0, Math.min(1.2, p.fanPct / 100));
    if (s <= 0) return { Q: 0, dp: 0, s, fp, sys: systemDP(p, g, 0, air, blk) };
    let lo = 0, hi = p.nFans * fp.Q0 * s;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (fanDP(fp, p.nFans, mid, s) > systemDP(p, g, mid, air, blk).total) lo = mid; else hi = mid;
    }
    const Q = 0.5 * (lo + hi);
    return { Q, dp: fanDP(fp, p.nFans, Q, s), s, fp, sys: systemDP(p, g, Q, air, blk) };
  }

  /* ------------------------------------------------------------------ *
   * 6. Tube side and gas enthalpy
   * ------------------------------------------------------------------ */

  /** Heat released by the wet gas cooling Tin → Tout [kW] (same method as balance.py):
   *  dry sensible + vapour sensible + latent heat of the water that condenses
   *  (vapour stays at saturation once the dew point is reached). */
  function gasDuty(Tin, Tout, nd, nvIn, P) {
    const nvOut = Math.min(nvIn, nd * wsat(Tout, P));
    const dT = Tin - Tout;
    const Qs = nd * CPD * dT + 0.5 * (nvIn + nvOut) * CPV * dT;
    const Ql = (nvIn - nvOut) * MW_W * hfg(0.5 * (Tin + Tout));
    return { Q: Qs + Ql, Qs, Ql, nvOut };
  }

  /** Fine-step integral of the gas duty Tin → Tout along a linear pressure profile;
   *  independent reference for the energy-balance closure check. */
  function gasDutyFine(Tin, Tout, nd, nvIn, Pin, Pout, n) {
    n = n || 400;
    let Q = 0, Ql = 0, nv = nvIn;
    for (let i = 0; i < n; i++) {
      const a = Tin + (Tout - Tin) * i / n, b = Tin + (Tout - Tin) * (i + 1) / n;
      const P = Pin + (Pout - Pin) * (i + 1) / n;
      const d = gasDuty(a, b, nd, nv, P);
      Q += d.Q; Ql += d.Ql; nv = d.nvOut;
    }
    return { Q, Ql, Qs: Q - Ql, nvOut: nv };
  }

  /** Tube-side coefficient [W/m²K on inside area]. Gas: Dittus–Boelter (Gnielinski-free,
   *  laminar floor Nu = 3.66). Condensing with non-condensables: Silver–Bell–Ghaly,
   *  1/h = 1/h_film + Z/h_gas, Z = sensible / total heat released in the cell. */
  function tubeH(p, g, Tc, nd, nv, Z, condensing, tubes) {
    const yW = nv / (nd + nv);
    const gp = gasProps(Tc, yW);
    const m = (nd * MWD + nv * MW_W);                                   // kg/s
    const G = m / (tubes * Math.PI / 4 * g.di * g.di);
    const Re = G * g.di / gp.mu;
    const Nu = Math.max(3.66, 0.023 * Math.pow(Re, 0.8) * Math.pow(gp.Pr, 0.3));
    const hGas = Nu * gp.k / g.di;
    const h = condensing ? 1 / (1 / p.hFilm + Z / hGas) : hGas;
    return { h, hGas, Re };
  }

  /* ------------------------------------------------------------------ *
   * 7. Cell-by-cell solver
   * ------------------------------------------------------------------ *
   * Rows r = 0 (bottom, air inlet) … R-1 (top). Air rises through all rows,
   * unmixed along the tube length (column x keeps its own air temperature).
   * Gas enters the top pass and works downward; each pass = rows/passes rows
   * in parallel; flow direction along x alternates between passes.
   * Each cell: ε-NTU, crossflow with the gas side mixed; gas outlet found by
   * Newton on the condensing-gas enthalpy. The air field is iterated
   * (Gauss–Seidel) until the inlet air temperatures stop changing.
   */
  function epsCross(NTU, Cr, airIsMin) {
    if (Cr < 1e-9) return 1 - Math.exp(-NTU);
    return airIsMin
      ? (1 / Cr) * (1 - Math.exp(-Cr * (1 - Math.exp(-NTU))))     // Cmax (gas) mixed
      : 1 - Math.exp(-(1 / Cr) * (1 - Math.exp(-Cr * NTU)));     // Cmin (gas) mixed
  }

  function solveCell(TgIn, nvIn, nd, P, TaIn, Ca, uaFun) {
    if (TgIn <= TaIn + 1e-6) return { TgOut: TgIn, nvOut: nvIn, Q: 0, Ql: 0, Qs: 0 };
    let d = gasDuty(TgIn, TgIn - 0.25, nd, nvIn, P);
    let Cg = d.Q / 0.25, Z = d.Q > 0 ? d.Qs / d.Q : 1, cond = d.Ql > 0;
    let TgOut = TgIn, res = null;
    for (let it = 0; it < 3; it++) {
      const UA = uaFun(0.5 * (TgIn + TgOut), nvIn, Z, cond);
      const Cmin = Math.min(Cg, Ca), Cmax = Math.max(Cg, Ca);
      const eps = epsCross(UA / Cmin, Cmin / Cmax, Ca <= Cg);
      const Q = eps * Cmin * (TgIn - TaIn);
      // Newton for TgOut with gasDuty(TgIn, TgOut) = Q
      let T = Math.max(TaIn, TgIn - Q / Cg);
      for (let k = 0; k < 8; k++) {
        const f = gasDuty(TgIn, T, nd, nvIn, P).Q - Q;
        const f2 = gasDuty(TgIn, T - 0.01, nd, nvIn, P).Q - Q;
        const df = (f2 - f) / 0.01;                      // dQ per K of further cooling
        const step = df > 0 ? f / df : 0;
        T = Math.min(TgIn, Math.max(TaIn, T + step));
        if (Math.abs(step) < 1e-6) break;
      }
      TgOut = T;
      res = gasDuty(TgIn, TgOut, nd, nvIn, P);
      if (TgIn - TgOut > 1e-6) { Cg = res.Q / (TgIn - TgOut); Z = res.Q > 0 ? res.Qs / res.Q : 1; cond = res.Ql > 0; }
    }
    return { TgOut, nvOut: res.nvOut, Q: res.Q, Ql: res.Ql, Qs: res.Qs };
  }

  function solve(input) {
    const p = Object.assign({}, DEFAULTS, input || {});
    const g = geometry(p);
    const air = airProps(p.Tamb, p.patm);
    const blk = rowBlockage(p);
    const op = operatingPoint(p, g, air, blk);
    const mAir = op.Q * air.rho;
    const R = p.rows, N = Math.max(2, Math.round(p.nSeg));
    const passes = [1, 2, 3, 6].includes(p.passes) && R % p.passes === 0 ? p.passes : 6;
    const rowsPerPass = R / passes;

    // air side, per row
    const airRows = [];
    for (let r = 0; r < R; r++) airRows.push(airRow(g, p, Math.max(mAir, 1e-6), blk.rows[r], air, blk.fouled[r]));
    const Rw = Math.log(p.tubeOD / g.di) / (2 * Math.PI * p.tubeK);   // m K/W per metre
    const segL = p.tubeLength / N;
    const tubesRow = g.nTubesRow;
    const Ca = Math.max(mAir, 1e-9) * CP_AIR / 1000 / N;               // kW/K per column per row

    // gas inlet
    const nd = p.flow / NM3_PER_KMOL / 3600;                            // kmol/s dry
    const nvIn = p.saturatedInlet ? nd * wsat(p.Tin, p.Pin) : nd * (p.waterIn || 0);

    // air temperature field entering each row (r) at column x
    const TaIn = [];
    for (let r = 0; r < R; r++) TaIn.push(new Float64Array(N).fill(p.Tamb));
    const TaOut = TaIn.map(a => new Float64Array(a));
    const cellQ = TaIn.map(() => new Float64Array(N));
    const cellTg = TaIn.map(() => new Float64Array(N));
    let rowsOut = [], gasOut = null, iters = 0, maxChange = 0;
    const totalSteps = passes * N;

    for (iters = 1; iters <= 80; iters++) {
      let Tg = p.Tin, nv = nvIn;
      rowsOut = new Array(R);
      for (let k = 0; k < passes; k++) {
        const fwd = k % 2 === 0;
        const rowIdx = [];
        for (let j = 0; j < rowsPerPass; j++) rowIdx.push(R - 1 - (k * rowsPerPass + j)); // top first
        const ndr = nd / rowsPerPass;
        let mixH = 0, mixNv = 0, mixT = 0;
        for (const r of rowIdx) {
          let T = Tg, v = nv / rowsPerPass, Qrow = 0, Qlrow = 0;
          const ar = airRows[r];
          const uaFun = (Tm, nvl, Z, cond) => {
            const th = tubeH(p, g, Tm, ndr, nvl, Z, cond, tubesRow);
            const Um = 1 / (1 / (th.h * Math.PI * g.di) + Rw + 1 / ar.UAm);   // W/m/K
            return p.uaMult * Um * tubesRow * segL / 1000;                     // kW/K
          };
          for (let i = 0; i < N; i++) {
            const x = fwd ? i : N - 1 - i;
            const step = k * N + i;
            const P = p.Pin + (p.Pout - p.Pin) * (step + 0.5) / totalSteps;
            const c = solveCell(T, v, ndr, P, TaIn[r][x], Ca, uaFun);
            cellQ[r][x] = c.Q; cellTg[r][x] = 0.5 * (T + c.TgOut);
            TaOut[r][x] = TaIn[r][x] + c.Q / Ca;
            T = c.TgOut; v = c.nvOut; Qrow += c.Q; Qlrow += c.Ql;
          }
          rowsOut[r] = { row: r, pass: k, TgIn: Tg, TgOut: T, Q: Qrow, Ql: Qlrow, nvOut: v };
          mixT += T / rowsPerPass; mixNv += v;
        }
        Tg = mixT; nv = Math.min(mixNv, nd * wsat(Tg, p.Pin + (p.Pout - p.Pin) * (k + 1) / passes));
      }
      gasOut = { T: Tg, nv };
      // propagate air upward
      maxChange = 0;
      for (let r = 1; r < R; r++) for (let x = 0; x < N; x++) {
        const v = TaOut[r - 1][x];
        maxChange = Math.max(maxChange, Math.abs(v - TaIn[r][x]));
        TaIn[r][x] = v;
      }
      if (maxChange < 1e-4) break;
    }

    // results
    let Q = 0, Ql = 0;
    for (const ro of rowsOut) { Q += ro.Q; Ql += ro.Ql; }
    const ref = gasDutyFine(p.Tin, gasOut.T, nd, nvIn, p.Pin, p.Pout, 400);
    let TairOut = 0;
    for (let x = 0; x < N; x++) TairOut += TaOut[R - 1][x] / N;
    const QairCheck = mAir * CP_AIR * (TairOut - p.Tamb) / 1000;
    let UAsum = 0, hMean = 0, etaMean = 0, hClean = 0;
    for (const ar of airRows) { hMean += ar.hEff / R; etaMean += ar.etaF / R; hClean += ar.h / R; }
    // overall UA from the clean/fouled cell conductances at mean conditions
    for (let r = 0; r < R; r++) {
      const th = tubeH(p, g, (p.Tin + gasOut.T) / 2, nd / rowsPerPass, nvIn / rowsPerPass, 0.3, true, tubesRow);
      UAsum += p.uaMult / (1 / (th.h * Math.PI * g.di) + Rw + 1 / airRows[r].UAm) * tubesRow * p.tubeLength / 1000;
    }
    const fanPowerAir = op.Q * op.dp;                         // W
    const shaft = fanPowerAir / p.fanEff;
    return {
      params: p, geom: g, air, blockage: blk,
      airflow: { Q: op.Q, m: mAir, faceV: op.Q / g.Aface, fanV: op.Q / g.fanArea, dp: op.dp, sys: op.sys, s: op.s,
        powerShaft: shaft, powerElectric: shaft / p.motorEff, Tout: TairOut },
      rows: rowsOut, airRows,
      hAir: hClean, hAirEff: hMean, finEff: etaMean,
      UA: UAsum, U: UAsum * 1000 / g.Ao,
      Q, Ql, Qs: Q - Ql,
      Tout: gasOut.T,
      waterIn: nvIn * MW_W * 3600, waterOut: gasOut.nv * MW_W * 3600,
      condensed: (nvIn - gasOut.nv) * MW_W * 3600,           // kg/h
      dryMass: nd * MWD * 3600,                               // kg/h
      closure: ref.Q > 0 ? Math.abs(Q - ref.Q) / ref.Q : 0,
      airClosure: Q > 0 ? Math.abs(Q - QairCheck) / Q : 0,
      setpointMet: gasOut.T <= 65.5,
      iterations: iters, converged: maxChange < 1e-3,
      field: { TaIn, TaOut, cellQ, cellTg, N },
    };
  }

  /* ------------------------------------------------------------------ *
   * 8. Helpers for charts and calibration
   * ------------------------------------------------------------------ */

  /** Fan curve (per total fans) and system curve sampled for plotting. */
  function curves(input, n) {
    const p = Object.assign({}, DEFAULTS, input || {});
    const g = geometry(p), air = airProps(p.Tamb, p.patm), blk = rowBlockage(p);
    const fp = fanParams(p, air);
    const s = p.fanPct / 100;
    const Qmax = p.nFans * fp.Q0 * 1.05;
    const pts = [];
    n = n || 40;
    for (let i = 0; i <= n; i++) {
      const Q = Qmax * i / n;
      pts.push({ Q, fan: fanDP(fp, p.nFans, Q, s), fan100: fanDP(fp, p.nFans, Q, 1), sys: systemDP(p, g, Q, air, blk).total });
    }
    return { pts, op: operatingPoint(p, g, air, blk) };
  }

  /** Find x in [lo,hi] with f(x)=0 (f monotone), bisection. */
  function bisect(f, lo, hi, n) {
    let flo = f(lo);
    for (let i = 0; i < (n || 40); i++) {
      const mid = 0.5 * (lo + hi), fm = f(mid);
      if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** UA multiplier c such that the model reproduces a measured outlet temperature
   *  (cleanliness factor = UA_actual / UA_clean_model). */
  function fitUAFactor(input, ToutMeasured) {
    const f = lc => solve(Object.assign({}, input, { uaMult: Math.exp(lc) })).Tout - ToutMeasured;
    if (f(Math.log(20)) > 0) return 20;
    if (f(Math.log(0.002)) < 0) return 0.002;
    return Math.exp(bisect(f, Math.log(0.002), Math.log(20), 30));
  }

  /** Blockage that reproduces a measured outlet temperature (other params fixed). */
  function fitBlockage(input, ToutMeasured, maxB) {
    maxB = maxB || 0.95;
    const f = b => solve(Object.assign({}, input, { blockage: b })).Tout - ToutMeasured;
    if (f(0) > 0) return 0;
    if (f(maxB) < 0) return maxB;
    return bisect(f, 0, maxB, 30);
  }

  /* Calibration targets (scenarios.json / balance.py, ambient from weather — see ASSUMPTIONS). */
  const TARGETS = [
    { key: 'design', name: 'Design (P&ID)', Tin: 137, flow: 21000, Tamb: 35, fanPct: 100, Tout: 60, clean: true,
      note: 'Clean bundle, fans 100 %, design air temperature assumed 35 °C' },
    { key: 'now', name: '14 Nov 2026', Tin: 166.9, flow: 20979, Tamb: 5, fanPct: 88.2, Tout: 65.1, Q: 4.50, latent: 0.80,
      note: 'Snapshot 14:00, controller on setpoint' },
    { key: 'summer', name: 'Summer 2025', Tin: 160.7, flow: 18122, Tamb: 30, fanPct: 99.4, Tout: 72.3, Q: 3.17,
      note: 'Jun–Aug 2025 average, fans saturated 90 % of hours' },
  ];

  /** Calibrate against the targets.
   *  - Fan scaling: cannot be identified from these data (no airflow or fan-power
   *    measurement, and the clean design case is not binding because the clean model
   *    over-performs it), so it is held at `fanScale` (default 1) and reported as such.
   *  - Fouling: for each plant point, the debris resistance R_f is fitted (uniform
   *    fouling, blockage held at `blockage`) so that the model reproduces the measured
   *    outlet temperature. The model-independent cleanliness factor
   *    UA_actual / UA_clean_model is reported alongside. */
  function calibrate(opts) {
    opts = opts || {};
    const blockage = opts.blockage !== undefined ? opts.blockage : 0.5;
    const base = Object.assign({ foulMode: 'uniform', blockage, fanScale: 1 }, opts.base || {});
    const out = [];
    for (const t of TARGETS) {
      const op = Object.assign({}, base, { Tin: t.Tin, flow: t.flow, Tamb: t.Tamb, fanPct: t.fanPct });
      if (t.clean) {
        const r = solve(Object.assign({}, op, { blockage: 0, Rf: 0 }));
        out.push({ target: t, Rf: 0, blockage: 0, cf: fitUAFactor(Object.assign({}, op, { blockage: 0, Rf: 0 }), t.Tout), result: r });
        continue;
      }
      const f = Rf => solve(Object.assign({}, op, { Rf })).Tout - t.Tout;
      const Rf = f(0) >= 0 ? 0 : f(3) <= 0 ? 3 : bisect(f, 0, 3, 36);
      const r = solve(Object.assign({}, op, { Rf }));
      const cf = fitUAFactor(Object.assign({}, op, { blockage: 0, Rf: 0 }), t.Tout);
      out.push({ target: t, Rf, blockage, cf, result: r });
    }
    return { fanScale: base.fanScale, blockage, points: out };
  }

  return {
    TARGETS, calibrate,
    DEFAULTS, ASSUMPTIONS, DRY, MWD, CPD, CPV, MW_W, NM3_PER_KMOL, FIN_K,
    psat, hfg, wsat, airProps, gasProps,
    geometry, rowBlockage, briggsYoung, finEfficiency, robinsonBriggsRow, rowDP, airRow,
    fanParams, fanDP, systemDP, operatingPoint, curves,
    gasDuty, gasDutyFine, tubeH, epsCross, solveCell, solve,
    bisect, fitUAFactor, fitBlockage,
  };
});
