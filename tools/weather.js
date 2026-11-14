/* Build data/weather_uatg.csv (hourly ambient, Atyrau airport UATG) from METAR
 * observations archived by Iowa Environmental Mesonet, and print the ambient
 * temperature for each calibration scenario.
 *
 *   node tools/weather.js            download + process
 *   node tools/weather.js raw.csv    process an already downloaded file
 *
 * Source: https://mesonet.agron.iastate.edu/request/download.phtml (station UATG)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const URL = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=UATG&data=tmpf' +
  '&year1=2023&month1=11&day1=1&year2=2026&month2=11&day2=15&tz=Etc/UTC&format=onlycomma' +
  '&latlon=no&missing=M&trace=T&direct=no&report_type=3';
const HOUR = 3600e3;
const OUT = path.join(__dirname, '..', 'data', 'weather_uatg.csv');

const local = t => new Date(t).toLocaleString('sv-SE', { timeZone: 'Asia/Almaty' }); // "YYYY-MM-DD HH:mm:ss"

function toHourly(text) {
  // METAR (every 30 min, sometimes specials) -> hourly mean, gaps up to 3 h interpolated
  const sums = new Map();
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [, valid, tmpf] = line.split(',');
    if (!tmpf || tmpf === 'M') continue;
    const t = Date.parse(valid.replace(' ', 'T') + 'Z');
    const k = Math.floor(t / HOUR);
    const s = sums.get(k) || [0, 0];
    s[0] += (parseFloat(tmpf) - 32) * 5 / 9; s[1]++;
    sums.set(k, s);
  }
  const keys = [...sums.keys()].sort((a, b) => a - b);
  const rows = [];
  for (let k = keys[0], prev = null; k <= keys[keys.length - 1]; k++) {
    const s = sums.get(k);
    if (s) {
      const T = s[0] / s[1];
      if (prev && k - prev.k > 1 && k - prev.k <= 4)
        for (let j = prev.k + 1; j < k; j++) rows.push({ k: j, T: prev.T + (T - prev.T) * (j - prev.k) / (k - prev.k) });
      rows.push({ k, T }); prev = { k, T };
    }
  }
  return rows.map(r => ({ t: r.k * HOUR, T: Math.round(r.T * 10) / 10 }));
}

function mean(rows, from, to) {
  const sel = rows.filter(r => { const l = local(r.t).slice(0, 10); return l >= from && l <= to; });
  return { mean: sel.reduce((a, r) => a + r.T, 0) / sel.length, n: sel.length, sel };
}

async function main() {
  const text = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : await (await fetch(URL)).text();
  const rows = toHourly(text);
  const csv = 'timestamp,T_amb\n' + rows.map(r => new Date(r.t).toISOString().slice(0, 16) + 'Z,' + r.T.toFixed(1)).join('\n') + '\n';
  fs.writeFileSync(OUT, csv);
  const span = (rows[rows.length - 1].t - rows[0].t) / HOUR + 1;
  console.log(`hourly values ${rows.length} of ${span} (${(100 * rows.length / span).toFixed(1)} %), ${local(rows[0].t)} .. ${local(rows[rows.length - 1].t)}`);

  const w = mean(rows, '2024-12-01', '2025-02-28'), s = mean(rows, '2025-06-01', '2025-08-31');
  console.log(`winter Dec24-Feb25 mean ${w.mean.toFixed(1)} C (${w.n} h)`);
  console.log(`summer Jun-Aug25  mean ${s.mean.toFixed(1)} C (${s.n} h)`);
  const now = rows.filter(r => local(r.t).startsWith('2026-11-14')).map(r => `${local(r.t).slice(11, 16)} ${r.T}`);
  console.log('14 Nov 2026 (Asia/Almaty):', now.join(' | '));
  const jja = rows.filter(r => ['06', '07', '08'].includes(local(r.t).slice(5, 7))).map(r => r.T).sort((a, b) => a - b);
  const q = p => jja[Math.floor(p * (jja.length - 1))];
  console.log(`all Jun-Aug hours: 1 % exceedance ${q(0.99)} C, 0.4 % ${q(0.996)} C, max ${jja[jja.length - 1]} C`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
