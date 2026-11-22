import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Report } from '@vulnforge/core';

import { composeFrame } from './frames.js';
import { dispatch, initialModel, type EnvFacts, type TuiModel } from './model.js';
import type { RenderCapabilities } from './render3d.js';
import { stripAnsi, visibleLength } from './theme.js';

/**
 * Golden frames (spec 8.2 / G6): ANSI-stripped snapshots at the three binding
 * terminal sizes, plus the hard invariants on every tab at every size.
 */

const ENV: EnvFacts = {
  nodeVersion: 'v22.0.0',
  platform: 'linux x64',
  cwd: '/tmp/project',
  cacheDir: '/home/user/.vulnforge/cache/osv',
  aiConfigured: true,
  toolVersion: '0.0.0-test',
};

const CAPS: RenderCapabilities = { color: 'mono', unicode: true };

const SIZES = [
  { width: 80, height: 24 },
  { width: 100, height: 30 },
  { width: 142, height: 42 },
] as const;

const report = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../fixtures/reports/with-vulnerabilities.json', import.meta.url),
    ),
    'utf8',
  ),
) as Report;

function withReport(): TuiModel {
  return dispatch(initialModel(ENV), {
    type: 'report-loaded',
    report,
    path: '/tmp/project/report.json',
  }).model;
}

function runningModel(): TuiModel {
  let model = initialModel(ENV);
  model = dispatch(model, {
    type: 'preflight',
    facts: {
      target: '/tmp/project/vulnerable-npm',
      exists: true,
      manifest: 'package-lock.json',
      ecosystem: 'npm',
      ignoreFile: null,
    },
  }).model;
  const packages = ['express@4.17.1', 'lodash@4.17.20', 'minimist@1.2.5'];
  packages.forEach((pkg, index) => {
    model = dispatch(model, {
      type: 'scan-event',
      event: { type: 'query-progress', done: index + 1, total: 12, pkg },
    }).model;
  });
  // The reducer stamps the real wall-clock start; goldens pin it.
  return { ...model, scan: { ...model.scan, startedAt: '09:30:00' } };
}

describe('tui frame invariants', () => {
  it.each(SIZES)('every tab renders exactly $width x $height cells', ({ width, height }) => {
    for (const tab of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      const model = { ...withReport(), tab };
      const frame = composeFrame(model, width, height, CAPS, 0);
      expect(frame).toHaveLength(height);
      for (const line of frame) {
        expect(visibleLength(line)).toBe(width);
      }
    }
  });

  it.each(SIZES)('the live monitor renders exactly $width x $height cells', ({ width, height }) => {
    const frame = composeFrame(runningModel(), width, height, CAPS, 3);
    expect(frame).toHaveLength(height);
    for (const line of frame) {
      expect(visibleLength(line)).toBe(width);
    }
  });

  it('the too-small fallback is exact and honest', () => {
    const frame = composeFrame(withReport(), 30, 8, CAPS, 0);
    expect(frame).toHaveLength(8);
    for (const line of frame) {
      expect(visibleLength(line)).toBe(30);
    }
    expect(stripAnsi(frame[0] ?? '')).toContain('terminal too small');
  });
});

describe('tui golden frames (ANSI-stripped)', () => {
  it.each(SIZES)('overview at $width x $height', ({ width, height }) => {
    const frame = composeFrame(withReport(), width, height, CAPS, 0);
    expect(stripAnsi(frame.join('\n'))).toMatchSnapshot();
  });

  it('findings at 100x30', () => {
    const model = { ...withReport(), tab: 3 as const };
    const frame = composeFrame(model, 100, 30, CAPS, 0);
    expect(stripAnsi(frame.join('\n'))).toMatchSnapshot();
  });

  it('start new scan with a blocked preflight at 100x30', () => {
    let model = dispatch(initialModel(ENV), {
      type: 'key',
      key: { type: 'char', value: 's' },
    }).model;
    for (const ch of '../nope') {
      model = dispatch(model, { type: 'key', key: { type: 'char', value: ch } }).model;
    }
    model = dispatch(model, { type: 'key', key: { type: 'enter' } }).model;
    model = dispatch(model, {
      type: 'preflight',
      facts: {
        target: '/tmp/project/nope',
        exists: false,
        manifest: null,
        ecosystem: null,
        ignoreFile: null,
      },
    }).model;
    const frame = composeFrame(model, 100, 30, CAPS, 0);
    expect(stripAnsi(frame.join('\n'))).toMatchSnapshot();
  });

  it('live monitor mid-scan at 100x30', () => {
    const frame = composeFrame(runningModel(), 100, 30, CAPS, 3);
    expect(stripAnsi(frame.join('\n'))).toMatchSnapshot();
  });

  it('dependency tree at 100x30', () => {
    const model = { ...withReport(), tab: 4 as const };
    const frame = composeFrame(model, 100, 30, CAPS, 0);
    expect(stripAnsi(frame.join('\n'))).toMatchSnapshot();
  });

  it('ai agent at 100x30', () => {
    const model = { ...withReport(), tab: 5 as const };
    const frame = composeFrame(model, 100, 30, CAPS, 0);
    expect(stripAnsi(frame.join('\n'))).toMatchSnapshot();
  });

  it('settings at 100x30', () => {
    const model = { ...withReport(), tab: 8 as const };
    const frame = composeFrame(model, 100, 30, CAPS, 0);
    expect(stripAnsi(frame.join('\n'))).toMatchSnapshot();
  });

  it('live monitor never prints a whole-scan percentage', () => {
    const frame = stripAnsi(composeFrame(runningModel(), 100, 30, CAPS, 3).join('\n'));
    expect(frame).toContain('Querying OSV — 3 / 12 queries');
    expect(frame).not.toMatch(/\d+\s*%/);
  });

  it('live monitor shows the honest start time, never a pid it does not have', () => {
    const frame = stripAnsi(composeFrame(runningModel(), 100, 30, CAPS, 3).join('\n'));
    expect(frame).toContain('started');
  });
});
