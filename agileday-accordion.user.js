// ==UserScript==
// @name         Agileday: projektit ja alapalkit haitareiksi
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.5.0
// @description  Time reporting: projektiryhmät avautuvat ja sulkeutuvat, tunnittomat ovat oletuksena kiinni; Submit- ja Agent-palkki ovat kiinni, kun viikko ei ole UNSUBMITTED; jäädytysilmoituksen voi sulkea
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-accordion.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-accordion.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PROJECT = 'tr[data-testid="project-row"]';
  const TASK = 'tr[data-testid="task-row"]';
  const INPUT = 'input[data-testid^="input-"]';
  const TOTAL = 'td[data-testid^="total-"]';
  // Viikon latauduttua oletustila (auki, jos tunteja) lasketaan uudelleen näin
  // kauan, koska arvot voivat tulla rivien jälkeen. Myöhemmin ilmestyvät
  // projektit ovat käyttäjän juuri lisäämiä (Add project) ja aukeavat.
  const LATE_MS = 2000;
  const DEBUG = false;

  // Agent-palkkia ja jäädytysilmoitusta ei tarkisteta: ne eivät näy kaikilla
  // eivätkä kaikilla viikoilla.
  const health = pjHealth('agileday-accordion', {
    checks: {
      'projektirivit (tr[data-testid="project-row"])': () =>
        pjHealth.tableHasInputs() ? !!document.querySelector(PROJECT) : null,
      'taskirivit (tr[data-testid="task-row"])': () =>
        pjHealth.tableHasInputs() ? !!document.querySelector(TASK) : null,
      'Submit-palkki': () => !!findFooter(),
    },
  });

  const style = document.createElement('style');
  style.textContent = `
    ${PROJECT} > td:first-child { position: relative; }
    ${PROJECT} { cursor: pointer; }
    ${PROJECT} :is(button, input, a, [role="button"]) { cursor: revert; }
    .pj-acc-chev {
      position: absolute; left: 1px; top: 2px; width: 20px; height: 20px;
      color: rgba(0, 0, 0, .45); pointer-events: none; transition: transform .15s;
    }
    ${PROJECT}[data-pj-acc="closed"] .pj-acc-chev,
    [data-pj-foot="closed"] .pj-acc-chev { transform: rotate(-90deg); }
    ${PROJECT}[data-pj-acc="closed"] > td > * { opacity: .7; }
    ${PROJECT}:hover .pj-acc-chev { color: rgba(0, 0, 0, .8); }
    tr[data-pj-hidden] { display: none !important; }

    [data-pj-foot="closed"] {
      padding: 0 !important; min-height: 0 !important; height: 20px !important;
      border: 0 !important; box-shadow: none !important; background: transparent !important;
    }
    [data-pj-footwrap="closed"] { padding-bottom: 0 !important; }
    [data-pj-foot="closed"] > :not(.pj-acc-foot) { display: none !important; }
    /* Sama nuoli kuin projektiriveillä, palkin vasemmassa yläkulmassa. */
    .pj-acc-foot {
      position: absolute; left: 0; top: 0; height: 20px; z-index: 1;
      display: flex; align-items: center; cursor: pointer; white-space: nowrap;
    }
    .pj-acc-foot .pj-acc-chev { position: static; flex: none; margin: 0 1px; }
    .pj-acc-foot-label {
      margin-left: 4px; color: rgba(0, 0, 0, .55); font: 12px/20px system-ui, sans-serif;
    }
    [data-pj-foot="open"] .pj-acc-foot-label { display: none; }
    .pj-acc-foot:hover .pj-acc-foot-label,
    [data-pj-foot="closed"]:hover .pj-acc-foot-label { color: rgba(0, 0, 0, .85); }
    .pj-acc-foot:hover .pj-acc-chev { color: rgba(0, 0, 0, .8); }
    [data-pj-foot="closed"] { cursor: pointer; }
    [data-pj-foot="closed"]:hover .pj-acc-chev { color: rgba(0, 0, 0, .8); }
    [data-pj-agent="closed"] { display: none !important; }

    [data-pj-notice] { position: relative; }
    [data-pj-notice="dismissed"] { display: none !important; }
    .pj-notice-x {
      position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
      width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%;
      background: transparent; color: rgba(0, 0, 0, .55); cursor: pointer;
      font: 20px/26px system-ui, sans-serif; text-align: center;
    }
    .pj-notice-x:hover { background: rgba(0, 0, 0, .08); color: rgba(0, 0, 0, .85); }
  `;
  document.head.appendChild(style);

  // ---- Projektiryhmät ----

  const open = new Map();      // `${viikko}|${projekti}` → boolean
  const userSet = new Set();   // avaimet, joita käyttäjä on itse avannut/sulkenut
  const taskCount = new Map(); // sama avain → tehtävärivien määrä
  let week = null;
  let weekSeenAt = 0;

  function weekKey() {
    const td = document.querySelector(TOTAL);
    return td ? td.dataset.testid : null;
  }

  function groups() {
    const out = [];
    for (const pr of document.querySelectorAll(PROJECT)) {
      const tasks = [];
      for (let r = pr.nextElementSibling; r && r.matches(TASK); r = r.nextElementSibling) tasks.push(r);
      const name = pr.cells[0]?.firstElementChild?.textContent.replace(/\s+/g, ' ').trim() || '';
      out.push({ pr, tasks, key: `${week}|${name}` });
    }
    return out;
  }

  function hasHours(tasks) {
    return tasks.some((t) => [...t.querySelectorAll(INPUT)].some((i) => i.value.trim()));
  }

  function apply({ pr, tasks, key }) {
    const isOpen = open.get(key);
    pr.setAttribute('data-pj-acc', isOpen ? 'open' : 'closed');
    for (const t of tasks) t.toggleAttribute('data-pj-hidden', !isOpen);
  }

  function makeChev() {
    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('class', 'pj-acc-chev');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" '
      + 'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
    return chev;
  }

  function runProjects() {
    const wk = weekKey();
    if (!wk) return;
    if (wk !== week) {
      week = wk;
      weekSeenAt = Date.now();
      // Vielä kerran juuri ennen asettumisikkunan loppua: kenttien arvot eivät muuta DOMia.
      setTimeout(() => safeRun(), LATE_MS - 50);
    }

    for (const g of groups()) {
      const td = g.pr.cells[0];
      if (td && !td.querySelector('.pj-acc-chev')) {
        td.appendChild(makeChev());
      }
      const settling = Date.now() - weekSeenAt <= LATE_MS;
      if (!open.has(g.key) || (settling && !userSet.has(g.key))) {
        open.set(g.key, hasHours(g.tasks) || !settling);
      } else if (g.tasks.length > (taskCount.get(g.key) ?? 0)) {
        // Add task: uusi rivi näkyviin.
        open.set(g.key, true);
      }
      taskCount.set(g.key, g.tasks.length);
      apply(g);
    }
  }

  document.addEventListener('click', health.guard('projektin avaus', (e) => {
    const pr = e.target.closest?.(PROJECT);
    if (!pr || e.target.closest('button, input, a, [role="button"], .MuiPopover-root')) return;
    const g = groups().find((x) => x.pr === pr);
    if (!g) return;
    open.set(g.key, !open.get(g.key));
    userSet.add(g.key);
    apply(g);
    if (DEBUG) console.log('[pj-acc]', g.key, open.get(g.key));
  }));

  // ---- Alapalkit: Submit-palkki ja Agent-palkki yhtenä haitarina ----

  let footOpen = null;    // käyttäjän valinta, nollautuu kun tila vaihtuu
  let lastUnsubmitted = null;
  let agentBar = null;

  // Agent-palkki on koko sovelluksen alapalkki ilman tunnistettavia
  // attribuutteja: haetaan "Agent"-teksti näkymän alareunasta ja noustaan
  // leveimpään mataloihin esivanhempaan.
  function findAgentBar() {
    if (agentBar?.isConnected) return agentBar;
    const leaf = [...document.querySelectorAll('body *')].find((el) =>
      !el.childElementCount && el.textContent.trim() === 'Agent' &&
      el.getBoundingClientRect().bottom > innerHeight - 120);
    let bar = null;
    for (let el = leaf; el && el !== document.body; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.height >= 100) break;
      if (r.width >= innerWidth * 0.5) bar = el;
    }
    return bar;
  }

  function findFooter() {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /submit/i.test(b.textContent.trim()) && !b.closest('table'));
    const start = btn || document.querySelector('.MuiChip-root');
    for (let el = start; el && el !== document.body; el = el.parentElement) {
      const pos = getComputedStyle(el).position;
      if (pos === 'sticky' || pos === 'fixed') return el;
    }
    return null;
  }

  function runFooter() {
    const foot = findFooter();
    if (!foot) {
      // Muilla sivuilla Agent-palkki pysyy Agiledayn omassa tilassa.
      agentBar?.removeAttribute('data-pj-agent');
      agentBar = null;
      document.querySelector('[data-pj-footwrap]')?.removeAttribute('data-pj-footwrap');
      return;
    }
    const unsubmitted = [...foot.querySelectorAll('.MuiChip-root')]
      .some((c) => /unsubmitted/i.test(c.textContent));
    if (unsubmitted !== lastUnsubmitted) { footOpen = null; lastUnsubmitted = unsubmitted; }
    const isOpen = footOpen ?? unsubmitted;

    let handle = foot.querySelector(':scope > .pj-acc-foot');
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'pj-acc-foot';
      const text = document.createElement('span');
      text.className = 'pj-acc-foot-label';
      text.textContent = 'Viikon kommentti, Submit ja Agent';
      handle.append(makeChev(), text);
      handle.addEventListener('click', (e) => {
        e.stopPropagation();
        footOpen = foot.getAttribute('data-pj-foot') !== 'open';
        runFooter();
      });
      // Kiinni ollessa koko kaista avaa palkit.
      foot.addEventListener('click', () => {
        if (foot.getAttribute('data-pj-foot') !== 'closed') return;
        footOpen = true;
        runFooter();
      });
      foot.appendChild(handle);
    }
    const state = isOpen ? 'open' : 'closed';
    if (foot.getAttribute('data-pj-foot') !== state) foot.setAttribute('data-pj-foot', state);
    foot.parentElement?.setAttribute('data-pj-footwrap', state);
    agentBar = findAgentBar();
    if (agentBar && agentBar.getAttribute('data-pj-agent') !== state) {
      agentBar.setAttribute('data-pj-agent', state);
    }
    const label = isOpen ? 'Piilota alapalkit' : 'Näytä viikon kommentti, Submit ja Agent';
    if (handle.title !== label) handle.title = label;
  }

  // ---- Jäädytysilmoitus ----

  // Sulkeminen on tilapäinen: tieto on vain muistissa, joten sivun lataus
  // palauttaa ilmoituksen.
  let noticeDismissed = false;

  function findNotice() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => /\b(freeze|frozen)\b/i.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    const text = walker.nextNode();
    // Laatikko on ensimmäinen leveä esivanhempi, jolla on reunus tai tausta.
    for (let el = text?.parentElement; el && el !== document.body; el = el.parentElement) {
      if (el.hasAttribute('data-pj-notice')) return el;
      const cs = getComputedStyle(el);
      const boxed = parseFloat(cs.borderTopWidth) > 0 ||
        !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor);
      if (boxed && el.getBoundingClientRect().width > 300) return el;
    }
    return null;
  }

  function runNotice() {
    const box = findNotice();
    if (!box) return;
    if (!box.querySelector(':scope > .pj-notice-x')) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'pj-notice-x';
      x.textContent = '×';
      x.title = 'Piilota (palaa, kun sivu ladataan uudelleen)';
      x.addEventListener('click', () => {
        noticeDismissed = true;
        box.setAttribute('data-pj-notice', 'dismissed');
      });
      box.appendChild(x);
    }
    const state = noticeDismissed ? 'dismissed' : 'shown';
    if (box.getAttribute('data-pj-notice') !== state) box.setAttribute('data-pj-notice', state);
  }

  function run() {
    runProjects();
    runFooter();
    runNotice();
  }

  let timer = null;
  const safeRun = health.guard('päivitys', run);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(safeRun, 100); };
  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true, characterData: true,
  });
  safeRun();
})();
