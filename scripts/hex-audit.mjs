#!/usr/bin/env node
/**
 * hex-audit: product hex/rgba literals outside the token source and the two
 * generated files must be ZERO. Only rgba(0,0,0,x) shadows are allowed as
 * literals. Identity-colored rgba() must come from the emitter, not by hand.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const ALLOWED_FILES = new Set([
  'packages/core/src/design-tokens.ts',
  'packages/dashboard/src/design-tokens.generated.css',
  'packages/cli/src/colors.generated.ts',
]);

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/gu;
const RGBA_RE = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,[^)]*\)/gu;

const SCANNED_EXT = new Set(['.ts', '.tsx', '.css', '.html', '.mts']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (SCANNED_EXT.has(path.slice(path.lastIndexOf('.')))) {
      yield path;
    }
  }
}

let violations = 0;

for (const base of ['packages']) {
  for (const file of walk(join(ROOT, base))) {
    const rel = relative(ROOT, file);
    if (ALLOWED_FILES.has(rel)) continue;
    if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue; // tests pin literals on purpose
    const text = readFileSync(file, 'utf8');

    for (const match of text.matchAll(HEX_RE)) {
      console.log(`hex-audit: ${rel}: hex literal ${match[0]}`);
      violations += 1;
    }
    for (const match of text.matchAll(RGBA_RE)) {
      const [, r, g, b] = match;
      if (r === '0' && g === '0' && b === '0') continue; // shadow literal, allowed
      console.log(`hex-audit: ${rel}: non-shadow rgba literal ${match[0]}`);
      violations += 1;
    }
  }
}

console.log(violations === 0 ? 'hex-audit: 0 violations' : `hex-audit: ${violations} violation(s)`);
process.exit(violations === 0 ? 0 : 1);
