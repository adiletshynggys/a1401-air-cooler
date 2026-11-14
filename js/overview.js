/* overview.js — animated process flow diagram of the cooling train with live readouts. */
(function () {
  'use strict';
  const S = window.SCENARIOS;
  const { fmt, assume } = UI;
  const svg = document.getElementById('flowSvg');
  const P_IN = 2.739, P_OUT = 2.705;     // MPa abs, from balance.py (26.90 / 26.55 kgf/cm² g)

  // ---------- static drawing ----------
  const Y1 = 150, Y2 = 430;
  const shell = (x, y, w, tag, desc, hl) => `
    <g><rect class="eq${hl ? ' hl' : ''}" x="${x}" y="${y - 17}" width="${w}" height="34" rx="17"/>
    <line x1="${x + 16}" y1="${y - 17}" x2="${x + 16}" y2="${y + 17}" stroke="#4a5663" stroke-width="1"/>
    <line x1="${x + w - 16}" y1="${y - 17}" x2="${x + w - 16}" y2="${y + 17}" stroke="#4a5663" stroke-width="1"/>
    <text class="tagname" x="${x + w / 2}" y="${y + 36}" text-anchor="middle">${tag}</text>
    <text class="desc" x="${x + w / 2}" y="${y + 50}" text-anchor="middle">${desc}</text></g>`;

  const pipes = {
    p1: `M98 ${Y1} H230`, p2: `M300 ${Y1} H420`, p3: `M490 ${Y1} H610`, p4: `M680 ${Y1} H820`,
    p5: `M1020 ${Y1} H1120 V${Y2} H1070`, p6: `M1000 ${Y2} H870`, p7: `M800 ${Y2} H640`,
    pGas: `M600 360 V330 H360 V${Y2} H310`, pFlare: `M360 330 V272`,
    pLiq: `M600 500 V530 H470`,
  };
  const pipeKeys = Object.keys(pipes);

  svg.innerHTML = `
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#4a5663"/></marker>
  </defs>
  ${pipeKeys.map(k => `<path class="pipe" d="${pipes[k]}"/>`).join('')}
  ${pipeKeys.map(k => `<path class="pipe-flow${k === 'pLiq' ? ' liq' : k === 'pFlare' ? ' flare' : ''}" id="f-${k}" d="${pipes[k]}"/>`).join('')}

  <!-- R-1405 -->
  <g><rect class="eq" x="48" y="${Y1 - 80}" width="50" height="160" rx="22"/>
  <text class="tagname" x="73" y="${Y1 + 100}" text-anchor="middle">R-1405</text>
  <text class="desc" x="73" y="${Y1 + 114}" text-anchor="middle">CO shift</text></g>
  ${shell(230, Y1, 70, 'E-1406', 'waste heat boiler')}
  ${shell(420, Y1, 70, 'E-1407', 'BFW preheater')}
  ${shell(610, Y1, 70, 'E-1408', 'demin / condensate preheater')}

  <!-- A-1401 air cooler -->
  <g id="eqA1401">
    <rect class="eq hl" x="820" y="${Y1 - 30}" width="200" height="40" rx="3"/>
    ${[0, 1, 2, 3, 4, 5].map(i => `<line x1="828" x2="1012" y1="${Y1 - 24 + i * 6}" y2="${Y1 - 24 + i * 6}" stroke="#0b5cad" stroke-width="1" opacity=".55"/>`).join('')}
    <path d="M830 ${Y1 + 10} L860 ${Y1 + 40} H980 L1010 ${Y1 + 10}" fill="none" stroke="#4a5663" stroke-width="1.2"/>
    ${[880, 960].map(x => `<g transform="translate(${x} ${Y1 + 52})"><ellipse rx="26" ry="6" fill="#fff" stroke="#4a5663"/>
      <g class="fanspin"><line x1="-22" x2="22" y1="0" y2="0" stroke="#0b5cad" stroke-width="2.5"/></g></g>`).join('')}
    <text class="tagname" x="920" y="${Y1 - 42}" text-anchor="middle">A-1401  air cooler</text>
    <text class="desc" x="920" y="${Y1 + 80}" text-anchor="middle">3 sections · 6 bundles · forced draft</text>
    <text class="desc" id="a1401duty" x="920" y="${Y1 + 94}" text-anchor="middle"></text>
  </g>

  ${shell(1000, Y2, 70, 'E-1409', 'demin preheater')}
  ${shell(800, Y2, 70, 'E-1410', 'cooling water trim')}

  <!-- D-1403 -->
  <g><rect class="eq" x="575" y="360" width="50" height="140" rx="22"/>
  <line x1="580" y1="470" x2="620" y2="470" stroke="#2f8fd8" stroke-width="1.2"/>
  <text class="tagname" x="655" y="${Y2 + 58}">D-1403</text>
  <text class="desc" x="655" y="${Y2 + 72}">separator</text></g>

  <!-- PV0017 valve + flare -->
  <g transform="translate(360 302)"><path d="M-9 -8 L9 8 M-9 8 L9 -8" stroke="#4a5663" stroke-width="2"/></g>
  <g><path d="M352 272 L360 236 L368 272 Z" class="eq"/><path d="M360 232 q-8 -12 0 -24 q8 13 0 24" fill="#e9a36b" stroke="#c0603a"/>
  <text class="tagname" x="380" y="252">Flare</text><text class="desc" x="380" y="266">via PV0017 (Y), not metered</text></g>

  <!-- PSA -->
  <g><rect class="eq" x="190" y="${Y2 - 34}" width="120" height="68" rx="4"/>
  <text class="tagname" x="250" y="${Y2 - 4}" text-anchor="middle">PSA M-1405</text>
  <text class="desc" x="250" y="${Y2 + 12}" text-anchor="middle">hydrogen purification</text></g>
  <text class="desc" x="318" y="${Y2 - 10}">FI010 (X)</text>

  <!-- condensate -->
  <path d="M470 530 H440" stroke="#2f8fd8" stroke-width="2" marker-end="url(#arr)"/>
  <text class="tagname" x="340" y="534">Condensate Z</text>
  <text class="desc" x="340" y="548">FT0027</text>

  <g id="readouts"></g>`;

  // ---------- readout boxes ----------
  const RO = [
    { id: 'r1', x: 164, y: Y1 - 72, tag: 'R-1405 outlet' },
    { id: 'r2', x: 360, y: Y1 - 72, tag: 'E-1406 outlet' },
    { id: 'r3', x: 550, y: Y1 - 72, tag: 'E-1407 out · TIA026' },
    { id: 'r4', x: 750, y: Y1 - 72, tag: 'E-1408 out · TIA050' },
    { id: 'r5', x: 1120, y: 270, tag: 'A-1401 out · TICA0055' },
    { id: 'r6', x: 935, y: Y2 - 74, tag: 'E-1409 outlet' },
    { id: 'r7', x: 735, y: Y2 - 74, tag: 'E-1410 outlet' },
    { id: 'r8', x: 600, y: 330 - 60, tag: 'D-1403 · PICA0017', anchorX: 690 },
    { id: 'r9', x: 250, y: Y2 + 56, tag: 'to PSA · FI010' },
  ];
  const roG = svg.querySelector('#readouts');
  roG.innerHTML = RO.map(r => {
    const x = (r.anchorX || r.x) - 62, y = r.y;
    return `<g class="ro" id="${r.id}" transform="translate(${x} ${y})">
      <rect width="124" height="52" rx="5"/>
      <text class="t" x="8" y="18"></text>
      <text class="s" x="8" y="32"></text>
      <text class="tagr" x="8" y="45">${r.tag}</text></g>`;
  }).join('');

  function setRO(id, t, s, warn) {
    const g = svg.querySelector('#' + id);
    g.querySelector('.t').textContent = t;
    g.querySelector('.s').textContent = s;
    g.classList.toggle('warn', !!warn);
  }

  // ---------- update for a scenario ----------
  function render(i) {
    const s = S[i];
    const design = i === 0;
    const wetIn = s.X + s.vap_in, wetOut = s.X + s.vap_out;
    const kg = v => fmt(v, 0) + ' kg/h';
    setRO('r1', '429 °C', kg(wetIn) + ' wet');
    setRO('r2', '282 °C', kg(wetIn) + ' wet');
    setRO('r3', (design ? '157' : '~165') + ' °C', design ? 'design' : 'design 157 °C', !design);
    setRO('r4', fmt(s.Tin, 0) + ' °C', P_IN.toFixed(2) + ' MPa · ' + kg(wetIn), s.Tin > 142);
    setRO('r5', fmt(s.Tout, 1) + ' °C', P_OUT.toFixed(2) + ' MPa · setpoint 65', s.Tout > 65.5);
    setRO('r6', '≈50 °C', 'design, not metered');
    setRO('r7', '38 °C', 'cooling water trim');
    setRO('r8', '2.56 MPa', '38 °C · ' + kg(s.X + s.vap_out - s.Z_downstream) + ' gas');
    setRO('r9', fmt(s.FI, 0) + ' Nm³/h', 'X = ' + kg(s.X) + ' dry');

    // flow animation speed ∝ mass flow
    const ref = 16000;
    const dur = f => Math.max(0.5, Math.min(4, 1.6 * ref / Math.max(f, 1))) + 's';
    const set = (k, f) => { const el = svg.querySelector('#f-' + k); el.style.setProperty('--dur', dur(f)); };
    ['p1', 'p2', 'p3', 'p4'].forEach(k => set(k, wetIn));
    ['p5', 'p6', 'p7'].forEach(k => set(k, wetOut + s.Z));
    set('pGas', s.X); set('pLiq', (s.Z + s.Z_downstream) * 3);
    const flare = svg.querySelector('#f-pFlare');
    flare.style.opacity = s.pv17_open > 1 ? 1 : 0.15;
    set('pFlare', 6000);

    svg.querySelector('#a1401duty').textContent =
      `duty ${fmt(s.Q, 2)} MW · ${fmt(100 * s.Qlat / s.Q, 0)} % latent` + (s.fan !== null ? ` · fans ${fmt(s.fan, 0)} %` : '');
    const spin = svg.querySelectorAll('.fanspin');
    spin.forEach(g => {
      const dur = s.fan === null ? 1.2 : Math.max(0.25, 1.2 * 90 / Math.max(10, s.fan));
      g.style.animation = `spin ${dur}s linear infinite`;
    });

    document.getElementById('scenNote').textContent = s.note + (s.hours ? ` · ${fmt(s.hours, 0)} h of data` : '');

    const k = (label, v, unit, d, hl) => `<div class="kpi${hl ? ' hl' : ''}"><div class="k">${label}</div><div class="v">${v} <small>${unit}</small></div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
    document.getElementById('ovKpis').innerHTML = [
      k('A-1401 heat load', fmt(s.Q, 2), 'MW', `${fmt(s.Qlat, 2)} MW latent + ${fmt(s.Qsens, 2)} MW sensible`, true),
      k('Water vapour entering A-1401', fmt(s.vap_in, 0), 'kg/h', `saturated at ${fmt(s.Tin, 0)} °C, ${P_IN} MPa`),
      k('Z, condensed in A-1401', fmt(s.Z, 0), 'kg/h', `+ ${fmt(s.Z_downstream, 0)} kg/h in E-1409/E-1410`),
      k('X, dry syngas to PSA', fmt(s.X, 0), 'kg/h', `FI010 = ${fmt(s.FI, 0)} Nm³/h dry`),
      k('Y, gas to flare', 'n/m', '', s.hours ? `not metered; PV0017 open ${fmt(s.pv17_open, 1)} % of hours` : 'not metered'),
      k('A-1401 fans', s.fan === null ? '—' : fmt(s.fan, 0), s.fan === null ? '' : '%',
        s.fan === null ? 'design case' : `at ≥ 99 % for ${fmt(s.fan100, 0)} % of hours`),
    ].join('');

    const dQ = S[3].Q / S[0].Q;
    document.getElementById('ovFoot').innerHTML =
      `Same flow, two inlet temperatures: at 137 °C (design) A-1401 must remove ${fmt(S[0].Q, 1)} MW, at 167 °C (now) ${fmt(S[3].Q, 1)} MW, ${fmt(dQ, 1)} times more, because the extra water vapour has to condense. ` +
      `Gas is assumed saturated with water at the A-1401 inlet (the P&ID marks the line two-phase) ${assume('Saturation at the A-1401 inlet is assumed in balance.py. Upstream flows use the same water content; liquid formed upstream in the design case is not shown.')}. ` +
      `Pressures upstream of E-1408 are not in the files and are not shown. Source: <code>scenarios.json</code> from <code>balance.py</code>.`;

    document.querySelectorAll('.scen button').forEach(b => b.classList.toggle('on', +b.dataset.scen === i));
  }

  // fan spin keyframes (SVG transform)
  const st = document.createElement('style');
  st.textContent = '@keyframes spin{from{transform:scaleX(1)}50%{transform:scaleX(-1)}to{transform:scaleX(1)}}' +
    '@media (prefers-reduced-motion: reduce){.fanspin{animation:none!important}}';
  document.head.appendChild(st);

  document.querySelectorAll('.scen button').forEach(b => b.addEventListener('click', () => render(+b.dataset.scen)));
  render(3);
})();
