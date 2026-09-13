import { useMemo } from 'react';
import { ArrowRight, CheckCircle2, Quote, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface ChangeReviewProps {
  source: string;
  corrected: string;
  changes?: string[];
}

type DiffToken = { kind: 'same' | 'added' | 'removed' | 'space'; text: string };

/** Above this many word pairs the LCS table gets too heavy for the browser — show the result without marks. */
const MAX_DIFF_CELLS = 4_000_000;

/**
 * Word-level diff built on the longest common subsequence, so an inserted or removed word
 * does not shift every following word into a removed/added pair. Changed words are grouped
 * into runs («было» → «стало») and whitespace is never highlighted.
 */
function diffWords(source: string, corrected: string): DiffToken[] {
  // Line breaks are tokens too, so paragraphs survive; other whitespace only separates words.
  const before = source.match(/\n|[^\s]+/g) ?? [];
  const after = corrected.match(/\n|[^\s]+/g) ?? [];
  if (before.length * after.length > MAX_DIFF_CELLS) return [{ kind: 'same', text: corrected }];

  const cols = after.length + 1;
  const lcs = new Uint16Array((before.length + 1) * cols);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lcs[i * cols + j] = before[i] === after[j]
        ? lcs[(i + 1) * cols + j + 1] + 1
        : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
    }
  }

  const words: Array<{ kind: 'same' | 'added' | 'removed'; text: string }> = [];
  let i = 0; let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      words.push({ kind: 'same', text: after[j] }); i += 1; j += 1;
    } else if (j < after.length && (i >= before.length || lcs[i * cols + j + 1] >= lcs[(i + 1) * cols + j])) {
      words.push({ kind: 'added', text: after[j] }); j += 1;
    } else {
      words.push({ kind: 'removed', text: before[i] }); i += 1;
    }
  }

  // Inside one changed stretch show everything removed first, then everything added.
  const result: DiffToken[] = [];
  const push = (token: DiffToken) => {
    const last = result[result.length - 1];
    if (last && last.text !== '\n' && token.text !== '\n') result.push({ kind: 'space', text: ' ' });
    result.push(token);
  };
  let removed: string[] = []; let added: string[] = [];
  const flush = () => {
    if (removed.length) push({ kind: 'removed', text: removed.join(' ') });
    if (added.length) push({ kind: 'added', text: added.join(' ') });
    removed = []; added = [];
  };
  for (const word of words) {
    if (word.text === '\n') {
      // A removed line break is just gone; an added one breaks the line without a highlight
      if (word.kind !== 'removed') { flush(); result.push({ kind: 'space', text: '\n' }); }
      continue;
    }
    if (word.kind === 'removed') { removed.push(word.text); continue; }
    if (word.kind === 'added') { added.push(word.text); continue; }
    flush();
    push(word);
  }
  flush();
  return result;
}

export function ChangeReview({ source, corrected, changes = [] }: ChangeReviewProps) {
  const tokens = useMemo(() => diffWords(source, corrected), [source, corrected]);
  return (
    <Card className="mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium"><Sparkles size={16} className="text-primary" /> Что изменилось</div>
        <span className="text-xs text-muted-foreground">Сравнение с черновиком</span>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <div className="rounded-lg bg-muted/40 p-4 text-sm leading-7 whitespace-pre-wrap"><div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Было</div>{source || '—'}</div>
        <div className="rounded-lg bg-primary/5 p-4 text-sm leading-7 whitespace-pre-wrap"><div className="mb-2 text-[10px] uppercase tracking-wider text-primary">Стало</div>{tokens.map((token, index) => token.kind === 'added' ? <mark key={index} className="rounded bg-emerald-200/80 px-0.5 text-emerald-950">{token.text}</mark> : token.kind === 'removed' ? <del key={index} className="rounded bg-red-100 px-0.5 text-red-800">{token.text}</del> : <span key={index}>{token.text}</span>)}</div>
      </div>
      <div className="border-t border-border px-5 py-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><ArrowRight size={13} /> Краткий список правок</div>
        {changes.length ? <ul className="space-y-1 text-sm">{changes.map((change) => <li key={change} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />{change}</li>)}</ul> : <p className="text-sm text-muted-foreground">Существенных правок не найдено.</p>}
      </div>
    </Card>
  );
}

export function SourceQuote({ quote }: { quote?: string | null }) {
  if (!quote) return <span className="mt-1 block text-xs text-muted-foreground">Источник не найден в черновике</span>;
  return <span className="mt-1 flex items-start gap-1 text-xs text-muted-foreground"><Quote size={12} className="mt-0.5 shrink-0" /><span>«{quote}»</span></span>;
}
