import { describe, it, expect, vi } from 'vitest';
import { detectTypeWithAi } from '../../src/ai/detectType.js';
import { loadDocTypes } from '../../src/catalog/docTypes.js';

const catalog = loadDocTypes('./config/doc-types').list();
const DRAFT = 'прошу выделить средства на закупку 5 мониторов для отдела разработки. текущие мониторы 2016 года, у трех из них битые пиксели и мерцание. директору иванову и.и. от петрова п.п.';
const provider = (answer) => ({ name: 'test', complete: vi.fn(async () => (typeof answer === 'string' ? answer : JSON.stringify(answer))) });

describe('detectTypeWithAi', () => {
  it('asks the model with the whole type catalog and returns its choice', async () => {
    const ai = provider({ typeId: 'memo', confidence: 0.86, evidence: ['прошу выделить средства', 'директору иванову'] });
    const result = await detectTypeWithAi({ draft: DRAFT, docTypes: catalog, provider: ai });

    const [system, user] = ai.complete.mock.calls[0][0];
    for (const type of catalog) expect(system.content).toContain(type.id);
    expect(user.content).toContain(DRAFT);
    expect(result).toMatchObject({ typeId: 'memo', typeName: 'Служебная записка', confidence: 0.86, source: 'ai' });
    expect(result.evidence).toEqual(['прошу выделить средства', 'директору иванову']);
  });

  it('keeps only evidence that is really in the draft and clamps confidence', async () => {
    const ai = provider('```json\n{"typeId":"memo","confidence":7,"evidence":["«прошу выделить средства»","срочно уволить"]}\n```');
    const result = await detectTypeWithAi({ draft: DRAFT, docTypes: catalog, provider: ai });
    expect(result.confidence).toBe(0.99);
    expect(result.evidence).toEqual(['прошу выделить средства']);
  });

  it('falls back to the keyword rules when the model fails or names an unknown type', async () => {
    const broken = { name: 'test', complete: vi.fn(async () => { throw new Error('503'); }) };
    const failed = await detectTypeWithAi({ draft: 'Докладываю о нарушении срока поставки', docTypes: catalog, provider: broken });
    expect(failed).toMatchObject({ typeId: 'report', source: 'rules' });

    const unknown = await detectTypeWithAi({ draft: DRAFT, docTypes: catalog, provider: provider({ typeId: 'poem', confidence: 0.9 }) });
    expect(unknown.source).toBe('rules');
  });

  it('reports a draft that is not a business document instead of forcing a type', async () => {
    const ai = provider({ typeId: null, confidence: 0.08, evidence: ['привет как дела красавчик'], reason: 'Бытовое приветствие без делового содержания' });
    const result = await detectTypeWithAi({ draft: 'привет как дела красавчик', docTypes: catalog, provider: ai });
    expect(result).toMatchObject({ typeId: null, typeName: null, source: 'ai', notBusiness: true, reason: 'Бытовое приветствие без делового содержания' });
    expect(result.evidence).toEqual([]);
  });

  it('treats a very low confidence choice as «not a business document»', async () => {
    const ai = provider({ typeId: 'letter', confidence: 0.08, evidence: ['привет'] });
    const result = await detectTypeWithAi({ draft: 'привет как дела красавчик', docTypes: catalog, provider: ai });
    expect(result).toMatchObject({ typeId: null, notBusiness: true, source: 'ai' });
  });

  it('uses the rules without a provider', async () => {
    const result = await detectTypeWithAi({ draft: 'Докладываю о нарушении срока поставки', docTypes: catalog, provider: null });
    expect(result.source).toBe('rules');
  });
});
