// ==UserScript==
// @name         Agileday: Reported hours -rivi pysyy näkyvissä
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.2.0
// @description  Time reporting: Reported hours / Flex time -yhteenvetorivi kulkee Submit-palkin yläpuolella rullatessa
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-sticky-totals.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-sticky-totals.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROW = 'tr:has(> td[data-testid^="total-"])';
  const CLS = 'pj-sticky-totals';
  const VAR = '--pj-totals-bottom';
  const DEBUG = false;

  const health = pjHealth('agileday-sticky-totals', {
    checks: {
      'yhteenvetorivi (td[data-testid^="total-"])': () => !!document.querySelector(ROW),
      'Submit-palkki': () => !!findFooter(),
    },
  });

  const style = document.createElement('style');
  style.textContent = `
    tr.${CLS} > td {
      position: sticky;
      bottom: var(${VAR}, 0px);
      z-index: 3;
      background: var(--pj-totals-bg, #fff);
      box-shadow: inset 0 1px 0 rgba(0, 0, 0, .12);
    }
  `;
  document.head.appendChild(style);

  // Submit-napin sisältävä palkki: lähin sticky/fixed-esivanhempi.
  function findFooter() {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Submit');
    for (let el = btn; el && el !== document.body; el = el.parentElement) {
      const pos = getComputedStyle(el).position;
      if (pos === 'sticky' || pos === 'fixed') return el;
    }
    return null;
  }

  // Ensimmäinen läpinäkymätön tausta rivistä ylöspäin, jotta alle jäävät
  // rivit eivät kuulu läpi.
  function opaqueBg(el) {
    for (; el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return '#fff';
  }

  let footer = null;
  const ro = new ResizeObserver(() => updateOffset());

  function updateOffset() {
    let px = 0;
    if (footer && footer.isConnected) {
      const cs = getComputedStyle(footer);
      px = footer.offsetHeight + (parseFloat(cs.bottom) || 0);
    }
    document.documentElement.style.setProperty(VAR, px + 'px');
  }

  function run() {
    const row = document.querySelector(ROW);
    if (!row) return;
    if (!row.classList.contains(CLS)) {
      row.classList.add(CLS);
      document.documentElement.style.setProperty('--pj-totals-bg', opaqueBg(row));
      if (DEBUG) console.log('[pj-totals] rivi kiinnitetty', row);
    }
    const f = findFooter();
    if (f !== footer) {
      if (footer) ro.unobserve(footer);
      footer = f;
      if (footer) ro.observe(footer);
      if (DEBUG) console.log('[pj-totals] footer', footer);
    }
    updateOffset();
  }

  let timer = null;
  const safeRun = health.guard('päivitys', run);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(safeRun, 200); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  safeRun();
})();
