import { describe, expect, it } from 'vitest';
import * as texts from '../../src/bot/texts.js';
import { plainText } from '../../src/adapters/common/markup.js';

describe('bot texts', () => {
  it('escapes the user name in the greeting', () => {
    const { text } = texts.greeting({ firstName: '<i>Иван</i>', lastName: 'Смит & Ко' });
    expect(text).toContain('&lt;i&gt;Иван&lt;/i&gt; Смит &amp; Ко');
    expect(text).not.toContain('<i>Иван');
  });

  it('escapes AI changes, field hints, placeholders and fact warnings', () => {
    expect(texts.result(['<script>'])).toContain('&lt;script&gt;');
    expect(texts.askField({ label: 'A<B', question: 'Q&A?', example: '"x"' }, 2).text)
      .toMatch(/A&lt;B[\s\S]*Q&amp;A\?[\s\S]*"x"/);
    expect(texts.ready('Письмо', 'Классический', ['<Номер>'])).toContain('&lt;Номер&gt;');
    expect(texts.factWarnings({ added: ['1 < 2'], lost: ['a & b'] })).toMatch(/1 &lt; 2[\s\S]*a &amp; b/);
  });

  it('turns into clean plain text for VK', () => {
    const html = texts.greeting({ firstName: 'A & <B>' }).text + '\n' + texts.askField({ label: 'Адресат', question: 'Кому?', example: 'Директору' }).text;
    const plain = plainText({ text: html, format: 'html' });
    expect(plain).not.toMatch(/<\/?[bi]>|&(amp|lt|gt);/);
    expect(plain).toContain('Здравствуйте, A & <B>!');
    expect(plain).toContain('Например: Директору');
  });

  it('counts the remaining fields instead of a position that never moves', () => {
    const field = { label: 'Адресат', question: 'Кому?' };
    expect(texts.askField(field, 3).text).toContain('осталось 3');
    expect(texts.askField(field, 1).text).not.toContain('осталось');
    expect(texts.askField(field, 3).text).not.toMatch(/\d из \d/);
  });

  it('highlights step headers in bold', () => {
    expect(texts.collectDraftStart()).toMatch(/<b>Шаг 1 из 3/);
    expect(texts.chooseType([{ name: 'Служебная записка', hint: 'внутри' }]).text).toMatch(/<b>Шаг 2 из 3/);
    expect(texts.processing()).toMatch(/<b>Шаг 3 из 3/);
  });
});
