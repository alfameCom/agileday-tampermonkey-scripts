// ==UserScript==
// @name         Agileday: taskien nimet pelkkänä tekstinä
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.2.0
// @description  Time reporting: taskirivillä, jolla on viikon aikana tunteja, taskin pudotusvalikko korvautuu pelkällä nimellä
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-plain-task-names.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-plain-task-names.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROW = 'tr[data-testid="task-row"]';
  const INPUT = 'input[data-testid^="input-"]';
  const PICKER = '[data-testid^="task-autocomplete-"]';
  const ATTR = 'data-pj-task-text';
  const DEBUG = false;

  const health = pjHealth('agileday-plain-task-names', {
    checks: {
      'taskin valinta taskiriveillä (tr[data-testid="task-row"] [data-testid^="task-autocomplete-"])': () =>
        pjHealth.tableHasInputs() ? !!document.querySelector(`${ROW} ${PICKER} input`) : null,
    },
  });

  // Teksti piirretään valikon kääreen ::before-elementtiin, jotta Reactin
  // hallitsemaan DOMiin ei lisätä solmuja; skripti asettaa vain attribuutteja.
  const style = document.createElement('style');
  style.textContent = `
    [${ATTR}] > ${PICKER} { display: none !important; }
    /* Kääre vain tekstin levyinen, jotta kupla asettuu heti nimen perään. */
    [${ATTR}] { flex: 0 1 auto !important; width: auto !important; min-width: 0; }
    [${ATTR}]::before {
      content: attr(${ATTR});
      display: block; white-space: normal; overflow-wrap: anywhere;
      padding: 6px 4px 6px 8px; font-size: 14px; line-height: 20px;
    }
    [${ATTR}] + svg { flex: none; margin-left: 2px; opacity: .45; }
    [${ATTR}] + svg:hover { opacity: 1; }
  `;
  document.head.appendChild(style);

  function run() {
    for (const tr of document.querySelectorAll(ROW)) {
      const picker = tr.querySelector(PICKER);
      const wrap = picker?.parentElement;
      if (!wrap) continue;
      const name = picker.querySelector('input')?.value.trim() || '';
      const hasHours = [...tr.querySelectorAll(INPUT)].some((i) => i.value.trim());
      // Kenttä fokuksessa: käyttäjä on juuri valitsemassa taskia.
      const show = hasHours && name && !picker.contains(document.activeElement);
      if (show) {
        if (wrap.getAttribute(ATTR) !== name) {
          wrap.setAttribute(ATTR, name);
          if (DEBUG) console.log('[pj-plain-task-names]', name);
        }
      } else if (wrap.hasAttribute(ATTR)) {
        wrap.removeAttribute(ATTR);
      }
    }
  }

  let timer = null;
  const safeRun = health.guard('päivitys', run);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(safeRun, 150); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  // Kenttien arvot muuttuvat ominaisuuksina, joita MutationObserver ei näe.
  for (const ev of ['input', 'change', 'focusout']) document.addEventListener(ev, schedule, true);
  safeRun();
})();
