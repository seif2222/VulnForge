import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { StructureEntryPayload } from './api.js';
import type { Report } from './core.js';
import { findingRows, packageName, rowForPackage } from './structure-map.js';

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../fixtures/reports/with-vulnerabilities.json', import.meta.url),
    ),
    'utf8',
  ),
) as Report;

function entry(path: string, depth: number, kind: 'dir' | 'file' = 'dir'): StructureEntryPayload {
  const name = path.split('/').pop() ?? path;
  return { path, name, kind, depth };
}

const TREE: readonly StructureEntryPayload[] = [
  entry('node_modules', 0),
  entry('node_modules/@scope', 1),
  entry('node_modules/@scope/left-pad', 2),
  entry('node_modules/lodash', 1),
  entry('src', 0),
  entry('package.json', 0, 'file'),
];

describe('structure mapping', () => {
  it('strips versions from package identities, scoped included', () => {
    expect(packageName('lodash@4.17.20')).toBe('lodash');
    expect(packageName('@scope/left-pad@1.0.0')).toBe('@scope/left-pad');
    expect(packageName('lodash')).toBe('lodash');
  });

  it('maps a package to its real installed directory row', () => {
    expect(rowForPackage(TREE, 'lodash@4.17.20')).toBe(3);
    expect(rowForPackage(TREE, '@scope/left-pad@1.0.0')).toBe(2);
  });

  it('falls back to the root manifest row when the package is not installed', () => {
    expect(rowForPackage(TREE, 'minimist@1.2.5')).toBe(5);
  });

  it('answers -1 when no honest row exists', () => {
    expect(rowForPackage([entry('src', 0)], 'lodash@4.17.20')).toBe(-1);
  });

  it("lights the rows of the report's real vulnerable packages with worst severity", () => {
    const tree: readonly StructureEntryPayload[] = [
      entry('node_modules', 0),
      entry('node_modules/PyYAML', 1),
      entry('node_modules/requests', 1),
      entry('requirements.txt', 0, 'file'),
    ];
    const rows = findingRows(tree, fixture);
    // fixture: PyYAML critical, requests high+critical? - worst severity wins per row
    expect(rows.get(1)).toBe('critical');
    expect(rows.get(2)).toBe(
      fixture.vulnerabilities.find((v) => v.package === 'requests')?.severity,
    );
    // Jinja2 is not installed under node_modules, so it lights the manifest
    // row where its requirement is declared - the honest spot for it.
    expect(rows.get(3)).toBe('medium');
  });
});
