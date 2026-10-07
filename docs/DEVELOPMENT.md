# Development

How the scripts are built and how to change them. User documentation is in the
[README](../README.md). The parts of Agileday's page each script depends on are listed in
[AGILEDAY-DOM.md](AGILEDAY-DOM.md).

## Repository layout

```
agileday-*.user.js   one userscript per feature, installed separately
lib/pj-health.js     shared health check, loaded with @require
scripts/             repository checks (not installed by users)
.githooks/           pre-commit hook running the checks
img/                 screenshots used in the README (take them with agileday-demo-mode on)
docs/                developer documentation
```

There is no build step and there are no dependencies. Each `*.user.js` file is exactly
what Tampermonkey installs.

## How a script is put together

Every script follows the same shape:

```js
// ==UserScript==
// @name         Agileday: <short Finnish name>
// @namespace    alfameCom.agileday-tampermonkey-scripts
// @version      0.1.0
// @description  <one line>
// @match        https://*.agileday.io/*
// @grant        none
// @require      https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/lib/pj-health.js
// @updateURL    https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/<name>.user.js
// @downloadURL  https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/<name>.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const DEBUG = false;
  const health = pjHealth('<name>', { checks: { /* … */ } });
  // styles, then a run() that is safe to call any number of times,
  // then a MutationObserver that schedules run()
})();
```

The main ideas:

- **Agileday is a single-page app.** Navigation (week change, tab change, date range)
  does not reload the page, and React re-renders parts of the DOM at any time. Scripts
  therefore do not run once. A `MutationObserver` on `document.body` schedules a
  `run()` that brings the page to the wanted state.
- **`run()` is idempotent.** It checks what is already in place and only changes what
  differs, so that it can be called repeatedly. Writing to the DOM only when something
  changed also prevents the observer from triggering itself in a loop.
- **Debounced runs.** The observer callback only schedules `run()` with a short
  debounce (100–200 ms), so a burst of React updates results in one run. Wrap `run()`
  in `health.guard()` so that an exception is reported instead of stopping the script.
- **Own markup is prefixed.** Every class, `data-*` attribute, storage key and element
  id the scripts add starts with `pj-`, so they never collide with Agileday's own names
  and are easy to spot in the inspector.
- **Prefer stable hooks.** Selectors use `data-testid`, ARIA roles/attributes and MUI
  component class names (`.MuiDataGrid-row`) rather than generated CSS class names
  (`css-1a2b3c`), which change with every Agileday build.
- **Use Agileday's UI to change data.** When a script changes data (for example
  `agileday-drag-clone` copying hours and comments), it does so by typing into
  Agileday's own fields and clicking Agileday's own buttons, so Agileday's validation
  and saving apply as usual. Values are set through the native `value` setter followed
  by bubbling `input` and `change` events, which is what React listens to. The scripts
  make no network requests.
- **React internals only as a last resort.** `agileday-my-hours` needs things the DOM
  does not offer: the MUI DataGrid API (`apiRef`: column width, visibility and order)
  and the date range picker's `onChange`/`onAccept`. It finds them by walking the React
  fiber (`__reactFiber$…`) up from the DOM element, and falls back to CSS and synthetic
  input when they are not found. This is the most fragile part of the repository; keep
  a DOM-level fallback for anything new that relies on it.
- **Storage.** Persistent settings go to `localStorage`, per-tab state (such as demo
  mode or dismissed health notices) to `sessionStorage`. Keys start with `pj-`.

Code comments and the texts the scripts add to the page are in Finnish. New code can be
commented in English or Finnish; keep each file consistent.

## Health check (`lib/pj-health.js`)

Because the scripts depend on Agileday's DOM, they can break silently when Agileday
changes its page. `pjHealth` turns that into a visible notice. Usage:

```js
const health = pjHealth('agileday-example', {
  checks: {
    // true = OK, false = broken, null = cannot be checked on this page (e.g. empty week)
    'hour inputs': () => !!document.querySelector('input[data-testid^="input-"]'),
    'comment bubbles': () => pjHealth.tableHasInputs()
      ? !!document.querySelector('[data-testid*="Comment"]') : null,
  },
  // optional: when the checks apply; default is the time card view
  active: pjHealth.onTimecard,
});

// Exceptions inside the wrapped function are reported in the notice.
const run = health.guard('update', () => { /* … */ });

// Report or clear a problem found at runtime.
health.report('comment-dialog', 'comment dialog did not open');
health.clear('comment-dialog');
```

- Checks run once a second, but a failing check is reported only after the page has had
  10 seconds to settle after a navigation. A check that passes again clears the problem
  immediately.
