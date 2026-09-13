import { describe, it, expect, vi } from 'vitest';
import { processDraft } from '../../src/ai/processDraft.js';
import { createMockProvider } from '../../src/ai/providers/mock.js';
import { AiFaultManager } from '../../src/ai/faults.js';
import { AiUnavailableError, AiInvalidResponseError } from '../../src/core/errors.js';
import { extractJson } from '../../src/ai/schema.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const DOC_TYPE = {
  id: 'zapiska',
  name: 'Записка',
  hint: 'Служебная записка',
  docTitle: null,
  layout: ['header', 'body'],
  structureHint: 'Заголовок, дата, от кого, кому, текст',
  fields: [
    { key: 'recipient', label: 'Кому', kind: 'extract', required: true, question: 'Имя и должность получателя' },
    { key: 'sender', label: 'От кого', kind: 'extract', required: true },
    { key: 'date', label: 'Дата', kind: 'extract', required: false },
  ],
};

const DRAFT = 'Записка для Петровой А.С. о командировке в Москву 01.01.2025';

function makeProvider(overrides = {}) {
  return {
    name: 'test',
    complete: vi.fn().mockImplementation(async () => {
      return JSON.stringify({
        title: 'Записка',
        body: [DRAFT],
        fields: {
          recipient: { value: 'Петровой А.С.', quote: 'для Петровой А.С.' },
          sender: { value: 'Иванов И.И.', quote: 'Иванов И.И.' },
          date: { value: '01.01.2025', quote: '01.01.2025' },
        },
        changes: ['Орфография исправлена'],
      });
    }),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('processDraft', () => {
  it('correct JSON response → parsed result', async () => {
    const provider = makeProvider();
    const result = await processDraft({
      draft: DRAFT,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    });

    expect(result.title).toBe('Записка');
    expect(result.body).toEqual([DRAFT]);
    expect(result.aiFields.recipient).toEqual({ value: 'Петровой А.С.', quote: 'для Петровой А.С.' });
    expect(result.changes).toEqual(['Орфография исправлена']);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('JSON in ```json fence → extracted correctly', async () => {
    const provider = makeProvider();
    provider.complete.mockResolvedValueOnce(
      '```json\n' +
      JSON.stringify({
        title: 'Записка',
        body: ['Текст'],
        fields: {},
        changes: [],
      }) +
      '\n```'
    );

    const result = await processDraft({
      draft: 'Записка о результатах совещания',
      docType: { ...DOC_TYPE, fields: [] },
      userFields: {},
      provider,
      log: null,
    });

    expect(result.title).toBe('Записка');
    expect(result.body).toEqual(['Текст']);
  });

  it('invalid JSON → retry → success', async () => {
    const provider = makeProvider();
    // First call returns garbage, second call returns valid JSON
    provider.complete
      .mockResolvedValueOnce('This is not JSON at all')
      .mockResolvedValueOnce(JSON.stringify({
        title: null,
        body: ['Retry text'],
        fields: {},
        changes: [],
      }));

    const result = await processDraft({
      draft: 'Текст',
      docType: { ...DOC_TYPE, fields: [] },
      userFields: {},
      provider,
      log: null,
    });

    expect(result.body).toEqual(['Retry text']);
    expect(provider.complete).toHaveBeenCalledTimes(2);
    // Retry rebuilds messages: stronger system instruction + original user message
    const retryMessages = provider.complete.mock.calls[1][0];
    expect(retryMessages).toHaveLength(2);
    expect(retryMessages[0].role).toBe('system');
    expect(retryMessages[0].content).toContain('ВАЖНО');
    expect(retryMessages[1].role).toBe('user');
  });

  it('two invalid JSONs → AiInvalidResponseError', async () => {
    const provider = makeProvider();
    provider.complete
      .mockResolvedValueOnce('Not JSON #1')
      .mockResolvedValueOnce('Not JSON #2');

    await expect(processDraft({
      draft: 'Текст',
      docType: { ...DOC_TYPE, fields: [] },
      userFields: {},
      provider,
      log: null,
    })).rejects.toThrow(AiInvalidResponseError);

    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('field with quote not in source → grounding fails, field preserved as ungrounded', async () => {
    const provider = makeProvider();
    provider.complete.mockResolvedValueOnce(JSON.stringify({
      title: null,
      body: ['Текст'],
      fields: {
        recipient: { value: 'Петровой А.С.', quote: 'несуществующая цитата' },
      },
      changes: [],
    }));

    const result = await processDraft({
      draft: DRAFT,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    });

    expect(result.aiFields.recipient).toEqual({ value: 'Петровой А.С.', quote: 'несуществующая цитата', ungrounded: true });
    expect(result.aiFields.recipient.ungrounded).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].key).toBe('recipient');
    expect(result.warnings[0].reason).toBe('quote_not_in_source');
  });

  it('added surname → warning in result', async () => {
    const provider = makeProvider();
    // "Директору Смирнову" is NOT in the draft — grounding should fail
    provider.complete.mockResolvedValueOnce(JSON.stringify({
      title: null,
      body: ['Текст'],
      fields: {
        recipient: { value: 'Директору Смирнову', quote: 'для Петровой А.С.' },
      },
      changes: [],
    }));

    const result = await processDraft({
      draft: DRAFT,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].severity).toBe('grounding');
  });

  it('network error → AiUnavailableError', async () => {
    const provider = makeProvider();
    provider.complete.mockRejectedValue(new Error('fetch failed'));

    await expect(processDraft({
      draft: 'Текст',
      docType: { ...DOC_TYPE, fields: [] },
      userFields: {},
      provider,
      log: null,
    })).rejects.toThrow(AiUnavailableError);
  });

  it('armOnce works once, second call proceeds normally', async () => {
    const fm = new AiFaultManager({});
    fm.armOnce('test:123');

    const provider = makeProvider();

    // First call should fail
    await expect(processDraft({
      draft: 'Текст',
      docType: { ...DOC_TYPE, fields: [] },
      userFields: {},
      provider,
      log: null,
      faultManager: fm,
      ownerKey: 'test:123',
    })).rejects.toThrow(AiUnavailableError);

    // Second call should succeed
    const result = await processDraft({
      draft: 'Текст',
      docType: { ...DOC_TYPE, fields: [] },
      userFields: {},
      provider,
      log: null,
      faultManager: fm,
      ownerKey: 'test:123',
    });

    expect(result.body).toBeDefined();
  });

  it('unknown field keys → discarded', async () => {
    const provider = makeProvider();
    provider.complete.mockResolvedValueOnce(JSON.stringify({
      title: null,
      body: ['Текст'],
      fields: {
        recipient: { value: 'Петровой А.С.', quote: 'для Петровой А.С.' },
        unknownKey: { value: 'something', quote: 'something' },
      },
      changes: [],
    }));

    const result = await processDraft({
      draft: DRAFT,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    });

    expect(result.aiFields.recipient).toBeDefined();
    expect(result.aiFields.unknownKey).toBeUndefined();
  });

  it('faultAlways → all calls fail', async () => {
    const fm = new AiFaultManager({ AI_FAULT: 'always' });
    const provider = makeProvider();

    await expect(processDraft({
      draft: 'Текст',
      docType: { ...DOC_TYPE, fields: [] },
      userFields: {},
      provider,
      log: null,
      faultManager: fm,
      ownerKey: 'any:owner',
    })).rejects.toThrow(AiUnavailableError);

    // Second call also fails
    await expect(processDraft({
      draft: 'Текст',
      docType: { ...DOC_TYPE, fields: [] },
      userFields: {},
      provider,
      log: null,
      faultManager: fm,
      ownerKey: 'any:owner',
    })).rejects.toThrow(AiUnavailableError);
  });

  it('grounding failure includes groundedFields in result', async () => {
    const provider = makeProvider();
    provider.complete.mockResolvedValueOnce(JSON.stringify({
      title: null,
      body: ['Текст'],
      fields: {
        recipient: { value: 'Петровой А.С.', quote: 'несуществующая цитата' },
      },
      changes: [],
    }));

    const result = await processDraft({
      draft: DRAFT,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    });

    expect(result.groundedFields).toHaveLength(1);
    expect(result.groundedFields[0].key).toBe('recipient');
    expect(result.groundedFields[0].reason).toBe('quote_not_in_source');
    expect(result.aiFields.recipient).toEqual({ value: 'Петровой А.С.', quote: 'несуществующая цитата', ungrounded: true });
  });

  it('retry uses stronger system instruction', async () => {
    const provider = makeProvider();
    provider.complete
      .mockResolvedValueOnce('Not JSON at all')
      .mockResolvedValueOnce(JSON.stringify({
        title: null,
        body: ['Retry'],
        fields: {},
        changes: [],
      }));

    await processDraft({
      draft: 'Текст',
      docType: { ...DOC_TYPE, fields: [] },
      userFields: {},
      provider,
      log: null,
    });

    // Check retry call had stronger system instruction
    const retryCall = provider.complete.mock.calls[1][0];
    expect(retryCall[0].content).toContain('ВАЖНО');
    expect(retryCall[0].role).toBe('system');
  });

  it('derived field (title) gets grounded via checkDerivedGrounding', async () => {
    const provider = makeProvider();
    const draftWithSender = 'Записка для Петровой А.С. от Иванова И.И. о командировке в Москву 01.01.2025';
    // Title "О командировке" should be grounded in draft
    provider.complete.mockResolvedValueOnce(JSON.stringify({
      title: 'О командировке',
      body: [draftWithSender],
      fields: {
        recipient: { value: 'Петровой А.С.', quote: 'для Петровой А.С.' },
        sender: { value: 'Иванова И.И.', quote: 'от Иванова И.И.' },
        date: { value: '01.01.2025', quote: '01.01.2025' },
      },
      changes: [],
    }));

    const result = await processDraft({
      draft: draftWithSender,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    });

    // Title should be preserved (grounded)
    expect(result.title).toBe('О командировке');
    expect(result.warnings).toHaveLength(0);
  });

  // ── Schema validation retry tests ──────────────────────────────────────────

  it('schema validation fails → retry with feedback → success', async () => {
    const provider = makeProvider();
    // First call: valid JSON but field is a plain string (schema error)
    provider.complete
      .mockResolvedValueOnce(JSON.stringify({
        title: null,
        body: ['Текст'],
        fields: {
          recipient: 'Петровой А.С.',  // WRONG — should be { value: "...", quote: "..." }
        },
        changes: [],
      }))
      // Second call: corrected JSON
      .mockResolvedValueOnce(JSON.stringify({
        title: null,
        body: ['Текст'],
        fields: {
          recipient: { value: 'Петровой А.С.', quote: 'для Петровой А.С.' },
        },
        changes: [],
      }));

    const result = await processDraft({
      draft: DRAFT,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    });

    expect(result.body).toEqual(['Текст']);
    expect(result.aiFields.recipient).toEqual({ value: 'Петровой А.С.', quote: 'для Петровой А.С.' });
    expect(provider.complete).toHaveBeenCalledTimes(2);

    // Retry messages should contain Zod error details and previous response
    const retryMessages = provider.complete.mock.calls[1][0];
    expect(retryMessages).toHaveLength(2);
    expect(retryMessages[0].role).toBe('system');
    expect(retryMessages[0].content).toContain('схеме ответа');
    expect(retryMessages[1].role).toBe('user');
    expect(retryMessages[1].content).toContain('не прошёл валидацию схемы');
    expect(retryMessages[1].content).toContain('recipient');
    expect(retryMessages[1].content).toContain(DRAFT);
  });

  it('schema validation fails twice → AiInvalidResponseError', async () => {
    const provider = makeProvider();
    // Both calls return schema-invalid responses
    const invalidResponse = JSON.stringify({
      title: null,
      body: ['Текст'],
      fields: {
        recipient: 'Петровой А.С.',  // WRONG format
      },
      changes: [],
    });
    provider.complete
      .mockResolvedValueOnce(invalidResponse)
      .mockResolvedValueOnce(invalidResponse);

    await expect(processDraft({
      draft: DRAFT,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    })).rejects.toThrow(AiInvalidResponseError);

    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('schema retry preserves original context', async () => {
    const provider = makeProvider();
    provider.complete
      .mockResolvedValueOnce(JSON.stringify({
        title: null,
        body: ['Текст'],
        fields: {
          recipient: 'Петровой А.С.',
        },
        changes: [],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        title: null,
        body: ['Текст'],
        fields: {
          recipient: { value: 'Петровой А.С.', quote: 'для Петровой А.С.' },
        },
        changes: [],
      }));

    await processDraft({
      draft: DRAFT,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    });

    const retryMessages = provider.complete.mock.calls[1][0];
    const retryUserMessage = retryMessages[1].content;

    // Retry user message contains the original draft text
    expect(retryUserMessage).toContain(DRAFT);

    // Retry user message contains the Zod error path (recipient field)
    expect(retryUserMessage).toContain('recipient');

    // Retry system message includes original system prompt + schema instructions
    const retrySystemMessage = retryMessages[0].content;
    expect(retrySystemMessage).toContain('схеме ответа');
    expect(retrySystemMessage).toContain('ВАЖНО');
  });

  it('derived field NOT grounded → preserved as ungrounded with groundedFields entry', async () => {
    const provider = makeProvider();
    const draftWithSender = 'Записка для Петровой А.С. от Иванова И.И. о командировке в Москву 01.01.2025';
    // Add a derived field to docType
    const docTypeWithDerived = {
      ...DOC_TYPE,
      fields: [
        ...DOC_TYPE.fields,
        { key: 'salutation', label: 'Обращение', kind: 'derived', required: false },
      ],
    };
    // "Протокол совещания" has no words from the draft → should fail derived grounding
    provider.complete.mockResolvedValueOnce(JSON.stringify({
      title: null,
      body: [draftWithSender],
      fields: {
        recipient: { value: 'Петровой А.С.', quote: 'для Петровой А.С.' },
        sender: { value: 'Иванова И.И.', quote: 'от Иванова И.И.' },
        date: { value: '01.01.2025', quote: '01.01.2025' },
        salutation: { value: 'Протокол совещания', quote: 'Протокол совещания' },
      },
      changes: [],
    }));

    const result = await processDraft({
      draft: draftWithSender,
      docType: docTypeWithDerived,
      userFields: {},
      provider,
      log: null,
    });

    // salutation is derived, not grounded → preserved with ungrounded flag
    expect(result.aiFields.salutation).toEqual({ value: 'Протокол совещания', quote: 'Протокол совещания', ungrounded: true });
    expect(result.aiFields.salutation.ungrounded).toBe(true);
    expect(result.groundedFields.length).toBeGreaterThan(0);
    expect(result.groundedFields.some(f => f.key === 'salutation')).toBe(true);
  });

  it('groundedFields array is empty when all fields pass grounding', async () => {
    const provider = makeProvider();
    const draftWithSender = 'Записка для Петровой А.С. от Иванова И.И. о командировке в Москву 01.01.2025';
    provider.complete.mockResolvedValueOnce(JSON.stringify({
      title: 'О командировке',
      body: [draftWithSender],
      fields: {
        recipient: { value: 'Петровой А.С.', quote: 'для Петровой А.С.' },
        sender: { value: 'Иванова И.И.', quote: 'от Иванова И.И.' },
        date: { value: '01.01.2025', quote: '01.01.2025' },
      },
      changes: [],
    }));

    const result = await processDraft({
      draft: draftWithSender,
      docType: DOC_TYPE,
      userFields: {},
      provider,
      log: null,
    });

    expect(result.groundedFields).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('extractJson', () => {
  it('extracts JSON from plain text', () => {
    const input = '{"a": 1}';
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it('extracts JSON from markdown fence', () => {
    const input = '```json\n{"a": 1}\n```';
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it('extracts JSON with surrounding text', () => {
    const input = 'Here is the result: {"a": 1} done.';
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it('throws on no JSON object', () => {
    expect(() => extractJson('no json here')).toThrow('no JSON object in AI response');
  });
});
