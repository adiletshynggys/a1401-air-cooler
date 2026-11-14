/* ui.js — shared helpers: tab routing, assumption tooltips, number formatting, colour map. */
(function () {
  'use strict';
  const UI = {};

  /* ---------- formatting ---------- */
  UI.fmt = (v, d = 0) => (v === null || v === undefined || !isFinite(v)) ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  UI.esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Green "measured" tag with a tooltip naming the source. */
  UI.source = (label, txt) => `<span class="assume src" tabindex="0" data-tip="${UI.esc(txt)}">${UI.esc(label)}</span>`;

  /** "assumption" tag with a tooltip. `key` is a key of A1401.ASSUMPTIONS, or free text. */
  UI.assume = key => {
    const txt = (window.A1401 && A1401.ASSUMPTIONS[key]) || key;
    return `<span class="assume" tabindex="0" data-tip="${UI.esc(txt)}">assumption</span>`;
  };

  /* ---------- tooltip (one floating element for all tags) ---------- */
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(tip));
  function showTip(el) {
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 24);
    tip.style.maxWidth = w + 'px';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = Math.min(window.innerWidth - tw - 12, Math.max(12, r.left + r.width / 2 - tw / 2));
    let y = r.top - th - 8; if (y < 8) y = r.bottom + 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  ['mouseover', 'focusin'].forEach(ev => document.addEventListener(ev, e => {
    const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el);
  }));
  ['mouseout', 'focusout'].forEach(ev => document.addEventListener(ev, e => {
    if (e.target.closest && e.target.closest('[data-tip]')) hideTip();
  }));
  document.addEventListener('click', e => {           // touch: tap toggles
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) { e.preventDefault(); tip.hidden ? showTip(el) : hideTip(); } else hideTip();
  });
  window.addEventListener('scroll', hideTip, { passive: true });

  /* ---------- colour map (diverging blue → red, ColorBrewer RdYlBu reversed) ---------- */
  const STOPS = [[0x2c, 0x7b, 0xb6], [0xab, 0xd9, 0xe9], [0xff, 0xff, 0xbf], [0xfd, 0xae, 0x61], [0xd7, 0x19, 0x1c]];
  UI.cmap = t => {
    t = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(t)), f = t - i, a = STOPS[i], b = STOPS[i + 1];
    return [0, 1, 2].map(k => (a[k] + (b[k] - a[k]) * f) / 255);
  };
  UI.cmapCss = t => { const c = UI.cmap(t); return `rgb(${c.map(v => Math.round(v * 255)).join(',')})`; };

  /* ---------- tabs ---------- */
  const listeners = [];
  UI.onTab = fn => listeners.push(fn);
  function route() {
    const name = (location.hash || '#overview').slice(1).split('?')[0];
    const tabs = document.querySelectorAll('section.tab');
    let found = false;
    tabs.forEach(s => { const on = s.dataset.tab === name; s.hidden = !on; found = found || on; });
    if (!found) { document.getElementById('tab-overview').hidden = false; }
    const active = found ? name : 'overview';
    document.querySelectorAll('.tabs a').forEach(a => {
      const on = a.dataset.tab === active; a.classList.toggle('on', on); a.setAttribute('aria-selected', on);
    });
    listeners.forEach(fn => fn(active));
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', route);

  /* ---------- Chart.js defaults ---------- */
  UI.chartDefaults = () => {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = '#4a5663';
    Chart.defaults.borderColor = '#e6e9ee';
    Chart.defaults.animation = false;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.boxHeight = 2;
    Chart.defaults.elements.point.radius = 0;
    Chart.defaults.elements.line.borderWidth = 2;
  };
  UI.ACCENT = '#0b5cad';
  UI.GREY = '#8a96a3';
  UI.SERIES = ['#0b5cad', '#d9822b', '#2a9d8f', '#8e5bb5'];   // charts only (data series)

  window.UI = UI;
})();
