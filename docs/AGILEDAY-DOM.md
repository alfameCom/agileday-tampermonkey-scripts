# What the scripts depend on in Agileday

This document is for Agileday's developers. It lists every part of Agileday's page the
userscripts in this repository rely on, so that you can see which changes would break
them. It also describes which gaps in the time reporting UX each script fills, in case
that is useful as product input.

None of the scripts call Agileday's APIs or make any network requests. Everything below
is about the rendered page: selectors, attributes, visible texts and, in one script, React
component props.

If you change one of these parts, the scripts' shared health check shows users a yellow
"⚠ Agileday-skripti ei toimi odotetusti" ("An Agileday script is not working as
expected") notice naming the script and the missing part. That is intended. A broken
script then fails visibly instead of doing something wrong, and we update it. A heads-up
before a larger change to the time card or My hours is always welcome, but not expected.

## Summary: the most fragile dependencies

| Dependency | Used by |
|---|---|
| `data-testid` values `project-row`, `task-row` on time card rows | accordion, drag-clone |
| `data-testid` prefix `input-` on hour inputs | accordion, drag-clone |
| `data-testid` `total-YYYY-MM-DD` on summary row cells | sticky-totals, day-colors, accordion |
| Summary cell structure: one wrapper element whose first two children are *Reported* and *Flex*, as `h:mm` or `-` | day-colors |
| Day columns aligned by `cellIndex` across all rows of the time card table, header row included | day-colors |
| `svg[data-testid="CommentAdded2Icon"]` for a filled comment, **with the comment text in its `aria-label`** | copy-comments, drag-clone |
| Comment popover `.MuiPopover-paper` with a `textarea`, and the first `button` in it being *save* | drag-clone |
| Button labels `Submit`, `Current month`, `Current year`; text `Agent`; chip text `UNSUBMITTED`; the word *freeze*/*frozen* in the freeze notice | sticky-totals, accordion, my-hours |
| My hours MUI DataGrid: `role`, `aria-expanded`, `aria-level`, `data-id`, `data-field`; field names `__tree_data_group__`, `date`, `project`, `task`, `description`; a header title starting with *Actual* | my-hours, demo-mode |
| My hours: DataGrid `apiRef` and the date range picker's `onChange`/`onAccept`, reached through React fiber props | my-hours |

The last row is the one we know is fragile. It has DOM fallbacks, but they are weaker.
A public, stable way to do the same would help: for example URL parameters for the date
range and a persisted column layout. See [UX gaps](#ux-gaps-the-scripts-fill).

## Routes

- **Time card:** `/hours` with no `tab` or `tab=timecard`, week view (`view` / `mode`
  missing or containing `week`). Health checks run only here, except for my-hours.
- **My hours:** `/hours?tab=hoursActuals`. `agileday-my-hours` is active only here and
  removes everything it added when you leave the tab.
- Every script matches `https://*.agileday.io/*` and runs at `document-idle`. Apart from
  my-hours, the scripts do not check the route themselves: they act wherever their
  selectors match, and re-run on DOM mutations (debounced 100–200 ms) because Agileday is
  a single-page app.

## Per script

### agileday-sticky-totals

Keeps the summary row (*Reported hours*, *Flex time*, *Total flex time*) pinned above
the Submit bar.

- Summary row: `tr:has(> td[data-testid^="total-"])`.
- Submit bar: the first `button` whose trimmed text is exactly `Submit`, then its
  nearest ancestor with computed `position: sticky` or `fixed`. The bar's height is
  followed with a `ResizeObserver`.
- Visual only: makes the row's cells `position: sticky`. No clicks, no value changes.
- Health checks: the summary row exists; the Submit bar is found.

### agileday-copy-comments

Right-click on a filled comment icon copies the comment to the clipboard.

- Filled comment: `svg[data-testid="CommentAdded2Icon"]` in the clicked cell. **The
  text is read from the icon's `aria-label`.** This is what makes it work in locked
  previous-month cells too, where the popover cannot be opened.
- Hit test by coordinates (icon rectangle + 6 px), because in locked cells a disabled
  overlay on top of the icon receives the event.
- Capture-phase `contextmenu` listener; the default menu is suppressed only over a filled
  icon. Copies with `GM_setClipboard`.
- Health check: among filled cells, at least one has `svg[data-testid*="Comment"]`.

### agileday-day-colors

Highlights today, colours *Reported* / *Flex* by how full the day is, dims future days.

- Day columns: `td[data-testid^="total-"]`, date parsed from the `YYYY-MM-DD` suffix.
  The column is the cell's `cellIndex`, assumed to line up in every row of the table,
  header (`th`) included.
- Values: `td.firstElementChild.children[0]` (Reported) and `[1]` (Flex), parsed as
  `[+-]h:mm`; a lone `-` means no target (weekends, days off). The day's target is
  *Reported − Flex*.
- Visual only: adds classes and a CSS custom property to the day column's cells, and
  inline colour on the two values. Re-runs every minute so that "today" moves at midnight.
- Health checks: a `total-YYYY-MM-DD` cell exists; the first one has at least two
  children.

### agileday-drag-clone

Alt + drag a filled cell onto another day of the same task copies hours and comment;
Alt + × clears a cell. **This is the script that changes data**, always through
Agileday's own UI.

- Rows and inputs: `tr[data-testid="task-row"]`, `input[data-testid^="input-"]`.
  Locked cells: `input.disabled` / `input.readOnly`.
- Comment source: `svg[data-testid="CommentAdded2Icon"]` `aria-label`.
- Writing hours: `focus()`, the native `HTMLInputElement` `value` setter, bubbling
  `input` and `change` events, `blur()`. The value is copied verbatim.
- Writing the comment:
  1. Wait (up to 3 s) for the cell's first enabled `button` (the comment button, which
     appears once the cell has hours) and click it.
  2. Wait for `.MuiPopover-paper textarea:not([aria-hidden])`, set the text the same way.
  3. Wait for the popover's **first `button`** to be enabled (assumed to be *save*),
     click it, wait for the popover to close.
- Captures `pointerdown` / `pointermove` / `pointerup` (and `click` while Alt is held)
  so Agileday does not focus the field or open the comment during a drag.
- Health check: task rows with hour inputs exist. At runtime it reports a problem if the
  comment button, the popover or its save button cannot be found.

### agileday-accordion

Collapsible project groups, collapsible Submit/Agent bars, dismissible freeze notice.

- Project rows `tr[data-testid="project-row"]`, task rows `tr[data-testid="task-row"]`.
  **Task rows are assumed to follow their project row directly as sibling `tr`s.**
  Project name: `cells[0].firstElementChild.textContent`.
- Whether a project has hours: `input[data-testid^="input-"]` values.
- Week identity: the `data-testid` of the first `td[data-testid^="total-"]`.
- Clicks on `button, input, a, [role="button"], .MuiPopover-root` inside a project row
  are left to Agileday.
- Submit bar: first `button` matching `/submit/i` outside the table (fallback: first
  `.MuiChip-root`), then the nearest `sticky`/`fixed` ancestor. Status: a `.MuiChip-root`
  in the bar with text matching `/unsubmitted/i`.
- Agent bar: a leaf element with text exactly `Agent` within 120 px of the viewport
  bottom, then its widest ancestor (≥ 50 % of the viewport width, < 100 px tall).
- Freeze notice: a text node matching `/\b(freeze|frozen)\b/i`, then the first ancestor
  wider than 300 px with a top border or a background.
- Hides rows and bars with CSS; no clicks into Agileday, no value changes.
- Health checks: project rows and task rows exist (when the week has inputs); the Submit
  bar is found.

### agileday-my-hours

Quick ranges, expand/collapse all, custom grouping with sorting and filters, persistent
column widths, column hiding and order, on the My hours tab.

- **Placement:** buttons found by exact text `Current month` (quick ranges go before it)
  and `Current year` (the other buttons go after it). The new buttons copy the anchor's
  `className` to look like MUI buttons.
- **Grid:** `.MuiDataGrid-root`, `.MuiDataGrid-virtualScroller`. Group rows
  `[role="row"][aria-expanded]` with `aria-level`, leaf rows
  `.MuiDataGrid-row[role="row"]:not([aria-expanded])`, row id `data-id`. The first
  `button` in a group row is the expand toggle. Cells `[role="gridcell"][data-field]`.
- **Headers:** `[role="columnheader"][data-field]`, title
  `.MuiDataGrid-columnHeaderTitle`, resize handle
  `.MuiDataGrid-columnSeparator--resizable`. The hours column is the one whose title
  starts with *Actual*. Field names used: `__tree_data_group__`, `date`, `project`, `task`.
- **Formats:** hours `-?h:mm`; grid dates must be parseable by `Date.parse()`; the range
  field is `DD/MM/YYYY – DD/MM/YYYY` (separators copied from what the field shows).
- **React internals:**
  - DataGrid API: walks `__reactFiber$…` up from `.MuiDataGrid-root` looking for
    `apiRef` / `privateApiRef` / `value` whose `.current` has `setColumnWidth`,
    `setColumnVisibility` and `getColumn` (plus `getAllColumns`, `setColumnIndex` for
    order). Fallback: CSS on `[data-field="…"]` (`display`, width, flex `order`).
  - Date range: from the range input's fiber, up to 80 levels, a props object with a
    two-item `value` array and `onChange` (optional `onAccept`), and the
    LocalizationProvider adapter's `utils.date`. Quick ranges call
    `onChange(value, { validationError: [null, null] })` and `onAccept(value)`.
    Fallback: select the field and dispatch a synthetic `paste`.
- **Interaction:**
  - Expand/collapse all clicks Agileday's own group toggles, scrolling the virtual
    scroller because only visible rows are rendered.
  - Custom grouping moves the grid off-screen (still in the DOM), expands all groups,
    reads every leaf row, and renders its own table in front of it. It re-reads when the
    top-level rows change.
  - Column resizing: the script listens to pointer events on the separators and applies
    widths with `setColumnWidth`. For the tree column it handles resizing itself,
    because Agileday resets that column's width.
- **Storage:** `localStorage['pj-myhours-cols']` (widths, hidden columns, order,
  grouping, sort).
- **Health checks** (My hours only): `Current year` and `Current month` buttons, the
  date range input, column headers, group rows.

### agileday-demo-mode

Replaces names with placeholders for screen recordings (Ctrl+Alt+D or `#pj-demo`).

- My hours grid cells `[role="gridcell"][data-field]` with `data-field` `project`,
  `task`, `description` and `__tree_data_group__`. For the tree column the row's
  `aria-level` decides the kind: `1` person, `2` *Customer · Project* (split on
  `' · '`), `3` task.
- Hides `.MuiAvatar-root img`.
- Rewrites text node contents in place from a `MutationObserver` callback, which runs
  before paint. Outside the grid, only values already seen in the grid are replaced.
- No health checks.

## Storage keys

All keys start with `pj-`.

| Key | Storage | Script |
|---|---|---|
| `pj-myhours-cols` | localStorage | my-hours |
| `pj-demo-map` | localStorage | demo-mode |
| `pj-demo` | sessionStorage | demo-mode |
| `pj-health-dismissed` | sessionStorage | `lib/pj-health.js` |

The scripts also add elements, classes and `data-*` attributes to the page, all
prefixed `pj-` (for example `#pj-health`, `.pj-sticky-totals`, `data-pj-acc`), and set
`data-pj-demo` / `data-pj-dates` on `<html>`.

## UX gaps the scripts fill

What users were missing:

- **Copying entries across days** (drag-clone). Repeating the same hours and comment on
  several days means typing them again, and opening the comment dialog each time. A
  copy/fill gesture, or a "copy to…" action on a cell, would cover this.
- **Long time cards** (accordion). With many projects the week view gets long, and
  projects without hours this week take as much space as active ones. The sticky
  Submit and Agent bars and the freeze notice permanently cover part of the screen even
  after the week is submitted.
- **Losing sight of the totals** (sticky-totals). The *Reported hours* row scrolls away
  while you enter hours further up.
- **Seeing today and gaps at a glance** (day-colors). The time card does not mark today,
  and under-reported past days do not stand out.
- **Reading and reusing comments** (copy-comments). There is no quick way to read or
  copy a comment, and in locked previous-month cells the comment cannot be opened at all.
- **My hours** (my-hours):
  - no presets for today, the last work day or the current week;
  - groups can only be opened one at a time;
  - there is one fixed grouping (employee → customer · project → task); a flat or per-day
    view is what you need to check a week against a calendar;
  - no sorting or filtering within groups;
  - column widths and layout are not remembered between visits.
- **Recording the UI safely** (demo-mode). There is no demo or privacy mode for
  screenshots, recordings and support tickets.

## Checking that the scripts still work

Open the time card or My hours with `#pj-health-test` at the end of the URL and reload.
Every installed script that uses the health check adds a test line to the notice. Then
remove the hash: if no notice appears within about 10 seconds, the checks pass.
