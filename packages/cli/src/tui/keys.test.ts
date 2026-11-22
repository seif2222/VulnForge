import { describe, expect, it } from 'vitest';

import { createKeyParser } from './app.js';

/** The stateful byte parser: pastes, control keys and split sequences. */

describe('createKeyParser', () => {
  it('parses ordinary typing byte by byte', () => {
    const parse = createKeyParser();
    expect(parse(Buffer.from('E:\\Pref\\depscan', 'utf8'))).toEqual(
      [...'E:\\Pref\\depscan'].map((value) => ({ type: 'char', value })),
    );
  });

  it('a bracketed paste is one insertion, never re-parsed as keys', () => {
    const parse = createKeyParser();
    // Content includes 1, s and q: as keys those would switch tabs and quit.
    const pasted = 'E:\\Delta\\vuln 1 s q';
    const keys = parse(Buffer.from(`[200~${pasted}[201~`, 'utf8'));
    expect(keys).toEqual([{ type: 'paste', text: pasted }]);
  });

  it('a bracketed paste split across chunks is buffered, not mangled', () => {
    const parse = createKeyParser();
    const wire = '[200~E:\\Pref\\deps[201~';
    const first = parse(Buffer.from(wire.slice(0, 12), 'latin1'));
    const second = parse(Buffer.from(wire.slice(12), 'latin1'));
    expect(first).toEqual([]);
    expect(second).toEqual([{ type: 'paste', text: 'E:\\Pref\\deps' }]);
  });

  it('Ctrl+V passed through as a control byte becomes a clipboard request', () => {
    const parse = createKeyParser();
    expect(parse(Buffer.from([0x16]))).toEqual([{ type: 'paste-request' }]);
  });

  it('a multi-byte character split across chunks survives', () => {
    const parse = createKeyParser();
    const bytes = Buffer.from('proj-€', 'utf8'); // € is 3 bytes
    const cut = bytes.length - 1;
    const first = parse(bytes.subarray(0, cut));
    const second = parse(bytes.subarray(cut));
    expect([...first, ...second]).toEqual([...'proj-€'].map((value) => ({ type: 'char', value })));
  });

  it('typing, enter and backspace keep working around pastes', () => {
    const parse = createKeyParser();
    expect(parse(Buffer.from([0x61, 0x0d, 0x7f]))).toEqual([
      { type: 'char', value: 'a' },
      { type: 'enter' },
      { type: 'backspace' },
    ]);
  });
});
