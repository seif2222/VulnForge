import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  cacheKeyFor,
  createMemoryCache,
  type OsvCache,
  type OsvHttp,
  type OsvQuery,
  type OsvVulnerability,
} from '@vulnforge/core';

export const FIXTURE_PROJECTS = fileURLToPath(
  new URL('../../../fixtures/projects/', import.meta.url),
);

const OSV_RECORDINGS_DIR = fileURLToPath(new URL('../../../fixtures/osv/', import.meta.url));

interface RecordingEnvelope {
  readonly request: {
    readonly ecosystem: string;
    readonly name: string;
    readonly version: string;
  };
  readonly recordedAt: string;
  readonly response: { readonly vulns?: readonly OsvVulnerability[] };
}

export type OsvRecordings = ReadonlyMap<string, readonly OsvVulnerability[]>;

/** The recorded osv.dev responses committed at the repo root. Never the network. */
export function loadOsvRecordings(): OsvRecordings {
  const recordings = new Map<string, readonly OsvVulnerability[]>();
  for (const file of readdirSync(OSV_RECORDINGS_DIR)) {
    const envelope = JSON.parse(
      readFileSync(`${OSV_RECORDINGS_DIR}${file}`, 'utf8'),
    ) as RecordingEnvelope;
    recordings.set(
      cacheKeyFor({
        ecosystem: envelope.request.ecosystem,
        name: envelope.request.name,
        version: envelope.request.version,
      }),
      envelope.response.vulns ?? [],
    );
  }
  return recordings;
}

/** An OsvHttp answering from the recordings; throws on anything unrecorded. */
export function recordingHttp(recordings: OsvRecordings): OsvHttp {
  return {
    queryBatch(queries: readonly OsvQuery[]): Promise<readonly OsvVulnerability[][]> {
      return Promise.resolve(
        queries.map((query) => {
          const vulns = recordings.get(cacheKeyFor(query));
          if (vulns === undefined) {
            throw new Error(`no recorded osv.dev response for ${cacheKeyFor(query)}`);
          }
          return vulns;
        }),
      );
    },
  };
}

/** A cache filled as an earlier online run would have left it. */
export function seededMemoryCache(recordings: OsvRecordings): OsvCache & { keys(): string[] } {
  const cache = createMemoryCache();
  for (const [key, vulns] of recordings) {
    const separator = key.lastIndexOf('@');
    cache.set(
      {
        ecosystem: key.slice(0, key.indexOf('__')),
        name: key.slice(key.indexOf('__') + 2, separator),
        version: key.slice(separator + 1),
      },
      vulns,
    );
  }
  return cache;
}

export interface CapturedIo {
  readonly io: {
    readonly stdout: (chunk: string) => void;
    readonly stderr: (chunk: string) => void;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly isStdoutTTY: boolean;
    readonly isStderrTTY: boolean;
    readonly cwd: string;
    readonly columns?: number | undefined;
    readonly version: string;
  };
  readonly stdout: () => string;
  readonly stderr: () => string;
}

/** Capturing io for runCli tests: pipes off, TTY off, env controlled. */
export function captureIo(
  overrides: Partial<{
    env: Readonly<Record<string, string | undefined>>;
    isStdoutTTY: boolean;
    isStderrTTY: boolean;
    cwd: string;
    columns: number;
  }> = {},
): CapturedIo {
  let out = '';
  let err = '';
  return {
    io: {
      stdout: (chunk) => {
        out += chunk;
      },
      stderr: (chunk) => {
        err += chunk;
      },
      env: overrides.env ?? {},
      isStdoutTTY: overrides.isStdoutTTY ?? false,
      isStderrTTY: overrides.isStderrTTY ?? false,
      cwd: overrides.cwd ?? '/',
      columns: overrides.columns,
      version: '0.0.0-test',
    },
    stdout: () => out,
    stderr: () => err,
  };
}
