import { createOpenAiProvider } from './providers/openaiResponses.js';
import { createMockProvider } from './providers/mock.js';
import { createOpencodeProvider } from './providers/opencodeCli.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Каталог с конфигом агента doc-editor для OpenCode CLI (packages/backend/opencode). */
const OPENCODE_CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../opencode');

/**
 * Factory: create the AI provider based on env.AI_PROVIDER.
 *
 * Supported providers:
 * - "openai"    → official OpenAI SDK (Responses API)
 * - "opencode"  → OpenCode CLI (free models)
 * - "mock"      → deterministic stub for local testing
 *
 * @param {object} env - application environment (AI_PROVIDER, AI_BASE_URL, AI_API_KEY, etc.)
 * @returns {{ name: string, complete: Function }}
 */
export function createAiProvider(env) {
  switch (env.AI_PROVIDER) {
    case 'openai':
      return createOpenAiProvider({
        apiKey: env.AI_API_KEY,
        baseURL: env.AI_BASE_URL,
        model: env.AI_MODEL,
        timeoutMs: Number(env.AI_TIMEOUT_MS) || 30_000,
      });
    case 'opencode':
      // Официальный CLI OpenCode: бесплатные модели OpenCode Zen, ключ не нужен.
      return createOpencodeProvider({
        runtime: env.OPENCODE_RUNTIME,
        bin: env.OPENCODE_BIN,
        image: env.OPENCODE_IMAGE,
        model: env.OPENCODE_MODEL,
        agent: env.OPENCODE_AGENT,
        maxParallel: Number(env.OPENCODE_MAX_PARALLEL) || 1,
        timeoutMs: Number(env.AI_TIMEOUT_MS) || 180_000,
        configDir: OPENCODE_CONFIG_DIR,
      });
    case 'mock':
      return createMockProvider();
    default:
      throw new Error(`Unknown AI_PROVIDER: ${env.AI_PROVIDER}`);
  }
}
