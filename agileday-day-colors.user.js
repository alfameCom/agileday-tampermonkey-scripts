// ==UserScript==
// @name         Agileday: kuluva päivä, tuntivärit ja tulevat päivät
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.2.0
// @description  Time reporting: korostaa kuluvan päivän sarakkeen, värittää Reported hours- ja Flex time -arvot ja himmentää tulevat päivät
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-day-colors.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-day-colors.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Yhteenvetorivin päiväsolut: data-testid="total-2026-10-07". Sarakkeet ovat
  // linjassa cellIndexillä kaikilla taulukon riveillä (otsikko mukaan lukien).
  const TOTAL = 'td[data-testid^="total-"]';
  const TODAY = 'pj-today';
  const FUTURE = 'pj-future';
  const PAST = 'pj-past';
  const TINT = '--pj-day-tint';
  const COLORED = 'data-pj-colored';
  const ACCENT = '37, 99, 235';
  const DEBUG = false;

  const health = pjHealth('agileday-day-colors', {
    checks: {
      'päiväsarakkeet (td[data-testid="total-YYYY-MM-DD"])': () =>
        [...document.querySelectorAll(TOTAL)].some((td) => /\d{4}-\d{2}-\d{2}$/.test(td.dataset.testid)),
      'Reported hours- ja Flex time -arvot yhteenvetosolussa': () => {
        const td = document.querySelector(TOTAL);
        return td ? (td.firstElementChild?.children.length ?? 0) >= 2 : null;
      },
    },
  });

  const style = document.createElement('style');
  style.textContent = `
    tr > td.${TODAY}, tr > th.${TODAY} {
      background-image:
        linear-gradient(rgba(${ACCENT}, .07), rgba(${ACCENT}, .07)) !important;
    }
    tr > th.${TODAY}, tr > th.${TODAY} * { color: rgb(${ACCENT}) !important; }
    tr > th.${TODAY} { font-weight: 700; }
    tr > td.${PAST}, tr > th.${PAST} {
      background-image:
        linear-gradient(var(${TINT}), var(${TINT})) !important;
    }
    tr > td.${FUTURE}, tr > th.${FUTURE} {
      background-image: repeating-linear-gradient(-45deg,
        rgba(0, 0, 0, .035) 0 6px, transparent 6px 12px) !important;
    }
    tr > td.${FUTURE} > *, tr > th.${FUTURE} > * {
      opacity: .45;
      transition: opacity .15s;
    }
    tr > td.${FUTURE}:hover > *, tr > td.${FUTURE}:focus-within > * { opacity: 1; }
  `;
  document.head.appendChild(style);

  function isoDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // "7:30" → 450, "-7:30" → -450, "-" → 0, muu → null.
  function minutes(text) {
    const t = text.trim();
    if (t === '-') return 0;
    const m = t.match(/^([+-]?)(\d+):(\d{2})/);
    if (!m) return null;
    const v = Number(m[2]) * 60 + Number(m[3]);
    return m[1] === '-' ? -v : v;
  }

  function paint(el, color) {
    if (!el) return;
    if (color) {
      el.style.color = color;
      el.style.fontWeight = '600';
      el.setAttribute(COLORED, '');
    } else if (el.hasAttribute(COLORED)) {
      el.style.color = '';
      el.style.fontWeight = '';
      el.removeAttribute(COLORED);
    }
  }

  // Päivän täyttöaste liukuvärin sävynä (0 punainen – 120 vihreä) tai null.
  // Tavoite päätellään erotuksesta reported − flex, joten viikonloput ja
  // vapaapäivät (flex "-") jäävät värittämättä. Tekstit väritetään vain
  // kuluvalle päivälle; menneillä tila näkyy sarakkeen taustavärinä.
  function colorTotals(td, state) {
    const lines = td.firstElementChild?.children;
    if (!lines || lines.length < 2) return null;
    const [reportedEl, flexEl] = lines;
    const reported = minutes(reportedEl.textContent);
    const flex = minutes(flexEl.textContent);
    const hasTarget = flexEl.textContent.trim() !== '-';

    let hue = null;
    let rColor = null;
    let fColor = null;
    if (state !== 'future' && hasTarget && reported !== null && flex !== null) {
      const target = reported - flex;
      if (target > 0) {
        const ratio = Math.max(0, Math.min(1, reported / target));
        hue = Math.round(ratio * 120);
        if (state === 'today') rColor = `hsl(${hue}, 70%, 36%)`;
      }
      if (state === 'today' && flex < 0) fColor = 'hsl(0, 70%, 42%)';
      else if (state === 'today' && flex > 0) fColor = 'hsl(120, 60%, 32%)';
    }
    paint(reportedEl, rColor);
    paint(flexEl, fColor);
    return hue;
  }

  function run() {
    const totals = [...document.querySelectorAll(TOTAL)];
    if (!totals.length) return;
    const table = totals[0].closest('table');
    if (!table) return;
    const today = isoDate(new Date());

    // cellIndex → { state: 'today' | 'future' | 'past', tint }
    const cols = new Map();
    for (const td of totals) {
      const m = td.dataset.testid.match(/(\d{4}-\d{2}-\d{2})$/);
      if (!m) continue;
      const state = m[1] === today ? 'today' : m[1] > today ? 'future' : 'past';
      const hue = colorTotals(td, state);
      // Menneet arkipäivät saavat liukuvärin haaleana taustana; kuluva päivä
      // pysyy sinisenä.
      const tint = state === 'past' && hue !== null ? `hsla(${hue}, 75%, 45%, .10)` : null;
      cols.set(td.cellIndex, { state, tint });
    }

    for (const row of table.rows) {
      for (const cell of row.cells) {
        const { state, tint } = cols.get(cell.cellIndex) ?? {};
        cell.classList.toggle(TODAY, state === 'today');
        cell.classList.toggle(FUTURE, state === 'future');
        cell.classList.toggle(PAST, !!tint);
        if (tint) {
          if (cell.style.getPropertyValue(TINT) !== tint) cell.style.setProperty(TINT, tint);
        } else if (cell.style.getPropertyValue(TINT)) {
          cell.style.removeProperty(TINT);
        }
      }
    }
    if (DEBUG) console.log('[pj-days]', today, Object.fromEntries(cols));
  }

  let timer = null;
  const safeRun = health.guard('päivitys', run);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(safeRun, 100); };
  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true, characterData: true,
  });
  // Päivä vaihtuu, vaikka sivu olisi auki yön yli.
  setInterval(safeRun, 60 * 1000);
  safeRun();
})();
