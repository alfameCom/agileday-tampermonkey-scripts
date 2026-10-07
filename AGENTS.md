# Agent instructions

Instructions for AI coding agents working in this repository. Humans should start from
[README.md](README.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); this file links to
them rather than repeating them.

## What this repository is

Tampermonkey userscripts that improve time reporting in Agileday
(`https://<organisation>.agileday.io`), a Next.js + MUI single-page app that we do not
own. Each `agileday-*.user.js` file is installed as-is; there is no build step, no
package manager and no dependencies. `lib/pj-health.js` is shared and loaded with
`@require`.

| Read this | When |
|---|---|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Before changing any code: script structure, health check API, testing, releasing. |
| [docs/AGILEDAY-DOM.md](docs/AGILEDAY-DOM.md) | Before touching selectors: what each script depends on in Agileday's page. |
| [README.md](README.md) | User-facing behaviour of every script. |

## Hard rules

1. **Raise `@version`** in every script you change, and in every script that
   `@require`s `lib/pj-health.js` if you change the library. Tampermonkey ignores a
   changed file whose version did not increase. Patch for fixes, minor for features.
2. **No network requests.** No `fetch`, XHR, WebSocket, `GM_xmlhttpRequest`, external
   images, fonts or analytics. The README promises users this.
3. **Change Agileday data only through its UI.** Type into Agileday's inputs (native
   `value` setter + bubbling `input`/`change` events) and click its buttons. Never call
   Agileday's API directly.
4. **Prefix everything you add with `pj-`**: classes, ids, `data-pj-*` attributes,
   `localStorage`/`sessionStorage` keys, CSS custom properties.
5. **Keep the metadata block uniform**: `@namespace alfameCom.agileday-tampermonkey-scripts`,
   `@match https://*.agileday.io/*` (never one organisation's subdomain), `@grant none`
   unless a `GM_*` API is required, `@run-at document-idle`, and `@updateURL` /
   `@downloadURL` / `@require` pointing to
   `https://raw.githubusercontent.com/alfameCom/agileday-tampermonkey-scripts/main/…`.
6. **Keep documentation in sync in the same change:**
   - user-visible behaviour → the script's section in `README.md` (and the table at the
     top if the one-line summary changed);
   - selectors, texts, attributes or React props the script relies on →
     `docs/AGILEDAY-DOM.md`;
   - new script → both, plus the *Scripts* table and the README's *Contents*.
7. **Keep everything generic.** No organisation, customer, project or person names,
   organisation subdomains (`acme.agileday.io`; write `*.agileday.io` or <!-- generic-check: allow -->
   `<organisation>.agileday.io`), issue keys, e-mail addresses or other real data in
   code, comments, docs, examples, commit messages or screenshots. Use placeholders such
   as *Jane Doe*, *Customer A Ltd*, *Project A*, *Task 1*. Screenshots are taken with
   `agileday-demo-mode` on (Ctrl+Alt+D), and you must look at every new image before
   committing it: the automated check cannot read images.
   `node scripts/check-generic.js` enforces the text part; never weaken its rules or add
   `generic-check: allow` to get real data through.
8. **Language:** documentation is English. Code comments and the texts the scripts show
   on the page are Finnish today; keep each file consistent with itself. When you add a
   Finnish UI text, add its English meaning to the README.

## How the code works (short version)

- Agileday re-renders at any time and navigates without page loads. Scripts therefore
  observe `document.body` with a `MutationObserver`, debounce (100–200 ms) and call an
  idempotent `run()` that only writes to the DOM when something differs. Writing
  unconditionally makes the observer trigger itself in a loop.
- Prefer stable hooks: `data-testid`, ARIA roles/attributes, `data-field`, MUI component
  classes (`.MuiDataGrid-row`). Never use generated classes like `css-1a2b3c`.
- Each script registers `pjHealth` checks for the elements it cannot work without and
  wraps `run()` and event handlers in `health.guard()`. A check returns `true`, `false`
  or `null` (cannot check on this page, e.g. empty week).
- `agileday-my-hours` reaches into React internals (`__reactFiber$…`) for the MUI
  DataGrid `apiRef` and the date range picker's `onChange`. It is the most fragile code
  here. Anything new built on it must keep a DOM-level fallback.
- Every script has `const DEBUG = false;` near the top for console logging. Leave it
  `false` in commits.

## Verifying a change

You cannot open Agileday yourself; it needs a logged-in user. Do what you can, then hand
over precise manual test steps.

1. Syntax and genericity, always:

   ```sh
   for f in *.user.js lib/*.js scripts/*.js; do node --check "$f" || echo "FAIL $f"; done
   node scripts/check-generic.js
   ```

   The same runs in the pre-commit hook (`git config core.hooksPath .githooks`) and in
   CI on every push and pull request.

2. Pure logic (date ranges, `h:mm` parsing, sorting, grouping) can be tested by
   extracting the function into a quick `node -e` script. Do so when you touch it.
3. Ask the user for the manual checks in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#testing)
   that apply: navigation without reload, empty week, submitted/unsubmitted week, locked
   previous-month cells, `#pj-health-test`, and my-hours together with demo mode.
4. If you need to know Agileday's markup, do not guess selectors. Ask the user to run in
   the browser console, for example,
   `copy(document.querySelector('<css>').outerHTML)` and paste the result, and check
   [docs/AGILEDAY-DOM.md](docs/AGILEDAY-DOM.md) first.

Report honestly what you verified yourself and what still needs the user's check in a
real Agileday tenant.

## Typical tasks

**A script stopped working after an Agileday release.** Get the health notice text from
the user; it names the script and the failing check. Find the selector in
`docs/AGILEDAY-DOM.md`, ask for the current markup of that part of the page, update the
selector (and its health check and the DOM doc), raise `@version`.

**Add a feature to an existing script.** Read the whole script first; most are 100–300
lines (`agileday-my-hours` is ~1000). Follow its existing structure and naming. Add a
health check if the feature needs new page elements.

**Add a new script.** Copy the metadata block and skeleton from
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#how-a-script-is-put-together), name it
`agileday-<feature>.user.js` with `@name Agileday: …`, start at `@version 0.1.0`, and
update the README (*Contents*, *Scripts* table, *Features* section) and
`docs/AGILEDAY-DOM.md`.

## Git

- One logical change per commit; the message says which script and version, e.g.
  `agileday-day-colors 0.3.0: weekend columns dimmed`.
- Do not commit `*.options.json`, `*.storage.json` (Tampermonkey exports) or `.DS_Store`.
- Pull requests go to `main`. Merging to `main` releases to every user at their next
  Tampermonkey update check, so do not merge untested changes.
