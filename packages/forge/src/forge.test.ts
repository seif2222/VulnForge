import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateReport, type Report } from '@vulnforge/core';

import { ForgeError, createForgeClient, type ForgeClient } from './client.js';
import { forgeCapabilities, loadForgeConfig } from './config.js';
import { explainFindings } from './explain.js';
import { explanationMessages, extractJson, suggestionMessages } from './prompts.js';
import { attachSuggestions, suggestForReport } from './suggest.js';

const report = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/reports/with-vulnerabilities.json', import.meta.url)),
    'utf8',
  ),
) as Report;

function stubClient(reply: string | Error): ForgeClient {
  return {
    model: 'test-model',
    chat: () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)),
  };
}

describe('loadForgeConfig', () => {
  it('returns null when nothing is configured', () => {
    expect(loadForgeConfig({})).toBeNull();
    expect(loadForgeConfig({ VULNFORGE_AI_API_KEY: '' })).toBeNull();
    expect(forgeCapabilities({})).toEqual({ configured: false, hasApiKey: false });
  });

  it('defaults to a local Ollama endpoint with a small model', () => {
    const config = loadForgeConfig({ VULNFORGE_AI_BASE_URL: 'http://127.0.0.1:11434/v1/' });
    expect(config).toEqual({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:1.5b',
      apiKey: null,
      timeoutMs: 30000,
    });
  });

  it('a hosted key flips the defaults to the hosted small model', () => {
    const config = loadForgeConfig({ VULNFORGE_AI_API_KEY: 'sk-test' });
    expect(config?.baseUrl).toBe('https://api.openai.com/v1');
    expect(config?.model).toBe('gpt-4o-mini');
    expect(forgeCapabilities({ VULNFORGE_AI_API_KEY: 'sk-test' })).toEqual({
      configured: true,
      hasApiKey: true,
    });
  });

  it('explicit model and timeout win', () => {
    const config = loadForgeConfig({
      VULNFORGE_AI_BASE_URL: 'http://gpu-box:11434/v1',
      VULNFORGE_AI_MODEL: 'llama3.2:3b',
      VULNFORGE_AI_TIMEOUT_MS: '5000',
    });
    expect(config?.model).toBe('llama3.2:3b');
    expect(config?.timeoutMs).toBe(5000);
  });
});

describe('createForgeClient', () => {
  const config = {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:1.5b',
    apiKey: null,
    timeoutMs: 1000,
  };

  it('posts an OpenAI-compatible request and returns the content', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createForgeClient(config, {
      fetchImpl: (url, init) => {
        calls.push({
          url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
          init: init ?? {},
        });
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), {
            status: 200,
          }),
        );
      },
    });

    await expect(client.chat([{ role: 'user', content: 'hi' }])).resolves.toBe('hello');
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(calls[0]?.init.body as string) as { model: string; stream: boolean };
    expect(body.model).toBe('qwen2.5:1.5b');
    expect(body.stream).toBe(false);
    expect(calls[0]?.init.headers).not.toHaveProperty('authorization');
  });

  it('sends the key only as a Bearer header', async () => {
    let seen: RequestInit | undefined;
    const client = createForgeClient(
      {
        ...config,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: 'sk-secret',
      },
      {
        fetchImpl: (_url, init) => {
          seen = init ?? {};
          return Promise.resolve(
            new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), {
              status: 200,
            }),
          );
        },
      },
    );
    await client.chat([{ role: 'user', content: 'hi' }]);
    expect(seen?.headers).toMatchObject({ authorization: 'Bearer sk-secret' });
    expect(seen?.body as string).not.toContain('sk-secret');
  });

  it('maps HTTP and transport failures to ForgeError', async () => {
    const http500 = createForgeClient(config, {
      fetchImpl: () => Promise.resolve(new Response('nope', { status: 500 })),
    });
    await expect(http500.chat([])).rejects.toMatchObject({ code: 'forge-unavailable' });

    const refused = createForgeClient(config, {
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await expect(refused.chat([])).rejects.toMatchObject({ code: 'forge-unavailable' });

    const noContent = createForgeClient(config, {
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 })),
    });
    await expect(noContent.chat([])).rejects.toMatchObject({ code: 'forge-bad-response' });
  });
});

describe('prompts', () => {
  it('the explanation prompt carries only real finding facts and demands JSON', () => {
    const finding = report.vulnerabilities[0];
    if (finding === undefined) throw new Error('fixture empty');
    const messages = explanationMessages(finding);
    const user = messages[1]?.content ?? '';
    expect(user).toContain(finding.id);
    expect(user).toContain(finding.package);
    expect(user).toContain(finding.installedVersion);
    expect(user).toContain('"explanation"');
    expect(messages[0]?.content).toContain('never invent');
  });

  it('the suggestion prompt lists every findingKey once and names the ecosystem', () => {
    const user = suggestionMessages(report)[1]?.content ?? '';
    for (const finding of report.vulnerabilities) {
      expect(user).toContain(finding.findingKey);
    }
    expect(user).toContain(report.meta.ecosystem);
  });

  it('extractJson handles bare JSON, fenced JSON and rejects junk', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
    expect(extractJson('here you go:\n```json\n[1, 2]\n```')).toEqual([1, 2]);
    expect(() => extractJson('no json at all')).toThrow('no JSON value');
  });
});

