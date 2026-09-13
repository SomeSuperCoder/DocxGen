import OpenAI from 'openai';
import { AiUnavailableError } from '../../core/errors.js';

/**
 * Create an OpenAI provider using the official SDK's Responses API.
 *
 * Uses `responses.create` with `input` (string) and optional `instructions`
 * for system-level context. Returns `response.output_text`.
 *
 * @param {{ apiKey: string, baseURL: string, model: string, timeoutMs: number }} opts
 */
export function createOpenAiProvider({ apiKey, baseURL, model, timeoutMs }) {
  const client = new OpenAI({ apiKey, baseURL });

  return {
    name: `openai:${model}`,

    /**
     * Run a completion via the Responses API.
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
          // Prefix non-system messages with their role for clarity
          inputParts.push(`${msg.role}: ${msg.content}`);
        }
      }

      const instructions = systemParts.join('\n\n') || undefined;
      const input = inputParts.join('\n\n') || 'Hello';

      let response;
      try {
        response = await client.responses.create(
          {
            model,
            ...(instructions ? { instructions } : {}),
            input,
          },
          { timeout: timeoutMs },
        );
      } catch (err) {
        throw new AiUnavailableError(`AI request failed: ${err.message}`);
      }

      const text = response.output_text;
      if (!text?.trim()) throw new AiUnavailableError('AI returned empty response');
      return text;
    },
  };
}
