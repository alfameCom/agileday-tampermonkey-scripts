# Contributing

Bug reports, fixes and new scripts are welcome.

## Reporting a problem

[Open an issue](https://github.com/alfameCom/agileday-tampermonkey-scripts/issues) and include:

- the script name and its version (Tampermonkey dashboard),
- the text of the yellow health notice, if one appeared,
- the page and what you did (for example "My hours, Current week, grouping Day"),
- your browser and Tampermonkey version.

Please do not attach screenshots with real names or customers. `agileday-demo-mode`
(Ctrl+Alt+D) replaces them with placeholders.

## Changing a script

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). In short:

1. Raise `@version` in the script you change.
2. Enable the checks once with `git config core.hooksPath .githooks`. They run
   `node --check` and `node scripts/check-generic.js` before every commit. The second
   one keeps organisation, customer and person data out of the repository; see
   [Keeping the repository generic](docs/DEVELOPMENT.md#keeping-the-repository-generic).
3. Test against a real Agileday tenant, including navigation without reloading.
4. Update the README if users see a difference, and
   [docs/AGILEDAY-DOM.md](docs/AGILEDAY-DOM.md) if the script depends on different
   parts of Agileday's page.
5. Open a pull request to `main`.