describe('explainFindings', () => {
  it('produces standalone explanations with the llm provider marker', async () => {
    const result = await explainFindings(report, {
      client: stubClient('{"explanation": "PyYAML loads yaml.", "remediation": "Upgrade to 5.4."}'),
      clock: () => new Date('2026-10-08T12:00:00Z'),
    });

    expect(result.warnings).toEqual([]);
    expect(result.explanations).toHaveLength(4);
    expect(result.explanations[0]).toEqual({
      findingKey: 'CVE-2020-14343|PyYAML@5.3.1',
      explanation: 'PyYAML loads yaml.',
      remediation: 'Upgrade to 5.4.',
      provider: 'llm',
      generatedAt: '2026-10-08T12:00:00.000Z',
    });
    // standalone: explanations are not part of the report
    expect(JSON.stringify(report)).not.toContain('PyYAML loads yaml.');
  });

  it('model failures become per-finding warnings, never a failed scan', async () => {
    const result = await explainFindings(report, {
      client: stubClient(
        new ForgeError('forge-unavailable', 'cannot reach Forge endpoint: ECONNREFUSED'),
      ),
    });
    expect(result.explanations).toEqual([]);
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings[0]).toContain('CVE-2020-14343|PyYAML@5.3.1');
  });

  it('a malformed reply is a warning for that finding only', async () => {
    const result = await explainFindings(report, { client: stubClient('not json') }, [
      'CVE-2020-14343|PyYAML@5.3.1',
    ]);
    expect(result.explanations).toEqual([]);
    expect(result.warnings[0]).toContain('no explanation for "CVE-2020-14343|PyYAML@5.3.1"');
  });
});

describe('suggestForReport + attachSuggestions', () => {
  const goodReply = JSON.stringify([
    {
      findingKey: 'CVE-2020-14343|PyYAML@5.3.1',
      saferVersion: '5.4',
      alternativePackage: null,
      rationale: 'fixes the loader issue',
    },
    {
      findingKey: 'CVE-2018-18074|requests@2.19.1',
      saferVersion: '2.20',
      alternativePackage: null,
      rationale: '2.20 patches it',
    },
  ]);

  it('returns validated suggestions in report order', async () => {
    const { suggestions, warnings } = await suggestForReport(report, {
      client: stubClient(goodReply),
    });
    expect(warnings).toEqual([]);
    expect(suggestions.map((entry) => entry.findingKey)).toEqual([
      'CVE-2020-14343|PyYAML@5.3.1',
      'CVE-2018-18074|requests@2.19.1',
    ]);
    expect(suggestions.every((entry) => entry.provider === 'llm')).toBe(true);
  });

  it('drops unknown keys, duplicates and missing rationales with warnings', async () => {
    const messy = JSON.stringify([
      {
        findingKey: 'CVE-9999-0000|fake@1.0',
        saferVersion: null,
        alternativePackage: null,
        rationale: 'invented',
      },
      {
        findingKey: 'CVE-2020-14343|PyYAML@5.3.1',
        saferVersion: '5.4',
        alternativePackage: null,
        rationale: 'real',
      },
      {
        findingKey: 'CVE-2020-14343|PyYAML@5.3.1',
        saferVersion: '5.4',
        alternativePackage: null,
        rationale: 'dup',
      },
      {
        findingKey: 'CVE-2018-18074|requests@2.19.1',
        saferVersion: null,
        alternativePackage: null,
      },
      { noKey: true },
    ]);
    const { suggestions, warnings } = await suggestForReport(report, {
      client: stubClient(messy),
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.findingKey).toBe('CVE-2020-14343|PyYAML@5.3.1');
    expect(warnings).toHaveLength(4);
  });

  it('attachSuggestions returns a new revalidated report and never mutates the input', async () => {
    const { suggestions } = await suggestForReport(report, { client: stubClient(goodReply) });
    const before = JSON.stringify(report);
    const enriched = attachSuggestions(report, suggestions);

    expect(JSON.stringify(report)).toBe(before);
    expect(enriched.suggestions).toHaveLength(2);
    expect(validateReport(enriched).ok).toBe(true);
    expect(enriched).not.toBe(report);
  });

  it('a non-array reply is a ForgeError', async () => {
    await expect(
      suggestForReport(report, { client: stubClient('{"oops": true}') }),
    ).rejects.toMatchObject({ code: 'forge-bad-response' });
  });

  it('a clean report needs no model call', async () => {
    const clean = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../fixtures/reports/clean.json', import.meta.url)),
        'utf8',
      ),
    ) as Report;
    const neverCalled: ForgeClient = {
      model: 'test',
      chat: () => Promise.reject(new Error('must not be called')),
    };
    await expect(suggestForReport(clean, { client: neverCalled })).resolves.toEqual({
      suggestions: [],
      warnings: [],
    });
  });
});
