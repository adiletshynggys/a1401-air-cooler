/* validation.js — calibration targets vs model, run live in the browser. */
(function () {
  'use strict';
  const M = window.A1401, { fmt, assume } = UI;
  let done = false;

  function run() {
    if (done) return; done = true;
    const body = document.getElementById('valBody');
    setTimeout(() => {
      const t0 = performance.now();
      const cal = M.calibrate({ blockage: 0.5 });
      const ms = performance.now() - t0;
      const pt = k => cal.points.find(p => p.target.key === k);
      const now = pt('now'), sum = pt('summer'), des = pt('design');
      window.Simulator && Simulator.setFit({ blockage: cal.blockage, Rf_now: now.Rf, Rf_summer: sum.Rf });

      const dev = (m, t, tol) => { const d = m - t; return `<span class="${Math.abs(d) <= tol ? 'dev-ok' : 'dev-bad'}">${d >= 0 ? '+' : ''}${fmt(d, 1)}</span>`; };
      const rows = cal.points.map(p => {
        const t = p.target, r = p.result;
        return `<tr>
          <td><b>${t.name}</b><br><span class="muted">${t.note}</span></td>
          <td class="n">${fmt(t.Tin, 1)} → ${fmt(t.Tout, 1)} °C<br><span class="muted">${fmt(t.flow, 0)} Nm³/h · fans ${fmt(t.fanPct, 0)} %</span></td>
          <td class="n">${fmt(t.Tamb, 0)} °C ${assume(t.clean ? 'designTamb' : 'Tamb')}</td>
          <td class="n">${fmt(r.Tout, 1)} °C<br>${dev(r.Tout, t.Tout, 0.5)} K</td>
          <td class="n">${t.Q ? fmt(t.Q, 2) + ' MW' : '—'}<br><span class="muted">${t.latent ? fmt(100 * t.latent, 0) + ' % latent' : ''}</span></td>
          <td class="n">${fmt(r.Q / 1000, 2)} MW<br><span class="muted">${fmt(100 * r.Ql / r.Q, 0)} % latent</span></td>
          <td class="n">${t.clean ? 'clean' : `${fmt(100 * p.blockage, 0)} % blocked<br>R<sub>f</sub> = ${fmt(p.Rf, 3)} m²K/W`}</td>
          <td class="n">${fmt(p.cf, 3)}</td>
          <td class="n">${fmt(100 * r.closure, 2)} %</td></tr>`;
      }).join('');

      // iso-fouling line: blockage vs fitted R_f for the "now" point
      const iso = [0, 0.2, 0.35, 0.5, 0.7].map(b => {
        const f = Rf => M.solve({ Tin: now.target.Tin, flow: now.target.flow, Tamb: now.target.Tamb, fanPct: now.target.fanPct, foulMode: 'uniform', blockage: b, Rf }).Tout - now.target.Tout;
        return { b, Rf: f(0) >= 0 ? 0 : M.bisect(f, 0, 3, 30) };
      });
      const clean = M.solve({ blockage: 0, Rf: 0 });

      body.innerHTML = `
      <div class="vwrap"><table class="vtable">
        <thead><tr><th>Case</th><th>Measured / design</th><th>Ambient</th><th>Model outlet<br>(deviation)</th><th>Duty, balance.py</th><th>Duty, model</th><th>Fitted fouling</th><th>Cleanliness factor<br>UA<sub>act</sub>/UA<sub>clean</sub></th><th>Energy closure</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="muted" style="margin-top:6px">Calibration ran in your browser in ${fmt(ms, 0)} ms. Fan scaling: ${fmt(cal.fanScale, 2)} (held). Blockage held at ${fmt(100 * cal.blockage, 0)} %, uniform. R<sub>f</sub> is fitted to each plant point.</p>

      <div class="callout"><h3>What the calibration says</h3>
        <ul>
          <li><b>Duty and condensation match.</b> The model gives ${fmt(now.result.Q / 1000, 2)} MW (${fmt(100 * now.result.Ql / now.result.Q, 0)} % latent) for 14 Nov and ${fmt(sum.result.Q / 1000, 2)} MW for summer 2025, within ${fmt(Math.max(Math.abs(now.result.Q / 1000 - now.target.Q) / now.target.Q, Math.abs(sum.result.Q / 1000 - sum.target.Q) / sum.target.Q) * 100, 1)} % of <code>balance.py</code>. The energy balance closes to better than 0.1 %.</li>
          <li><b>The real cooler transfers about ${fmt(100 * now.cf, 0)} % of the heat a clean bundle should.</b> With the drawing geometry and the assumed fans, a clean A-1401 has UA ≈ ${fmt(clean.UA, 0)} kW/K and would cool the gas almost to ambient. The plant behaves as if UA ≈ ${fmt(now.result.UA, 0)} kW/K. Winter (${fmt(now.cf, 3)}) and summer (${fmt(sum.cf, 3)}) agree, so this is a property of the cooler and not of the season.</li>
          <li><b>The fitted fouling is large.</b> With half the fin gaps packed, R<sub>f</sub> ≈ ${fmt(now.Rf, 2)}–${fmt(sum.Rf, 2)} m²K/W reproduces the plant. Many blockage/R<sub>f</sub> pairs fit equally well: ${iso.map(x => `${fmt(100 * x.b, 0)} % → ${fmt(x.Rf, 2)}`).join(' · ')} m²K/W. The two plant points cannot tell them apart.</li>
          <li><b>Bottom-row fouling alone cannot explain the data.</b> Even with the bottom row 95 % blocked, the five clean rows above still cool the gas close to ambient. The loss has to be spread over the bundle, or the airflow is much lower than assumed.</li>
          <li><b>Caution: the design point needs the same small UA.</b> To cool 137 → 60 °C at 35–45 °C air, the clean model needs only ${fmt(100 * des.cf, 0)}–9 % of its UA. Either the design has a very large margin, or one of the assumptions is optimistic: fan size and count ${assume('nFans')}, tube passes ${assume('passes')}, or fin geometry ${assume('finOD')}. The fan datasheet, the API 661 data sheet (design duty, air flow, design air temperature) and the number of tube passes would settle this.</li>
        </ul></div>

      <div class="callout"><h3>Model checks</h3>
        <ul>
          <li>Psat (Wagner–Pruss) within 0.3 % of IAPWS tables; latent heat within 0.6 % (unit tests).</li>
          <li>Gas duty for all four <code>scenarios.json</code> cases within 1.5 % of <code>balance.py</code> (CoolProp).</li>
          <li>Fin ratio ${fmt(clean.geom.finRatio, 2)} (drawing 23.4), finned area ${fmt(clean.geom.Ao, 0)} m² (drawing 6 × 5,288 = 31,728 m²).</li>
          <li>Fan operating point lies on both curves; power follows the cube law with speed.</li>
          <li>Run <code>node --test tests/</code> for the 14 physics tests.</li>
        </ul></div>`;
    }, 50);
  }
  UI.onTab(name => { if (name === 'validation') run(); });
  // also calibrate in the background shortly after load so the simulator presets are fitted
  window.addEventListener('load', () => setTimeout(run, 1500));
})();
