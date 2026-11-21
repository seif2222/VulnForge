#!/usr/bin/env node
import { runCli } from './run.js';
import { CLI_VERSION } from './version.js';

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

const exitCode = await runCli(
  process.argv.slice(2),
  {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    env: process.env,
    isStdoutTTY: process.stdout.isTTY === true,
    isStderrTTY: process.stderr.isTTY === true,
    cwd: process.cwd(),
    columns: process.stdout.isTTY === true ? process.stdout.columns : undefined,
    version: CLI_VERSION,
  },
  { signal: controller.signal },
);

process.exitCode = exitCode;
