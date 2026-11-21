#!/usr/bin/env node
/**
 * Encoding gate: every tracked source file must be UTF-8 without BOM and use LF line
 * endings. CRLF, lone CR, BOMs and invalid UTF-8 fail the gate. Binary extensions are
 * skipped. Run as part of `pnpm verify` before formatting, building and testing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vitest', '.pnpm-store']);
const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.zip',
  '.gz',
  '.tar',
  '.pdf',
]);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...walk(full));
    } else if (!SKIP_EXTENSIONS.has(extname(entry).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

/** @param {Buffer} buffer @returns {string | null} problem description, null when clean */
function inspect(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'UTF-8 BOM';
  }
  const text = new TextDecoder('utf-8', { fatal: true });
  let decoded;
  try {
    decoded = text.decode(buffer);
  } catch {
    return 'not valid UTF-8';
  }
  if (decoded.includes('\r\n')) return 'CRLF line endings';
  if (decoded.includes('\r')) return 'lone CR line endings';
  return null;
}

const problems = [];
for (const file of walk(ROOT)) {
  const problem = inspect(readFileSync(file));
  if (problem !== null) {
    problems.push(`${relative(ROOT, file)}: ${problem}`);
  }
}

if (problems.length > 0) {
  console.error(`encoding gate failed (${problems.length} file(s)):`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}
console.log('encoding gate: all files are UTF-8, no BOM, LF');
