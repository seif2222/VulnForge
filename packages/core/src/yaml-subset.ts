/**
 * The YAML subset pnpm lockfiles are written in: indentation-based block maps,
 * scalar sequences, single-line flow maps ({a: b}), and single/double-quoted
 * scalars. pnpm's lockfile emitter stays inside this subset. Anything outside
 * it (anchors, aliases, block scalars, tags, multi-line plain scalars, nested
 * maps inside sequences) throws instead of misparsing: a lockfile we cannot
 * read exactly is reported as unreadable, never guessed.
 */

export class YamlSubsetError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`YAML subset error on line ${line}: ${message}`);
    this.name = 'YamlSubsetError';
    this.line = line;
  }
}

const MAX_DEPTH = 100;

interface SourceLine {
  readonly line: number;
  readonly indent: number;
  readonly text: string;
}

function unquoteSingle(text: string, line: number): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      if (text[i + 1] === "'") {
        out += "'";
        i += 1;
        continue;
      }
      if (i !== text.length - 1) {
        throw new YamlSubsetError(line, 'unexpected character after closing quote');
      }
      return out;
    }
    out += ch;
  }
  throw new YamlSubsetError(line, 'unterminated single-quoted scalar');
}

function unquoteDouble(text: string, line: number): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) {
        break;
      }
      const simple: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
      const mapped = simple[next];
      if (mapped === undefined) {
        throw new YamlSubsetError(line, `unsupported escape \\${next}`);
      }
      out += mapped;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (i !== text.length - 1) {
        throw new YamlSubsetError(line, 'unexpected character after closing quote');
      }
      return out;
    }
    out += ch;
  }
  throw new YamlSubsetError(line, 'unterminated double-quoted scalar');
}

/** Splits `text` at the first `:` followed by a space or end-of-line, outside quotes. */
function splitKeyValue(text: string, line: number): [string, string] {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
        } else {
          quote = null;
        }
      } else if (quote === '"' && ch === '\\') {
        i += 1;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ':' && (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '\t')) {
      return [text.slice(0, i), text.slice(i + 1).trimStart()];
    }
  }
  throw new YamlSubsetError(line, `expected "key: value", got "${text}"`);
}

function parseScalar(text: string, line: number): string {
  if (text.startsWith("'")) {
    return unquoteSingle(text.slice(1), line);
  }
  if (text.startsWith('"')) {
    return unquoteDouble(text.slice(1), line);
  }
  if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) {
    throw new YamlSubsetError(line, 'anchors, aliases and tags are outside the subset');
  }
  if (text === '|' || text === '>' || text.startsWith('|-') || text.startsWith('>-')) {
    throw new YamlSubsetError(line, 'block scalars are outside the subset');
  }
  return text;
}

/** Splits flow-map content at top-level commas, respecting quotes. */
function splitFlowItems(text: string): string[] {
  const items: string[] = [];
  let quote: "'" | '"' | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === '\\') {
        i += 1;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ',') {
      items.push(text.slice(start, i));
      start = i + 1;
    }
  }
  items.push(text.slice(start));
  return items.map((item) => item.trim()).filter((item) => item !== '');
}

function parseFlowMap(text: string, line: number): Record<string, string> {
  const inner = text.slice(1, -1).trim();
  const result: Record<string, string> = {};
  if (inner === '') {
    return result;
  }
  for (const item of splitFlowItems(inner)) {
    const [key, value] = splitKeyValue(item, line);
    if (value === '') {
      throw new YamlSubsetError(line, `flow map entry "${key}" has no value`);
    }
    result[parseScalar(key, line)] = parseScalar(value, line);
  }
  return result;
}

/** Parses a single-line flow sequence of scalars: [arm, x64]. */
function parseFlowSequence(text: string, line: number): string[] {
  const inner = text.slice(1, -1).trim();
  if (inner === '') {
    return [];
  }
  return splitFlowItems(inner).map((item) => {
    const scalar = parseScalar(item, line);
    if (typeof scalar !== 'string') {
      throw new YamlSubsetError(line, 'flow sequences hold scalars only');
    }
    return scalar;
  });
}

function parseValue(text: string, line: number): unknown {
  if (text.startsWith('{')) {
    if (!text.endsWith('}')) {
      throw new YamlSubsetError(line, 'unterminated flow map');
    }
    return parseFlowMap(text, line);
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) {
      throw new YamlSubsetError(line, 'unterminated flow sequence');
    }
    return parseFlowSequence(text, line);
  }
  return parseScalar(text, line);
}

function preprocess(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const rawLines = text.split('\n');
  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i]?.replace(/\r$/, '') ?? '';
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) {
      continue;
    }
    if (raw.startsWith('\t')) {
      throw new YamlSubsetError(i + 1, 'tab indentation is outside the subset');
    }
    const indent = raw.length - raw.trimStart().length;
    lines.push({ line: i + 1, indent, text: raw.trimStart() });
  }
  return lines;
}

function parseBlock(
  lines: readonly SourceLine[],
  state: { index: number },
  indent: number,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) {
    throw new YamlSubsetError(lines[state.index]?.line ?? 0, 'nesting too deep');
  }
  const first = lines[state.index];
  if (first === undefined || first.indent < indent) {
    return null;
  }
  if (first.indent !== indent) {
    throw new YamlSubsetError(first.line, `unexpected indentation ${first.indent}, want ${indent}`);
  }

  if (first.text.startsWith('- ') || first.text === '-') {
    const items: string[] = [];
    while (state.index < lines.length) {
      const current = lines[state.index];
      if (current === undefined || current.indent !== indent || !current.text.startsWith('-')) {
        break;
      }
      const rest = current.text === '-' ? '' : current.text.slice(2).trim();
      if (rest === '') {
        throw new YamlSubsetError(current.line, 'nested blocks inside sequences are unsupported');
      }
      items.push(parseScalar(rest, current.line));
      state.index += 1;
    }
    return items;
  }

  const map: Record<string, unknown> = {};
  while (state.index < lines.length) {
    const current = lines[state.index];
    if (current === undefined || current.indent !== indent || current.text.startsWith('-')) {
      break;
    }
    const [rawKey, rawValue] = splitKeyValue(current.text, current.line);
    const key = parseScalar(rawKey, current.line);
    if (typeof key !== 'string') {
      throw new YamlSubsetError(current.line, 'map keys must be scalars');
    }
    state.index += 1;
    if (rawValue === '') {
      const next = lines[state.index];
      if (next !== undefined && next.indent > indent) {
        map[key] = parseBlock(lines, state, next.indent, depth + 1);
      } else {
        map[key] = null;
      }
    } else {
      map[key] = parseValue(rawValue, current.line);
    }
  }
  return map;
}

/** Parses a pnpm-lock.yaml-shaped document. Throws YamlSubsetError on anything else. */
export function parseYamlSubset(text: string): unknown {
  const lines = preprocess(text);
  if (lines.length === 0) {
    return null;
  }
  const state = { index: 0 };
  const document = parseBlock(lines, state, lines[0]?.indent ?? 0, 0);
  if (state.index < lines.length) {
    throw new YamlSubsetError(
      lines[state.index]?.line ?? 0,
      'unexpected content after document end',
    );
  }
  return document;
}
