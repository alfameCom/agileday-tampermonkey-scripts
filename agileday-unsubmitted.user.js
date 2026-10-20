// ==UserScript==
// @name         Agileday: mitä Submit lähettää
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.3.1
// @description  Time reporting: UNSUBMITTED-viikolla näyttää, mitä on muuttunut edellisen lähetyksen jälkeen (uudet, muutetut ja poistetut kirjaukset) ja palauttaa ne, tai näyttää mitä Submit lähettää
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-unsubmitted.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-unsubmitted.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Agiledayn kirjauksen oma tila (SUBMITTED/NEW) tarkoittaa vain, onko se
  // tallennettu palvelimelle. UNSUBMITTED on koko viikon tila, eikä sivulla ole
  // tietoa siitä, mitä viikolla oli edellisellä lähetyskerralla. Siksi skripti
  // ottaa viikosta tilannekuvan, kun viikko on lähetetty (siru ei ole
  // UNSUBMITTED) tai kun Submitia painetaan, ja vertaa myöhemmin siihen.

  const PROJECT = 'tr[data-testid="project-row"]';
  const ROW = 'tr[data-testid="task-row"]';
  const INPUT = 'input[data-testid^="input-"]';
  const PICKER = '[data-testid^="task-autocomplete-"]';
  const STORE = 'pj-unsub-snapshots'; // localStorage: viikon maanantai -> tilannekuva
  const KEEP_WEEKS = 30;
  const A_CELL = 'data-pj-unsub';
  const COMMENT_BTN = 'button[aria-label="Edit description"]';
  const POPUP = '[role="presentation"]';
  const SAVE_TEXT = /^(update|save|tallenna|päivitä)$/i;
  const DEBUG = false;

  // Solun kirjaus Reactin propseista: tuntisolun komponentilla on propsit
  // hour { id, minutes, status, description, … } ja updateHours.
  function fiberOf(el) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    return key ? el[key] : null;
  }
  function hourOf(input) {
    let f = fiberOf(input);
    for (let d = 0; f && d < 40; d++, f = f.return) {
      const p = f.memoizedProps;
      if (p && typeof p === 'object' && 'hour' in p && 'updateHours' in p) {
        return { found: true, hour: p.hour, rowId: p.timeCardRowId || '' };
      }
    }
    return { found: false, hour: null, rowId: '' };
  }

  let propsOk = null;
  const health = pjHealth('agileday-unsubmitted', {
    checks: {
      'kirjauksen tiedot tuntisolun React-propseissa (hour.id, hour.minutes)': () => propsOk,
    },
  });

  const style = document.createElement('style');
  style.textContent = `
    td[${A_CELL}] { position: relative; }
    td[${A_CELL}]::after {
      content: ''; position: absolute; top: 3px; left: 3px; z-index: 3;
      width: 8px; height: 8px; border-radius: 50%;
      background: #f59e0b; box-shadow: 0 0 0 2px #fff; pointer-events: none;
    }
    /* Samat värit kuin listan Uusi / Muutettu / Poistettu. */
    td[${A_CELL}="new"]::after { background: #16a34a; }
    td[${A_CELL}="deleted"]::after { background: #dc2626; }
    .pj-unsub-btn {
      margin-left: 8px; padding: 2px 10px; border-radius: 12px; cursor: pointer;
      border: 1px solid #f59e0b; background: #fffbeb; color: #92400e;
      font: 600 12px/18px system-ui, sans-serif; white-space: nowrap;
    }
    .pj-unsub-btn.pj-all { border-color: rgba(0, 0, 0, .25); background: #fff; color: rgba(0, 0, 0, .7); }
    .pj-unsub-btn:hover { filter: brightness(.97); }
    .pj-unsub-pop {
      position: fixed; z-index: 2147483000; box-sizing: border-box;
      width: min(720px, 94vw); max-height: 60vh; overflow: auto;
      background: #fff; border-radius: 10px; padding: 12px 14px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, .3);
      font: 13px/1.4 system-ui, sans-serif; color: rgba(0, 0, 0, .87);
    }
    .pj-unsub-pop h3 { margin: 0 0 8px; font-size: 14px; }
    .pj-unsub-pop table { width: 100%; border-collapse: collapse; }
    .pj-unsub-pop td { padding: 5px 6px; border-top: 1px solid rgba(0, 0, 0, .08); vertical-align: top; }
    .pj-unsub-pop td.pj-h { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .pj-unsub-pop .pj-dim { color: rgba(0, 0, 0, .55); }
    .pj-unsub-pop .pj-old { color: rgba(0, 0, 0, .45); text-decoration: line-through; }
    .pj-unsub-pop .pj-kind { font-weight: 600; white-space: nowrap; }
    .pj-unsub-pop .pj-kind-new { color: #15803d; }
    .pj-unsub-pop .pj-kind-changed { color: #b45309; }
    .pj-unsub-pop .pj-kind-deleted { color: #b91c1c; }
    .pj-unsub-pop tr.pj-go { cursor: pointer; }
    .pj-unsub-pop tbody tr.pj-go:hover td { background: #fffbeb; }
    .pj-unsub-pop .pj-note { margin-top: 8px; color: rgba(0, 0, 0, .55); font-size: 12px; }
    .pj-unsub-pop h3 { display: flex; align-items: center; gap: 8px; }
    .pj-unsub-revert {
      padding: 1px 8px; border-radius: 6px; border: 1px solid rgba(0, 0, 0, .25);
      background: #fff; font: 12px/18px system-ui, sans-serif; cursor: pointer; white-space: nowrap;
    }
    .pj-unsub-revert:hover:not(:disabled) { background: #fffbeb; border-color: #f59e0b; }
    .pj-unsub-revert:disabled { opacity: .45; cursor: default; }
    .pj-unsub-revert-all { margin-left: auto; font-weight: 600; }
    .pj-unsub-status { margin-top: 8px; font-weight: 600; color: #92400e; }
    td.pj-unsub-flash { outline: 2px solid #f59e0b; outline-offset: -2px; }
  `;
  document.head.appendChild(style);

  const fmt = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
  const dateOf = (input) => (/(\d{4}-\d{2}-\d{2})$/.exec(input.dataset.testid || '') || [])[1] || '';

  function projectInfo(pr) {
    const [head, sub] = pr?.cells[0]?.firstElementChild?.children || [];
    return {
      customer: head?.firstElementChild?.textContent.trim() || '',
      project: sub?.querySelector('p > button')?.textContent.trim() || '',
    };
  }

  // Viikon kirjaukset (vain tunnilliset) ja viikon tunniste (aikaisin päivä).
  function readWeek() {
    const entries = [];
    const cells = [];
    let week = '';
    let pr = null;
    let checked = false;
    let ok = false;
    for (const tr of document.querySelectorAll(`${PROJECT}, ${ROW}`)) {
      if (tr.matches(PROJECT)) { pr = tr; continue; }
      const task = tr.querySelector(`${PICKER} input`)?.value.trim() || '';
      const info = projectInfo(pr);
      for (const input of tr.querySelectorAll(INPUT)) {
        const date = dateOf(input);
        if (date && (!week || date < week)) week = date;
        const { hour, rowId } = hourOf(input);
        const td = input.closest('td');
        const filled = !!input.value.trim();
        cells.push({ td, input, date, rowId, task, ...info, filled });
        if (!filled) continue;
        checked = true;
        if (!hour?.id || !(hour.minutes > 0)) continue;
        ok = true;
        entries.push({
          id: hour.id, rowId, date, minutes: hour.minutes, description: (hour.description || '').trim(),
          task, ...info,
          day: (input.getAttribute('aria-label') || '').replace(/^Hours for\s*/i, ''),
          td,
        });
      }
    }
    propsOk = checked ? ok : null;
    return { week, entries, cells };
  }

  // Viikon tilan siru on alapalkissa (ei taulukossa, jossa on UNPLANNED-siruja).
  function weekChip() {
    return [...document.querySelectorAll('.MuiChip-root')].find((c) => !c.closest('table')
      && /^(unsubmitted|submitted|approved|rejected|accepted|locked|returned)$/i.test(c.textContent.trim()));
  }

  function loadSnaps() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; }
  }
  function saveSnap(week, entries, status) {
    if (!week) return;
    const snaps = loadSnaps();
    const data = entries.map(({ td, ...e }) => e);
    const prev = snaps[week];
    if (prev && JSON.stringify(prev.entries) === JSON.stringify(data)) return;
    snaps[week] = { at: new Date().toISOString(), status, entries: data };
    const weeks = Object.keys(snaps).sort();
    for (const w of weeks.slice(0, Math.max(0, weeks.length - KEEP_WEEKS))) delete snaps[w];
    localStorage.setItem(STORE, JSON.stringify(snaps));
    if (DEBUG) console.log('[pj-unsub] tilannekuva', week, status, data.length);
  }

  // Vanhoissa tilannekuvissa ei ole rivin id:tä: silloin rivi tunnistetaan nimistä.
  const sameRow = (a, b) => (a.rowId && b.rowId
    ? a.rowId === b.rowId
    : a.customer === b.customer && a.project === b.project && a.task === b.task);

  function diff(snap, entries) {
    const old = new Map(snap.entries.map((e) => [e.id, e]));
    const out = [];
    for (const e of entries) {
      const o = old.get(e.id);
      if (!o) out.push({ kind: 'new', e });
      else if (o.minutes !== e.minutes || o.description !== e.description) out.push({ kind: 'changed', e, o });
      old.delete(e.id);
    }
    // Tyhjennetty ja uudelleen kirjoitettu solu saa uuden id:n: sama rivi ja
    // päivä yhdistetään muutokseksi.
    for (const o of old.values()) {
      const i = out.findIndex((r) => r.kind === 'new' && r.e.date === o.date && sameRow(r.e, o));
      if (i < 0) { out.push({ kind: 'deleted', o }); continue; }
      const { e } = out[i];
      if (e.minutes === o.minutes && e.description === o.description) out.splice(i, 1);
      else out[i] = { kind: 'changed', e, o };
    }
    const order = (x) => (x.e || x.o).date + (x.e || x.o).task;
    return out.sort((a, b) => order(a).localeCompare(order(b)));
  }

  let btn = null;
  let pop = null;
  let seen = null; // { key, at }: viikon ja sirun yhdistelmä ja milloin se nähtiin ensin
  let view = null; // { mode: 'diff' | 'all', rows, snap }
  let cells = [];
  let busy = false;
  let status = '';

  function run() {
    if (busy) return;
    const chip = weekChip();
    const { week, entries, cells: c } = readWeek();
    cells = c;
    if (!chip || !week || propsOk === false) { cleanup(); return; }

    const chipText = chip.textContent.trim();
    const unsubmitted = /^unsubmitted$/i.test(chipText);
    if (!unsubmitted) {
      // Lähetetty viikko: tilannekuva talteen, ei nappia. Viikkoa vaihdettaessa
      // taulukko ja siru päivittyvät eri aikaan, joten tallennetaan vasta, kun
      // sama viikko ja tila ovat pysyneet hetken.
      const key = `${week}|${chipText}`;
      if (seen?.key !== key) seen = { key, at: Date.now() };
      else if (Date.now() - seen.at > 1500) saveSnap(week, entries, chipText);
      else setTimeout(schedule, 1600);
      cleanup();
      return;
    }
    seen = null;

    const snap = loadSnaps()[week];
    view = snap
      ? { mode: 'diff', rows: diff(snap, entries), snap }
      : { mode: 'all', rows: entries.map((e) => ({ kind: 'all', e })) };

    // Merkittävä solu: nykyinen kirjaus tai poistetun kirjauksen tyhjä paikka.
    const marked = new Map();
    if (view.mode === 'diff') {
      for (const r of view.rows) {
        r.td = r.e ? r.e.td
          : cells.find((c) => c.date === r.o.date && sameRow(c, r.o) && !c.filled)?.td;
        if (r.td) marked.set(r.td, r.kind);
      }
    }
    for (const [td, v] of marked) if (td.getAttribute(A_CELL) !== v) td.setAttribute(A_CELL, v);
    for (const td of document.querySelectorAll(`td[${A_CELL}]`)) if (!marked.has(td)) td.removeAttribute(A_CELL);

    if (!btn || !btn.isConnected || btn.previousElementSibling !== chip) {
      btn?.remove();
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pj-unsub-btn';
      btn.addEventListener('click', (e) => { e.stopPropagation(); pop ? closePop() : openPop(); });
      chip.after(btn);
    }
    let label;
    if (view.mode === 'diff') {
      const n = (k) => view.rows.filter((r) => r.kind === k).length;
      const parts = [[n('new'), 'uutta'], [n('changed'), 'muutettu'], [n('deleted'), 'poistettu']]
        .filter(([c]) => c).map(([c, t]) => `${c} ${t}`);
      label = parts.length ? `Muutokset: ${parts.join(' · ')}` : 'Ei muutoksia edelliseen lähetykseen';
    } else {
      const min = entries.reduce((s, e) => s + e.minutes, 0);
      label = `Submit lähettää ${entries.length} kirjausta · ${fmt(min)} h`;
    }
    if (btn.textContent !== label) btn.textContent = label;
    btn.classList.toggle('pj-all', view.mode === 'all');
    if (pop) renderPop();
  }

  function cleanup() {
    btn?.remove();
    btn = null;
    view = null;
    closePop();
    for (const td of document.querySelectorAll(`td[${A_CELL}]`)) td.removeAttribute(A_CELL);
  }

  function td(text, cls) {
    const el = document.createElement('td');
    if (cls) el.className = cls;
    // Arvot omina elementteinään, jotta agileday-demo-mode voi korvata ne.
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    return el;
  }

  function whereCell(x) {
    const el = document.createElement('td');
    for (const [i, t] of [x.customer, x.project, x.task].filter(Boolean).entries()) {
      if (i) el.append(' · ');
      const s = document.createElement('span');
      if (i < 2) s.className = 'pj-dim';
      s.textContent = t;
      el.appendChild(s);
    }
    return el;
  }

  // "vanha → uusi", vanha yliviivattuna, jos arvo muuttui.
  function changeCell(oldV, newV, cls) {
    const el = document.createElement('td');
    if (cls) el.className = cls;
    if (oldV !== undefined && oldV !== newV) {
      const o = document.createElement('span');
      o.className = 'pj-old';
      o.textContent = oldV || '(tyhjä)';
      el.append(o, ' ');
    }
    const n = document.createElement('span');
    n.textContent = newV;
    el.appendChild(n);
    return el;
  }

  const KIND = { new: 'Uusi', changed: 'Muutettu', deleted: 'Poistettu' };

  function renderPop() {
    pop.replaceChildren();
    const h = document.createElement('h3');
    const note = document.createElement('div');
    note.className = 'pj-note';
    if (view.mode === 'diff') {
      const at = new Date(view.snap.at).toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' });
      h.textContent = view.rows.length ? 'Muutokset edelliseen lähetykseen' : 'Ei muutoksia edelliseen lähetykseen';
      note.textContent = `Verrattu tilanteeseen ${at} (${view.snap.status}), jonka tämä selain tallensi. `
        + 'Submit lähettää koko viikon, mutta nämä ovat ne kohdat, jotka ovat muuttuneet.';
    } else {
      h.textContent = 'Submit lähettää viikon kaikki kirjaukset';
      note.textContent = 'Tästä viikosta ei ole tallennettua lähetettyä tilannetta tässä selaimessa, '
        + 'joten muutoksia ei voi eritellä. Seuraavasta lähetyksestä alkaen skripti näyttää, mikä on muuttunut.';
    }
    pop.appendChild(h);
    if (view.mode === 'diff' && view.rows.length) {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'pj-unsub-revert pj-unsub-revert-all';
      all.textContent = 'Palauta kaikki';
      all.title = 'Palauta viikko edellisen lähetyksen tilaan';
      all.disabled = busy;
      all.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (confirm(`Palautetaanko ${view.rows.length} muutosta edellisen lähetyksen tilaan?`)) revert(view.rows);
      });
      h.appendChild(all);
    }
    if (view.rows.length) {
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      for (const r of view.rows) {
        const x = r.e || r.o;
        const tr = document.createElement('tr');
        if (r.kind !== 'all') {
          const k = td(KIND[r.kind], `pj-kind pj-kind-${r.kind}`);
          tr.appendChild(k);
        }
        tr.append(td(x.day), whereCell(x));
        if (r.kind === 'deleted') {
          tr.append(changeCell(fmt(x.minutes), '', 'pj-h'), changeCell(x.description, '', 'pj-dim'));
        } else {
          tr.append(changeCell(r.o && fmt(r.o.minutes), fmt(x.minutes), 'pj-h'),
            changeCell(r.o?.description, x.description, 'pj-dim'));
        }
        if (r.kind !== 'all') {
          const cell = document.createElement('td');
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'pj-unsub-revert';
          b.textContent = 'Palauta';
          b.title = { new: 'Poista uusi kirjaus', changed: 'Palauta vanhat tunnit ja kommentti',
            deleted: 'Lisää poistettu kirjaus takaisin' }[r.kind];
          b.disabled = busy;
          b.addEventListener('click', (ev) => { ev.stopPropagation(); revert([r]); });
          cell.appendChild(b);
          tr.appendChild(cell);
        }
        if (r.td) {
          tr.className = 'pj-go';
          tr.title = 'Klikkaa näyttääksesi solun';
          tr.addEventListener('click', () => { closePop(); flash(r.td); });
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      pop.appendChild(table);
    }
    pop.appendChild(note);
    if (status) {
      const st = document.createElement('div');
      st.className = 'pj-unsub-status';
      st.textContent = status;
      pop.appendChild(st);
    }
    place();
  }

  function place() {
    if (!pop || !btn) return;
    const r = btn.getBoundingClientRect();
    const h = pop.offsetHeight;
    const w = pop.offsetWidth;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const top = r.bottom + 6 + h > window.innerHeight ? r.top - h - 6 : r.bottom + 6;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  function openPop() {
    if (!view) return;
    pop = document.createElement('div');
    pop.className = 'pj-unsub-pop';
    document.body.appendChild(pop);
    renderPop();
  }
  function closePop() {
    pop?.remove();
    pop = null;
  }

  // ---- Palautus Agiledayn omien kenttien kautta ----

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
  function setNativeValue(el, value) {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  function domError(msg) {
    const err = new Error(msg);
    err.dom = true;
    return err;
  }

  async function writeCell(td, hours, comment) {
    if (!td?.isConnected) throw new Error('solu ei ole enää sivulla');
    const input = td.querySelector(INPUT);
    if (!input || input.disabled || input.readOnly) throw new Error('solu on lukittu');
    if (input.value.trim() !== hours) {
      input.focus();
      setNativeValue(input, hours);
      input.blur();
    }
    if (!hours || comment === null) return;
    const btn = await waitFor(() => {
      const b = td.querySelector(COMMENT_BTN);
      return b && !b.disabled ? b : null;
    });
    if (!btn) throw domError('kommenttinappia ei löytynyt');
    btn.click();
    const area = await waitFor(() => document.querySelector(`${POPUP} textarea:not([aria-hidden])`));
    if (!area) throw domError('kommenttidialogi ei auennut');
    area.focus();
    setNativeValue(area, comment);
    const popup = area.closest(POPUP);
    const save = await waitFor(() => {
      const btns = [...popup.querySelectorAll('button')];
      const b = btns.find((x) => SAVE_TEXT.test(x.textContent.trim())) || btns.at(-1);
      return b && !b.disabled ? b : null;
    });
    if (!save) throw domError('kommentin tallennusnappia ei löytynyt');
    save.click();
    await waitFor(() => !area.isConnected);
  }

  async function revertOne(r) {
    if (r.kind === 'new') return writeCell(r.e.td, '', null);
    if (r.kind === 'changed') {
      const comment = r.o.description !== r.e.description ? r.o.description : null;
      return writeCell(r.e.td, hhmm(r.o.minutes), comment);
    }
    // Poistettu: sama rivi ja päivä, solun on oltava tyhjä.
    const target = cells.find((c) => c.date === r.o.date && sameRow(c, r.o) && !c.filled);
    if (!target) throw new Error(`${r.o.day}: riviä ei löydy tai solussa on jo kirjaus`);
    return writeCell(target.td, hhmm(r.o.minutes), r.o.description || null);
  }

  async function revert(rows) {
    if (busy) return;
    busy = true;
    // Kommenttidialogi tarvitsee näkyvän ankkurin myös yhdistetyillä riveillä.
    document.body.classList.add('pj-merge-saving');
    const errors = [];
    try {
      for (const [i, r] of rows.entries()) {
        status = `Palautetaan ${i + 1}/${rows.length}…`;
        if (pop) renderPop();
        try {
          await revertOne(r);
        } catch (err) {
          errors.push(err.message);
          if (err.dom) health.report('error:palautus', `palautus epäonnistui: ${err.message}`);
          if (DEBUG) console.warn('[pj-unsub]', err);
        }
        await sleep(300);
      }
    } finally {
      document.body.classList.remove('pj-merge-saving');
      busy = false;
      status = errors.length ? `Osa palautuksista epäonnistui: ${errors.join('; ')}` : '';
      // Propsit päivittyvät tallennuksen jälkeen; lista lasketaan uudelleen hetken päästä.
      setTimeout(safeRun, 800);
      setTimeout(safeRun, 2500);
    }
  }

  function flash(cell) {
    if (!cell?.isConnected) return;
    cell.scrollIntoView({ block: 'center', behavior: 'smooth' });
    cell.classList.add('pj-unsub-flash');
    setTimeout(() => cell.classList.remove('pj-unsub-flash'), 1800);
  }

  // Submit: tilannekuva juuri ennen lähetystä, jotta seuraava vertailu
  // perustuu siihen, mitä lähetettiin.
  document.addEventListener('click', health.guard('Submit', (e) => {
    const b = e.target.closest?.('button');
    if (!b || b.closest('table') || !/^submit$/i.test(b.textContent.trim())) return;
    const { week, entries } = readWeek();
    if (week && propsOk !== false) saveSnap(week, entries, 'Submit');
  }), true);

  document.addEventListener('mousedown', (e) => {
    if (pop && !pop.contains(e.target) && e.target !== btn) closePop();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); }, true);
  window.addEventListener('resize', () => place());

  let timer = null;
  const safeRun = health.guard('päivitys', run);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(safeRun, 200); };
  new MutationObserver((records) => {
    if (records.every((r) => r.target.closest?.('.pj-unsub-pop, .pj-unsub-btn'))) return;
    schedule();
  }).observe(document.body, { childList: true, subtree: true });
  // Tallennus muuttaa propseja ilman DOM-muutosta; kenttien tapahtumat ja hidas
  // varakierros pitävät tilan ajan tasalla.
  for (const ev of ['change', 'focusout']) document.addEventListener(ev, () => setTimeout(schedule, 600), true);
  setInterval(safeRun, 5000);
  safeRun();
})();
