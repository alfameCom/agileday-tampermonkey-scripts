// ==UserScript==
// @name         Agileday: kommenttikuplan kopiointi oikealla klikillä
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.2.1
// @description  Time reporting: oikea klikkaus tuntisolun kommenttikuplaan kopioi kommentin leikepöydälle ja näyttää sen toastissa
// @match        https://*.agileday.io/*
// @grant        GM_setClipboard
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-copy-comments.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/agileday-copy-comments.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Täytetty kupla. Kommentin teksti on ikonin aria-labelissa (tyhjällä
  // kuplalla sitä ei ole), myös "From previous month" -soluissa, joita ei voi klikata.
  const BUBBLE = 'button[aria-label="Edit description"]';
  const ICON = `${BUBBLE} svg[aria-label]`;
  const HIT_PAD = 6; // px kuplan ympärillä, joka lasketaan osumaksi
  const DEBUG = false;

  // Täytetyissä soluissa on aina kommenttikupla (tyhjä tai täytetty).
  const health = pjHealth('agileday-copy-comments', {
    checks: {
      'kommenttikuplat tuntisoluissa (button[aria-label="Edit description"])': () => {
        const filled = [...document.querySelectorAll('table td input')].filter((i) => i.value.trim());
        if (!filled.length) return null;
        return filled.some((i) => i.closest('td')?.querySelector(`${BUBBLE} svg`));
      },
    },
  });

  const style = document.createElement('style');
  style.textContent = `
    .pj-copy-toast {
      position: fixed; top: 16px; left: 50%; z-index: 2147483647;
      transform: translate(-50%, -8px); opacity: 0;
      max-width: min(560px, 90vw); padding: 10px 14px;
      background: #1f1f24; color: #fff; border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, .25);
      font: 14px/1.4 system-ui, sans-serif;
      transition: opacity .15s, transform .15s; pointer-events: none;
    }
    .pj-copy-toast.pj-show { opacity: 1; transform: translate(-50%, 0); }
    .pj-copy-toast b { display: block; font-size: 12px; opacity: .7; margin-bottom: 2px; }
    .pj-copy-toast span { white-space: pre-wrap; word-break: break-word; }
  `;
  document.head.appendChild(style);

  let toast = null;
  let toastTimer = null;
  function showToast(title, text) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'pj-copy-toast';
      document.body.appendChild(toast);
    }
    toast.replaceChildren();
    const b = document.createElement('b');
    b.textContent = title;
    const span = document.createElement('span');
    span.textContent = text;
    toast.append(b, span);
    toast.classList.add('pj-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('pj-show'), 2500);
  }

  async function copy(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return;
    }
    await navigator.clipboard.writeText(text);
  }

  // Kupla, jonka päällä osoitin on. Haetaan koordinaateista, koska vanhoissa
  // soluissa klikkaus osuu kuplan päällä olevaan disabloituun kerrokseen.
  function iconAt(e) {
    const td = e.target.closest && e.target.closest('td');
    if (!td) return null;
    for (const svg of td.querySelectorAll(ICON)) {
      const r = svg.getBoundingClientRect();
      if (e.clientX >= r.left - HIT_PAD && e.clientX <= r.right + HIT_PAD &&
          e.clientY >= r.top - HIT_PAD && e.clientY <= r.bottom + HIT_PAD) return svg;
    }
    return null;
  }

  document.addEventListener('contextmenu', health.guard('oikea klikkaus', async (e) => {
    const svg = iconAt(e);
    if (!svg) return;
    const text = svg.getAttribute('aria-label') || '';
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      await copy(text);
      showToast('Kopioitu leikepöydälle', text);
    } catch (err) {
      showToast('Kopiointi epäonnistui', text);
      if (DEBUG) console.warn('[pj-copy]', err);
    }
    if (DEBUG) console.log('[pj-copy]', text, svg);
  }), true);
})();
