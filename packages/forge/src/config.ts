/** Forge configuration from the environment. Key presence is a fact; the key value never leaves the client. */
export interface ForgeConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string | null;
  readonly timeoutMs: number;
}

export interface ForgeEnv {
  readonly VULNFORGE_AI_BASE_URL?: string | undefined;
  readonly VULNFORGE_AI_MODEL?: string | undefined;
  readonly VULNFORGE_AI_API_KEY?: string | undefined;
  readonly VULNFORGE_AI_TIMEOUT_MS?: string | undefined;
}

export const FORGE_DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:11434/v1';
export const FORGE_DEFAULT_HOSTED_BASE_URL = 'https://api.openai.com/v1';
/** "Small LLM" defaults per the owner's phase-3 brief: a small local model, or a small hosted one. */
export const FORGE_DEFAULT_LOCAL_MODEL = 'qwen2.5:1.5b';
export const FORGE_DEFAULT_HOSTED_MODEL = 'gpt-4o-mini';
export const FORGE_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Loads Forge config. Returns null when nothing AI-related is configured; the
 * caller then reports Forge as unavailable. With only an API key, targets the
 * hosted OpenAI-compatible API; otherwise defaults to a local Ollama server.
 */
export function loadForgeConfig(env: ForgeEnv): ForgeConfig | null {
  const apiKey =
    env.VULNFORGE_AI_API_KEY !== undefined && env.VULNFORGE_AI_API_KEY !== ''
      ? env.VULNFORGE_AI_API_KEY
      : null;
  const explicitBase = env.VULNFORGE_AI_BASE_URL;
  const hasBase = explicitBase !== undefined && explicitBase !== '';

  if (apiKey === null && !hasBase) {
    return null;
  }

  const hosted = apiKey !== null && !hasBase;
  const timeoutParsed = Number.parseInt(env.VULNFORGE_AI_TIMEOUT_MS ?? '', 10);
  return {
    baseUrl: (hasBase
      ? explicitBase
      : hosted
        ? FORGE_DEFAULT_HOSTED_BASE_URL
        : FORGE_DEFAULT_LOCAL_BASE_URL
    ).replace(/\/+$/u, ''),
    model:
      env.VULNFORGE_AI_MODEL !== undefined && env.VULNFORGE_AI_MODEL !== ''
        ? env.VULNFORGE_AI_MODEL
        : hosted
          ? FORGE_DEFAULT_HOSTED_MODEL
          : FORGE_DEFAULT_LOCAL_MODEL,
    apiKey,
    timeoutMs:
      Number.isFinite(timeoutParsed) && timeoutParsed > 0
        ? timeoutParsed
        : FORGE_DEFAULT_TIMEOUT_MS,
  };
}

/** Capability facts for status surfaces: booleans only, never the key. */
export function forgeCapabilities(env: ForgeEnv): {
  readonly configured: boolean;
  readonly hasApiKey: boolean;
} {
  const config = loadForgeConfig(env);
  return { configured: config !== null, hasApiKey: config?.apiKey !== null && config !== null };
}
