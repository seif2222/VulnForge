import type { ForgeConfig } from './config.js';

export const FORGE_ERROR_CODES = [
  'forge-unavailable',
  'forge-timeout',
  'forge-bad-response',
] as const;

export type ForgeErrorCode = (typeof FORGE_ERROR_CODES)[number];

export class ForgeError extends Error {
  readonly code: ForgeErrorCode;

  constructor(code: ForgeErrorCode, message: string) {
    super(message);
    this.name = 'ForgeError';
    this.code = code;
  }
}

export interface ForgeMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface ForgeClient {
  readonly model: string;
  chat(messages: readonly ForgeMessage[]): Promise<string>;
}

export interface ForgeClientDeps {
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Minimal OpenAI-compatible chat-completions client. Works against a local
 * Ollama server (no key) and hosted OpenAI-compatible APIs (Bearer key).
 * The API key is only ever placed in the Authorization header.
 */
export function createForgeClient(config: ForgeConfig, deps: ForgeClientDeps = {}): ForgeClient {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    model: config.model,

    async chat(messages: readonly ForgeMessage[]): Promise<string> {
      const controller = new AbortController();
      const timer = (async () => {
        await sleep(config.timeoutMs);
        controller.abort();
      })();
      void timer.catch(() => undefined);

      let response: Response;
      try {
        response = await doFetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey === null ? {} : { authorization: `Bearer ${config.apiKey}` }),
          },
          body: JSON.stringify({ model: config.model, messages, temperature: 0.2, stream: false }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ForgeError(
            'forge-timeout',
            `Forge did not answer within ${config.timeoutMs}ms`,
          );
        }
        throw new ForgeError(
          'forge-unavailable',
          `cannot reach Forge endpoint: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!response.ok) {
        throw new ForgeError(
          'forge-unavailable',
          `Forge endpoint returned HTTP ${response.status}`,
        );
      }

      let body: unknown;
      try {
        const parsed: unknown = await response.json();
        body = parsed;
      } catch {
        throw new ForgeError('forge-bad-response', 'Forge endpoint returned non-JSON');
      }

      const choices = isRecord(body) ? body['choices'] : undefined;
      const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
      const message = isRecord(first) ? first['message'] : undefined;
      const content = isRecord(message) ? message['content'] : undefined;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new ForgeError('forge-bad-response', 'Forge endpoint returned no message content');
      }
      return content;
    },
  };
}
