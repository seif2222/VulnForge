import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, relative, resolve } from 'node:path';

export const SOURCE_CONTRACT = 'forge-source-v1';
export const SOURCE_THRESHOLD = 0;
const MAX_CHARS = 3500;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 100;
const MAX_FUNCTIONS = 200;
const MAX_ENTRIES = 10000;
const EXCLUDED = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', 'vendor']);

export interface SourceFunction {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly code: string;
}
export interface SourcePrediction {
  readonly functionId: string;
  readonly score: number;
  readonly candidate: boolean;
  readonly status: 'unconfirmed-model-prediction';
  readonly severity: 'unknown';
}
export interface SourceReport {
  readonly schemaVersion: 'forge-source-report-v1';
  readonly detector: 'forge-experimental';
  readonly status: 'completed' | 'partial' | 'unavailable';
  readonly modelId: string | null;
  readonly adapterSha256: string | null;
  readonly threshold: number;
  readonly scoreMeaning: 'logit(yes)-logit(no), not a calibrated probability';
  readonly functions: readonly Omit<SourceFunction, 'code'>[];
  readonly predictions: readonly SourcePrediction[];
  readonly skipped: readonly { path: string; reason: string }[];
  readonly warnings: readonly string[];
}

/** Conservative C-only heuristic, not a complete C parser. Mask strings/comments
 * before brace matching. Unsupported constructs are coverage gaps, never safe. */
export function extractCFunctions(source: string, path: string): SourceFunction[] {
  const masked = source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/gu,
    (match) => match.replace(/[^\n]/gu, ' '),
  );
  const result: SourceFunction[] = [];
  let depth = 0;
  let boundary = 0;
  let start = -1;
  let name = '';
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{') {
      if (depth === 0) {
        const header = masked.slice(boundary, i);
        const match = /([A-Za-z_]\w*)\s*\([^;{}]*\)\s*$/u.exec(header);
        if (match !== null && !['if', 'for', 'while', 'switch'].includes(match[1] ?? '')) {
          const lines = header.split('\n');
          // Ignore preprocessor lines; their semantics remain unsupported.
          const cleanHeader = lines
            .map((line) => (/^\s*#/u.test(line) ? ' '.repeat(line.length) : line))
            .join('\n');
          const offset = cleanHeader.search(/\S/u);
          start = offset < 0 ? -1 : boundary + offset;
          name = match[1] ?? '';
        }
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth < 0) return [];
      if (depth === 0) {
        if (start >= 0) {
          const code = source.slice(start, i + 1);
          result.push({
            id: createHash('sha256').update(`${path}\0${start}\0${code}`).digest('hex'),
            path,
            name,
            code,
            startLine: source.slice(0, start).split('\n').length,
            endLine: source.slice(0, i + 1).split('\n').length,
          });
        }
        boundary = i + 1;
        start = -1;
      }
    } else if (ch === ';' && depth === 0) {
      boundary = i + 1;
    }
  }
  return depth === 0 ? result : [];
}

export function validateSourceEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  // Source code cannot leave this machine in v1. No redirects, credentials or query secrets.
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Forge source v1 requires an HTTP loopback IP endpoint (127.0.0.1 or [::1])');
  }
  return url;
}

