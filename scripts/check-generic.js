#!/usr/bin/env node
// Fails if the repository contains organisation-, customer- or person-specific data.
//
// The scripts and docs must stay generic: they work for every Agileday organisation and
// must not reveal anything about the organisation, customers or people of whoever wrote
// them. Run before committing (the pre-commit hook does this) and in CI:
//
//   node scripts/check-generic.js
//
// Two kinds of rules:
// - Built-in rules below catch data that is recognisable by its shape (organisation
//   subdomains, e-mail addresses, issue keys, phone numbers, personal identity codes).
// - A local, git-ignored deny list `.generic-denylist` catches names that have no
//   recognisable shape: your organisation's customers, projects, colleagues, internal
//   tools. One term per line, case-insensitive, `#` starts a comment. It never leaves
//   your machine, so the terms themselves are not published.
//
// A line can opt out of the built-in rules with the marker `generic-check: allow` in a
// comment on the same line. Use it sparingly and only for clearly generic examples.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DENYLIST = path.join(ROOT, '.generic-denylist');
const ALLOW_MARK = 'generic-check: allow';
const BINARY = /\.(png|jpe?g|gif|webp|ico|mp4|mov|zip|pdf)$/i;

const RULES = [
  {
    name: 'organisation-specific Agileday address (use *.agileday.io or <organisation>.agileday.io)',
    re: /(?<![\w*<>-])(?!www\.)[a-z0-9][a-z0-9-]*\.agileday\.io/gi,
  },
  {
    name: 'organisation-specific SaaS tenant address',
    re: /\b[a-z0-9][a-z0-9-]*\.(atlassian\.net|sharepoint\.com|slack\.com|visualstudio\.com|zendesk\.com|my\.salesforce\.com)\b/gi,
  },
  {
    name: 'e-mail address (example.com/org/net and GitHub noreply addresses are allowed)',
    re: /\b[\w.+-]+@(?!(example\.(com|org|net)|users\.noreply\.github\.com|noreply\.)\b)[\w-]+(\.[\w-]+)+\b/gi,
  },
  {
    name: 'issue key such as ABC-123 (Jira and similar trackers reveal customers and projects)', // generic-check: allow
    re: /\b(?!(UTF|ISO|SHA|RFC|ECMA|ES|WCAG|CVE|HTTP|TLS|AES|RSA|MD|X)-)[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g, // generic-check: allow
  },
  {
    name: 'phone number',
    re: /(?<![\w.])\+\d{1,3}[ -]?\(?\d{1,4}\)?([ -]?\d{2,4}){2,4}\b/g,
  },
  {
    name: 'Finnish personal identity code',
    re: /\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])\d{2}[-+ABCDEFUVWXY]\d{3}[0-9A-Y]\b/g,
  },
];

function files() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT, encoding: 'utf8',
  });
  return out.split('\n').filter((f) => f && !BINARY.test(f) && fs.existsSync(path.join(ROOT, f)));
}

function denyTerms() {
  if (!fs.existsSync(DENYLIST)) return [];
  return fs.readFileSync(DENYLIST, 'utf8').split('\n')
    .map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
    .map((t) => ({ term: t, re: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') }));
}

const terms = denyTerms();
const problems = [];

for (const file of files()) {
  if (file === '.generic-denylist') continue;
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    if (!line.includes(ALLOW_MARK)) {
      for (const rule of RULES) {
        for (const m of line.matchAll(rule.re)) problems.push(`${where}: ${rule.name}: "${m[0]}"`);
      }
    }
    // The deny list cannot be opted out of.
    for (const { term, re } of terms) {
      if (re.test(line)) problems.push(`${where}: term from .generic-denylist: "${term}"`);
      re.lastIndex = 0;
    }
  });
}

if (problems.length) {
  console.error('Organisation-, customer- or person-specific data found:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nReplace it with generic placeholders (see AGENTS.md, rule 7).');
  process.exit(1);
}
console.log(`check-generic: OK (${terms.length} local deny-list term${terms.length === 1 ? '' : 's'})`);
