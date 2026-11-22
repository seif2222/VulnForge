import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Report } from '@vulnforge/core';
import { createDashboardHistory } from './dashboard-history.js';
const report = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/reports/with-vulnerabilities.json', import.meta.url)),
    'utf8',
  ),
) as Report;
describe('dashboard history on disk', () => {
  it('reopens a completed report after a new server store is created', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-history-'));
    try {
      const path = join(dir, 'history.json');
      createDashboardHistory(path).add(report);
      const restored = createDashboardHistory(path).snapshot();
      expect(restored.warning).toBeNull();
      expect(restored.reports).toEqual([report]);
      const store = createDashboardHistory(path);
      store.add(report);
      expect(store.snapshot().reports).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('protects unreadable existing history and reports save failures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-history-'));
    try {
      const path = join(dir, 'history.json');
      writeFileSync(path, 'corrupt');
      const store = createDashboardHistory(path);
      store.add(report);
      expect(store.snapshot().warning).not.toBeNull();
      expect(readFileSync(path, 'utf8')).toBe('corrupt');
      const blocked = createDashboardHistory(join(path, 'nested.json'));
      blocked.add(report);
      expect(blocked.snapshot().warning).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
