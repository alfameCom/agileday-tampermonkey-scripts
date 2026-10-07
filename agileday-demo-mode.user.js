// ==UserScript==
// @name         Agileday: demotila videoita varten
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.1.0
// @description  Ctrl+Alt+D tai #pj-demo: henkilön, asiakkaiden, projektien, taskien ja kuvausten nimet korvataan geneerisillä, jotta näkymästä voi tallentaa videon
// @match        https://*.agileday.io/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-demo-mode.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-demo-mode.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const FLAG = 'pj-demo';     // sessionStorage: demotila päällä tällä välilehdellä
  const STORE = 'pj-demo-map'; // localStorage: oikea arvo → korvaava, pysyy samana
  const DEBUG = false;

  const PERSON = 'Jane Doe';
  const DESCRIPTIONS = [
    'Development', 'Weekly meeting', 'Code review', 'Documentation', 'Testing',
    'Customer meeting', 'Ticket handling', 'Maintenance', 'Planning', 'Release preparation',
    'Bug fixing', 'Daily stand-up',
  ];

  const style = document.createElement('style');
  style.textContent = `
    html[data-pj-demo] .MuiAvatar-root img { visibility: hidden; }
    .pj-demo-toast {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483646;
      padding: 8px 14px; border-radius: 8px; background: rgba(0, 0, 0, .8); color: #fff;
      font: 13px/1.4 system-ui, sans-serif; pointer-events: none; transition: opacity .4s;
    }
  `;
  document.head.appendChild(style);

  // ---- Korvaavat arvot ----

  let state;
  try { state = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { state = null; }
  if (!state?.map) state = { map: {}, n: {}, person: null };
  const fakes = new Set(Object.values(state.map));
  const save = () => localStorage.setItem(STORE, JSON.stringify(state));

  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `A${i - 25}`);
  const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase();

  const make = {
    person: () => PERSON,
    customer: (i) => `Customer ${letter(i)} Ltd`,
    project: (i) => `Project ${letter(i)}`,
    task: (i) => `Task ${i + 1}`,
    description: (i) => DESCRIPTIONS[i % DESCRIPTIONS.length],
  };

  function fake(kind, real) {
    const key = real.trim();
    if (!key || fakes.has(key)) return key;
    if (state.map[key]) return state.map[key];
    const i = state.n[kind] || 0;
    state.n[kind] = i + 1;
    const value = make[kind](i);
    state.map[key] = value;
    fakes.add(value);
    if (kind === 'person') {
      state.person = key;
      state.map[initials(key)] = initials(value);
      fakes.add(initials(value));
    }
    save();
    if (DEBUG) console.log('[pj-demo]', kind, key, '→', value);
    return value;
  }

  // ---- DOMin käsittely ----

  function textNodes(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('script, style, .pj-demo-toast')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  }

  function setText(node, value) {
    // Alkuperäinen tyhjätila säilyy, ettei asettelu muutu.
    const m = /^(\s*)[\s\S]*?(\s*)$/.exec(node.data);
    const next = `${m[1]}${value}${m[2]}`;
    if (node.data !== next) node.data = next;
  }

  // My hours -taulukon solut: sarake (data-field) ja puusarakkeessa rivin
  // taso kertovat, mitä arvo on. Lehtirivin puusolu on päivämäärä.
  function cellKind(cell) {
    const field = cell.dataset.field;
    if (field === 'project') return 'project';
    if (field === 'task') return 'task';
    if (field === 'description') return 'description';
    if (field !== '__tree_data_group__') return null;
    const row = cell.closest('[role="row"]');
    if (!row?.hasAttribute('aria-expanded')) return null;
    return { 1: 'person', 2: 'customer-project', 3: 'task' }[row.getAttribute('aria-level')] || null;
  }

  function processCells() {
    for (const cell of document.querySelectorAll('[role="gridcell"][data-field]')) {
      const kind = cellKind(cell);
      if (!kind) continue;
      for (const node of textNodes(cell)) {
        const t = node.data.trim();
        if (!t) continue;
        if (kind === 'customer-project') {
          // "Asiakas Oy · Projekti"
          const parts = t.split(' · ');
          const value = parts.length === 2
            ? `${fake('customer', parts[0])} · ${fake('project', parts[1])}`
            : fake('project', t);
          setText(node, value);
        } else {
          setText(node, fake(kind, t));
        }
      }
    }
  }

  // Muualla (sivupalkki, omat näkymät) korvataan tunnetut arvot sellaisenaan
  // ja henkilön nimi myös osana pidempää tekstiä.
  function processAll() {
    for (const node of textNodes(document.body)) {
      const t = node.data.trim();
      if (!t || fakes.has(t)) continue;
      if (state.map[t]) { setText(node, state.map[t]); continue; }
      if (state.person && node.data.includes(state.person)) {
        node.data = node.data.split(state.person).join(state.map[state.person]);
      }
    }
  }

  let observer = null;

  function process() {
    processCells();
    processAll();
    // Omat muutokset eivät käynnistä uutta kierrosta.
    observer?.takeRecords();
  }

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'pj-demo-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 1200);
    setTimeout(() => el.remove(), 1700);
  }

  function enable(announce) {
    sessionStorage.setItem(FLAG, '1');
    document.documentElement.setAttribute('data-pj-demo', '');
    if (!observer) {
      // Käsitellään heti mikrotehtävänä, ennen kuin selain piirtää: oikeat
      // arvot eivät välähdä videolla.
      observer = new MutationObserver(process);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    process();
    if (announce) toast('Demotila päällä (Ctrl+Alt+D lopettaa)');
  }

  function disable() {
    sessionStorage.removeItem(FLAG);
    // Oikeat arvot palautuvat lataamalla sivu.
    location.reload();
  }

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.altKey && e.code === 'KeyD')) return;
    e.preventDefault();
    if (sessionStorage.getItem(FLAG)) disable(); else enable(true);
  }, true);

  if (location.hash.includes('pj-demo')) sessionStorage.setItem(FLAG, '1');
  if (sessionStorage.getItem(FLAG)) enable(false);
})();