- `pjHealth.onTimecard()` is true on `/hours` with no `tab` or `tab=timecard`, in the
  week view. `pjHealth.tableHasInputs()` tells whether the week has any rows at all.
- `@require` gives every script its own copy of the library, but the notice box in the
  DOM is shared and each script manages only its own lines in it.
- `#pj-health-test` in the URL makes every script add a test line, which is a quick way
  to see which scripts are installed and running.

Every new script that depends on Agileday's DOM should register checks for the elements
it cannot work without.

## Debugging

Every script has a `DEBUG` constant near the top. Set it to `true` (in the Tampermonkey
editor, or in your local copy) and the script logs what it finds and does to the console.

To see which Agileday elements a script depends on, see
[AGILEDAY-DOM.md](AGILEDAY-DOM.md). When a script stops working, check its selectors
there against the current page in the browser's element inspector first.

## Working on a script locally

The easiest loop is to edit the script directly in Tampermonkey's editor and reload
Agileday. To work from your own editor instead:

1. In Tampermonkey's settings, set **Config mode** to *Advanced* and, under
   **Security**, allow access to local files (Chrome: also enable *Allow access to file
   URLs* in the extension details).
2. Create a small loader script in Tampermonkey with the same metadata block as the
   script, but with `@require file:///path/to/agileday-example.user.js` in place of the
   code, and disable the installed copy.
3. Every reload of Agileday now runs your local file.

## Keeping the repository generic

The scripts work for every Agileday organisation, and nothing in this repository may
reveal the organisation, customers, projects or people of whoever wrote it.
`scripts/check-generic.js` fails on:

- organisation-specific addresses (`acme.agileday.io`, `acme.atlassian.net`, …); <!-- generic-check: allow -->
  write `*.agileday.io` or `<organisation>.agileday.io` instead,
- e-mail addresses (except `example.com` and noreply addresses),
- issue keys such as `ACME-123`, phone numbers and Finnish personal identity codes, <!-- generic-check: allow -->
- any term in your local `.generic-denylist`.

`.generic-denylist` is git-ignored and stays on your machine. Put in it the names that
have no recognisable shape: your customers, projects, colleagues and internal tools, one
per line. Since the list is never committed, the names themselves are not published
either.

Enable the pre-commit hook once per clone, so the checks run before every commit:

```sh
git config core.hooksPath .githooks
```

CI runs the same checks on every push and pull request. The check cannot read images:
take screenshots with `agileday-demo-mode` on and look at them before committing.

A line that is a clearly generic example but trips a rule can be marked with
`generic-check: allow` in a comment. The deny list cannot be bypassed this way.

## Testing

There are no automated tests; the scripts are tested against a real Agileday tenant.
Before a pull request:

1. Check syntax and genericity (the pre-commit hook does both):

   ```sh
   for f in *.user.js lib/*.js scripts/*.js; do node --check "$f" || echo "FAIL $f"; done
   node scripts/check-generic.js
   ```

2. Try the change in the browser, including:
   - changing the week / date range without reloading (SPA navigation),
   - an empty week and a week with many projects,
   - a submitted and an unsubmitted week, where relevant,
   - the previous month (locked cells), where relevant.
3. Open `…/hours#pj-health-test` and confirm the script reports itself, then remove the
   hash and confirm no health notice appears after 10 seconds.
4. If you touch `agileday-my-hours`, test with `agileday-demo-mode` on as well; demo mode
   rewrites the texts in its tables.

## Releasing a change

1. Change the script.
2. **Raise `@version`.** Tampermonkey compares versions and ignores a changed file whose
   version did not increase. Use semantic-ish versions: patch for fixes, minor for new
   features.
3. Update the README if the behaviour visible to users changed, and
   [AGILEDAY-DOM.md](AGILEDAY-DOM.md) if the script now depends on different parts of
   the page.
4. Open a pull request to `main`. Once it is merged, users get the update with
   Tampermonkey's next update check (by default within a day).

`raw.githubusercontent.com` caches files for a few minutes, so an update can take a
moment to become visible even after the merge.

Changing `lib/pj-health.js` does not by itself reach users: Tampermonkey refreshes
`@require` files when the script that requires them is updated. Raise the `@version` of
the scripts too.

## Adding a new script

- File name `agileday-<feature>.user.js`; `@name` starts with `Agileday: `.
- Copy the metadata block above; keep `@match https://*.agileday.io/*` so it works for
  every organisation, and `@grant none` unless a `GM_*` API is really needed
  (`agileday-copy-comments` uses `GM_setClipboard`).
- Register health checks for the elements the script cannot work without.
- Add the script to the table and the features section of the README, and its DOM
  dependencies to [AGILEDAY-DOM.md](AGILEDAY-DOM.md).
