import { useEffect, useState } from 'react';
import { Archive, Check, ClipboardCheck, FileUp, History, RotateCcw, UploadCloud } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { DocumentView, GostReport } from '@/types/document';

export function GostChecklist({ documentId }: { documentId?: string }) {
  const [report, setReport] = useState<GostReport | null>(null);
  useEffect(() => {
    if (!documentId) return;
    fetch(`/api/documents/${documentId}/gost`, { credentials: 'include' }).then((r) => r.ok ? r.json() : null).then(setReport).catch(() => undefined);
  }, [documentId]);
  if (!report) return null;
  return <Card className="mt-5 overflow-hidden">
    <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2 text-sm font-medium"><ClipboardCheck size={16} className="text-primary" /> Проверка по {report.standard}</div><span className="text-xs text-muted-foreground">{report.score}/{report.total}</span></div>
    <ul className="grid gap-2 p-5 md:grid-cols-2">{report.checks.map((check) => <li key={check.id} className="flex gap-2 text-sm"><Check size={15} className={check.ok ? 'mt-0.5 text-emerald-600' : 'mt-0.5 text-amber-600'} /> <span><span className="font-medium">{check.label}</span><span className="block text-xs text-muted-foreground">{check.ok ? 'Соответствует' : check.detail}</span></span></li>)}</ul>
  </Card>;
}

interface HistoryPanelProps { documentId?: string; onRestore?: (doc: DocumentView) => void; }
export function HistoryPanel({ documentId, onRestore }: HistoryPanelProps) {
  const [versions, setVersions] = useState<Array<{ id: string; title: string; kind: string; createdAt: string; current?: boolean }>>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!documentId || !open) return; fetch(`/api/documents/${documentId}/versions`, { credentials: 'include' }).then((r) => r.ok ? r.json() : { versions: [] }).then((data) => setVersions(data.versions || [])).catch(() => undefined); }, [documentId, open]);
  if (!documentId) return null;
  return <Card className="mt-5 overflow-hidden">
    <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-4 text-left"><span className="flex items-center gap-2 text-sm font-medium"><History size={16} className="text-primary" /> История и версии</span><span className="text-xs text-muted-foreground">{open ? 'Скрыть' : 'Открыть'}</span></button>
    {open && <div className="border-t border-border p-5">{versions.length === 0 ? <p className="text-sm text-muted-foreground">Версии появятся после обработки.</p> : <ul className="space-y-2">{versions.map((version) => <li key={version.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-3 text-sm"><span><b>{version.title || 'Без заголовка'}</b><small className="ml-2 text-muted-foreground">{new Date(version.createdAt).toLocaleString('ru-RU')} · {version.kind}</small></span>{version.current ? <span className="text-xs text-emerald-700">Текущая</span> : <Button size="sm" variant="outline" onClick={async () => { const response = await fetch(`/api/documents/${documentId}/versions/${version.id}/restore`, { method: 'POST', credentials: 'include' }); if (response.ok) onRestore?.(await response.json()); }}><RotateCcw size={13} /> Откатить</Button>}</li>)}</ul>}</div>}
  </Card>;
}

export function TemplateImport({ onImported }: { onImported?: () => void }) {
  const [busy, setBusy] = useState(false);
  return <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted/40"><FileUp size={14} /> Свой бланк DOCX<input hidden type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setBusy(true); const data = new FormData(); data.append('file', file); const response = await fetch('/api/templates/import', { method: 'POST', body: data, credentials: 'include', headers: { 'x-filename': encodeURIComponent(file.name) } }); setBusy(false); if (response.ok) onImported?.(); event.target.value = ''; }} />{busy && <UploadCloud size={13} className="animate-pulse" />}</label>;
}

export function BatchPanel() {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [ids, setIds] = useState<string[]>([]);
  const downloadArchive = async () => { setBusy(true); setMessage('Собираем архив…'); const response = await fetch('/api/documents/batch-archive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: ids }) }); if (response.ok) { const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'docxgen-archive.zip'; link.click(); URL.revokeObjectURL(url); setMessage('Архив скачан.'); } else { const body = await response.json().catch(() => ({})); setMessage(body.error?.message || 'Документы ещё обрабатываются.'); } setBusy(false); };
  return <Card className="mt-5 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-medium"><Archive size={16} className="text-primary" /> Пакетная обработка</div><p className="mt-1 text-xs text-muted-foreground">Загрузите несколько TXT и скачайте единый архив DOCX.</p></div><div className="flex gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted/40">Выбрать файлы<input hidden type="file" multiple accept=".txt,text/plain" onChange={async (event) => { const files = [...(event.target.files || [])]; if (!files.length) return; setBusy(true); setMessage('Отправляем черновики…'); const documents = await Promise.all(files.slice(0, 20).map(async (file) => ({ filename: file.name, sourceText: await file.text(), docType: 'memo', templateId: 'classic' }))); const response = await fetch('/api/documents/process-batch', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documents }) }); const body = await response.json().catch(() => ({})); setBusy(false); if (response.ok) { setIds((body.documents || []).map((item: { id: string }) => item.id)); setMessage(`В очереди: ${body.count} документ(ов).`); } else setMessage(body.error?.message || 'Не удалось запустить пакет'); event.target.value = ''; }} />{busy && <UploadCloud size={13} className="animate-pulse" />}</label>{ids.length > 0 && <Button size="sm" variant="outline" onClick={() => void downloadArchive()} disabled={busy}><Archive size={13} /> Скачать архив</Button>}</div></div>{message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}</Card>;
}

export function MaxMiniAppBanner() {
  const isMiniApp = typeof window !== 'undefined' && (new URLSearchParams(window.location.search).has('maxApp') || window.location.hash.includes('maxApp') || /MAX/i.test(navigator.userAgent));
  if (!isMiniApp) return null;
  return <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm"><span><b>DocxGen внутри MAX</b><span className="ml-2 text-xs text-muted-foreground">Микрофон работает через браузер мини‑приложения.</span></span><a href="#/new" className="text-xs text-primary underline">Открыть редактор</a></div>;
}
