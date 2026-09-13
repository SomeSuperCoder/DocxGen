import { useMemo } from 'react';
import { ArrowRight, CheckCircle2, Quote, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface ChangeReviewProps {
  source: string;
  corrected: string;
  changes?: string[];
}

function diffWords(source: string, corrected: string) {
  const before = source.split(/(\s+)/);
  const after = corrected.split(/(\s+)/);
  const result: Array<{ kind: 'same' | 'added' | 'removed'; text: string }> = [];
  let i = 0; let j = 0;
  while (i < before.length || j < after.length) {
    if (before[i] === after[j]) { if (after[j] !== undefined) result.push({ kind: 'same', text: after[j] }); i++; j++; continue; }
    if (after[j] !== undefined) result.push({ kind: 'added', text: after[j++] });
    if (before[i] !== undefined && (j >= after.length || before[i] !== after[j])) result.push({ kind: 'removed', text: before[i++] });
  }
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
