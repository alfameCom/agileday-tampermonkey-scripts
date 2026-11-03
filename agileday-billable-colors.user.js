// ==UserScript==
// @name         Agileday: billable- ja non-billable-taskit väreillä
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.1.0
// @description  Time card: non-billable-taskin rivi saa oranssin reunan, sävyn ja €-kieltomerkin, billable-taskin rivi turkoosin reunan. Tieto taskin billable-asetuksesta, varalla taskin nimestä ("… - nonbillable").
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-billable-colors.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-billable-colors.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROW = 'tr[data-testid="task-row"]';
  const PICKER = '[data-testid^="task-autocomplete-"]';
  const ATTR = 'data-pj-billable'; // "yes" | "no"
  const SRC = 'data-pj-billable-src'; // "agileday" | "name"
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[pj-billable]', ...a);

  // Varapolku, jos taskin billable-tietoa ei löydy: PlanMillistä siirretyt
  // taskit on nimetty "[taskin nimi] - nonbillable".
  const NB_NAME = /non[\s-]?billable|ei[\s-]laskutettava|laskuttamaton/i;

  // --- Taskin tiedot Reactin propseista ---------------------------------------

  // Agiledayn DOMissa taskin billable-asetusta ei näy. Taskiolio on kuitenkin
  // rivin komponenttien propseissa (Autocompleten value, rivin task tms.).
  // Haetaan tuntisolun/valitsimen fiberistä ylöspäin taskirivin tr:ään ja
  // muutama taso sen yli, ei pidemmälle: taulukon propseissa on kaikki rivit.
  const ABOVE_ROW = 4;

  function fiberOf(el) {
    const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    return key ? el[key] : null;
  }

  function billableOf(o) {
    if (!o || typeof o !== 'object') return null;
    for (const k of ['billable', 'isBillable']) {
      const v = o[k];
      if (typeof v === 'boolean') return v;
      if (v === 0 || v === 1) return v === 1;
    }
    return null;
  }

  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !v.$$typeof && !(v instanceof Node);

  // Etsii propseista olion, jolla on billable-kenttä (enintään kaksi tasoa
  // syvältä, taulukoita ei käydä läpi).
  function findInProps(props) {
    if (!plain(props)) return null;
    const own = billableOf(props);
    if (own != null && ('name' in props || 'id' in props)) return { billable: own, task: props };
    for (const v of Object.values(props)) {
      if (!plain(v)) continue;
      const b = billableOf(v);
      if (b != null) return { billable: b, task: v };
      for (const w of Object.values(v)) {
        if (!plain(w)) continue;
        const c = billableOf(w);
        if (c != null) return { billable: c, task: w };
      }
    }
    return null;
  }

  function fromProps(tr) {
    const start = tr.querySelector(`${PICKER} input`) || tr.querySelector('input') || tr;
    let above = -1;
    for (let f = fiberOf(start), d = 0; f && d < 60; f = f.return, d++) {
      if (f.stateNode === tr) above = 0;
      else if (above >= 0 && ++above > ABOVE_ROW) break;
      const hit = findInProps(f.memoizedProps);
      if (hit) return hit;
    }
    return null;
  }

  // --- Tyylit ------------------------------------------------------------------

  const NO_EURO = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<circle cx="50" cy="50" r="50" fill="#ffcc00"/>' +
    '<circle cx="50" cy="50" r="46" fill="#e2001a"/>' +
    '<circle cx="50" cy="50" r="35" fill="#ffcc00"/>' +
    '<text x="47" y="53" text-anchor="middle" dominant-baseline="central" ' +
    'font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="68" fill="#111">€</text>' +
    '<line x1="25.3" y1="25.3" x2="74.7" y2="74.7" stroke="#e2001a" stroke-width="10"/>' +
    '</svg>');

  // Sävy ja reuna inset-varjolla, jotta ne eivät kilpaile agileday-day-colorsin
  // sarakesävyjen (taustaväri) kanssa.
  const style = document.createElement('style');
  style.textContent = `
    ${ROW}[${ATTR}] > td:first-child { position: relative; }
    ${ROW}[${ATTR}="yes"] > td:first-child { box-shadow: inset 3px 0 0 #0d9488; }
    ${ROW}[${ATTR}="no"] > td { box-shadow: inset 0 0 0 999px rgba(234, 88, 12, .06); }
    ${ROW}[${ATTR}="no"] > td:first-child {
      box-shadow: inset 4px 0 0 #ea580c, inset 0 0 0 999px rgba(234, 88, 12, .06);
      padding-right: 50px;
    }
    /* Kieltomerkki (suomalainen malli): keltainen reunus, punainen rengas ja
       vinoviiva, keltainen pohja ja keskellä musta €. */
    /* Agiledayn taskirivillä on alhaalla enemmän tilaa kuin ylhäällä, joten
       sisältö (nimi, tuntikentät) on ~6 px keskikohdan yläpuolella. Merkki samalle linjalle. */
    ${ROW}[${ATTR}="no"] > td:first-child::after {
      content: ''; position: absolute; right: 8px; top: calc(50% - 6px); transform: translateY(-50%);
      height: 50%; max-height: 40px; aspect-ratio: 1; border-radius: 50%; pointer-events: none;
      background: url("${NO_EURO}") center / contain no-repeat;
    }
    /* Nimestä päätelty: katkoviivakehys merkiksi epävarmemmasta lähteestä. */
    ${ROW}[${ATTR}="no"][${SRC}="name"] > td:first-child::after { outline: 1px dashed #e2001a; outline-offset: 1px; }
  `;
  document.head.appendChild(style);

  // --- Päivitys --------------------------------------------------------------------

  // null = ei voi tarkistaa (ei valittuja taskeja), true/false = löytyikö
  // billable-tieto propseista ainakin yhdeltä riviltä.
  let propsOk = null;
  const health = pjHealth('agileday-billable-colors', {
    checks: {
      'taskin billable-tieto taskirivin React-propseissa': () => propsOk,
    },
  });

  function set(el, name, value) {
    if (value == null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function run() {
    let rows = 0;
    let hits = 0;
    for (const tr of document.querySelectorAll(ROW)) {
      const name = tr.querySelector(`${PICKER} input`)?.value.trim() || '';
      if (!name) { set(tr, ATTR, null); set(tr, SRC, null); continue; }
      rows++;
      const hit = fromProps(tr);
      let value = null;
      let src = null;
      if (hit) {
        hits++;
        value = hit.billable ? 'yes' : 'no';
        src = 'agileday';
      }
      // Nimi voittaa: "- nonbillable" -taskin pitäisi olla non-billable, ja
      // jos se ei ole, ristiriita on juuri se, mikä halutaan nähdä.
      if (NB_NAME.test(name)) { value = 'no'; src = hit && !hit.billable ? 'agileday' : 'name'; }
      set(tr, ATTR, value);
      set(tr, SRC, src);
    }
    propsOk = rows ? hits > 0 : null;
    log('rivejä', rows, 'propseista', hits);
  }

  // Vianetsintään konsolissa: pjBillableDebug() listaa ensimmäisen taskirivin
  // fiber-ketjun propsien avaimet (ei arvoja).
  window.pjBillableDebug = () => {
    const tr = document.querySelector(ROW);
    if (!tr) return 'ei taskirivejä';
    const out = [];
    let above = -1;
    for (let f = fiberOf(tr.querySelector(`${PICKER} input`) || tr), d = 0; f && d < 60; f = f.return, d++) {
      if (f.stateNode === tr) above = 0;
      else if (above >= 0 && ++above > ABOVE_ROW + 3) break;
      const p = f.memoizedProps;
      if (!plain(p)) continue;
      const keys = Object.keys(p).map((k) => (plain(p[k]) ? `${k}{${Object.keys(p[k]).slice(0, 25).join(',')}}` : k));
      out.push(`${d}${above >= 0 ? ` (tr+${above})` : ''} ${typeof f.type === 'string' ? f.type : f.type?.displayName || f.type?.name || '?'}: ${keys.join(', ')}`);
    }
    return out.join('\n');
  };

  let timer = null;
  const safeRun = health.guard('päivitys', run);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(safeRun, 150); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  // Taskin valinta muuttaa inputin arvoa ominaisuutena, jota MutationObserver ei näe.
  for (const ev of ['input', 'change', 'focusout']) document.addEventListener(ev, schedule, true);
  safeRun();
})();
