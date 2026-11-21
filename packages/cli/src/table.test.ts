import { describe, expect, it } from 'vitest';

import type { Report } from '@vulnforge/core';

import { colorEnabled, progressEnabled, resolveColumns } from './progress.js';
import { renderTable, sortFindings } from './table.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const withVulnerabilities = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/reports/with-vulnerabilities.json', import.meta.url)),
    'utf8',
  ),
) as Report;

const clean = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/reports/clean.json', import.meta.url)),
    'utf8',
  ),
) as Report;

describe('renderTable', () => {
  it('lists every finding with its risk score, sorted by score desc', () => {
    const table = renderTable(withVulnerabilities, { color: false, columns: 100 });

    for (const finding of withVulnerabilities.vulnerabilities) {
      expect(table).toContain(finding.id);
      expect(table).toContain(finding.package);
      expect(table).toContain(finding.installedVersion);
    }
    const scoreOf = (key: string) =>
      withVulnerabilities.risk.find((entry) => entry.findingKey === key)?.priorityScore;
    expect(table).toContain(String(scoreOf('CVE-2020-14343|PyYAML@5.3.1')));

    // sort order: 95, 80, 60, 60
    const ids = sortFindings(withVulnerabilities).map((finding) => finding.id);
    expect(ids).toEqual(['CVE-2020-14343', 'CVE-2018-18074', 'CVE-2023-32681', 'CVE-2024-22195']);
  });

  it('is deterministic: same input, same bytes', () => {
    const a = renderTable(withVulnerabilities, { color: false, columns: 100 });
    const b = renderTable(withVulnerabilities, { color: false, columns: 100 });
    expect(a).toBe(b);
  });

  it('says so when there are no findings', () => {
    const table = renderTable(clean, { color: false, columns: 100 });
    expect(table).toContain('No known vulnerabilities found.');
    expect(table).toContain('0 findings');
  });

  it('colors severity rows only when asked', () => {
    const plain = renderTable(withVulnerabilities, { color: false, columns: 100 });
    const colored = renderTable(withVulnerabilities, { color: true, columns: 100 });
    expect(plain).not.toContain('\u001b[');
    expect(colored).toContain('\u001b[');
  });

  it('shrinks the ID column to fit narrow terminals', () => {
    const narrow = renderTable(withVulnerabilities, { color: false, columns: 60 });
    for (const line of narrow.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});

describe('progress and color gating', () => {
  it('renders progress only on a TTY, not quiet, not CI', () => {
    expect(progressEnabled({ isStderrTTY: true, quiet: false, env: {} })).toBe(true);
    expect(progressEnabled({ isStderrTTY: false, quiet: false, env: {} })).toBe(false);
    expect(progressEnabled({ isStderrTTY: true, quiet: true, env: {} })).toBe(false);
    expect(progressEnabled({ isStderrTTY: true, quiet: false, env: { CI: 'true' } })).toBe(false);
    expect(progressEnabled({ isStderrTTY: true, quiet: false, env: { CI: '' } })).toBe(true);
  });

  it('resolves color from flags and env in the right order', () => {
    const tty = { isStdoutTTY: true, env: {} };
    expect(colorEnabled({ noColor: false, ...tty })).toBe(true);
    expect(colorEnabled({ noColor: true, ...tty })).toBe(false);
    expect(colorEnabled({ noColor: false, isStdoutTTY: true, env: { NO_COLOR: '1' } })).toBe(false);
    expect(colorEnabled({ noColor: false, isStdoutTTY: false, env: { FORCE_COLOR: '1' } })).toBe(
      true,
    );
    expect(colorEnabled({ noColor: false, isStdoutTTY: false, env: {} })).toBe(false);
  });

  it('resolves columns: env override > tty > 80', () => {
    expect(resolveColumns({ VULNFORGE_COLUMNS: '120' }, 100)).toBe(120);
    expect(resolveColumns({}, 100)).toBe(100);
    expect(resolveColumns({}, undefined)).toBe(80);
    expect(resolveColumns({ VULNFORGE_COLUMNS: 'junk' }, undefined)).toBe(80);
  });
});
