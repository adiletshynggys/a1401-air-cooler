/* plant.js — hourly plant data: load, clean (frozen + shutdown), plot, cleanliness factor. */
(function () {
  'use strict';
  const M = window.A1401, { fmt } = UI;
  const COLS = { Tin: '1400TIA050', Tout: '1400TICA0055_pv', fan: '1400TICA0055_mv', pv17: '1400PICA0017_mv', FI: '1400FI010' };
  const HOUR = 3600e3;
  let plant = null, wx = null, charts = {};

  /* ---------------- parsing ---------------- */
  function parseTime(s) {
    s = s.trim().replace(/^"|"$/g, '');
    let iso = s.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso += '+05:00';   // naive → Atyrau local (UTC+5)
    const t = Date.parse(iso);
    return isNaN(t) ? Date.parse(s) : t;
  }
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const delim = (lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length ? '\t'
      : (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const head = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(delim);
      const o = { t: parseTime(c[0]) };
      for (let j = 1; j < head.length; j++) { const v = parseFloat(c[j]); o[head[j]] = isNaN(v) ? null : v; }
      if (!isNaN(o.t)) rows.push(o);
    }
    rows.sort((a, b) => a.t - b.t);
    return { head, rows };
  }

  /* ---------------- cleaning (same rules as balance.py) ---------------- */
  function clean(parsed) {
    const miss = Object.values(COLS).filter(c => !parsed.head.includes(c));
    if (miss.length) throw new Error('Missing columns: ' + miss.join(', '));
    const rows = parsed.rows.map(r => ({ t: r.t, Tin: r[COLS.Tin], Tout: r[COLS.Tout], fan: r[COLS.fan], pv17: r[COLS.pv17], FI: r[COLS.FI] }));
    // frozen: Tin, Tout, FI all unchanged vs previous hour for ≥ 24 consecutive hours
    let run = 0, frozenIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i], b = rows[i - 1];
      const same = a.Tin === b.Tin && a.Tout === b.Tout && a.FI === b.FI;
      run = same ? run + 1 : 0;
      if (run >= 24 && frozenIdx < 0) { frozenIdx = i - 23; break; }
    }
    let frozenFrom = null, frozenCount = 0;
    let kept = rows;
    if (frozenIdx >= 0) {
      frozenFrom = rows[frozenIdx - 1 >= 0 ? frozenIdx - 1 : 0].t;
      // keep the very last row (live snapshot), as balance.py does
      kept = rows.slice(0, Math.max(0, frozenIdx - 1)).concat(rows.slice(-1));
      frozenCount = rows.length - kept.length;
    }
    const valid = kept.filter(r => r.FI !== null && r.Tin !== null && r.Tout !== null && r.FI >= 10000 && r.Tin >= 120);
    return { all: rows, valid, frozenFrom, frozenCount, shutdown: kept.length - valid.length };
  }

  /* ---------------- charts ---------------- */
  const tz = { timeZone: 'Asia/Almaty' };
  const dfmt = t => new Date(t).toLocaleDateString('en-GB', Object.assign({ year: '2-digit', month: 'short' }, tz));
  const dfull = t => new Date(t).toLocaleString('en-GB', Object.assign({ year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }, tz));

  const bandPlugin = {
    id: 'bands',
    beforeDatasetsDraw(chart, args, opts) {
      if (!opts.bands || !opts.bands.length) return;
      const { ctx, chartArea: a, scales: { x } } = chart;
      ctx.save(); ctx.fillStyle = 'rgba(179,38,30,0.13)';
      for (const [t0, t1] of opts.bands) {
        const x0 = Math.max(a.left, x.getPixelForValue(t0)), x1 = Math.min(a.right, x.getPixelForValue(t1));
        if (x1 > x0) ctx.fillRect(x0, a.top, Math.max(1, x1 - x0), a.bottom - a.top);
      }
      ctx.restore();
    },
  };

  function series(rows, k) {     // break the line across gaps > 3 h
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      if (i && rows[i].t - rows[i - 1].t > 3 * HOUR) out.push({ x: rows[i - 1].t + HOUR, y: null });
      out.push({ x: rows[i].t, y: rows[i][k] });
    }
    return out;
  }
  const xTime = () => ({ type: 'linear', ticks: { callback: v => dfmt(v), maxTicksLimit: 12 }, grid: { color: '#eef1f4' } });
  const tip = { callbacks: { title: it => it.length ? dfull(it[0].parsed.x) : '' } };

  function drawPlant() {
    const v = plant.valid, C = UI.SERIES;
    const bands = [];
    let s = null;
    for (const r of v) {
      if (r.fan >= 99) { if (!s) s = [r.t, r.t + HOUR]; else if (r.t - s[1] <= HOUR) s[1] = r.t + HOUR; else { bands.push(s); s = [r.t, r.t + HOUR]; } }
    }
    if (s) bands.push(s);
    const dec = { enabled: true, algorithm: 'lttb', samples: 900 };
    Object.values(charts).forEach(c => c.destroy()); charts = {};
    charts.ts = new Chart(document.getElementById('chTs'), {
      type: 'line', plugins: [bandPlugin],
      data: { datasets: [
        { label: 'A-1401 inlet, TIA050 (°C)', data: series(v, 'Tin'), borderColor: C[1], borderWidth: 1.2, yAxisID: 'y' },
        { label: 'A-1401 outlet, TICA0055 (°C)', data: series(v, 'Tout'), borderColor: C[0], borderWidth: 1.2, yAxisID: 'y' },
        { label: 'Fan output, TICA0055 MV (%)', data: series(v, 'fan'), borderColor: C[2], borderWidth: 1, yAxisID: 'y2' },
      ] },
      options: { parsing: false, normalized: true, spanGaps: false, interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: { x: xTime(), y: { title: { display: true, text: 'Temperature, °C' } }, y2: { position: 'right', min: 0, max: 105, title: { display: true, text: 'Fan output, %' }, grid: { display: false } } },
        plugins: { decimation: dec, bands: { bands }, tooltip: tip } },
    });
    charts.flow = new Chart(document.getElementById('chFlow'), {
      type: 'line',
      data: { datasets: [{ label: 'FI010, Nm³/h dry', data: series(v, 'FI'), borderColor: C[0], borderWidth: 1.2 }] },
      options: { parsing: false, normalized: true, interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: { x: xTime(), y: { title: { display: true, text: 'Nm³/h' } } }, plugins: { decimation: dec, tooltip: tip } },
    });

    const n = v.length, f99 = v.filter(r => r.fan >= 99).length, hot = v.filter(r => r.Tout > 65.5).length;
    const k = (l, val, u, d, hl) => `<div class="kpi${hl ? ' hl' : ''}"><div class="k">${l}</div><div class="v">${val} <small>${u}</small></div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
    document.getElementById('plantKpis').innerHTML = [
      k('Valid running hours', fmt(n, 0), 'h', `${dfmt(v[0].t)} – ${dfmt(v[n - 1].t)}`),
      k('Frozen data excluded', fmt(plant.frozenCount, 0), 'h', plant.frozenFrom ? `repeating values from ${dfull(plant.frozenFrom)}` : 'none detected'),
      k('Shutdown hours excluded', fmt(plant.shutdown, 0), 'h', 'FI010 < 10,000 or TIA050 < 120'),
      k('Fans at ≥ 99 %', fmt(100 * f99 / n, 1), '% of hours', `${fmt(f99, 0)} h with no cooling reserve`, true),
      k('Outlet above 65 °C setpoint', fmt(100 * hot / n, 1), '% of hours', `${fmt(hot, 0)} h`),
      k('Mean inlet / outlet', `${fmt(avg(v, 'Tin'), 0)} / ${fmt(avg(v, 'Tout'), 0)}`, '°C', 'design 137 / 60 °C'),
    ].join('');
    if (wx) computeCF();
  }
  const avg = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length;

  /* ---------------- cleanliness factor ---------------- */
  let cfJob = 0;
  function computeCF() {
    const job = ++cfJob;
    const note = document.getElementById('cfNote'), prog = document.getElementById('cfProg');
    const wmap = new Map(wx.map(r => [Math.round(r.t / HOUR), r.T]));
    const days = new Map();
    for (const r of plant.valid) {
      const T = wmap.get(Math.round(r.t / HOUR)); if (T === undefined || T === null) continue;
      const key = new Date(r.t).toLocaleDateString('en-CA', tz);
      const d = days.get(key) || { t: 0, n: 0, Tin: 0, Tout: 0, fan: 0, FI: 0, Ta: 0 };
      d.t += r.t; d.n++; d.Tin += r.Tin; d.Tout += r.Tout; d.fan += r.fan; d.FI += r.FI; d.Ta += T; days.set(key, d);
    }
    const list = [...days.values()].filter(d => d.n >= 12).map(d => ({ t: d.t / d.n, Tin: d.Tin / d.n, Tout: d.Tout / d.n, fan: d.fan / d.n, FI: d.FI / d.n, Ta: d.Ta / d.n }));
    if (!list.length) { note.textContent = 'No overlap between plant data and weather data (check timestamps).'; return; }
    prog.hidden = false;
    const out = [];
    let i = 0;
    (function step() {
      if (job !== cfJob) return;
      const t0 = performance.now();
      while (i < list.length && performance.now() - t0 < 40) {
        const d = list[i++];
        const cf = M.fitUAFactor({ Tin: d.Tin, Tout: d.Tout, flow: d.FI, fanPct: d.fan, Tamb: d.Ta, blockage: 0, Rf: 0, nSeg: 6 }, d.Tout);
        out.push({ x: d.t, y: cf, fan: d.fan, Ta: d.Ta });
      }
      prog.firstElementChild.style.width = (100 * i / list.length) + '%';
      if (i < list.length) return setTimeout(step, 0);
      prog.hidden = true;
      note.textContent = `${list.length} days. 1 = performs like the clean model; below 1 = fouled, or less air than assumed. Model: clean bundle, fan scaling 1.`;
      if (charts.cf) charts.cf.destroy();
      charts.cf = new Chart(document.getElementById('chCf'), {
        type: 'scatter',
        data: { datasets: [{ label: 'Daily cleanliness factor', data: out, backgroundColor: UI.SERIES[0], pointRadius: 2.5 }] },
        options: { scales: { x: xTime(), y: { min: 0, title: { display: true, text: 'UA actual / UA clean model' } } },
          plugins: { tooltip: { callbacks: { title: it => dfull(it[0].parsed.x), label: c => `CF ${fmt(c.parsed.y, 3)} · fans ${fmt(c.raw.fan, 0)} % · air ${fmt(c.raw.Ta, 1)} °C` } } } },
      });
    })();
  }

  /* ---------------- file handling ---------------- */
  function hook(dropId, inputId, onText) {
    const drop = document.getElementById(dropId), inp = document.getElementById(inputId);
    const read = f => { const fr = new FileReader(); fr.onload = () => onText(fr.result, f.name); fr.readAsText(f); };
    inp.addEventListener('change', () => inp.files[0] && read(inp.files[0]));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && read(e.dataTransfer.files[0]); });
  }
  function loadPlant(text, name) {
    const st = document.getElementById('plantStatus');
    try {
      plant = clean(parseCSV(text));
      if (!plant.valid.length) throw new Error('No valid running hours found.');
      document.getElementById('dropPlant').classList.add('loaded');
      st.textContent = `${name}: ${fmt(plant.all.length, 0)} rows, ${fmt(plant.valid.length, 0)} valid`;
      if (window.Chart) drawPlant();
    } catch (e) { st.textContent = 'Could not read ' + name + ': ' + e.message; }
  }
  function loadWx(text, name) {
    const st = document.getElementById('wxStatus');
    const p = parseCSV(text);
    const col = p.head.find(h => /t_?amb|temp|tair|^t$/i.test(h)) || p.head[1];
    wx = p.rows.map(r => ({ t: r.t, T: r[col] })).filter(r => r.T !== null);
    document.getElementById('dropWx').classList.add('loaded');
    st.textContent = `${name}: ${fmt(wx.length, 0)} hourly values (column "${col}")`;
    if (plant && window.Chart) computeCF();
    else document.getElementById('cfNote').textContent = 'Weather loaded. Load the plant CSV as well.';
  }
  hook('dropPlant', 'filePlant', loadPlant);
  hook('dropWx', 'fileWx', loadWx);


  window.Plant = { parseCSV, clean, load: loadPlant, loadWeather: loadWx };
})();
