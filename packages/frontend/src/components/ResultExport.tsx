import { useEffect, useState } from 'react';
import { Copy, FileDown, Mail } from 'lucide-react';
import { buildEmailText } from '@/lib/draftTools';
import type { Requisites } from '@/types/document';

interface ResultExportProps {
  correctedText: string;
  requisites: Requisites;
}

type Done = 'text' | 'email' | 'txt' | 'error' | null;

const DONE_LABEL: Record<Exclude<Done, null>, string> = {
  text: 'Текст скопирован',
  email: 'Письмо скопировано — вставьте его в почту',
  txt: 'Файл TXT скачан',
  error: 'Браузер не дал доступ к буферу обмена — выделите текст вручную',
};

/** Copy the result or save it as TXT right in the browser, without building a DOCX. */
export function ResultExport({ correctedText, requisites }: ResultExportProps) {
  const [done, setDone] = useState<Done>(null);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), 3000);
    return () => clearTimeout(timer);
  }, [done]);

  const copy = async (value: string, kind: 'text' | 'email') => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(kind);
    } catch {
      setDone('error');
    }
  };

  const downloadTxt = () => {
    const subject = requisites['Тема']?.trim();
    const blob = new Blob([buildEmailText(correctedText, requisites)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(subject || 'Документ').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setDone('txt');
  };

  const action = 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-secondary';
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className={action} onClick={() => void copy(correctedText, 'text')}>
        <Copy size={13} aria-hidden="true" /> Копировать текст
      </button>
      <button type="button" className={action} onClick={() => void copy(buildEmailText(correctedText, requisites), 'email')}>
        <Mail size={13} aria-hidden="true" /> Копировать для письма
      </button>
      <button type="button" className={action} onClick={downloadTxt}>
        <FileDown size={13} aria-hidden="true" /> Скачать TXT
      </button>
      <span role="status" className={`text-xs ${done === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
        {done ? DONE_LABEL[done] : ''}
      </span>
    </div>
  );
}
