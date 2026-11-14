/* simulator.js — case buttons (normal vs solutions), weather, 3D view, comparison table, charts. */
(function () {
  'use strict';
  const M = window.A1401, { fmt, assume } = UI;
  const kw = w => fmt(w / 1000, w < 9500 ? 1 : 0);
  UI.chartDefaults();

  const NOTE = {
    normal: 'Today: 50 % of fin gaps blocked; debris resistance fitted to the plant outlet temperature for this weather.',
    s1: [M.ASSUMPTIONS.hood, M.ASSUMPTIONS.cage, M.ASSUMPTIONS.filters, M.ASSUMPTIONS.clean, M.ASSUMPTIONS.spray].join(' '),
    s2: [M.ASSUMPTIONS.spare, M.ASSUMPTIONS.spray, M.ASSUMPTIONS.TinFix].join(' '),
    s12: 'Solution 1 and solution 2 together: protected bundle (hood, cage, filters), standby unit, spray and 137 °C inlet.',
  };

  /* ---------------- state ---------------- */
  const st = { c: 'normal', w: 'summer', glob: {}, per: {} };
  M.CASES.forEach(c => { st.per[c.key] = { fanMode: 'auto', fanPct: 100 }; });
  const W = () => M.WEATHER.find(w => w.key === st.w);

  function input(key, extra) {
    const o = Object.assign({}, st.per[key]); delete o.fanMode; delete o.sprayOpt;
    if (st.per[key].sprayOpt) o.spray = st.per[key].sprayOpt === 'on';
    if (st.per[key].fanMode === 'auto') delete o.fanPct;
    return M.caseParams(key, W(), Object.assign({}, st.glob, o, extra || {}));
  }
  function run(key, nSeg) {
    const p = input(key, { nSeg });
    return st.per[key].fanMode === 'manual' ? M.solve(p) : M.autoFan(p);
  }

  /* ---------------- buttons ---------------- */
  const caseBtns = document.getElementById('caseBtns'), wxBtns = document.getElementById('wxBtns');
  caseBtns.innerHTML = M.CASES.map(c => `<button type="button" data-c="${c.key}"><b>${c.name}</b><span>${c.sub}</span></button>`).join('');
  wxBtns.innerHTML = M.WEATHER.map(w => `<button type="button" data-w="${w.key}" title="${fmt(w.Tamb, 1)} °C air">${w.name}</button>`).join('');
  caseBtns.addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectCase(b.dataset.c); });
  wxBtns.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.w = b.dataset.w; delete st.glob.Tamb; delete st.glob.RH; delete st.glob.flow;
    update(true);
  });
  function selectCase(k) { st.c = k; buildSliders(); update(false); }
  function syncButtons() {
    caseBtns.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === st.c));
    wxBtns.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.w === st.w && st.glob.Tamb === undefined));
  }

  /* ---------------- full screen ---------------- */
  const stage = document.getElementById('stage');
  // The stage always expands to the window (class "fs"); native full screen is added where allowed.
  const fsBtn = document.getElementById('fsBtn');
  function setFs(on) {
    stage.classList.toggle('fs', on);
    document.body.style.overflow = on ? 'hidden' : '';
    fsBtn.title = on ? 'Exit full screen (Esc)' : 'Full screen (F)';
    if (on && stage.requestFullscreen && !document.fullscreenElement) stage.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  const toggleFs = () => setFs(!stage.classList.contains('fs'));
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && stage.classList.contains('fs')) setFs(false); });
  fsBtn.addEventListener('click', toggleFs);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && stage.classList.contains('fs')) setFs(false);
    if ((e.key === 'f' || e.key === 'F') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !document.getElementById('tab-simulator').hidden) toggleFs();
  });

  /* ---------------- sliders ---------------- */
  const host = document.getElementById('sliders');
  const P = () => input(st.c);
  const GLOB = [
    { k: 'Tamb', label: 'Air temperature', min: -20, max: 45, step: 0.5, unit: '°C', d: 1 },
    { k: 'RH', label: 'Relative humidity', min: 10, max: 100, step: 1, unit: '%', d: 0 },
    { k: 'flow', label: 'Syngas flow (dry)', min: 10000, max: 26000, step: 100, unit: 'Nm³/h', d: 0 },
  ];
  const FAN = [
    { k: 'nFans', label: 'Number of fans', min: 1, max: 6, step: 1, unit: '', d: 0, tag: 'nFans' },
    { k: 'fanD', label: 'Fan diameter', min: 2, max: 6, step: 0.1, unit: 'm', d: 1, tag: 'fanD' },
    { k: 'fanRpm', label: 'Fan speed at 100 %', min: 120, max: 500, step: 5, unit: 'rpm', d: 0, tag: 'fanRpm' },
  ];
  function caseCtl() {
    const p = P(), out = [
      { k: 'Tin', label: 'Inlet temperature', min: 130, max: 175, step: 0.5, unit: '°C', d: 1 },
      { k: 'blockage', label: 'Fin gaps blocked', min: 0, max: 70, step: 1, unit: '%', d: 0, scale: 100 },
      { k: 'Rf', label: 'Debris resistance R_f', min: 0, max: 1, step: 0.005, unit: 'm²K/W', d: 3 },
      { k: 'fanMode', label: 'Fan control', type: 'seg', opts: [['auto', 'Auto to 65 °C'], ['manual', 'Manual']] },
      { k: 'sprayOpt', label: 'Water spray', type: 'seg', opts: [['on', 'On when needed'], ['off', 'Off']] },
    ];
    if (st.per[st.c].fanMode === 'manual') out.push({ k: 'fanPct', label: 'Fan output', min: 0, max: 100, step: 1, unit: '%', d: 0 });
    if (p.hood) out.push({ k: 'hoodH', label: 'Hood height (= outlet height)', min: 1, max: 8, step: 0.1, unit: 'm', d: 1, tag: 'hood' },
      { k: 'hoodOverhang', label: 'Hood reaches past bundle end', min: 0, max: 5, step: 0.1, unit: 'm', d: 1 });
    if (p.filters) out.push({ k: 'filterDp', label: 'Filter Δp at 2.5 m/s', min: 30, max: 250, step: 5, unit: 'Pa', d: 0, tag: 'filters' });
    if (p.spray) out.push({ k: 'sprayEff', label: 'Spray effectiveness', min: 0.3, max: 0.95, step: 0.01, unit: '', d: 2, tag: 'spray' });
    return out;
  }
  const ctlHtml = (c, scope) => c.type === 'seg'
    ? `<div class="ctl"><label>${c.label}</label><div class="seg" data-k="${c.k}" data-s="${scope}">` +
      c.opts.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('') + '</div></div>'
    : `<div class="ctl"><div class="row"><label for="s-${c.k}">${c.label}${c.tag ? ' ' + assume(c.tag) : ''}</label><output id="o-${c.k}"></output></div>` +
      `<input type="range" id="s-${c.k}" data-k="${c.k}" data-s="${scope}" min="${c.min}" max="${c.max}" step="${c.step}"></div>`;
  let CTLS = [];
  function buildSliders() {
    const cc = caseCtl();
    CTLS = [...GLOB.map(c => Object.assign({ s: 'g' }, c)), ...cc.map(c => Object.assign({ s: 'c' }, c)), ...FAN.map(c => Object.assign({ s: 'g' }, c))];
    const name = M.CASES.find(c => c.key === st.c).name;
    host.innerHTML =
      `<div class="grp"><h3>Weather and process · all cases</h3>${GLOB.map(c => ctlHtml(c, 'g')).join('')}</div>` +
      `<div class="grp"><h3>${name}</h3>${cc.map(c => ctlHtml(c, 'c')).join('')}</div>` +
      `<div class="grp"><h3>Fan · all cases</h3>${FAN.map(c => ctlHtml(c, 'g')).join('')}</div>`;
    syncSliders();
  }
  function syncSliders() {
    const p = P();
    for (const c of CTLS) {
      if (c.type === 'seg') { const cur = c.k === 'sprayOpt' ? (p.spray ? 'on' : 'off') : st.per[st.c][c.k];
        host.querySelectorAll(`.seg[data-k="${c.k}"] button`).forEach(b => b.classList.toggle('on', b.dataset.v === cur)); continue; }
      const v = (c.k === 'fanPct' ? st.per[st.c].fanPct : p[c.k]) * (c.scale || 1);
      const el = host.querySelector('#s-' + c.k); if (!el) continue;
      el.value = v; host.querySelector('#o-' + c.k).textContent = `${fmt(v, c.d)} ${c.unit}`;
    }
  }
  host.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    const c = CTLS.find(x => x.k === k), v = parseFloat(e.target.value) / (c.scale || 1);
    (c.s === 'g' ? st.glob : st.per[st.c])[k] = v;
    host.querySelector('#o-' + k).textContent = `${fmt(v * (c.scale || 1), c.d)} ${c.unit}`;
    update(c.s === 'g');
  });
  host.addEventListener('click', e => {
    const b = e.target.closest('.seg button'); if (!b) return;
    st.per[st.c][b.parentElement.dataset.k] = b.dataset.v;
    buildSliders(); update(false);
  });

  /* ---------------- card + table ---------------- */
  const card = document.getElementById('card'), cmp = document.getElementById('cmp');
  const dl = (v, ref, d, unit, lowerIsBetter) => {
    const x = v - ref; if (Math.abs(x) < Math.pow(10, -d) / 2) return '';
    const good = lowerIsBetter ? x < 0 : x > 0;
    return `<span class="dlt ${good ? 'good' : 'worse'}">${x > 0 ? '+' : '−'}${fmt(Math.abs(x), d)}${unit}</span>`;
  };
  // air the fan can move at 100 % with this case's resistances (hood, cage, filters, debris)
  const full = r => r._full || (r._full = M.solve(Object.assign({}, r.params, { fanPct: 100, nSeg: 4 })));
  const qmax = r => full(r).airflow.Q;
  function renderCard(r, base) {
    const c = M.CASES.find(x => x.key === st.c), isN = st.c === 'normal', ok = r.Tout <= M.SETPOINT + 0.5;
    const row = (k, v, u, d) => `<tr><td>${k}</td><td class="n">${v} <small>${u}</small>${d || ''}</td></tr>`;
    card.innerHTML = `
      <h3>${c.name} ${assume(NOTE[c.key])}</h3><div class="cs">${c.sub} · ${W().name}${st.glob.Tamb !== undefined ? ' (custom)' : ''}, ${fmt(r.params.Tamb, 1)} °C air</div>
      <div class="tout">${fmt(r.Tout, 1)}<small> °C out</small></div>
      <span class="sp ${ok ? 'ok' : 'bad'}">${ok ? '65 °C setpoint met' : `${fmt(r.Tout - M.SETPOINT, 1)} K above 65 °C`}</span>
      <table>
        ${isN ? '' : row('vs normal', fmt(r.Tout, 1), '°C', dl(r.Tout, base.Tout, 1, ' K', true))}
        ${row('Fan output', fmt(r.params.fanPct, 0), '%', isN ? '' : dl(r.params.fanPct, base.params.fanPct, 0, ' %', true))}
        ${row('Fan power', kw(r.airflow.powerElectric), 'kW', isN ? '' : dl(r.airflow.powerElectric / 1000, base.airflow.powerElectric / 1000, 0, ' kW', true))}
        ${row('Duty', fmt(r.Q / 1000, 2), 'MW')}
        ${row('Water condensed', fmt(r.condensed / 1000, 2), 't/h')}
        ${row('Air flow', fmt(r.airflow.Q, 0), 'm³/s')}
        ${row('Max air flow (fan 100 %)', fmt(qmax(r), 0), 'm³/s', isN ? '' : dl(qmax(r), qmax(base), 0, ' m³/s', false))}
        ${r.params.hood || r.params.cage || r.params.filters ? row('Hood + cage + filters at 100 %', fmt(full(r).airflow.sys.hood + full(r).airflow.sys.cage + full(r).airflow.sys.filter, 0), `of ${fmt(full(r).airflow.sys.total, 0)} Pa`) : ''}
        ${r.params.spray || r.params.sprayIdle ? row('Spray', r.sprayWater > 0 ? fmt(r.sprayWater, 2) : 'off', r.sprayWater > 0 ? `m³/h · air ${fmt(r.airflow.Tin, 1)} °C` : '(not needed)') : ''}
      </table>`;
  }
  function renderTable(res) {
    const maxP = Math.max(1, ...res.map(x => x.r.airflow.powerElectric));
    cmp.innerHTML = `<thead><tr><th>Case · ${W().name}${st.glob.Tamb !== undefined ? ' (custom)' : ''}</th><th>Outlet</th><th>Setpoint 65 °C</th><th>Fan output</th><th>Fan power</th><th>Duty</th><th>Condensed</th><th>Spray water</th></tr></thead><tbody>` +
      res.map(({ c, r }) => `<tr data-c="${c.key}" class="${c.key === st.c ? 'on' : ''}">
        <td><b>${c.name}</b><span class="cs">${c.sub}</span></td>
        <td>${fmt(r.Tout, 1)} °C</td>
        <td class="${r.Tout <= M.SETPOINT + 0.5 ? 'ok' : 'bad'}">${r.Tout <= M.SETPOINT + 0.5 ? 'met' : '+' + fmt(r.Tout - M.SETPOINT, 1) + ' K'}</td>
        <td>${fmt(r.params.fanPct, 0)} %</td>
        <td><span class="bar" style="width:${Math.round(60 * r.airflow.powerElectric / maxP)}px"></span>${kw(r.airflow.powerElectric)} kW</td>
        <td>${fmt(r.Q / 1000, 2)} MW</td>
        <td>${fmt(r.condensed / 1000, 2)} t/h</td>
        <td>${r.sprayWater > 0 ? fmt(r.sprayWater, 2) + ' m³/h' : '—'}</td></tr>`).join('') + '</tbody>';
  }
  cmp.addEventListener('click', e => { const tr = e.target.closest('tr[data-c]'); if (tr) selectCase(tr.dataset.c); });

  /* ---------------- charts: sweep of air temperature ---------------- */
  const charts = {};
  const C = { normal: '#b3261e', s1: UI.SERIES[0], s2: UI.SERIES[2], s12: UI.SERIES[3] };
  const TS = [-15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40];
  // typical Atyrau humidity vs air temperature (UATG means: 85 % in winter, 44 % summer mean, 21 % above 35 °C)
  const rhAt = T => T <= 7 ? 85 : T <= 26 ? 85 - (T - 7) * (41 / 19) : Math.max(15, 44 - (T - 26) * (23 / 12));
  function initCharts() {
    if (!window.Chart) return;
    const ax = (t, o) => Object.assign({ title: { display: true, text: t }, grid: { color: UI.css('--line-2') } }, o || {});
    const opt = y => ({ showLine: true, scales: { x: ax('Air temperature, °C', { min: -15, max: 40 }), y: ax(y) },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y, 1)}` } } } });
    charts.out = new Chart(document.getElementById('chOut'), { type: 'scatter', data: { datasets: [] }, options: opt('Gas outlet, °C') });
    charts.pow = new Chart(document.getElementById('chPow'), { type: 'scatter', data: { datasets: [] }, options: opt('Fan power, kW') });
    charts.pow.options.scales.y.min = 0;
  }
  let job = 0;
  function sweep() {
    if (!window.Chart) return;
    const my = ++job, data = {};
    M.CASES.forEach(c => { data[c.key] = { out: [], pow: [] }; });
    const tasks = [];
    for (const T of TS) for (const c of M.CASES) tasks.push({ T, c });
    let i = 0;
    (function step() {
      if (my !== job) return;
      const t0 = performance.now();
      while (i < tasks.length && performance.now() - t0 < 30) {
        const { T, c } = tasks[i++];
        const glob = Object.assign({}, st.glob, { Tamb: T, RH: rhAt(T) });
        const o = Object.assign({}, st.per[c.key]); delete o.fanMode; delete o.sprayOpt; if (st.per[c.key].fanMode === 'auto') delete o.fanPct;
        if (st.per[c.key].sprayOpt) o.spray = st.per[c.key].sprayOpt === 'on';
        const p = M.caseParams(c.key, W(), Object.assign(glob, o, { nSeg: 8 }));
        const r = st.per[c.key].fanMode === 'manual' ? M.solve(p) : M.autoFan(p);
        data[c.key].out.push({ x: T, y: r.Tout }); data[c.key].pow.push({ x: T, y: r.airflow.powerElectric / 1000 });
      }
      if (i < tasks.length) return setTimeout(step, 0);
      const col = k => k === 's1' ? UI.css('--accent') : k === 'normal' ? UI.css('--bad') : C[k];
      const ds = k => M.CASES.map(c => ({ label: c.name, data: data[c.key][k], borderColor: col(c.key),
        borderWidth: c.key === st.c ? 3 : 1.6, pointRadius: c.key === st.c ? 2.5 : 0, pointBackgroundColor: col(c.key) }));
      const Ta = st.glob.Tamb !== undefined ? st.glob.Tamb : W().Tamb;
      const now = { label: 'This weather', data: [{ x: Ta, y: 0 }], borderColor: '#9aa5b1', borderDash: [3, 3], borderWidth: 1 };
      charts.out.data.datasets = [...ds('out'), { label: '65 °C setpoint', data: [{ x: -15, y: 65 }, { x: 40, y: 65 }], borderColor: UI.css('--ink'), borderDash: [4, 4], borderWidth: 1 }];
      const top = Math.max(...charts.out.data.datasets.flatMap(d => d.data.map(p => p.y)));
      charts.out.data.datasets.push(Object.assign({}, now, { data: [{ x: Ta, y: 0 }, { x: Ta, y: top }] }));
      charts.out.update();
      charts.pow.data.datasets = ds('pow');
      const ptop = Math.max(1, ...charts.pow.data.datasets.flatMap(d => d.data.map(p => p.y)));
      charts.pow.data.datasets.push(Object.assign({}, now, { data: [{ x: Ta, y: 0 }, { x: Ta, y: ptop }] }));
      charts.pow.update();
    })();
  }

  /* ---------------- main update ---------------- */
  let tmr = null, swTmr = null;
  function update() {
    syncButtons(); syncSliders();
    clearTimeout(tmr);
    tmr = setTimeout(() => {
      const res = M.CASES.map(c => ({ c, r: run(c.key, c.key === st.c ? 16 : 10) }));
      const sel = res.find(x => x.c.key === st.c).r, base = res.find(x => x.c.key === 'normal').r;
      renderCard(sel, base); renderTable(res);
      Scene3D.update(sel);
    }, 30);
    clearTimeout(swTmr);
    swTmr = setTimeout(sweep, 250);
  }

  /* ---------------- tab lifecycle ---------------- */
  let inited = false;
  UI.onTab(name => {
    const on = name === 'simulator';
    if (on && !inited) {
      inited = true;
      Scene3D.init(document.getElementById('viewer')); Scene3D.setTheme(UI.isDark());
      initCharts(); buildSliders(); update(true);
    }
    Scene3D.setRunning(on);
  });
  UI.onTheme(dark => {
    Scene3D.setTheme(dark);
    for (const ch of Object.values(charts)) {
      for (const ax of Object.values(ch.options.scales)) { ax.grid.color = UI.css('--line-2'); ax.ticks.color = UI.css('--ink-2'); ax.title.color = UI.css('--ink-2'); }
      ch.options.plugins.legend.labels.color = UI.css('--ink-2');
    }
    if (inited) sweep();
  });
  window.Simulator = { state: st, run };
})();
