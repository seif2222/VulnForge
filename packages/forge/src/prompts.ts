import type { Report, Vulnerability } from '@vulnforge/core';

import type { ForgeMessage } from './client.js';

const SYSTEM_PROMPT = [
  'You are Forge, the explanation layer of the vulnforge dependency scanner.',
  'You only explain and suggest. You never invent vulnerabilities, packages,',
  'versions, CVEs or fixes. Every fact you use comes from the finding data in',
  'the user message. If a fact is missing, say "unknown" instead of guessing.',
  'Answer with strict JSON only. No markdown fences, no commentary.',
].join(' ');

function findingFacts(finding: Vulnerability): Record<string, unknown> {
  return {
    id: finding.id,
    findingKey: finding.findingKey,
    aliases: finding.aliases,
    package: finding.package,
    installedVersion: finding.installedVersion,
    severity: finding.severity,
    severityReason: finding.severityReason,
    cvss: finding.cvss,
    summary: finding.summary,
    affectedRange: finding.affectedRange,
    fixedVersion: finding.fixedVersion,
    advisoryUrl: finding.advisoryUrl,
  };
}

/** Prompt for one explanation. Returns the exact JSON shape Forge must fill. */
export function explanationMessages(finding: Vulnerability): readonly ForgeMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        'Explain this dependency vulnerability finding to a developer, then give a concrete',
        'remediation step. Reply with exactly this JSON shape:',
        '{"explanation": "2-4 sentences, plain language", "remediation": "1-2 sentences, concrete"}',
        '',
        'Finding data (the only facts you may use):',
        JSON.stringify(findingFacts(finding), null, 2),
      ].join('\n'),
    },
  ];
}

/** Prompt for fix suggestions across a report's findings. */
export function suggestionMessages(report: Report): readonly ForgeMessage[] {
  const findings = report.vulnerabilities.map((finding) => ({
    ...findingFacts(finding),
    dependencyKind:
      report.packages.find(
        (entry) => entry.name === finding.package && entry.version === finding.installedVersion,
      )?.isDirect === true
        ? 'direct'
        : 'transitive',
  }));
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `Ecosystem: ${report.meta.ecosystem}. For each finding below, suggest the safest fix:`,
        'a saferVersion within the same package when one is known from the finding data,',
        'and/or an alternativePackage when a well-known maintained alternative exists.',
        'Use null for anything you cannot ground in the finding data.',
        'Reply with exactly a JSON array, one object per finding:',
        '[{"findingKey": "...", "saferVersion": "x.y.z" | null, "alternativePackage": "name" | null, "rationale": "one sentence"}]',
        'Include every findingKey exactly once. Never add findingKeys that are not listed.',
        '',
        'Findings (the only facts you may use):',
        JSON.stringify(findings, null, 2),
      ].join('\n'),
    },
  ];
}

/** Extracts the first JSON value from a model reply, tolerating code fences. */
export function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(reply);
  const candidate = (fenced?.[1] ?? reply).trim();
  const start = candidate.search(/[[{]/u);
  if (start === -1) {
    throw new Error('no JSON value in model reply');
  }
  const opener = candidate[start] as string;
  const closer = opener === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(closer);
  if (end <= start) {
    throw new Error('unterminated JSON value in model reply');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}
