import { validateReport, type Report, type Suggestion } from '@vulnforge/core';

import { ForgeError, type ForgeClient } from './client.js';
import { extractJson, suggestionMessages } from './prompts.js';

export interface SuggestDeps {
  readonly client: ForgeClient;
}

export interface SuggestResult {
  readonly suggestions: readonly Suggestion[];
  readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Asks Forge for fix suggestions, then enforces the contract: provider 'llm',
 * one entry per findingKey, only findingKeys that exist in the report.
 * Anything else is dropped with a warning, never silently trusted.
 */
export async function suggestForReport(report: Report, deps: SuggestDeps): Promise<SuggestResult> {
  if (report.vulnerabilities.length === 0) {
    return { suggestions: [], warnings: [] };
  }

  const warnings: string[] = [];
  let raw: unknown;
  try {
    raw = extractJson(await deps.client.chat(suggestionMessages(report)));
  } catch (error) {
    if (error instanceof ForgeError) throw error;
    throw new ForgeError(
      'forge-bad-response',
      `suggestion reply was not a JSON array: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(raw)) {
    throw new ForgeError('forge-bad-response', 'suggestion reply was not a JSON array');
  }

  const knownKeys = new Set(report.vulnerabilities.map((finding) => finding.findingKey));
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];

  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry['findingKey'] !== 'string') {
      warnings.push('dropped a suggestion with no findingKey');
      continue;
    }
    const key = entry['findingKey'];
    if (!knownKeys.has(key)) {
      warnings.push(`dropped a suggestion for unknown findingKey "${key}"`);
      continue;
    }
    if (seen.has(key)) {
      warnings.push(`dropped a duplicate suggestion for "${key}"`);
      continue;
    }
    seen.add(key);
    const rationale = entry['rationale'];
    if (typeof rationale !== 'string' || rationale === '') {
      warnings.push(`dropped a suggestion for "${key}" with no rationale`);
      continue;
    }
    suggestions.push({
      findingKey: key,
      saferVersion: optionalString(entry['saferVersion']),
      alternativePackage: optionalString(entry['alternativePackage']),
      rationale,
      provider: 'llm',
    });
  }

  // Report order, not model order, so the output is deterministic.
  const order = new Map(
    report.vulnerabilities.map((finding, index) => [finding.findingKey, index]),
  );
  suggestions.sort(
    (left, right) => (order.get(left.findingKey) ?? 0) - (order.get(right.findingKey) ?? 0),
  );

  return { suggestions, warnings };
}

/**
 * Returns a NEW report carrying the suggestions; the engine's report object is
 * never mutated. The result is revalidated - an invalid merge is a ForgeError,
 * never a written report.
 */
export function attachSuggestions(report: Report, suggestions: readonly Suggestion[]): Report {
  const enriched: Report = { ...report, suggestions };
  const verdict = validateReport(enriched);
  if (!verdict.ok) {
    const detail = verdict.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new ForgeError('forge-bad-response', `suggestions failed report validation: ${detail}`);
  }
  return enriched;
}
