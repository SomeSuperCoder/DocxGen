import OpenAI from 'openai';
import { AiUnavailableError } from '../../core/errors.js';

/**
 * Create an OpenAI provider using the official SDK's Responses API
 * with a fallback to chat/completions.
 *
 * Tries `responses.create` first (Responses API), then falls back to
 * `chat.completions.create` if the proxy provider doesn't support it
 * (404 or responses-related errors).
 *
 * Timeout is set on the client constructor, not as a second argument.
 *
 * @param {{ apiKey: string, baseURL: string, model: string, timeoutMs: number }} opts
 */
export function createOpenAiProvider({ apiKey, baseURL, model, timeoutMs }) {
  const client = new OpenAI({ apiKey, baseURL, timeout: timeoutMs });

  return {
    name: `openai:${model}`,

    /**
     * Run a completion via the Responses API with chat/completions fallback.
     * System messages are extracted into `instructions`; the rest become the `input`.
     * @param {Array<{role: string, content: string}>} messages
     * @returns {Promise<string>}
     */
    async complete(messages) {
      // Responses API separates system context (instructions) from user/assistant input
      const systemParts = [];
      const inputParts = [];

      for (const msg of messages) {
        if (msg.role === 'system') {
          systemParts.push(msg.content);
        } else {
          inputParts.push(`${msg.role}: ${msg.content}`);
        }
      }

      const instructions = systemParts.join('\n\n') || undefined;
      const input = inputParts.join('\n\n') || 'Hello';

      // Try Responses API first, fallback to chat/completions
      try {
        const response = await client.responses.create({
          model,
          ...(instructions ? { instructions } : {}),
          input,
        });
        const text = response.output_text;
        if (!text?.trim()) throw new AiUnavailableError('AI returned empty response');
        return text;
      } catch (err) {
        // If responses.create fails with 404 or responses-related errors, try chat/completions
        if (err.status === 404 || err.message?.includes('responses') || err.message?.includes('Not Found')) {
          console.warn(`[openai] responses.create failed (${err.message}), falling back to chat/completions`);
          return await fallbackChatCompletions(client, model, messages);
        }
        throw new AiUnavailableError(`AI request failed: ${err.message}`);
      }
    },
  };
}

/**
 * Fallback path using the standard chat/completions endpoint.
 * Used when the proxy provider doesn't support the Responses API.
 * @param {import('openai').default} client
 * @param {string} model
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
async function fallbackChatCompletions(client, model, messages) {
  try {
    const response = await client.chat.completions.create({
      model,
      messages,
    });
    const content = response.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) throw new AiUnavailableError('AI returned empty response');
    return content;
  } catch (err) {
    throw new AiUnavailableError(`AI request failed (chat/completions fallback): ${err.message}`);
  }
}
