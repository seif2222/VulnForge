import { resolve } from 'node:path';

import { startDashboardServer } from './dashboard-server.js';

/**
 * Entry point for the public demo (`node packages/cli/dist/public-main.js`).
 * Same engine and dashboard as the local tool; see PublicDemoOptions for what is
 * turned off. No AI provider is ever configured here.
 */
const port = Number.parseInt(process.env['PORT'] ?? '10000', 10);
const server = await startDashboardServer({
  port,
  assetsRoot: resolve(import.meta.dirname, '..', 'assets', 'dashboard'),
  toolVersion: process.env['VULNFORGE_VERSION'] ?? '0.1.0',
  aiAvailable: false,
  publicDemo: {
    host: '0.0.0.0',
    maxScansPerWindow: Number.parseInt(process.env['DEMO_MAX_SCANS'] ?? '8', 10),
    windowMs: 10 * 60 * 1000,
    scanTimeoutMs: 90 * 1000,
  },
});
process.stderr.write(`vulnforge public demo listening on port ${String(server.port)}\n`);
