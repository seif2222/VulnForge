import type { AiExplanation, Report } from '@vulnforge/core';

import { ForgeError, type ForgeClient } from './client.js';
import { explanationMessages, extractJson } from './prompts.js';

export interface ExplainDeps {
  readonly client: ForgeClient;
  readonly clock?: () => Date;
}

export interface ExplainResult {
  readonly explanations: readonly AiExplanation[];
  /** One line per finding Forge could not explain. Never throws on model failure. */
  readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Explains findings through Forge. Model failures and malformed replies become
 * per-finding warnings; the scan result is never failed by the AI layer.
 */
export async function explainFindings(
  report: Report,
  deps: ExplainDeps,
  findingKeys?: readonly string[],
): Promise<ExplainResult> {
  const clock = deps.clock ?? (() => new Date());
  const wanted = findingKeys ?? report.vulnerabilities.map((finding) => finding.findingKey);
  const byKey = new Map(report.vulnerabilities.map((finding) => [finding.findingKey, finding]));

  const explanations: AiExplanation[] = [];
  const warnings: string[] = [];

  for (const key of wanted) {
    const finding = byKey.get(key);
    if (finding === undefined) {
      warnings.push(`skipped unknown findingKey "${key}"`);
      continue;
    }
    try {
      const reply = await deps.client.chat(explanationMessages(finding));
      const parsed = extractJson(reply);
      if (
        !isRecord(parsed) ||
        typeof parsed['explanation'] !== 'string' ||
        typeof parsed['remediation'] !== 'string'
      ) {
        throw new ForgeError('forge-bad-response', 'reply missed explanation/remediation fields');
      }
      explanations.push({
        findingKey: key,
        explanation: parsed['explanation'],
        remediation: parsed['remediation'],
        provider: 'llm',
        generatedAt: clock().toISOString(),
      });
    } catch (error) {
      warnings.push(
        `no explanation for "${key}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { explanations, warnings };
}
