// ==UserScript==
// @name         Agileday: saman taskin rivit yhdeksi
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.1.2
// @description  Time reporting: saman projektin saman taskin rivit näkyvät yhtenä rivinä; päivän useat kirjaukset summana, ja klikkaus avaa ne erillisinä kohtina muokattavaksi
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-merge-task-rows.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-merge-task-rows.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PROJECT = 'tr[data-testid="project-row"]';
  const ROW = 'tr[data-testid="task-row"]';
  const INPUT = 'input[data-testid^="input-"]';
  const PICKER = '[data-testid^="task-autocomplete-"]';
  const COMMENT_BTN = 'button[aria-label="Edit description"]';
  const POPUP = '[role="presentation"]';
  const SAVE_TEXT = /^(update|save|tallenna|päivitä)$/i;
  // Omat attribuutit: piilotettu rivi, solun peite, rivin summa, roskakori.
  const A_HIDDEN = 'data-pj-merge-hidden';
  const A_CELL = 'data-pj-merge-cell';
  const A_TOTAL = 'data-pj-merge-total';
  const A_TRASH = 'data-pj-merge-trash';
  const DEBUG = false;

  const health = pjHealth('agileday-merge-task-rows', {
    checks: {
      'taskin valinta taskiriveillä (tr[data-testid="task-row"] [data-testid^="task-autocomplete-"])': () =>
        pjHealth.tableHasInputs() ? !!document.querySelector(`${ROW} ${PICKER} input`) : null,
    },
  });

  function domError(msg) {
    const err = new Error(msg);
    err.dom = true;
    return err;
  }

  const style = document.createElement('style');
  style.textContent = `
    tr[${A_HIDDEN}] { display: none !important; }
    /* Tallennuksen ajan rivit näkyvissä, jotta Agiledayn kommenttidialogi
       ankkuroituu oikeaan nappiin. Modaalin tausta peittää ne. */
    body.pj-merge-saving tr[${A_HIDDEN}] { display: table-row !important; }
    td[${A_CELL}] { position: relative; }
    .pj-merge-cell {
      position: absolute; z-index: 2; box-sizing: border-box;
      display: flex; align-items: center; gap: 6px; padding: 0 8px;
      background: #fff; border: 1px solid rgba(0, 0, 0, .23); border-radius: 8px;
      cursor: pointer; font-family: inherit; color: rgba(0, 0, 0, .87);
    }
    .pj-merge-cell:hover { border-color: rgba(0, 0, 0, .87); }
    .pj-merge-sum { flex: 1; font-size: 14px; }
    .pj-merge-count {
      flex: none; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
      border-radius: 9px; background: #7e22ce; color: #fff;
      font: 600 11px/18px system-ui, sans-serif; text-align: center;
    }
    td[${A_TOTAL}] { position: relative; color: transparent !important; }
    td[${A_TOTAL}] > * { visibility: hidden; }
    td[${A_TOTAL}]::after {
      content: attr(${A_TOTAL}); position: absolute; inset: 0; padding: inherit;
      display: flex; align-items: center; justify-content: flex-end;
      color: var(--pj-merge-total-color, rgba(0, 0, 0, .87));
    }
    td[${A_TRASH}] button { visibility: hidden; }

    .pj-merge-backdrop {
      position: fixed; inset: 0; z-index: 2147483000; background: rgba(0, 0, 0, .3);
      display: flex; align-items: center; justify-content: center;
      font: 14px/1.4 system-ui, sans-serif; color: rgba(0, 0, 0, .87);
    }
    .pj-merge-dialog {
      width: min(560px, 92vw); max-height: 86vh; overflow: auto; box-sizing: border-box;
      background: #fff; border-radius: 12px; padding: 16px 18px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, .3);
    }
    .pj-merge-dialog h2 { margin: 0 0 2px; font-size: 16px; font-weight: 600; }
    .pj-merge-dialog .pj-merge-sub { margin: 0 0 12px; color: rgba(0, 0, 0, .6); }
    .pj-merge-item {
      display: grid; grid-template-columns: 72px 1fr 28px; gap: 8px; align-items: start;
      padding: 8px 0; border-top: 1px solid rgba(0, 0, 0, .08);
    }
    .pj-merge-item input, .pj-merge-item textarea {
      box-sizing: border-box; width: 100%; font: inherit; padding: 6px 8px;
      border: 1px solid rgba(0, 0, 0, .23); border-radius: 6px;
    }
    .pj-merge-item textarea { min-height: 38px; resize: vertical; }
    .pj-merge-item input:focus, .pj-merge-item textarea:focus { outline: 2px solid #7e22ce; outline-offset: -1px; }
    .pj-merge-item.pj-removed input, .pj-merge-item.pj-removed textarea { opacity: .4; text-decoration: line-through; }
    .pj-merge-item.pj-locked input, .pj-merge-item.pj-locked textarea { background: rgba(0, 0, 0, .04); }
    .pj-merge-x {
      width: 28px; height: 32px; border: 0; border-radius: 6px; background: transparent;
      font: 18px/1 system-ui, sans-serif; color: rgba(0, 0, 0, .55); cursor: pointer;
    }
    .pj-merge-x:hover { background: rgba(0, 0, 0, .06); color: rgb(185, 28, 28); }
    .pj-merge-x:disabled { visibility: hidden; }
    .pj-merge-actions { display: flex; gap: 8px; align-items: center; margin-top: 12px;
      padding-top: 12px; border-top: 1px solid rgba(0, 0, 0, .08); }
    .pj-merge-actions .pj-merge-total { margin-right: auto; color: rgba(0, 0, 0, .6); }
    .pj-merge-btn {
      padding: 6px 14px; border-radius: 8px; border: 1px solid rgba(0, 0, 0, .23);
      background: #fff; font: inherit; cursor: pointer;
    }
    .pj-merge-btn:disabled { opacity: .45; cursor: default; }
    /* Pois käytöstä oleva nappi ei saa hiiritapahtumia: vihje on kääreessä. */
    .pj-merge-addwrap[title]:not([title=""]) { cursor: help; }
    .pj-merge-addwrap[title]:not([title=""]) .pj-merge-btn { pointer-events: none; }
    .pj-merge-btn.pj-primary { background: #7e22ce; border-color: #7e22ce; color: #fff; font-weight: 600; }
    .pj-merge-msg { margin-top: 8px; color: rgb(185, 28, 28); }
  `;
  document.head.appendChild(style);

  // ---- Apurit ----

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
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // "1:30", "01:30", "1,5", "1.5", "2" -> minuutit
  function minutes(v) {
    const s = (v || '').trim();
    if (!s) return 0;
    let m = /^(\d+):(\d{1,2})$/.exec(s);
    if (m) return +m[1] * 60 + +m[2];
    m = /^(\d+(?:[.,]\d+)?)$/.exec(s);
    if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
    return NaN;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const fmtCell = (min) => (Number.isNaN(min) ? '?' : `${pad(Math.floor(min / 60))}:${pad(min % 60)}`);
  const fmtTotal = (min) => (Number.isNaN(min) ? '?' : `${Math.floor(min / 60)}:${pad(min % 60)} h`);

  const locked = (input) => input.disabled || input.readOnly;
  const commentOf = (td) => td.querySelector(`${COMMENT_BTN} svg[aria-label]`)?.getAttribute('aria-label')?.trim() || '';

  function taskName(tr) {
    const picker = tr.querySelector(PICKER);
    if (!picker) return '';
    // Demotilassa näytetään korvaava nimi, jos agileday-demo-mode on antanut sellaisen.
    if (document.documentElement.hasAttribute('data-pj-demo')) {
      return picker.parentElement?.getAttribute('data-pj-demo-text') || 'Task';
    }
    return picker.querySelector('input')?.value.trim() || '';
  }

  // ---- Ryhmittely ----

  // Ryhmä = saman projektin peräkkäiset taskirivit, joilla on sama task ja
  // tunteja tällä viikolla. Tunnittomat rivit (esim. juuri lisätty) eivät
  // yhdisty, mutta ne kelpaavat uusien kirjausten paikoiksi.
  function collectGroups() {
    const groups = new Map();
    let project = -1;
    for (const tr of document.querySelectorAll(`${PROJECT}, ${ROW}`)) {
      if (tr.matches(PROJECT)) { project++; continue; }
      const name = tr.querySelector(`${PICKER} input`)?.value.trim();
      if (!name) continue;
      const key = `${project}\u0000${name}`;
      if (!groups.has(key)) groups.set(key, { rows: [], spare: [] });
      const g = groups.get(key);
      const filled = [...tr.querySelectorAll(INPUT)].some((i) => i.value.trim());
      // Fokuksessa oleva rivi ei saa piiloutua kesken kirjoituksen: se kelpaa
      // vain näkyväksi pääriviksi.
      const focused = tr.contains(document.activeElement);
      (filled && (!focused || !g.rows.length) ? g.rows : g.spare).push(tr);
    }
    return [...groups.values()].filter((g) => g.rows.length > 1);
  }

  // Päivän solut kaikilta ryhmän riveiltä (myös tunnittomilta), sarakkeittain.
  function daySlots(g, col) {
    const slots = [];
    for (const tr of [...g.rows, ...g.spare]) {
      const td = tr.cells[col];
      const input = td?.querySelector(INPUT);
      if (input) slots.push({ tr, td, input, spare: !g.rows.includes(tr) });
    }
    return slots;
  }

  function dayColumns(tr) {
    return [...tr.cells].filter((td) => td.querySelector(INPUT)).map((td) => td.cellIndex);
  }

  // ---- Näkymä ----

  let modalOpen = false;

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function run() {
    if (modalOpen || document.body.classList.contains('pj-merge-saving')) return;
    const keep = new Set();
    const mark = (el, name, value = '') => { setAttr(el, name, value); keep.add(el); };

    for (const g of collectGroups()) {
      const [primary, ...rest] = g.rows;
      for (const tr of rest) mark(tr, A_HIDDEN);

      let weekMin = 0;
      for (const col of dayColumns(primary)) {
        const slots = daySlots(g, col);
        // Näkyvät tunnittomat/fokusrivit näyttävät omat arvonsa itse.
        const filled = slots.filter((s) => !s.spare && s.input.value.trim());
        const td = primary.cells[col];
        let dayMin = 0;
        for (const s of filled) dayMin += minutes(s.input.value);
        weekMin += dayMin;
        // Peite, kun kirjauksia on useita tai ainoa on piilotetulla rivillä.
        const needOverlay = filled.length > 1 || (filled.length === 1 && filled[0].tr !== primary);
        if (!needOverlay) continue;
        mark(td, A_CELL);
        renderOverlay(td, g, col, dayMin, filled);
      }

      // Rivin summa ja roskakori: solut viimeisen päiväsarakkeen jälkeen.
      const days = dayColumns(primary);
      if (!days.length) continue;
      for (const td of [...primary.cells].slice(Math.max(...days) + 1)) {
        if (/^\d+:\d{2}\s*h$/.test(td.textContent.trim()) || td.hasAttribute(A_TOTAL)) {
          if (!td.hasAttribute(A_TOTAL)) td.style.setProperty('--pj-merge-total-color', getComputedStyle(td).color);
          mark(td, A_TOTAL, fmtTotal(weekMin));
        } else if (td.querySelector('button')) {
          mark(td, A_TRASH);
        }
      }
    }

    // Siivous: elementit, jotka eivät enää kuulu mihinkään ryhmään.
    for (const name of [A_HIDDEN, A_CELL, A_TOTAL, A_TRASH]) {
      for (const el of document.querySelectorAll(`[${name}]`)) {
        if (keep.has(el) && (name !== A_CELL || el.querySelector('.pj-merge-cell'))) continue;
        el.removeAttribute(name);
        if (name === A_CELL) el.querySelector(':scope > .pj-merge-cell')?.remove();
      }
    }
    for (const ov of document.querySelectorAll('.pj-merge-cell')) {
      if (!ov.parentElement?.hasAttribute(A_CELL)) ov.remove();
    }
  }

  function renderOverlay(td, g, col, dayMin, filled) {
    let ov = td.querySelector(':scope > .pj-merge-cell');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'pj-merge-cell';
      ov.innerHTML = '<span class="pj-merge-sum"></span><span class="pj-merge-count"></span>';
      td.appendChild(ov);
    }
    ov.pjOpen = () => openModal(g, col);
    const sum = fmtCell(dayMin);
    const sumEl = ov.querySelector('.pj-merge-sum');
    if (sumEl.textContent !== sum) sumEl.textContent = sum;
    const countEl = ov.querySelector('.pj-merge-count');
    const count = String(filled.length);
    if (countEl.textContent !== count) countEl.textContent = count;
    // Demotilassa ei kommentteja vihjeeseen (agileday-demo-mode ei näe titleä).
    const demo = document.documentElement.hasAttribute('data-pj-demo');
    const title = filled.map((s) => {
      const c = demo ? '' : commentOf(s.td);
      return c ? `${s.input.value.trim()} · ${c}` : s.input.value.trim();
    }).join('\n');
    if (ov.title !== title) ov.title = title;

    // Sama paikka ja koko kuin solun omalla kentällä.
    const box = td.querySelector('.MuiInputBase-root') || td.querySelector(INPUT);
    const r = box.getBoundingClientRect();
    const t = td.getBoundingClientRect();
    if (!r.width) return;
    const pos = { left: r.left - t.left, top: r.top - t.top, width: r.width, height: r.height };
    for (const [k, v] of Object.entries(pos)) {
      const px = `${Math.round(v)}px`;
      if (ov.style[k] !== px) ov.style[k] = px;
    }
  }

  document.addEventListener('click', health.guard('solun klikkaus', (e) => {
    const ov = e.target.closest?.('.pj-merge-cell');
    if (!ov || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    ov.pjOpen?.();
  }), true);
  // Agileday fokusoi kentän jo pointerdownissa.
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.pj-merge-cell') && !e.altKey) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---- Modaali ----

  function openModal(g, col) {
    const primary = g.rows[0];
    const slots = daySlots(g, col);
    const dateLabel = (slots[0]?.input.getAttribute('aria-label') || '').replace(/^Hours for\s*/i, '');

    const items = slots
      .filter((s) => s.input.value.trim())
      .map((s) => ({ slot: s, hours: s.input.value.trim(), comment: commentOf(s.td), orig: null }));
    for (const it of items) it.orig = { hours: it.hours, comment: it.comment };
    const used = new Set(items.map((it) => it.slot));
    const freeSlot = () => slots.find((s) => !used.has(s) && !s.input.value.trim() && !locked(s.input));

    modalOpen = true;
    const back = document.createElement('div');
    back.className = 'pj-merge-backdrop';
    const dlg = document.createElement('div');
    dlg.className = 'pj-merge-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    back.appendChild(dlg);

    const h = document.createElement('h2');
    h.textContent = taskName(primary);
    const sub = document.createElement('p');
    sub.className = 'pj-merge-sub';
    sub.textContent = `Kirjaukset ${dateLabel}`;
    const list = document.createElement('div');
    const actions = document.createElement('div');
    actions.className = 'pj-merge-actions';
    const total = document.createElement('span');
    total.className = 'pj-merge-total';
    const add = button('+ Lisää kirjaus');
    const cancel = button('Peruuta');
    const save = button('Tallenna', true);
    const msg = document.createElement('div');
    msg.className = 'pj-merge-msg';
    const addWrap = document.createElement('span');
    addWrap.className = 'pj-merge-addwrap';
    addWrap.appendChild(add);
    actions.append(total, addWrap, cancel, save);
    dlg.append(h, sub, list, actions, msg);

    function button(text, primaryBtn) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pj-merge-btn' + (primaryBtn ? ' pj-primary' : '');
      b.textContent = text;
      return b;
    }

    function updateTotal() {
      let min = 0;
      for (const it of items) if (!it.removed) min += minutes(it.hours);
      total.textContent = `Yhteensä ${fmtTotal(min)}`;
      const free = freeSlot();
      add.disabled = !free;
      addWrap.title = free ? '' : 'Jokainen kirjaus tarvitsee Agiledayssa oman rivin, ja tämän '
        + 'taskin kaikilla riveillä on jo kirjaus tälle päivälle. Lisää sama task projektin '
        + 'Add task -napista, niin uusi kirjaus voidaan tehdä sille.';
    }

    function renderItem(it) {
      const row = document.createElement('div');
      row.className = 'pj-merge-item';
      const isLocked = locked(it.slot.input);
      if (isLocked) row.classList.add('pj-locked');
      const hrs = document.createElement('input');
      hrs.placeholder = 'hh:mm';
      hrs.value = it.hours;
      hrs.readOnly = isLocked;
      const com = document.createElement('textarea');
      com.placeholder = 'Kommentti';
      com.value = it.comment;
      com.readOnly = isLocked;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'pj-merge-x';
      x.textContent = '×';
      x.title = 'Poista kirjaus';
      x.disabled = isLocked;
      hrs.addEventListener('input', () => { it.hours = hrs.value.trim(); updateTotal(); });
      com.addEventListener('input', () => { it.comment = com.value.trim(); });
      x.addEventListener('click', () => {
        if (!it.orig) { // uusi, tallentamaton: pois listasta
          items.splice(items.indexOf(it), 1);
          used.delete(it.slot);
          row.remove();
        } else {
          it.removed = !it.removed;
          row.classList.toggle('pj-removed', it.removed);
          x.title = it.removed ? 'Palauta kirjaus' : 'Poista kirjaus';
        }
        updateTotal();
      });
      row.append(hrs, com, x);
      list.appendChild(row);
      return hrs;
    }

    for (const it of items) renderItem(it);
    updateTotal();

    add.addEventListener('click', () => {
      const slot = freeSlot();
      if (!slot) return;
      const it = { slot, hours: '', comment: '', orig: null };
      used.add(slot);
      items.push(it);
      renderItem(it).focus();
      updateTotal();
    });

    function close() {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      modalOpen = false;
      schedule();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save.click(); }
    }
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    cancel.addEventListener('click', close);

    save.addEventListener('click', health.guard('tallennus', async () => {
      const changes = items.filter((it) => {
        if (locked(it.slot.input)) return false;
        if (it.removed) return true;
        if (!it.orig) return !!it.hours;
        return it.hours !== it.orig.hours || it.comment !== it.orig.comment;
      });
      const bad = changes.find((it) => !it.removed && Number.isNaN(minutes(it.hours)));
      if (bad) { msg.textContent = `Tuntimäärä "${bad.hours}" ei kelpaa (esim. 1:30).`; return; }
      if (!changes.length) { close(); return; }

      for (const b of [save, cancel, add]) b.disabled = true;
      msg.textContent = '';
      document.body.classList.add('pj-merge-saving');
      try {
        for (const it of changes) {
          save.textContent = `Tallennetaan ${changes.indexOf(it) + 1}/${changes.length}…`;
          await writeEntry(it);
        }
        close();
      } catch (err) {
        msg.textContent = `Tallennus keskeytyi: ${err.message}. Tarkista solut taulukosta.`;
        if (err.dom) health.report('error:tallennus', `tallennus epäonnistui: ${err.message}`);
        if (DEBUG) console.warn('[pj-merge]', err);
        save.textContent = 'Tallenna';
        cancel.disabled = false;
      } finally {
        document.body.classList.remove('pj-merge-saving');
      }
    }));

    document.body.appendChild(back);
    (list.querySelector('input:not([readonly])') || save).focus();
  }

  // Kirjoitus Agiledayn omien kenttien ja kommenttidialogin kautta.
  async function writeEntry(it) {
    const { td } = it.slot;
    if (!td.isConnected) throw new Error('taulukko päivittyi kesken, avaa solu uudelleen');
    const input = td.querySelector(INPUT);
    if (!input || locked(input)) throw new Error('solu on lukittu');

    const hours = it.removed ? '' : it.hours;
    if (input.value.trim() !== hours) {
      input.focus();
      setNativeValue(input, hours);
      input.blur();
    }
    if (!hours) return;
    const before = it.orig ? it.orig.comment : '';
    if (it.comment === before) return;

    // Kommenttinappi ilmestyy vasta, kun solussa on tunnit.
    const btn = await waitFor(() => {
      const b = td.querySelector(COMMENT_BTN);
      return b && !b.disabled ? b : null;
    });
    if (!btn) throw domError('kommenttinappia ei löytynyt');
    btn.click();
    const area = await waitFor(() => document.querySelector(`${POPUP} textarea:not([aria-hidden])`));
    if (!area) throw domError('kommenttidialogi ei auennut');
    area.focus();
    setNativeValue(area, it.comment);
    const popup = area.closest(POPUP);
    const saveBtn = await waitFor(() => {
      const btns = [...popup.querySelectorAll('button')];
      const b = btns.find((x) => SAVE_TEXT.test(x.textContent.trim())) || btns.at(-1);
      return b && !b.disabled ? b : null;
    });
    if (!saveBtn) throw domError('kommentin tallennusnappia ei löytynyt');
    saveBtn.click();
    await waitFor(() => !area.isConnected);
  }

  // ---- Käynnistys ----

  let timer = null;
  const safeRun = health.guard('päivitys', run);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(safeRun, 150); };
  new MutationObserver((records) => {
    // Omat peitteet eivät käynnistä uutta kierrosta.
    if (records.every((r) => r.target.closest?.('.pj-merge-cell, .pj-merge-backdrop'))) return;
    schedule();
  }).observe(document.body, { childList: true, subtree: true });
  for (const ev of ['input', 'change', 'focusout']) document.addEventListener(ev, schedule, true);
  window.addEventListener('resize', schedule);
  safeRun();
})();
