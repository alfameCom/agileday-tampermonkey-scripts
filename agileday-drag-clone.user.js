// ==UserScript==
// @name         Agileday: tuntikirjauksen kloonaus raahaamalla
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.5.0
// @description  Time reporting: Alt pohjassa raahaa tuntisolun toiseen saman taskin soluun (tunnit ja kommentti kopioituvat) tai tyhjennä solu ×-napista
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-drag-clone.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-drag-clone.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROW = 'tr[data-testid="task-row"]';
  const INPUT = 'input[data-testid^="input-"]';
  // Täytetyn kuplan ikoni; kommentin teksti on sen aria-labelissa.
  const COMMENT_ICON = 'svg[data-testid="CommentAdded2Icon"]';
  const POPOVER = '.MuiPopover-paper';
  const DEBUG = false;

  const health = pjHealth('agileday-drag-clone', {
    checks: {
      'tuntikentät taskiriveillä (tr[data-testid="task-row"] input[data-testid^="input-"])': () =>
        pjHealth.tableHasInputs() ? !!document.querySelector(`${ROW} ${INPUT}`) : null,
    },
  });

  // Virhe, joka johtuu sivun rakenteesta (selektori ei osu), ei käyttäjästä.
  function domError(msg) {
    const err = new Error(msg);
    err.dom = true;
    return err;
  }

  const style = document.createElement('style');
  style.textContent = `
    td.pj-clone-src { outline: 2px dashed rgb(37, 99, 235); outline-offset: -3px; }
    td.pj-clone-dst { outline: 2px solid rgb(22, 163, 74); outline-offset: -3px;
      background-image: linear-gradient(rgba(22, 163, 74, .12), rgba(22, 163, 74, .12)) !important; }
    body.pj-alt td.pj-clonable, body.pj-alt td.pj-clonable * { cursor: grab !important; }
    /* Raahauksen aikana korostus väistyy lähde- ja kohdesolun merkintöjen tieltä. */
    body.pj-alt:not(.pj-cloning) td.pj-clonable {
      outline: 2px dashed rgba(37, 99, 235, .6); outline-offset: -3px;
      background-image: linear-gradient(rgba(37, 99, 235, .08), rgba(37, 99, 235, .08)) !important;
    }
    body.pj-cloning, body.pj-cloning * { cursor: copy !important; user-select: none !important; }
    td.pj-clonable { position: relative; }
    .pj-clone-del {
      position: absolute; top: 1px; right: 1px; z-index: 5;
      width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%;
      background: rgb(220, 38, 38); color: #fff; font: 700 13px/18px system-ui, sans-serif;
      text-align: center; box-shadow: 0 1px 4px rgba(0, 0, 0, .3);
    }
    /* Ohittaa solun grab-kursorin, jonka valitsin on muuten tarkempi. */
    body.pj-alt td.pj-clonable .pj-clone-del { cursor: pointer !important; }
    .pj-clone-del:hover { background: rgb(185, 28, 28); transform: scale(1.1); }
    body.pj-cloning .pj-clone-del { display: none; }
    .pj-clone-ghost {
      position: fixed; z-index: 2147483647; pointer-events: none;
      max-width: 260px; padding: 4px 8px; border-radius: 6px;
      background: #1f1f24; color: #fff; font: 12px/1.4 system-ui, sans-serif;
      box-shadow: 0 4px 14px rgba(0, 0, 0, .25);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pj-clone-toast {
      position: fixed; top: 16px; left: 50%; z-index: 2147483647;
      transform: translate(-50%, -8px); opacity: 0;
      max-width: min(560px, 90vw); padding: 10px 14px;
      background: #1f1f24; color: #fff; border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, .25);
      font: 14px/1.4 system-ui, sans-serif;
      transition: opacity .15s, transform .15s; pointer-events: none;
    }
    .pj-clone-toast.pj-show { opacity: 1; transform: translate(-50%, 0); }
  `;
  document.head.appendChild(style);

  let toast = null;
  let toastTimer = null;
  function showToast(text) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'pj-clone-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('pj-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('pj-show'), 2500);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout = 3000) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(50);
    }
  }

  // Reactin kontrolloitu kenttä: arvo asetetaan prototyypin setterillä, jotta
  // React huomaa muutoksen input-tapahtumasta.
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function cellAt(el) {
    const td = el?.closest?.('td');
    return td && td.closest(ROW) && td.querySelector(INPUT) ? td : null;
  }

  function readCell(td) {
    const input = td.querySelector(INPUT);
    const icon = td.querySelector(COMMENT_ICON);
    return {
      hours: input.value.trim(),
      comment: icon?.getAttribute('aria-label')?.trim() || '',
    };
  }

  async function writeCell(td, { hours, comment }) {
    const input = td.querySelector(INPUT);
    if (!input || input.disabled || input.readOnly) throw new Error('Kohdesolu on lukittu');

    input.focus();
    setNativeValue(input, hours);
    input.blur();
    if (!comment) return;

    // Kommenttinappi ilmestyy vasta, kun solussa on tunnit.
    const btn = await waitFor(() => {
      const b = td.querySelector('button:not(.pj-clone-del)');
      return b && !b.disabled ? b : null;
    });
    if (!btn) throw domError('Kommenttinappia ei löytynyt');
    btn.click();

    const area = await waitFor(() =>
      document.querySelector(`${POPOVER} textarea:not([aria-hidden])`));
    if (!area) throw domError('Kommenttidialogi ei auennut');
    area.focus();
    setNativeValue(area, comment);

    const save = await waitFor(() => {
      const b = area.closest(POPOVER).querySelector('button');
      return b && !b.disabled ? b : null;
    });
    if (!save) throw domError('Kommentin tallennusnappia ei löytynyt');
    save.click();
    await waitFor(() => !document.querySelector(POPOVER));
  }

  let drag = null; // { src, data, ghost, dst }

  function setDst(td) {
    if (drag.dst === td) return;
    drag.dst?.classList.remove('pj-clone-dst');
    drag.dst = td;
    td?.classList.add('pj-clone-dst');
  }

  function endDrag() {
    if (!drag) return;
    drag.src.classList.remove('pj-clone-src');
    drag.dst?.classList.remove('pj-clone-dst');
    drag.ghost.remove();
    document.body.classList.remove('pj-cloning');
    drag = null;
  }

  async function clearCell(td) {
    const input = td.querySelector(INPUT);
    if (!input || input.disabled || input.readOnly) {
      showToast('Solu on lukittu');
      return;
    }
    const { hours, comment } = readCell(td);
    input.focus();
    setNativeValue(input, '');
    input.blur();
    // Poistettu sisältö toastiin, jotta vahingossa tyhjennetyn saa kirjoitettua takaisin.
    showToast(comment ? `Tyhjennetty ${hours} · ${comment}` : `Tyhjennetty ${hours}`);
    if (document.body.classList.contains('pj-alt')) setAltMode(true);
  }

  document.addEventListener('pointerdown', health.guard('raahauksen aloitus', (e) => {
    if (!e.altKey || e.button !== 0) return;
    const del = e.target.closest?.('.pj-clone-del');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      clearCell(del.closest('td'));
      return;
    }
    const src = cellAt(e.target);
    if (!src) return;
    const data = readCell(src);
    if (!data.hours) return;
    e.preventDefault();
    e.stopPropagation();

    const ghost = document.createElement('div');
    ghost.className = 'pj-clone-ghost';
    ghost.textContent = data.comment ? `${data.hours} · ${data.comment}` : data.hours;
    document.body.appendChild(ghost);
    src.classList.add('pj-clone-src');
    document.body.classList.add('pj-cloning');
    drag = { src, data, ghost, dst: null };
    moveGhost(e);
  }), true);

  function moveGhost(e) {
    drag.ghost.style.left = e.clientX + 14 + 'px';
    drag.ghost.style.top = e.clientY + 14 + 'px';
  }

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    moveGhost(e);
    const td = cellAt(document.elementFromPoint(e.clientX, e.clientY));
    // Vain saman taskin rivillä ja eri solussa.
    setDst(td && td !== drag.src && td.closest(ROW) === drag.src.closest(ROW) ? td : null);
  }, true);

  document.addEventListener('pointerup', health.guard('pudotus', async (e) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const { dst, data } = drag;
    endDrag();
    if (!dst) return;
    try {
      await writeCell(dst, data);
      showToast(data.comment ? `Kloonattu ${data.hours} + kommentti` : `Kloonattu ${data.hours}`);
      // Alt voi olla yhä pohjassa: uusi täytetty solu on heti kloonattavissa.
      if (document.body.classList.contains('pj-alt')) setAltMode(true);
    } catch (err) {
      showToast(`Kloonaus epäonnistui: ${err.message}`);
      if (err.dom) health.report('error:kloonaus', `kloonaus epäonnistui: ${err.message}`);
      if (DEBUG) console.warn('[pj-clone]', err);
    }
  }), true);

  // Alt-klikkaus ei saa fokusoida kenttää eikä avata kommenttia.
  document.addEventListener('click', (e) => {
    if (e.altKey && cellAt(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Alt pohjassa: täytetyt solut korostuvat ja saavat grab-kursorin sekä
  // ×-napin tyhjennystä varten. Lukittuihin soluihin ei tule ×-nappia.
  const setAltMode = health.guard('Alt-tila', (on) => {
    document.body.classList.toggle('pj-alt', on);
    for (const td of document.querySelectorAll('td.pj-clonable')) td.classList.remove('pj-clonable');
    for (const b of document.querySelectorAll('.pj-clone-del')) b.remove();
    if (!on) return;
    for (const input of document.querySelectorAll(`${ROW} ${INPUT}`)) {
      if (!input.value.trim()) continue;
      const td = input.closest('td');
      if (!td) continue;
      td.classList.add('pj-clonable');
      if (input.disabled || input.readOnly) continue;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'pj-clone-del';
      del.textContent = '×';
      del.title = 'Tyhjennä solu';
      td.appendChild(del);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') endDrag();
    if (e.key === 'Alt' && !e.repeat) setAltMode(true);
  }, true);
  document.addEventListener('keyup', (e) => { if (e.key === 'Alt') setAltMode(false); }, true);
  // Alt voi vapautua toisessa ikkunassa, jolloin keyup jää tulematta.
  document.addEventListener('pointermove', (e) => {
    if (document.body.classList.contains('pj-alt') !== e.altKey) setAltMode(e.altKey);
  }, true);
  window.addEventListener('blur', () => { endDrag(); setAltMode(false); });
})();
