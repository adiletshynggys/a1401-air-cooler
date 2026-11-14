/* simulator.js — sliders, readouts, "why debris hurts twice" cards and charts (a)–(e). */
(function () {
  'use strict';
  const M = window.A1401, { fmt, assume } = UI;
  UI.chartDefaults();

  /* Fitted fouling from the calibration (blockage held at 50 %, uniform). The Validation
   * tab recomputes these live; presets are refreshed when it finishes. */
  const FIT = { blockage: 0.5, Rf_now: 0.402, Rf_summer: 0.443 };
  const PRESETS = {
    clean: { Tamb: 5, flow: 20979, Tin: 166.9, fanPct: 88.2, blockage: 0, Rf: 0, foulMode: 'uniform' },
    now: { Tamb: 5, flow: 20979, Tin: 166.9, fanPct: 88.2, blockage: FIT.blockage, Rf: FIT.Rf_now, foulMode: 'uniform' },
    summer: { Tamb: 30, flow: 18122, Tin: 160.7, fanPct: 99.4, blockage: FIT.blockage, Rf: FIT.Rf_summer, foulMode: 'uniform' },
    design: { Tamb: 35, flow: 21000, Tin: 137, fanPct: 100, blockage: 0, Rf: 0, foulMode: 'uniform' },
  };
  const D = M.DEFAULTS;
  let P = Object.assign({}, D, PRESETS.now);

  /* ---------------- control definitions ---------------- */
  const finH = () => (P.finOD - P.finRootD) / 2;
  const CTL = [
    { grp: 'Operating point' },
    { k: 'Tamb', label: 'Ambient air', min: -30, max: 45, step: 0.5, unit: '°C', d: 1 },
    { k: 'flow', label: 'Syngas flow (dry)', min: 10000, max: 26000, step: 100, unit: 'Nm³/h', d: 0 },
    { k: 'Tin', label: 'Inlet temperature', min: 130, max: 175, step: 0.5, unit: '°C', d: 1, help: 'Design 137 °C, actual ~167 °C (TIA050)' },
    { k: 'fanPct', label: 'Fan output', min: 0, max: 100, step: 1, unit: '%', d: 0, help: 'Treated as fan speed (affinity laws)', tag: 'Fan output % is treated as speed; with auto-variable-pitch fans the curve shape differs.' },
    { grp: 'Debris fouling' },
    { k: 'blockage', label: 'Fin gaps blocked', min: 0, max: 70, step: 1, unit: '%', d: 0, scale: 100, help: 'Packed gaps resist the air and bury the fin surface' },
    { k: 'Rf', label: 'Debris resistance R_f', min: 0, max: 1, step: 0.005, unit: 'm²K/W', d: 3, help: 'Insulating layer on the finned surface' },
    { k: 'foulMode', label: 'Which rows are fouled', type: 'seg', opts: [['bottom1', 'Bottom row'], ['bottom2', 'Bottom 2'], ['uniform', 'All rows']] },
    { k: 'steamCoil', label: 'Steam heating coil on air inlet', type: 'chk', tag: 'steamCoil' },
    { grp: 'Fins' },
    { k: 'fpi', label: 'Fin density', min: 6, max: 14, step: 0.5, unit: 'fins/inch', d: 1, tag: 'fpi' },
    { k: '_finH', label: 'Fin height', min: 8, max: 20, step: 0.1, unit: 'mm', d: 1, get: () => finH() * 1000, set: v => { P.finOD = P.finRootD + 2 * v / 1000; }, tag: 'finOD' },
    { k: '_finT', label: 'Fin thickness', min: 0.25, max: 0.6, step: 0.01, unit: 'mm', d: 2, get: () => P.finT * 1000, set: v => { P.finT = v / 1000; }, tag: 'finT' },
    { k: 'finMaterial', label: 'Fin material', type: 'seg', opts: [['Al', 'Aluminium'], ['steel', 'Steel']] },
    { grp: 'Fans and tube side', collapsed: true },
    { k: 'nFans', label: 'Number of fans', min: 3, max: 12, step: 1, unit: '', d: 0, tag: 'nFans' },
    { k: 'fanD', label: 'Fan diameter', min: 1.8, max: 4.3, step: 0.05, unit: 'm', d: 2, tag: 'fanD' },
    { k: 'fanRpm', label: 'Fan speed at 100 %', min: 250, max: 700, step: 5, unit: 'rpm', d: 0, tag: 'fanRpm' },
    { k: 'fanScale', label: 'Fan scaling (calibration)', min: 0.3, max: 1.5, step: 0.01, unit: '×', d: 2, tag: 'Calibration factor on fan size. Held at 1: the data contain no airflow or fan-power measurement to fit it.' },
    { k: 'hFilm', label: 'Condensate film h', min: 1500, max: 3000, step: 50, unit: 'W/m²K', d: 0, tag: 'hFilm' },
    { k: 'passes', label: 'Tube passes', type: 'seg', opts: [[1, '1'], [2, '2'], [3, '3'], [6, '6']], tag: 'passes' },
  ];

  /* ---------------- build controls ---------------- */
  const host = document.getElementById('sliders');
  let html = '', open = false, inDetails = false;
  for (const c of CTL) {
    if (c.grp) {
      if (inDetails) html += '</details>';
      else if (open) html += '</div>';
      if (c.collapsed) { html += `<details class="grp"><summary>${c.grp}</summary>`; inDetails = true; }
      else { html += `<div class="grp"><h3>${c.grp}</h3>`; open = true; inDetails = false; }
      continue;
    }
    const tag = c.tag ? ' ' + assume(c.tag) : '';
    if (c.type === 'seg') {
      html += `<div class="ctl"><label>${c.label}${tag}</label><div class="seg" data-k="${c.k}">` +
        c.opts.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('') + '</div></div>';
    } else if (c.type === 'chk') {
      html += `<label class="chk"><input type="checkbox" data-k="${c.k}"> ${c.label}${tag}</label>`;
    } else {
      html += `<div class="ctl"><div class="row"><label for="s-${c.k}">${c.label}${tag}</label><output id="o-${c.k}"></output></div>` +
        `<input type="range" id="s-${c.k}" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}">` +
        (c.help ? `<div class="help">${c.help}</div>` : '') + '</div>';
    }
  }
  html += inDetails ? '</details>' : '</div>';
  host.innerHTML = html;

  const ctlByK = Object.fromEntries(CTL.filter(c => c.k).map(c => [c.k, c]));
  const getV = c => c.get ? c.get() : (P[c.k] * (c.scale || 1));
  const setV = (c, v) => { if (c.set) c.set(v); else P[c.k] = v / (c.scale || 1); };

  function syncControls() {
    for (const c of CTL) {
      if (!c.k) continue;
      if (c.type === 'seg') host.querySelectorAll(`.seg[data-k="${c.k}"] button`).forEach(b => b.classList.toggle('on', String(P[c.k]) === b.dataset.v));
      else if (c.type === 'chk') host.querySelector(`input[data-k="${c.k}"]`).checked = !!P[c.k];
      else { const v = getV(c); host.querySelector('#s-' + c.k).value = v; host.querySelector('#o-' + c.k).textContent = `${fmt(v, c.d)} ${c.unit}`; }
    }
  }
  host.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    const c = ctlByK[k];
    if (c.type === 'chk') P[k] = e.target.checked; else setV(c, parseFloat(e.target.value));
    if (c.type !== 'chk') host.querySelector('#o-' + k).textContent = `${fmt(getV(c), c.d)} ${c.unit}`;
    clearPreset(); update();
  });
  host.addEventListener('click', e => {
    const b = e.target.closest('.seg button'); if (!b) return;
    const k = b.parentElement.dataset.k;
    P[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
    syncControls(); clearPreset(); update();
  });
  const presetBtns = document.querySelectorAll('.presets button');
  function clearPreset() { presetBtns.forEach(b => b.classList.remove('on')); }
  presetBtns.forEach(b => b.addEventListener('click', () => {
    Object.assign(P, PRESETS[b.dataset.preset]);
    presetBtns.forEach(x => x.classList.toggle('on', x === b));
    syncControls(); update();
  }));

  /* ---------------- readouts ---------------- */
  const ro = document.getElementById('readouts');
  function renderReadouts(r) {
    const a = r.airflow, q = r.Q / 1000;
    const row = (k, v, u, tag) => `<tr><td>${k}${tag ? ' ' + assume(tag) : ''}</td><td class="n">${v} <small>${u}</small></td></tr>`;
    const latPct = r.Q > 0 ? 100 * r.Ql / r.Q : 0;
    ro.innerHTML = `
      <div><h3>Gas outlet</h3>
      <div class="big">${fmt(r.Tout, 1)}<small> °C</small></div>
      <table>${row('Duty', fmt(q, 2), 'MW')}
      ${row('Water condensed', fmt(r.condensed, 0), 'kg/h')}
      ${row('Water vapour in', fmt(r.waterIn, 0), 'kg/h')}</table>
      <div class="split"><div class="lat" style="width:${latPct}%"></div><div class="sen" style="width:${100 - latPct}%"></div></div>
      <div class="split-lbl"><span>latent ${fmt(r.Ql / 1000, 2)} MW</span><span>sensible ${fmt(r.Qs / 1000, 2)} MW</span></div></div>
      <div><h3>Air side</h3><table>
      ${row('Air mass flow', fmt(a.m, 0), 'kg/s')}
      ${row('Face velocity', fmt(a.faceV, 2), 'm/s')}
      ${row('Fan static pressure', fmt(a.dp, 0), 'Pa')}
      ${row('Fan power, shaft', fmt(a.powerShaft / 1000, 0), 'kW', 'fanEff')}
      ${row('Air outlet', fmt(a.Tout, 1), '°C')}
      ${row('Air-side h, clean fins', fmt(r.hAir, 1), 'W/m²K')}
      ${row('Air-side h with R_f', fmt(r.hAirEff, 1), 'W/m²K')}
      ${row('Fin efficiency', fmt(100 * r.finEff, 1), '%')}</table></div>
      <div><h3>Overall</h3><table>
      ${row('U (finned area)', fmt(r.U, 2), 'W/m²K')}
      ${row('UA', fmt(r.UA, 1), 'kW/K')}
      ${row('Finned area', fmt(r.geom.Ao, 0), 'm²')}
      ${row('Fin ratio', fmt(r.geom.finRatio, 1), '')}
      ${row('Energy balance closure', fmt(100 * r.closure, 2), '%')}</table></div>`;
    const b = document.getElementById('spBadge');
    b.className = 'badge ' + (r.setpointMet ? 'ok' : 'bad');
    b.textContent = r.setpointMet ? `65 °C setpoint met · ${fmt(r.Tout, 1)} °C` : `Setpoint 65 °C missed by ${fmt(r.Tout - 65, 1)} K`;
  }

  /* ---------------- "debris hurts twice" ---------------- */
  function renderTwice(r) {
    const el = document.getElementById('twice');
    const clean = M.solve(Object.assign({}, P, { blockage: 0, Rf: 0, nSeg: 10 }));
    const g = r.geom, air = r.air;
    // split the air-side loss: same airflow, fouled surfaces vs clean surfaces
    let surf = 0, flowOnly = 0, base = 0;
    for (let i = 0; i < P.rows; i++) {
      base += M.airRow(g, P, clean.airflow.m, 0, air, 0).UAm;
      surf += M.airRow(g, P, clean.airflow.m, r.blockage.rows[i], air, r.blockage.fouled[i]).UAm;
      flowOnly += M.airRow(g, P, r.airflow.m, 0, air, 0).UAm;
    }
    const fouled = P.blockage > 0 || P.Rf > 0;
    const full = M.solve(Object.assign({}, P, { fanPct: 100, nSeg: 10 }));
    const dFlow = 100 * (1 - r.airflow.Q / Math.max(clean.airflow.Q, 1e-9));
    const dSurf = 100 * (1 - surf / base), dFlowH = 100 * (1 - flowOnly / base);
    el.innerHTML = fouled ? `
      <div class="card"><div class="h">1 · It resists the air</div><div class="big">−${fmt(dFlow, 0)} % air</div>
        <p>Same fans, ${fmt(r.airflow.Q, 0)} instead of ${fmt(clean.airflow.Q, 0)} m³/s. Less air alone costs ${fmt(dFlowH, 0)} % of the air-side conductance (h ∝ v<sup>0.68</sup>).</p></div>
      <div class="card"><div class="h">2 · It insulates the fins</div><div class="big">−${fmt(dSurf, 0)} % conductance</div>
        <p>At the same airflow, buried fin area and the debris layer remove ${fmt(dSurf, 0)} % of the air-side conductance. Together: UA ${fmt(clean.UA, 0)} → ${fmt(r.UA, 0)} kW/K.</p></div>
      <div class="card"><div class="h">3 · Fans cannot win it back</div><div class="big">${fmt(full.Tout, 1)} °C at 100 %</div>
        <p>Clean bundle at ${fmt(P.fanPct, 0)} % fans: ${fmt(clean.Tout, 1)} °C. Fouled at 100 %: ${fmt(full.Tout, 1)} °C for ${fmt(full.airflow.powerShaft / 1000, 0)} kW of shaft power.</p></div>`
      : `<div class="card" style="grid-column:1/-1"><div class="h">Clean bundle</div><p>Move the blockage or R<sub>f</sub> slider to see how debris cuts the airflow and insulates the fins at the same time.</p></div>`;
  }

  /* ---------------- charts ---------------- */
  const charts = {};
  const mk = (id, cfg) => { if (!window.Chart) return null; const c = new Chart(document.getElementById(id), cfg); charts[id] = c; return c; };
  const axis = (title, extra) => Object.assign({ title: { display: true, text: title }, grid: { color: '#eef1f4' } }, extra || {});
  const C = UI.SERIES;

  function initCharts() {
    mk('chFan', { type: 'scatter', data: { datasets: [] }, options: {
      showLine: true, scales: { x: axis('Air flow, m³/s', { min: 0 }), y: axis('Static pressure, Pa', { min: 0 }) },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.x, 0)} m³/s, ${fmt(c.parsed.y, 0)} Pa` } } } } });
    mk('chBlock', { type: 'scatter', data: { datasets: [] }, options: {
      showLine: true, scales: { x: axis('Fin gaps blocked, %', { min: 0, max: 70 }), y: axis('Outlet T, °C'), y2: axis('Duty, MW', { position: 'right', grid: { display: false } }) },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y, c.dataset.yAxisID === 'y2' ? 2 : 1)}` } } } } });
    mk('chRows', { type: 'bar', data: { labels: [], datasets: [] }, options: {
      scales: { x: { grid: { display: false } }, y: axis('Row duty, MW', { min: 0 }), y2: axis('Gas T leaving the row, °C', { position: 'right', grid: { display: false } }) } } });
    mk('chPower', { type: 'scatter', data: { datasets: [] }, options: {
      showLine: true, scales: { x: axis('Fan shaft power, kW', { min: 0 }), y: axis('Duty, MW', { min: 0 }) },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw.f, 0)} % fans → ${fmt(c.parsed.x, 0)} kW, ${fmt(c.parsed.y, 2)} MW, outlet ${fmt(c.raw.T, 1)} °C` } } } } });
    mk('chInlet', { type: 'scatter', data: { datasets: [] }, options: {
      showLine: true, scales: { x: axis('A-1401 inlet temperature, °C', { min: 130, max: 175 }), y: axis('Outlet T, °C'), y2: axis('Duty, MW · water condensed, t/h', { position: 'right', grid: { display: false }, min: 0 }) },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y, 2)}` } } } } });
  }

  function updateCharts(r) {
    if (!window.Chart) return;
    const q = Object.assign({}, P, { nSeg: 8 });
    // (a) fan vs system
    const cf = M.curves(q, 50), cc = M.curves(Object.assign({}, q, { blockage: 0, Rf: 0 }), 50);
    const xy = (pts, k) => pts.map(p => ({ x: p.Q, y: p[k] }));
    charts.chFan.data.datasets = [
      { label: `Fan curve at ${fmt(P.fanPct, 0)} %`, data: xy(cf.pts, 'fan'), borderColor: C[0] },
      { label: 'Fan curve at 100 %', data: xy(cf.pts, 'fan100'), borderColor: C[0], borderDash: [5, 4], borderWidth: 1.5 },
      { label: 'System, clean', data: xy(cc.pts, 'sys'), borderColor: UI.GREY },
      { label: 'System, fouled', data: xy(cf.pts, 'sys'), borderColor: C[1] },
      { label: 'Operating points', data: [{ x: cc.op.Q, y: cc.op.dp }, { x: cf.op.Q, y: cf.op.dp }], showLine: false, pointRadius: 5, backgroundColor: [UI.GREY, C[1]], borderColor: '#fff' },
    ];
    const ymax = Math.max(...cf.pts.map(p => p.fan100)) * 1.15;
    charts.chFan.options.scales.y.max = Math.ceil(ymax / 50) * 50;
    charts.chFan.update();

    // (b) blockage sweep at 0/20/35 °C
    const ds = [];
    [0, 20, 35].forEach((Ta, i) => {
      const T = [], Q = [];
      for (let b = 0; b <= 70; b += 5) {
        const s = M.solve(Object.assign({}, q, { Tamb: Ta, blockage: b / 100 }));
        T.push({ x: b, y: s.Tout }); Q.push({ x: b, y: s.Q / 1000 });
      }
      ds.push({ label: `Outlet T, ${Ta} °C air`, data: T, borderColor: C[i], yAxisID: 'y' });
      ds.push({ label: `Duty, ${Ta} °C air`, data: Q, borderColor: C[i], borderDash: [5, 4], borderWidth: 1.5, yAxisID: 'y2' });
    });
    ds.push({ label: '65 °C setpoint', data: [{ x: 0, y: 65 }, { x: 70, y: 65 }], borderColor: '#b3261e', borderWidth: 1, borderDash: [2, 3], yAxisID: 'y' });
    charts.chBlock.data.datasets = ds; charts.chBlock.update();

    // (c) rows in gas-path order (top → bottom)
    const order = r.rows.slice().reverse();
    charts.chRows.data.labels = order.map(o => `Row ${o.row + 1}` + (o.row === P.rows - 1 ? ' · gas in' : o.row === 0 ? ' · air in' : ''));
    charts.chRows.data.datasets = [
      { type: 'bar', label: 'Latent duty', data: order.map(o => o.Ql / 1000), backgroundColor: C[0], stack: 'q', yAxisID: 'y' },
      { type: 'bar', label: 'Sensible duty', data: order.map(o => (o.Q - o.Ql) / 1000), backgroundColor: '#9cc3e8', stack: 'q', yAxisID: 'y' },
      { type: 'line', label: 'Gas T leaving row', data: order.map(o => o.TgOut), borderColor: C[1], pointRadius: 3, pointBackgroundColor: C[1], yAxisID: 'y2' },
    ];
    charts.chRows.options.scales.x.stacked = true; charts.chRows.options.scales.y.stacked = true;
    charts.chRows.update();

    // (d) duty vs fan power, clean vs fouled
    const sweep = o => { const out = []; for (let f = 20; f <= 100; f += 10) { const s = M.solve(Object.assign({}, q, o, { fanPct: f })); out.push({ x: s.airflow.powerShaft / 1000, y: s.Q / 1000, f, T: s.Tout }); } return out; };
    charts.chPower.data.datasets = [
      { label: 'Clean bundle', data: sweep({ blockage: 0, Rf: 0 }), borderColor: UI.GREY, pointRadius: 3, pointBackgroundColor: UI.GREY },
      { label: `Fouled (${fmt(P.blockage * 100, 0)} % blocked, R_f ${fmt(P.Rf, 2)})`, data: sweep({}), borderColor: C[1], pointRadius: 3, pointBackgroundColor: C[1] },
    ];
    charts.chPower.update();

    // (e) inlet temperature
    const T = [], Q = [], Z = [];
    for (let t = 130; t <= 175; t += 2.5) {
      const s = M.solve(Object.assign({}, q, { Tin: t }));
      T.push({ x: t, y: s.Tout }); Q.push({ x: t, y: s.Q / 1000 }); Z.push({ x: t, y: s.condensed / 1000 });
    }
    const at = t => M.solve(Object.assign({}, q, { Tin: t }));
    const a137 = at(137), a167 = at(167);
    charts.chInlet.data.datasets = [
      { label: 'Outlet T, °C', data: T, borderColor: C[0], yAxisID: 'y' },
      { label: 'Duty, MW', data: Q, borderColor: C[1], yAxisID: 'y2' },
      { label: 'Water condensed, t/h', data: Z, borderColor: C[2], borderDash: [5, 4], yAxisID: 'y2' },
      { label: `Design 137 °C: ${fmt(a137.Q / 1000, 2)} MW, outlet ${fmt(a137.Tout, 1)} °C`, data: [{ x: 137, y: a137.Tout }], pointRadius: 6, pointStyle: 'rectRot', backgroundColor: UI.GREY, yAxisID: 'y' },
      { label: `Actual 167 °C: ${fmt(a167.Q / 1000, 2)} MW, outlet ${fmt(a167.Tout, 1)} °C`, data: [{ x: 167, y: a167.Tout }], pointRadius: 6, pointStyle: 'rectRot', backgroundColor: '#b3261e', yAxisID: 'y' },
    ];
    charts.chInlet.update();
  }

  /* ---------------- main update ---------------- */
  let tmr = null, last = null;
  function update() {
    const r = M.solve(P);
    last = r;
    renderReadouts(r);
    Scene3D.update(r);
    clearTimeout(tmr);
    tmr = setTimeout(() => { renderTwice(r); updateCharts(r); }, 120);
  }

  /* ---------------- tab lifecycle ---------------- */
  let inited = false;
  UI.onTab(name => {
    const on = name === 'simulator';
    if (on && !inited) {
      inited = true;
      Scene3D.init(document.getElementById('viewer'));
      initCharts(); syncControls(); update();
    }
    Scene3D.setRunning(on);
  });

  /* called by validation.js when the live calibration finishes */
  window.Simulator = {
    setFit(fit) {
      Object.assign(PRESETS.now, { blockage: fit.blockage, Rf: fit.Rf_now });
      Object.assign(PRESETS.summer, { blockage: fit.blockage, Rf: fit.Rf_summer });
    },
    params: () => P,
  };
})();
