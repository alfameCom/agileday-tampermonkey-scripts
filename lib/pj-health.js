// Yhteinen terveystarkistus Agileday-skripteille. Ladataan skriptiin
// @require-rivillä, joten jokainen skripti saa oman kopionsa; ilmoituslaatikko
// on DOMissa yhteinen, ja jokainen skripti hallitsee siinä vain omia rivejään.
//
// Käyttö:
//   const health = pjHealth('agileday-esimerkki', {
//     checks: {
//       'tuntikentät': () => !!document.querySelector('input[data-testid^="input-"]'),
//       'kommenttikuplat': () => noFilledCells() ? null : !!document.querySelector(...),
//     },
//   });
//   const run = health.guard('päivitys', () => { ... });
//
// Tarkistus palauttaa true (kunnossa), false (rikki) tai null (ei voi
// tarkistaa tällä sivulla, esim. tyhjä viikko). Tarkistukset ajetaan vain
// Time card -näkymässä, kun sivu on ehtinyt latautua.

/* exported pjHealth */
function pjHealth(script, opts) {
  const checks = opts?.checks || {};
  const active = opts?.active || pjHealth.onTimecard;

  const SETTLE_MS = 10000; // näin kauan annetaan sivun latautua ennen hälytystä
  const POLL_MS = 1000;
  const BOX_ID = 'pj-health';
  const DISMISS_KEY = 'pj-health-dismissed';

  const problems = new Map(); // avain → viesti
  let href = null;
  let since = 0;

  function dismissed() {
    try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
  }

  function ensureBox() {
    let box = document.getElementById(BOX_ID);
    if (box) return box;
    if (!document.getElementById(`${BOX_ID}-style`)) {
      const style = document.createElement('style');
      style.id = `${BOX_ID}-style`;
      style.textContent = `
        #${BOX_ID} {
          position: fixed; top: 12px; right: 16px; z-index: 2147483646;
          width: min(420px, calc(100vw - 32px)); padding: 12px 14px 10px;
          background: #fffbeb; color: #422006; border: 1px solid #f59e0b;
          border-left-width: 4px; border-radius: 8px;
          box-shadow: 0 6px 24px rgba(0, 0, 0, .15);
          font: 13px/1.45 system-ui, sans-serif;
        }
        #${BOX_ID}:not(:has(li)) { display: none; }
        #${BOX_ID} b.pj-h-title { display: block; font-size: 14px; margin: 0 24px 4px 0; }
        #${BOX_ID} ul { margin: 6px 0; padding-left: 18px; }
        #${BOX_ID} li { margin: 2px 0; }
        #${BOX_ID} code { font: 12px ui-monospace, monospace; background: rgba(0, 0, 0, .06);
          padding: 0 3px; border-radius: 3px; }
        #${BOX_ID} p { margin: 4px 0 0; color: #713f12; font-size: 12px; }
        #${BOX_ID} button.pj-h-x {
          position: absolute; top: 6px; right: 6px; width: 24px; height: 24px;
          border: 0; border-radius: 50%; background: transparent; color: inherit;
          font: 18px/24px system-ui, sans-serif; cursor: pointer;
        }
        #${BOX_ID} button.pj-h-x:hover { background: rgba(0, 0, 0, .08); }
      `;
      document.head.appendChild(style);
    }
    box = document.createElement('div');
    box.id = BOX_ID;
    box.setAttribute('role', 'status');
    box.innerHTML = `
      <button type="button" class="pj-h-x" title="Piilota tämän välilehden ajaksi">×</button>
      <b class="pj-h-title">⚠ Agileday-skripti ei toimi odotetusti</b>
      <ul></ul>
      <p>Agileday on todennäköisesti muuttanut sivun rakennetta. Muut ominaisuudet
      toimivat normaalisti; ilmoita ylläpitäjälle, niin skripti päivitetään.</p>`;
    box.querySelector('.pj-h-x').addEventListener('click', () => {
      // Piilotus koskee vain nyt näkyviä ongelmia; uudet tulevat näkyviin.
      const keys = dismissed();
      for (const li of box.querySelectorAll('li')) keys.add(li.dataset.key);
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...keys]));
      box.querySelector('ul').replaceChildren();
    });
    document.body.appendChild(box);
    return box;
  }

  function render() {
    const hidden = dismissed();
    const box = document.getElementById(BOX_ID) || (problems.size ? ensureBox() : null);
    if (!box) return;
    const ul = box.querySelector('ul');
    for (const li of ul.querySelectorAll(`li[data-script="${script}"]`)) {
      if (!problems.has(li.dataset.key.slice(script.length + 1))) li.remove();
    }
    for (const [key, msg] of problems) {
      const id = `${script}:${key}`;
      if (hidden.has(id) || ul.querySelector(`li[data-key="${CSS.escape(id)}"]`)) continue;
      const li = document.createElement('li');
      li.dataset.script = script;
      li.dataset.key = id;
      const name = document.createElement('code');
      name.textContent = script;
      li.append(name, `: ${msg}`);
      ul.appendChild(li);
    }
  }

  function report(key, msg) {
    if (problems.get(key) === msg) return;
    problems.set(key, msg);
    console.warn(`[${script}] ${msg}`);
    render();
  }

  function clear(key) {
    if (problems.delete(key)) render();
  }

  function check() {
    if (location.href !== href) { href = location.href; since = Date.now(); }
    if (!active()) {
      for (const key of [...problems.keys()]) if (key.startsWith('check:')) problems.delete(key);
      render();
      return;
    }
    const settled = Date.now() - since >= SETTLE_MS;
    for (const [name, fn] of Object.entries(checks)) {
      let ok;
      try { ok = fn(); } catch (err) { ok = false; }
      // Hälytetään vasta asettumisen jälkeen; korjaantuminen kuitataan heti.
      if (ok === false && settled) report(`check:${name}`, `ei löydä: ${name}`);
      else if (ok !== false) clear(`check:${name}`);
    }
  }

  // Ajonaikaiset virheet: kääre raportoi poikkeuksen kerran ja jatkaa.
  function guard(label, fn) {
    return function (...args) {
      try {
        const out = fn.apply(this, args);
        if (out && typeof out.catch === 'function') {
          return out.catch((err) => report(`error:${label}`, `virhe kohdassa ${label}: ${err?.message || err}`));
        }
        return out;
      } catch (err) {
        report(`error:${label}`, `virhe kohdassa ${label}: ${err?.message || err}`);
        return undefined;
      }
    };
  }

  setInterval(check, POLL_MS);
  // Testitila: osoitteen perään #pj-health-test näyttää ilmoituksen jokaiselta
  // skriptiltä, jotta ulkoasun ja asennuksen voi tarkistaa.
  if (location.hash.includes('pj-health-test')) report('test', 'testi-ilmoitus, skripti ja kirjasto ovat käytössä');
  return { guard, report, clear, check };
}

// Tarkistukset koskevat vain Time card -näkymää (/hours, tab=timecard tai ei
// tabia). Day-näkymässä ja My hours -välilehdellä ei hälytetä.
pjHealth.onTimecard = function () {
  if (!/\/hours\/?$/.test(location.pathname)) return false;
  const q = new URLSearchParams(location.search);
  const tab = q.get('tab');
  if (tab && tab !== 'timecard') return false;
  const view = q.get('view') || q.get('mode');
  return !view || /week/i.test(view);
};

// Onko tuntitaulukossa ylipäätään kenttiä? Tyhjällä viikolla (ei projekteja)
// rivitarkistuksia ei voi tehdä, joten ne palauttavat null.
pjHealth.tableHasInputs = function () {
  return !!document.querySelector('table input');
};