export async function scanSource(
  projectDir: string,
  options: { endpoint: string; threshold?: number; signal?: AbortSignal; fetch?: typeof fetch },
): Promise<SourceReport> {
  const endpoint = validateSourceEndpoint(options.endpoint);
  const threshold = options.threshold ?? SOURCE_THRESHOLD;
  if (!Number.isFinite(threshold)) throw new Error('threshold must be finite');
  const root = realpathSync(resolve(projectDir));
  const skipped: { path: string; reason: string }[] = [];
  const functions: SourceFunction[] = [];
  let files = 0;
  let entries = 0;
  const walk = (dir: string, level: number): void => {
    if (level > 20) {
      skipped.push({ path: relative(root, dir), reason: 'depth limit' });
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      entries++;
      if (entries > MAX_ENTRIES) {
        skipped.push({ path: '.', reason: 'entry limit' });
        return;
      }
      const absolute = join(dir, entry.name);
      const path = relative(root, absolute).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) {
        skipped.push({ path, reason: 'symlink not followed' });
        continue;
      }
      if (entry.isDirectory()) {
        if (EXCLUDED.has(entry.name) || entry.name.startsWith('.')) {
          skipped.push({ path, reason: 'excluded directory' });
        } else walk(absolute, level + 1);
        continue;
      }
      if (extname(entry.name) !== '.c') continue;
      if (++files > MAX_FILES) {
        skipped.push({ path, reason: 'C file limit' });
        continue;
      }
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        skipped.push({ path, reason: 'not regular or oversized file' });
        continue;
      }
      const source = readFileSync(absolute, 'utf8');
      if (/^\s*#\s*(if|ifdef|ifndef|define)\b/mu.test(source)) {
        skipped.push({ path, reason: 'preprocessor conditionals/macros unsupported' });
        continue;
      }
      const extracted = extractCFunctions(source, path);
      if (extracted.length === 0)
        skipped.push({ path, reason: 'no supported C functions extracted' });
      for (const fn of extracted) {
        if (fn.code.length > MAX_CHARS || functions.length >= MAX_FUNCTIONS) {
          skipped.push({ path, reason: `${fn.name}: function length/count limit, not truncated` });
        } else functions.push(fn);
      }
    }
  };
  walk(root, 0);
  const predictions: SourcePrediction[] = [];
  const warnings = [
    'Experimental C-function classifier. False positives and false negatives are expected.',
    'No CVE, CWE, severity, exploitability or remediation is inferred. A negative prediction is not proof of safety.',
    'Function extraction is heuristic; C++, headers, macros, conditional compilation and cross-function context are unsupported.',
    'Threshold is uncalibrated; validate on a separate validation set, not the held-out test set.',
  ];
  let modelId: string | null = null;
  let adapterSha256: string | null = null;
  let failed = false;
  for (const fn of functions) {
    try {
      const response = await (options.fetch ?? fetch)(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal:
          options.signal === undefined
            ? AbortSignal.timeout(60000)
            : AbortSignal.any([options.signal, AbortSignal.timeout(60000)]),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contract: SOURCE_CONTRACT,
          functionId: fn.id,
          language: 'c',
          code: fn.code,
        }),
      });
      if (!response.ok) throw new Error('endpoint returned an error');
      // Bound streamed responses even when Content-Length is missing or false.
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error('empty endpoint response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
        if (done) break;
        if (value === undefined) throw new Error('invalid response stream');
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new Error('oversized endpoint response');
        }
        chunks.push(value);
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof value !== 'object' || value === null) throw new Error('invalid endpoint response');
      const data = value as Record<string, unknown>;
      if (
        data.contract !== SOURCE_CONTRACT ||
        data.functionId !== fn.id ||
        typeof data.score !== 'number' ||
        !Number.isFinite(data.score) ||
        typeof data.modelId !== 'string' ||
        data.modelId.length === 0 ||
        data.modelId.length > 200 ||
        typeof data.adapterSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(data.adapterSha256) ||
        data.truncated !== false
      )
        throw new Error('invalid or truncated endpoint response');
      if (modelId !== null && (modelId !== data.modelId || adapterSha256 !== data.adapterSha256)) {
        throw new Error('model identity changed during scan');
      }
      modelId = data.modelId;
      adapterSha256 = data.adapterSha256;
      predictions.push({
        functionId: fn.id,
        score: data.score,
        candidate: data.score >= threshold,
        status: 'unconfirmed-model-prediction',
        severity: 'unknown',
      });
    } catch {
      skipped.push({
        path: fn.path,
        reason: `${fn.name}: inference unavailable/invalid; remaining functions not attempted`,
      });
      failed = true;
      break;
    }
  }
  return {
    schemaVersion: 'forge-source-report-v1',
    detector: 'forge-experimental',
    status:
      failed && predictions.length === 0
        ? 'unavailable'
        : failed || skipped.length > 0 || functions.length === 0
          ? 'partial'
          : 'completed',
    modelId,
    adapterSha256,
    threshold,
    scoreMeaning: 'logit(yes)-logit(no), not a calibrated probability',
    functions: functions.map(({ code: _code, ...metadata }) => metadata),
    predictions,
    skipped,
    warnings,
  };
}
