// ==UserScript==
// @name         Agileday: My hours -taulukon parannukset
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.6.0
// @description  Time reporting / My hours: pikavalinnat Today, Last work day ja Current week, kaikki ryhmät auki tai kiinni yhdellä napilla, omat ryhmittelyt (päivä, projekti…) lajittelulla ja suodatuksella, sarakeleveydet pysyvät ja sarakkeita voi piilottaa ja järjestää
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-my-hours.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-my-hours.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const GRID = '.MuiDataGrid-root';
  const SCROLLER = '.MuiDataGrid-virtualScroller';
  // Ryhmärivillä on aria-expanded; avausnappi on sen ensimmäinen nappi.
  // Kirjausriveillä (lehdet) aria-expandedia ei ole.
  const GROUP_ROW = '[role="row"][aria-expanded]';
  const LEAF_ROW = '.MuiDataGrid-row[role="row"]:not([aria-expanded])';
  const HEADER = '[role="columnheader"][data-field]';
  const SEPARATOR = '.MuiDataGrid-columnSeparator--resizable';
  // Puusarake (Employee) pitää ryhmien nuolet, sitä ei voi piilottaa.
  const TREE_FIELD = '__tree_data_group__';
  const STORE = 'pj-myhours-cols';
  const EXPAND_CLS = 'pj-expand-all';
  const COLS_CLS = 'pj-cols-btn';
  const GROUP_CLS = 'pj-group-btn';
  const QUICK_CLS = 'pj-quick-range';
  const DEBUG = false;

  // Omat ryhmittelyt: sarakkeiden data-fieldit ylimmästä tasosta alkaen.
  const GROUPINGS = [
    { key: 'agileday', label: 'Agiledayn oletus', fields: null },
    { key: 'date', label: 'Päivä', fields: ['date'] },
    { key: 'project', label: 'Projekti', fields: ['project'] },
    { key: 'project-task', label: 'Projekti → Task', fields: ['project', 'task'] },
    { key: 'none', label: 'Ei ryhmittelyä', fields: [] },
  ];

  function onMyHours() {
    return /\/hours\/?$/.test(location.pathname) &&
      new URLSearchParams(location.search).get('tab') === 'hoursActuals';
  }

  const health = pjHealth('agileday-my-hours', {
    active: onMyHours,
    checks: {
      'Current year -nappi (nappien paikka)': () => !!anchorButton(),
      'Current month -nappi (pikavalintojen paikka)': () => !!monthButton(),
      'aikavälikenttä (input, jossa pp/kk/vvvv)': () => !!dateInput(),
      'sarakeotsikot ([role="columnheader"][data-field])': () =>
        document.querySelector(GRID) ? !!document.querySelector(HEADER) : null,
      'ryhmärivit ([role="row"][aria-expanded])': () =>
        document.querySelector(`${GRID} [role="row"]`) ? !!document.querySelector(GROUP_ROW) : null,
    },
  });

  const style = document.createElement('style');
  style.textContent = `
    button.${EXPAND_CLS}, button.${COLS_CLS}, button.${GROUP_CLS}, button.${QUICK_CLS} { white-space: nowrap; gap: 6px; }
    button.${EXPAND_CLS}[data-busy], button.${GROUP_CLS}[data-busy] { opacity: .6; cursor: progress; }
    .pj-mh-icon { width: 18px; height: 18px; flex: none; }
    .pj-mh-menu {
      position: fixed; z-index: 1500; min-width: 220px; padding: 6px 0;
      background: #fff; color: rgba(0, 0, 0, .87); border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, .18); font: 14px/1.4 system-ui, sans-serif;
    }
    .pj-mh-menu label {
      display: flex; align-items: center; gap: 8px; padding: 5px 14px; cursor: pointer;
    }
    .pj-mh-menu label:hover { background: rgba(0, 0, 0, .05); }
    .pj-mh-menu label[data-locked] { color: rgba(0, 0, 0, .45); cursor: default; }
    .pj-mh-menu hr { margin: 6px 0; border: 0; border-top: 1px solid rgba(0, 0, 0, .1); }
    .pj-mh-menu button {
      display: block; width: 100%; padding: 5px 14px; border: 0; background: none;
      font: inherit; text-align: left; cursor: pointer; color: inherit;
    }
    .pj-mh-menu button:hover { background: rgba(0, 0, 0, .05); }

    /* Oman näkymän aikana grid jää DOMiin näkymättömänä ja riittävän isona,
       jotta sen virtuaalinen lista piirtää rivit ja sarakkeet luettaviksi. */
    ${GRID}[data-pj-offscreen] {
      position: fixed !important; left: -40000px !important; top: 0 !important;
      width: 3000px !important; height: 900px !important; visibility: hidden !important;
    }
    .pj-mh-view {
      overflow: auto; border: 1px solid rgba(0, 0, 0, .12); border-radius: 4px;
      background: #fff; font-size: 14px;
    }
    .pj-mh-view table { width: 100%; border-collapse: collapse; }
    .pj-mh-view th {
      position: sticky; top: 0; z-index: 1; background: #fff; text-align: left;
      font-weight: 500; padding: 10px 12px; border-bottom: 1px solid rgba(0, 0, 0, .12);
      white-space: nowrap;
    }
    .pj-mh-view td { padding: 8px 12px; border-bottom: 1px solid rgba(0, 0, 0, .06); vertical-align: top; }
    .pj-mh-view td.pj-num, .pj-mh-view th.pj-num { text-align: right; font-variant-numeric: tabular-nums; }
    .pj-mh-view td.pj-nowrap, .pj-mh-view td.pj-num { white-space: nowrap; }
    .pj-mh-view tr.pj-g { cursor: pointer; background: rgba(0, 0, 0, .025); font-weight: 600; }
    .pj-mh-view tr.pj-g:hover { background: rgba(0, 0, 0, .05); }
    .pj-mh-view tr.pj-g td:first-child { white-space: nowrap; }
    .pj-mh-view .pj-g-chev {
      width: 16px; height: 16px; margin: 0 6px -3px 0; color: rgba(0, 0, 0, .5);
      transition: transform .15s;
    }
    .pj-mh-view tr.pj-g[data-closed] .pj-g-chev { transform: rotate(-90deg); }
    .pj-mh-view .pj-g-count { font-weight: 400; color: rgba(0, 0, 0, .5); margin-left: 6px; }
    .pj-mh-view tr[data-pj-hidden] { display: none; }
    .pj-mh-view .pj-empty { padding: 24px; color: rgba(0, 0, 0, .55); }
    .pj-mh-view th[data-sort] { cursor: pointer; user-select: none; }
    .pj-mh-view th[data-sort]:hover { background: #f5f5f5; }
    .pj-mh-view th .pj-sort { margin-left: 4px; color: rgba(0, 0, 0, .45); font-size: 12px; }
    .pj-mh-view tr.pj-filter th { padding: 4px 8px 8px; font-weight: 400; }
    .pj-mh-view tr.pj-filter input {
      width: 100%; box-sizing: border-box; padding: 4px 6px; font: inherit; font-size: 13px;
      border: 1px solid rgba(0, 0, 0, .2); border-radius: 4px;
    }
    .pj-mh-view tr.pj-filter input:not(:placeholder-shown) { border-color: #1976d2; background: #f3f8fe; }
    .pj-mh-menu .pj-move {
      display: inline-block; width: 22px; padding: 0; margin-left: auto; text-align: center;
      border-radius: 4px; color: rgba(0, 0, 0, .55);
    }
    .pj-mh-menu .pj-move + .pj-move { margin-left: 0; }
    .pj-mh-menu .pj-move:disabled { visibility: hidden; }
  `;
  document.head.appendChild(style);

  // Sarakkeiden leveys- ja piilotussäännöt, ks. applyColumns.
  const colStyle = document.createElement('style');
  document.head.appendChild(colStyle);

  function monthButton() {
    return [...document.querySelectorAll('button')]
      .find((b) => /^current month$/i.test(b.textContent.trim()));
  }

  function anchorButton() {
    return [...document.querySelectorAll('button')]
      .find((b) => /^current year$/i.test(b.textContent.trim()));
  }

  function icon(path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pj-mh-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2" `
      + 'stroke-linecap="round" stroke-linejoin="round"/>';
    return svg;
  }
  const ICON_EXPAND = 'M7 9l5-5 5 5M7 15l5 5 5-5';
  const ICON_COLLAPSE = 'M7 4l5 5 5-5M7 20l5-5 5 5';
  const ICON_COLS = 'M4 5h16v14H4zM9.5 5v14M14.5 5v14';
  const ICON_GROUP = 'M4 6h16M8 12h12M8 18h12M4 12h.01M4 18h.01';

  // ---- Asetukset ----

  // { widths: { field: px }, hidden: [field], titles: { field: otsikko }, grouping,
  //   order: [field], sort: { field, dir: 1 | -1 } | null }
  function load() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { /* oletukset */ }
    return {
      widths: s.widths || {}, hidden: s.hidden || [], titles: s.titles || {},
      grouping: GROUPINGS.some((g) => g.key === s.grouping) ? s.grouping : 'agileday',
      order: s.order || [], sort: s.sort || null,
    };
  }
  let cfg = load();
  const save = () => localStorage.setItem(STORE, JSON.stringify(cfg));

  // ---- Gridin API ----

  // DataGridin apiRef löytyy jonkin esivanhemman propseista Reactin
  // fiber-puussa. Jos sitä ei löydy, sarakkeet hoidetaan CSS:llä.
  function gridApi() {
    const root = document.querySelector(GRID);
    if (!root) return null;
    const el = root.wrappedJSObject || root;
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    for (let f = key && el[key]; f; f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      for (const ref of [p.apiRef, p.privateApiRef, p.value]) {
        const api = ref?.current;
        if (api?.setColumnWidth && api.setColumnVisibility && api.getColumn) return api;
      }
    }
    return null;
  }

  // ---- Gridin ryhmät auki / kiinni ----

  // Klikataan Agiledayn omia nuolinappeja. Grid piirtää vain näkyvät rivit,
  // joten taulukkoa vieritetään alas ja klikataan sitä mukaa.

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function groupRows(expanded) {
    return [...document.querySelectorAll(`${GROUP_ROW}[aria-expanded="${expanded}"]`)];
  }

  async function clickAll(expand) {
    const scroller = document.querySelector(SCROLLER);
    const top = scroller?.scrollTop ?? 0;
    if (scroller) scroller.scrollTop = 0;
    // Jokaista riviä klikataan kerran: jos lapset latautuvat hitaasti ja rivi
    // näyttää vielä suljetulta, toinen klikkaus sulkisi sen uudelleen.
    const clicked = new Set();
    let waited = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const all = groupRows(!expand);
      const todo = all.filter((r) => !clicked.has(r.dataset.id));
      if (todo.length) {
        // Sulkiessa alhaalta ylös, jolloin syvimmät suljetaan ensin.
        for (const r of expand ? todo : todo.reverse()) {
          clicked.add(r.dataset.id);
          r.querySelector('button')?.click();
        }
        if (DEBUG) console.log('[pj-myhours] klikattu', todo.length);
        waited = 0;
        await sleep(80);
        continue;
      }
      // Klikatut, joiden tila ei ole vielä vaihtunut: odotetaan hetki.
      if (all.length && waited < 3000) { waited += 100; await sleep(100); continue; }
      if (!scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) break;
      scroller.scrollTop += Math.max(100, scroller.clientHeight - 50);
      waited = 0;
      await sleep(150);
    }
    if (scroller) scroller.scrollTop = expand ? top : 0;
  }

  let busy = false;

  async function withBusy(btnSel, fn) {
    if (busy) return;
    busy = true;
    const btn = document.querySelector(btnSel);
    btn?.setAttribute('data-busy', '');
    try {
      await fn();
    } finally {
      busy = false;
      btn?.removeAttribute('data-busy');
      safeRun();
    }
  }

  // ---- Sarakkeet: leveydet ja piilotus ----

  function headers() {
    return [...document.querySelectorAll(`${GRID} ${HEADER}`)];
  }

  function headerTitle(h) {
    return (h.querySelector('.MuiDataGrid-columnHeaderTitle') || h).textContent.trim();
  }

  function headerOf(field) {
    return document.querySelector(`${GRID} ${HEADER}[data-field="${CSS.escape(field)}"]`);
  }

  // Leveys lasketaan osoittimen paikasta (otsikon vasen reuna → osoitin),
  // koska Agileday voi palauttaa sarakkeen leveyden jo ennen hiiren
  // vapautusta. Puusarakkeen raahauksen skripti hoitaa kokonaan itse:
  // Agileday palauttaa sen leveyden kesken raahauksen.
  let resizing = null; // { field, left, own, width }

  function startResize(e) {
    const sep = e.target.closest?.(`${GRID} ${SEPARATOR}`);
    const header = sep?.closest(HEADER);
    if (!header) return;
    const field = header.dataset.field;
    const own = field === TREE_FIELD;
    resizing = { field, left: header.getBoundingClientRect().left, own, width: null };
    if (own) {
      e.preventDefault();
      e.stopPropagation();
      document.documentElement.style.cursor = 'col-resize';
    }
  }

  document.addEventListener('pointerdown', startResize, true);
  // Gridin oma raahaus voi alkaa myös mousedownista.
  document.addEventListener('mousedown', (e) => {
    if (resizing?.own) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  window.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    resizing.width = Math.max(60, Math.min(900, Math.round(e.clientX - resizing.left)));
    if (resizing.own) {
      e.stopPropagation();
      cfg.widths[resizing.field] = resizing.width;
      applyColumns();
    }
  }, true);

  window.addEventListener('pointerup', health.guard('leveyden tallennus', () => {
    const r = resizing;
    if (!r) return;
    resizing = null;
    document.documentElement.style.cursor = '';
    if (r.width === null) return;
    cfg.widths[r.field] = r.width;
    save();
    if (DEBUG) console.log('[pj-myhours] leveys', r.field, r.width);
    setTimeout(safeRun, 50);
  }), true);

  let cssKey = '';

  // Sarakkeet tallennetussa järjestyksessä; uudet sarakkeet perään.
  function ordered(fields) {
    const pos = (f) => { const i = cfg.order.indexOf(f); return i < 0 ? 1000 + fields.indexOf(f) : i; };
    return [...fields].sort((a, b) => pos(a) - pos(b));
  }

  // Gridin järjestys: APIlla, jos se löytyy, muuten CSS:n order-arvoilla
  // (rivit ja otsikkorivi ovat flex-rivejä). Puusarake pysyy ensimmäisenä.
  function orderRules(api) {
    if (!cfg.order.length) return [];
    const fields = headers().map((h) => h.dataset.field).filter((f) => f !== TREE_FIELD);
    const want = ordered(fields);
    if (api?.setColumnIndex) {
      const now = api.getAllColumns().map((c) => c.field);
      want.forEach((f, i) => {
        const idx = now.indexOf(TREE_FIELD) >= 0 ? i + 1 : i;
        if (now.indexOf(f) !== idx && now.includes(f)) api.setColumnIndex(f, idx);
      });
      return [];
    }
    return [
      `${GRID} [role="row"] > :not([data-field]) { order: 9999; }`,
      `${GRID} [data-field="${TREE_FIELD}"] { order: -1; }`,
      ...want.map((f, i) => `${GRID} [data-field="${CSS.escape(f)}"] { order: ${i}; }`),
    ];
  }

  function widthRule(f, w) {
    return `${GRID} [data-field="${CSS.escape(f)}"] { --width: ${w}px !important; width: ${w}px !important; `
      + `min-width: ${w}px !important; max-width: ${w}px !important; }`;
  }

  function applyColumns() {
    const api = gridApi();
    const rules = [];
    // Puusarakkeen leveys aina CSS:llä, koska Agileday kumoaa APIn kautta
    // asetetun leveyden.
    if (cfg.widths[TREE_FIELD]) rules.push(widthRule(TREE_FIELD, cfg.widths[TREE_FIELD]));
    if (api) {
      for (const [field, w] of Object.entries(cfg.widths)) {
        if (field === TREE_FIELD) continue;
        const col = api.getColumn(field);
        if (col && Math.abs((col.computedWidth ?? col.width) - w) > 1) api.setColumnWidth(field, w);
      }
      for (const field of cfg.hidden) {
        if (headerOf(field)) api.setColumnVisibility(field, false);
      }
    } else {
      // Varatapa ilman APIa: sarakkeen kaikki solut tunnistaa data-fieldistä.
      rules.push(...cfg.hidden.map((f) => `${GRID} [data-field="${CSS.escape(f)}"] { display: none !important; }`));
      for (const [f, w] of Object.entries(cfg.widths)) if (f !== TREE_FIELD) rules.push(widthRule(f, w));
    }
    if (!resizing) rules.push(...orderRules(api));
    const text = rules.join('\n');
    if (text !== cssKey) { colStyle.textContent = text; cssKey = text; }
  }

  function setHidden(field, hide) {
    cfg.hidden = cfg.hidden.filter((f) => f !== field);
    if (hide) cfg.hidden.push(field);
    save();
    if (!hide) gridApi()?.setColumnVisibility(field, true);
    // APIn piilottama sarake puuttuu kerätystä datasta: luetaan uudelleen.
    if (!hide && data && !data.fields.includes(field)) dataSig = null;
    renderView();
    safeRun();
  }

  // ---- Oma ryhmitelty näkymä ----

  // Kirjausrivit luetaan gridistä: kaikki ryhmät avataan ja lista vieritetään
  // läpi, koska grid piirtää vain näkyvät rivit.
  let data = null;   // { fields: [field], titles: {field: otsikko}, rows: [{field: teksti}] }
  let dataSig = null;
  let view = null;
  const closedGroups = new Set(); // `${grouping}|${polku}`

  // Gridin sisällön tunniste: ylimmän tason rivit muuttuvat, kun aikaväli
  // tai data vaihtuu, mutta eivät ryhmiä avattaessa.
  function gridSignature() {
    return [...document.querySelectorAll(`${GRID} .MuiDataGrid-row[aria-level="1"]`)]
      .map((r) => r.textContent).join('|');
  }

  function readLeaves(into) {
    for (const row of document.querySelectorAll(`${GRID} ${LEAF_ROW}`)) {
      if (into.has(row.dataset.id)) continue;
      const rec = {};
      for (const cell of row.querySelectorAll('[role="gridcell"][data-field]')) {
        rec[cell.dataset.field] = cell.textContent.trim();
      }
      into.set(row.dataset.id, rec);
    }
  }

  async function collect() {
    const grid = document.querySelector(GRID);
    if (!grid) return;
    grid.setAttribute('data-pj-offscreen', '');
    await sleep(100);
    await clickAll(true);
    const rows = new Map();
    const scroller = document.querySelector(SCROLLER);
    if (scroller) scroller.scrollTop = 0;
    await sleep(150);
    for (let guard = 0; guard < 2000; guard++) {
      readLeaves(rows);
      if (!scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) break;
      scroller.scrollTop += Math.max(100, scroller.clientHeight - 50);
      await sleep(120);
    }
    // Alkuun, jotta ylimmän tason rivi (gridSignature) on taas piirretty.
    if (scroller) scroller.scrollTop = 0;
    await sleep(100);
    const fields = headers().map((h) => h.dataset.field).filter((f) => f !== TREE_FIELD);
    const titles = {};
    for (const h of headers()) titles[h.dataset.field] = headerTitle(h);
    data = { fields, titles, rows: [...rows.values()] };
    dataSig = gridSignature();
    if (DEBUG) console.log('[pj-myhours] kerätty', data.rows.length, 'kirjausta');
  }

  function parseHours(s) {
    const m = /^(-)?(\d+):(\d{2})$/.exec((s || '').trim());
    if (!m) return 0;
    const min = Number(m[2]) * 60 + Number(m[3]);
    return m[1] ? -min : min;
  }

  function fmtHours(min) {
    const a = Math.abs(min);
    return `${min < 0 ? '-' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  }

  function dateValue(s) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? 0 : t;
  }

  function hoursField() {
    return data.fields.find((f) => /^actual/i.test(data.titles[f] || '')) || null;
  }

  // Päiväryhmän otsikkoon viikonpäivä: "ke 1.10.2026".
  function groupLabel(field, value) {
    if (field === 'date' && dateValue(value)) {
      return new Date(dateValue(value)).toLocaleDateString('fi-FI',
        { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
    }
    return value || '(tyhjä)';
  }

  function grouping() {
    return GROUPINGS.find((g) => g.key === cfg.grouping) || GROUPINGS[0];
  }

  // Suodatus: sarakkeittain, kirjainkoosta välittämättä, kaikkien ehtojen
  // pitää täsmätä. Ei tallennu, koska suodatus on yleensä hetkellinen.
  const filters = {};

  function matchesFilters(rec) {
    return Object.entries(filters).every(([f, q]) =>
      (rec[f] || '').toLocaleLowerCase('fi').includes(q.trim().toLocaleLowerCase('fi')));
  }

  // Oletuksena päivämäärän mukaan; muuten valittu sarake, tunnit ja päivät
  // arvoina, muut tekstinä.
  function compareRows(hrs) {
    const field = cfg.sort?.field || 'date';
    const dir = cfg.sort?.dir || 1;
    const key = (r) => {
      const v = r[field] || '';
      if (field === 'date') return dateValue(v);
      if (field === hrs || /^-?\d+:\d{2}$/.test(v)) return parseHours(v);
      return v;
    };
    return (a, b) => {
      const x = key(a);
      const y = key(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y
        : String(x).localeCompare(String(y), 'fi', { numeric: true });
      return c * dir || dateValue(a.date) - dateValue(b.date);
    };
  }

  // Nouseva → laskeva → oletus.
  function cycleSort(field) {
    if (cfg.sort?.field !== field) cfg.sort = { field, dir: 1 };
    else if (cfg.sort.dir > 0) cfg.sort = { field, dir: -1 };
    else cfg.sort = null;
    save();
    renderView();
  }

  function renderView() {
    if (!view || !data) return;
    const g = grouping();
    const cols = ordered(data.fields).filter((f) => !cfg.hidden.includes(f));
    const hrs = hoursField();
    const leaves = data.rows.filter(matchesFilters).sort(compareRows(hrs));

    // Kohdistus säilyy suodatuskentässä, vaikka taulukko piirretään uudelleen.
    const active = document.activeElement?.closest?.('.pj-mh-view tr.pj-filter') ? document.activeElement : null;
    const focus = active && { field: active.dataset.field, pos: active.selectionStart };

    const table = document.createElement('table');
    const thead = table.createTHead();
    const head = thead.insertRow();
    const filterRow = thead.insertRow();
    filterRow.className = 'pj-filter';
    for (const f of cols) {
      const th = document.createElement('th');
      th.dataset.sort = f;
      th.title = 'Lajittele (klikkaa uudelleen vaihtaaksesi suunnan)';
      th.append(data.titles[f] || f);
      if (cfg.sort?.field === f) {
        const mark = document.createElement('span');
        mark.className = 'pj-sort';
        mark.textContent = cfg.sort.dir > 0 ? '▲' : '▼';
        th.appendChild(mark);
      }
      if (f === hrs) th.className = 'pj-num';
      th.addEventListener('click', () => cycleSort(f));
      head.appendChild(th);

      const fth = document.createElement('th');
      const input = document.createElement('input');
      input.type = 'search';
      input.placeholder = 'Suodata';
      input.dataset.field = f;
      input.value = filters[f] || '';
      input.addEventListener('input', () => {
        if (input.value) filters[f] = input.value; else delete filters[f];
        renderView();
      });
      fth.appendChild(input);
      filterRow.appendChild(fth);
    }
    const body = table.createTBody();

    function leafRow(rec, depth) {
      const tr = body.insertRow();
      tr.dataset.level = depth;
      cols.forEach((f, i) => {
        const td = tr.insertCell();
        td.textContent = rec[f] || '';
        if (f === hrs) td.className = 'pj-num';
        else if (f === 'date') td.className = 'pj-nowrap';
        if (i === 0 && depth) td.style.paddingLeft = `${12 + depth * 20}px`;
      });
    }

    function build(recs, level, path) {
      if (level >= g.fields.length) {
        for (const r of recs) leafRow(r, level);
        return;
      }
      const field = g.fields[level];
      const groups = new Map();
      for (const r of recs) {
        const k = r[field] || '';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      const keys = [...groups.keys()];
      if (field === 'date') keys.sort((a, b) => dateValue(a) - dateValue(b));
      else keys.sort((a, b) => a.localeCompare(b, 'fi'));

      for (const k of keys) {
        const items = groups.get(k);
        const id = `${g.key}|${path}/${k}`;
        const tr = body.insertRow();
        tr.className = 'pj-g';
        tr.dataset.level = level;
        tr.toggleAttribute('data-closed', closedGroups.has(id));
        const first = tr.insertCell();
        first.style.paddingLeft = `${12 + level * 20}px`;
        const chev = icon('M6 9l6 6 6-6');
        chev.setAttribute('class', 'pj-g-chev');
        const count = document.createElement('span');
        count.className = 'pj-g-count';
        count.textContent = `(${items.length})`;
        first.append(chev, groupLabel(field, k), count);
        // Ryhmän nimi venyy tuntisarakkeeseen asti, summa sen kohdalle.
        const hi = hrs ? cols.indexOf(hrs) : -1;
        if (hi > 0) {
          first.colSpan = hi;
          const sum = tr.insertCell();
          sum.className = 'pj-num';
          sum.textContent = fmtHours(items.reduce((s, r) => s + parseHours(r[hrs]), 0));
          if (cols.length - hi - 1 > 0) tr.insertCell().colSpan = cols.length - hi - 1;
        } else {
          first.colSpan = cols.length;
        }
        tr.addEventListener('click', () => {
          if (closedGroups.has(id)) closedGroups.delete(id); else closedGroups.add(id);
          renderView();
          runButtons();
        });
        build(items, level + 1, `${path}/${k}`);
      }
    }

    build(leaves, 0, '');
    // Suljetun ryhmän alla olevat rivit piiloon, myös sisemmät ryhmät:
    // piilotetaan, kunnes vastaan tulee yhtä ylä- tai ylemmän tason ryhmä.
    let hideBelow = null;
    for (const tr of body.rows) {
      const lvl = Number(tr.dataset.level);
      const isGroup = tr.classList.contains('pj-g');
      if (hideBelow !== null && (!isGroup || lvl > hideBelow)) { tr.setAttribute('data-pj-hidden', ''); continue; }
      hideBelow = tr.hasAttribute('data-closed') ? lvl : null;
    }

    if (data.rows.length && !leaves.length) {
      const td = body.insertRow().insertCell();
      td.colSpan = cols.length;
      td.className = 'pj-empty';
      td.textContent = 'Suodatus ei löydä yhtään kirjausta.';
    }

    if (!data.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'pj-empty';
      empty.textContent = 'Valitulla aikavälillä ei ole kirjauksia.';
      view.replaceChildren(empty);
    } else {
      view.replaceChildren(table);
      // Suodatusrivi kiinnittyy otsikkorivin alle.
      for (const th of filterRow.cells) th.style.top = `${head.offsetHeight}px`;
      if (focus) {
        const input = table.querySelector(`tr.pj-filter input[data-field="${CSS.escape(focus.field)}"]`);
        input?.focus();
        input?.setSelectionRange(focus.pos, focus.pos);
      }
    }
  }

  // Näkymä ulottuu sisältöalueen (lähin rajattu esivanhempi, joka
  // päättyy Agent-palkin yläpuolelle) alareunaan. Sijainti lasketaan
  // vierittämättömänä, jotta korkeus ei kasva vieritettäessä.
  const VIEW_MARGIN = 16;

  function scrollParent(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY)) return p;
    }
    return null;
  }

  function fitView() {
    if (!view?.isConnected) return;
    const top = view.getBoundingClientRect().top;
    const sp = scrollParent(view);
    let bottom = innerHeight;
    let offset = top;
    if (sp) {
      const r = sp.getBoundingClientRect();
      bottom = r.top + sp.clientHeight - parseFloat(getComputedStyle(sp).paddingBottom || 0);
      offset = top + sp.scrollTop;
    }
    const h = `${Math.max(300, Math.round(bottom - offset - VIEW_MARGIN))}px`;
    if (view.style.height !== h) view.style.height = h;
  }
  window.addEventListener('resize', () => fitView());

  function customActive() {
    return grouping().fields !== null;
  }

  function leaveView() {
    view?.remove();
    view = null;
    data = null;
    dataSig = null;
    document.querySelector(`${GRID}[data-pj-offscreen]`)?.removeAttribute('data-pj-offscreen');
  }

  async function refreshView() {
    const grid = document.querySelector(GRID);
    if (!grid) return;
    if (!view || !view.isConnected) {
      view?.remove();
      view = document.createElement('div');
      view.className = 'pj-mh-view';
      const empty = document.createElement('div');
      empty.className = 'pj-empty';
      empty.textContent = 'Luetaan kirjauksia…';
      view.appendChild(empty);
      grid.before(view);
    }
    fitView();
    await collect();
    renderView();
  }

  function setGrouping(key) {
    cfg.grouping = key;
    save();
    closedGroups.clear();
    if (!customActive()) { leaveView(); safeRun(); return; }
    if (data) { renderView(); safeRun(); return; }
    withBusy(`button.${GROUP_CLS}`, refreshView);
  }

  // ---- Valikot ----

  let menu = null;

  function closeMenu() {
    menu?.remove();
    menu = null;
  }

  function showMenu(btn, items) {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'pj-mh-menu';
    menu.setAttribute('role', 'menu');
    menu.append(...items);
    menu.dataset.for = btn.className;
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.min(r.left, innerWidth - 240)}px`;
    document.body.appendChild(menu);
  }

  function columnsMenu(btn) {
    // Kaikki tunnetut sarakkeet: näkyvät otsikot ja aiemmin nähdyt piilotetut.
    const known = data ? [...data.fields] : headers().map((h) => h.dataset.field).filter((f) => f !== TREE_FIELD);
    for (const f of cfg.hidden) if (!known.includes(f)) known.push(f);
    const movable = ordered(known);
    const fields = [TREE_FIELD, ...movable];
    const items = fields.map((field) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !cfg.hidden.includes(field);
      if (field === TREE_FIELD) {
        box.disabled = true;
        label.dataset.locked = '';
        label.title = 'Ryhmien nuolet ovat tässä sarakkeessa';
      }
      box.addEventListener('change', health.guard('sarakkeen piilotus', () => setHidden(field, !box.checked)));
      label.append(box, cfg.titles[field] || field);
      if (field !== TREE_FIELD) {
        const i = movable.indexOf(field);
        for (const [delta, text, title] of [[-1, '↑', 'Siirrä vasemmalle'], [1, '↓', 'Siirrä oikealle']]) {
          const mv = document.createElement('button');
          mv.type = 'button';
          mv.className = 'pj-move';
          mv.textContent = text;
          mv.title = title;
          mv.disabled = !movable[i + delta];
          mv.addEventListener('click', health.guard('sarakkeen siirto', (e) => {
            e.preventDefault();
            const next = [...movable];
            [next[i], next[i + delta]] = [next[i + delta], next[i]];
            cfg.order = next;
            save();
            renderView();
            safeRun();
            columnsMenu(btn);
          }));
          label.appendChild(mv);
        }
      }
      return label;
    });
    const resetOrder = document.createElement('button');
    resetOrder.type = 'button';
    resetOrder.textContent = 'Palauta oletusjärjestys';
    resetOrder.addEventListener('click', () => {
      cfg.order = [];
      save();
      location.reload();
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Palauta oletusleveydet';
    reset.title = 'Unohtaa tallennetut leveydet ja lataa sivun uudelleen';
    reset.addEventListener('click', () => {
      cfg.widths = {};
      save();
      location.reload();
    });
    showMenu(btn, [...items, document.createElement('hr'), resetOrder, reset]);
  }

  function groupingMenu(btn) {
    const items = GROUPINGS.map((g) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'pj-grouping';
      radio.checked = g.key === cfg.grouping;
      radio.addEventListener('change', health.guard('ryhmittely', () => { closeMenu(); setGrouping(g.key); }));
      label.append(radio, g.label);
      return label;
    });
    showMenu(btn, items);
  }

  document.addEventListener('pointerdown', (e) => {
    if (menu && !menu.contains(e.target) && !e.target.closest?.(`button.${COLS_CLS}, button.${GROUP_CLS}`)) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // ---- Pikavalinnat: Today, Last work day, Current week ----

  // Aikaväli ei ole URL:ssa, joten se asetetaan päivämäärävalitsimeen:
  // ensisijaisesti valitsimen omalla onChangella (Reactin fiber-puusta),
  // varatapana liittämällä aikaväli kenttään paste-tapahtumana, jonka MUI:n
  // päivämääräkenttä jäsentää. Käytetty tapa näkyy <html data-pj-dates>.

  const QUICK = [
    { key: 'today', label: 'Today', title: 'Tämä päivä', range: () => { const d = today(); return [d, d]; } },
    { key: 'lastwork', label: 'Last work day', title: 'Edellinen arkipäivä (pyhiä ei huomioida)', range: () => {
      const d = today();
      do d.setDate(d.getDate() - 1); while (d.getDay() === 0 || d.getDay() === 6);
      return [d, d];
    } },
    { key: 'week', label: 'Current week', title: 'Maanantaista tähän päivään', range: () => {
      const end = today();
      const start = today();
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      return [start, end];
    } },
  ];

  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const DATE_RE = /\d{1,2}[./-]\d{1,2}[./-]\d{4}/;

  function dateInput() {
    return [...document.querySelectorAll('input')].find((i) => DATE_RE.test(i.value));
  }

  function fiberOf(el) {
    const o = el.wrappedJSObject || el;
    const key = Object.keys(o).find((k) => k.startsWith('__reactFiber$'));
    return key ? o[key] : null;
  }

  // Ulommaisin esivanhempi, jonka propseissa on [alku, loppu] ja onChange,
  // sekä MUI:n LocalizationProviderin päivämääräadapteri (utils).
  function pickerHandles(input) {
    let picker = null;
    let utils = null;
    let i = 0;
    for (let f = fiberOf(input); f && i < 80; f = f.return, i++) {
      const p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      if (Array.isArray(p.value) && p.value.length === 2 && typeof p.onChange === 'function') picker = p;
      if (!utils && typeof p.value?.utils?.date === 'function') utils = p.value.utils;
    }
    return picker && utils ? { picker, utils } : null;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;

  // Sama muoto kuin kentässä nyt: "01/10/2026 – 08/10/2026".
  function rangeText(input, [a, b]) {
    const sep = (/\d{4}(\s*[–-]\s*)\d/.exec(input.value) || [, ' – '])[1];
    const ds = (/\d{1,2}([./-])\d{1,2}/.exec(input.value) || [, '/'])[1];
    const f = (d) => `${pad(d.getDate())}${ds}${pad(d.getMonth() + 1)}${ds}${d.getFullYear()}`;
    return `${f(a)}${sep}${f(b)}`;
  }

  async function setRange(range) {
    const input = dateInput();
    if (!input) throw new Error('aikavälikenttää ei löydy');
    const h = pickerHandles(input);
    if (h) {
      const value = range.map((d) => h.utils.date(iso(d)));
      h.picker.onChange(value, { validationError: [null, null] });
      h.picker.onAccept?.(value);
      document.documentElement.dataset.pjDates = 'fiber';
      if (DEBUG) console.log('[pj-myhours] aikaväli onChangella', range);
      return;
    }
    const text = rangeText(input, range);
    input.focus();
    // Kaikki osiot valituiksi (Ctrl/Cmd+A), jolloin liitetty teksti korvaa koko arvon.
    const mac = /Mac/.test(navigator.platform);
    input.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'a', code: 'KeyA', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }));
    input.select();
    await sleep(30);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(30);
    input.blur();
    document.documentElement.dataset.pjDates = input.value === text ? 'paste' : 'paste-failed';
    if (DEBUG) console.log('[pj-myhours] aikaväli liittämällä', text, '→', input.value);
  }

  function runQuick() {
    const month = monthButton();
    if (!month) return;
    const existing = [...document.querySelectorAll(`button.${QUICK_CLS}`)];
    if (existing.length === QUICK.length && existing[QUICK.length - 1].nextElementSibling === month) return;
    existing.forEach((b) => b.remove());
    for (const q of QUICK) {
      const b = makeButton(month, QUICK_CLS, null, '', q.title,
        health.guard(`pikavalinta ${q.label}`, () => setRange(q.range())));
      b.textContent = q.label;
      b.dataset.range = q.key;
      month.before(b);
    }
  }

  // ---- Napit ----

  // true = kaikki ryhmät auki, false = jokin kiinni, null = ei ryhmiä.
  function allOpen() {
    if (customActive() && view) {
      const gs = view.querySelectorAll('tr.pj-g');
      return gs.length ? !view.querySelector('tr.pj-g[data-closed]') : null;
    }
    if (!document.querySelector(GROUP_ROW)) return null;
    return !groupRows(false).length;
  }

  function toggleAll(expand) {
    if (customActive() && view) {
      if (expand) {
        closedGroups.clear();
      } else {
        collectIds().forEach((id) => closedGroups.add(id));
      }
      renderView();
      safeRun();
      return;
    }
    withBusy(`button.${EXPAND_CLS}`, () => clickAll(expand));
  }

  // Kaikkien ryhmien tunnisteet nykyisellä ryhmittelyllä.
  function collectIds() {
    const g = grouping();
    const ids = [];
    const walk = (recs, level, path) => {
      if (!data || level >= g.fields.length) return;
      const groups = new Map();
      for (const r of recs) {
        const k = r[g.fields[level]] || '';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      for (const [k, items] of groups) {
        ids.push(`${g.key}|${path}/${k}`);
        walk(items, level + 1, `${path}/${k}`);
      }
    };
    walk(data?.rows || [], 0, '');
    return ids;
  }

  function makeButton(anchor, cls, iconPath, text, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    // Agiledayn napin luokat, jotta ulkoasu on sama; kuvake erottaa.
    btn.className = `${anchor.className} ${cls}`;
    if (iconPath) btn.append(icon(iconPath), text);
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function runButtons() {
    const anchor = anchorButton();
    if (!anchor) return;

    let exp = document.querySelector(`button.${EXPAND_CLS}`);
    let grp = document.querySelector(`button.${GROUP_CLS}`);
    let cols = document.querySelector(`button.${COLS_CLS}`);
    if (!exp || exp.previousElementSibling !== anchor || grp?.previousElementSibling !== exp ||
        cols?.previousElementSibling !== grp) {
      exp?.remove();
      grp?.remove();
      cols?.remove();
      exp = makeButton(anchor, EXPAND_CLS, null, '', '',
        health.guard('laajennus', () => toggleAll(exp.dataset.expand === '1')));
      grp = makeButton(anchor, GROUP_CLS, ICON_GROUP, 'Ryhmittely', 'Valitse, miten kirjaukset ryhmitellään',
        () => (menu?.dataset.for?.includes(GROUP_CLS) ? closeMenu() : groupingMenu(grp)));
      cols = makeButton(anchor, COLS_CLS, ICON_COLS, 'Sarakkeet', 'Piilota tai näytä sarakkeita',
        () => (menu?.dataset.for?.includes(COLS_CLS) ? closeMenu() : columnsMenu(cols)));
      anchor.after(exp, grp, cols);
    }

    const open = allOpen();
    const expand = open !== true;
    if (exp.dataset.expand !== (expand ? '1' : '0')) {
      exp.replaceChildren(icon(expand ? ICON_EXPAND : ICON_COLLAPSE), expand ? 'Laajenna kaikki' : 'Sulje kaikki');
      exp.dataset.expand = expand ? '1' : '0';
      exp.title = expand ? 'Avaa kaikki ryhmät päiväriveihin asti' : 'Sulje kaikki ryhmät';
    }
    exp.disabled = open === null;
    const label = customActive() ? `Ryhmittely: ${grouping().label}` : 'Ryhmittely';
    if (grp.lastChild?.textContent !== label) grp.lastChild.textContent = label;
  }

  function run() {
    if (!onMyHours()) {
      document.querySelectorAll(`button.${EXPAND_CLS}, button.${COLS_CLS}, button.${GROUP_CLS}, button.${QUICK_CLS}`)
        .forEach((b) => b.remove());
      closeMenu();
      leaveView();
      if (cssKey) { colStyle.textContent = ''; cssKey = ''; }
      return;
    }
    let titlesChanged = false;
    for (const h of headers()) {
      const t = headerTitle(h);
      if (t && cfg.titles[h.dataset.field] !== t) { cfg.titles[h.dataset.field] = t; titlesChanged = true; }
    }
    if (titlesChanged) save();
    if (!resizing) applyColumns();
    runButtons();
    runQuick();
    fitView();
    // Oma näkymä: luetaan uudelleen, kun gridin sisältö vaihtuu (aikaväli).
    if (customActive() && !busy && document.querySelector(GRID)) {
      const sig = gridSignature();
      if (!view || !view.isConnected || (sig && sig !== dataSig)) {
        withBusy(`button.${GROUP_CLS}`, refreshView);
      }
    }
  }

  let timer = null;
  const safeRun = health.guard('päivitys', run);
  const schedule = () => { if (!busy) { clearTimeout(timer); timer = setTimeout(safeRun, 150); } };
  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'],
  });
  // Toinen välilehti on voinut muuttaa asetuksia.
  window.addEventListener('storage', (e) => { if (e.key === STORE) { cfg = load(); schedule(); } });
  safeRun();
})();
