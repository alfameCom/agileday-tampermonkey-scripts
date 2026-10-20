// ==UserScript==
// @name         Agileday: UNPLANNED-projektit lukkoon
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.1.1
// @description  Time reporting: projekteihin, joilla ei ole allokaatiota (UNPLANNED), ei voi kirjata tunteja eikä lisätä taskeja
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-lock-unplanned.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-lock-unplanned.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PROJECT = 'tr[data-testid="project-row"]';
  const ROW = 'tr[data-testid="task-row"]';
  const INPUT = 'input[data-testid^="input-"]';
  // Isot kirjaimet tulevat CSS:stä, DOMissa teksti voi olla "Unplanned".
  const CHIP_TEXT = /^unplanned$/i;
  // Omat merkinnät: lukittu projektirivi ja kenttä, jonka skripti teki vain luettavaksi.
  const A_PROJECT = 'data-pj-unplanned';
  const A_INPUT = 'data-pj-unplanned-lock';
  const TIP = 'Projektilla ei ole allokaatiota (UNPLANNED). Tunteja ei voi kirjata, koska ne '
    + 'sotkisivat laskutuksen. Pyydä allokaatio projektipäälliköltä.';
  const DEBUG = false;

  const health = pjHealth('agileday-lock-unplanned', {
    checks: {
      'projektirivit (tr[data-testid="project-row"])': () =>
        pjHealth.tableHasInputs() ? !!document.querySelector(PROJECT) : null,
    },
  });

  const style = document.createElement('style');
  style.textContent = `
    ${ROW}[${A_PROJECT}] td:has(input[${A_INPUT}]) {
      background-image: repeating-linear-gradient(-45deg,
        rgba(0, 0, 0, .05) 0 6px, transparent 6px 12px) !important;
    }
    input[${A_INPUT}] { cursor: not-allowed; color: rgba(0, 0, 0, .45) !important; }
    ${ROW}[${A_PROJECT}] td:has(input[${A_INPUT}]) .MuiOutlinedInput-root { background: rgba(0, 0, 0, .03); }
    ${PROJECT}[${A_PROJECT}] .pj-unplanned-addtask { opacity: .4; cursor: not-allowed; }
    .pj-unplanned-chip { background: rgb(254, 226, 226) !important; color: rgb(153, 27, 27) !important; }
    .pj-unplanned-toast {
      position: fixed; top: 16px; left: 50%; z-index: 2147483647;
      transform: translate(-50%, -8px); opacity: 0;
      max-width: min(560px, 90vw); padding: 10px 14px;
      background: #1f1f24; color: #fff; border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, .25);
      font: 14px/1.4 system-ui, sans-serif;
      transition: opacity .15s, transform .15s; pointer-events: none;
    }
    .pj-unplanned-toast.pj-show { opacity: 1; transform: translate(-50%, 0); }
  `;
  document.head.appendChild(style);

  let toast = null;
  let toastTimer = null;
  function showToast(text) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'pj-unplanned-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('pj-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('pj-show'), 3500);
  }

  // Siru: projektirivin ensimmäisen solun lehtielementti, jonka teksti on unplanned.
  function findChip(pr) {
    for (const el of pr.cells[0]?.querySelectorAll('*') || []) {
      if (!el.children.length && CHIP_TEXT.test(el.textContent.trim())) {
        return el.closest('.MuiChip-root') || el;
      }
    }
    return null;
  }

  const addTaskButton = (pr) =>
    [...pr.querySelectorAll('button')].find((b) => /^add task$/i.test(b.textContent.trim()));

  function run() {
    const keep = new Set();
    let locked = false;
    for (const tr of document.querySelectorAll(`${PROJECT}, ${ROW}`)) {
      if (tr.matches(PROJECT)) {
        const chip = findChip(tr);
        locked = !!chip;
        if (!locked) continue;
        keep.add(tr);
        if (!tr.hasAttribute(A_PROJECT)) tr.setAttribute(A_PROJECT, '');
        chip.classList.add('pj-unplanned-chip');
        if (chip.title !== TIP) chip.title = TIP;
        const add = addTaskButton(tr);
        if (add) {
          add.classList.add('pj-unplanned-addtask');
          if (add.title !== TIP) add.title = TIP;
        }
        continue;
      }
      if (!locked) continue;
      keep.add(tr);
      if (!tr.hasAttribute(A_PROJECT)) tr.setAttribute(A_PROJECT, '');
      for (const input of tr.querySelectorAll(INPUT)) {
        // Agiledayn omat lukitukset (esim. edellinen kuukausi) jäävät sen hoidettaviksi.
        if (input.readOnly && !input.hasAttribute(A_INPUT)) continue;
        if (!input.readOnly) input.readOnly = true;
        if (!input.hasAttribute(A_INPUT)) input.setAttribute(A_INPUT, '');
        if (input.title !== TIP) input.title = TIP;
        keep.add(input);
      }
    }

    // Projekti sai allokaation tai rivi poistui: lukitus pois.
    for (const el of document.querySelectorAll(`[${A_PROJECT}]`)) {
      if (keep.has(el)) continue;
      el.removeAttribute(A_PROJECT);
      const chip = el.querySelector('.pj-unplanned-chip');
      if (chip) { chip.classList.remove('pj-unplanned-chip'); chip.removeAttribute('title'); }
      const add = el.querySelector('.pj-unplanned-addtask');
      if (add) { add.classList.remove('pj-unplanned-addtask'); add.removeAttribute('title'); }
    }
    for (const input of document.querySelectorAll(`input[${A_INPUT}]`)) {
      if (keep.has(input)) continue;
      input.readOnly = false;
      input.removeAttribute(A_INPUT);
      input.removeAttribute('title');
    }
    if (DEBUG) console.log('[pj-unplanned]', document.querySelectorAll(`${PROJECT}[${A_PROJECT}]`).length);
  }

  // Add task ja lukitut kentät: klikkaus estetään ja syy näytetään.
  document.addEventListener('click', health.guard('klikkaus', (e) => {
    const add = e.target.closest?.('.pj-unplanned-addtask');
    if (add && add.closest(`${PROJECT}[${A_PROJECT}]`)) {
      e.preventDefault();
      e.stopPropagation();
      showToast(TIP);
      return;
    }
    if (e.target.closest?.(`input[${A_INPUT}]`)) showToast(TIP);
  }), true);
  // Liittäminen ja pudotus vain luettavaan kenttään eivät tee mitään, mutta
  // kerrotaan miksi.
  for (const ev of ['paste', 'drop']) {
    document.addEventListener(ev, (e) => {
      if (e.target.closest?.(`input[${A_INPUT}]`)) { e.preventDefault(); showToast(TIP); }
    }, true);
  }

  // React voi palauttaa kentän muokattavaksi uudelleenpiirrossa ilman
  // DOM-muutosta; varmistetaan lukitus viimeistään fokuksessa.
  document.addEventListener('focusin', (e) => {
    const input = e.target.closest?.(`input[${A_INPUT}]`);
    if (input && !input.readOnly) input.readOnly = true;
  }, true);

  let timer = null;
  const safeRun = health.guard('päivitys', run);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(safeRun, 150); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  safeRun();
})();
