import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { Eye, ShieldCheck } from "lucide-react";
import { DocumentPreview } from "./DocumentPreview";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useAppDispatch, useAppSelector } from "@/hooks";
import {
  setText,
  appendText,
  setCorrectedText,
  setDocumentType,
  setTemplateId,
  processText,
  generateDocument,
  fetchCatalog,
} from "@/store/documentSlice";
import { DOCUMENT_TYPES, TEMPLATES } from "@/lib/constants";
import { stripMarkup } from "@/lib/utils";
import { clearSavedDraft, loadSavedDraft, matchHotkey, saveDraft } from "@/lib/draftTools";
import { DraftAssistant } from "./DraftAssistant";
import type { DocumentTypeId, TemplateId } from "@/types/document";
import { BatchPanel, GostChecklist, HistoryPanel, MaxMiniAppBanner, TemplateImport } from './ProductPanels';

import { StepIndicator } from "./StepIndicator";
import { DraftSection } from "./DraftSection";
import { CorrectedSection } from "./CorrectedSection";
import { StatusBar } from "./StatusBar";
import { ErrorBar } from "./ErrorBar";
import { ValidationAlert } from "./ValidationAlert";
import { ActionButton } from "./ActionButton";

export function DocumentGenerator() {
  const prefersReduced = useReducedMotion();
  const dispatch = useAppDispatch();

  const text = useAppSelector((s) => s.document.text);
  const correctedText = useAppSelector((s) => s.document.correctedText);
  const requisites = useAppSelector((s) => s.document.requisites);
  const documentType = useAppSelector((s) => s.document.documentType);
  const templateId = useAppSelector((s) => s.document.templateId);
  const missingFields = useAppSelector((s) => s.document.missingFields);
  const warnings = useAppSelector((s) => s.document.warnings);
  const status = useAppSelector((s) => s.document.status);
  const error = useAppSelector((s) => s.document.error);
  const processing = useAppSelector((s) => s.document.processing);
  const generating = useAppSelector((s) => s.document.generating);
  const docTypeFields = useAppSelector((s) => s.document.docTypeFields);
  const changes = useAppSelector((s) => s.document.changes ?? []);
  const sourceQuotes = useAppSelector((s) => s.document.sourceQuotes ?? {});
  const documentId = useAppSelector((s) => s.document.documentId);
  const catalog = useAppSelector((s) => s.document.catalog);
  const [detected, setDetected] = useState<{ typeId: DocumentTypeId; typeName: string; confidence: number; evidence: string[]; source?: 'ai' | 'rules'; reason?: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);

  const typeDescription = useMemo(
    () =>
      DOCUMENT_TYPES.find((item) => item.id === documentType)?.description ??
      "",
    [documentType],
  );

  const templateLabel = useMemo(
    () => catalog?.templates?.find((item) => item.id === templateId)?.name || TEMPLATES.find((item) => item.id === templateId)?.label || templateId,
    [templateId, catalog],
  );



  const currentStep = correctedText ? 2 : 1;

  const handleTextChange = useCallback(
    (value: string) => dispatch(setText(value)),
    [dispatch],
  );
  const handleAudioTranscribed = useCallback(
    (value: string) => dispatch(appendText(value)),
    [dispatch],
  );
  const handleCorrectedTextChange = useCallback(
    (value: string) => dispatch(setCorrectedText(value)),
    [dispatch],
  );
  const handleTypeChange = useCallback(
    (value: DocumentTypeId) => {
      dispatch(setDocumentType(value));
      dispatch(setCorrectedText(""));
    },
    [dispatch],
  );
  const handleTemplateChange = useCallback(
    (value: TemplateId) => dispatch(setTemplateId(value)),
    [dispatch],
  );
  const handleRequisiteChange = useCallback(
    (field: string, value: string) => {
      dispatch({
        type: "document/setRequisites",
        payload: { ...requisites, [field]: value },
      });
    },
    [dispatch, requisites],
  );

  const handleProcess = useCallback(() => {
    if (!text.trim()) return;
    // An unconfirmed suggestion is just a hint: the draft is processed with the type chosen in the form
    setDetected(null);
    dispatch(processText({ text, documentType, templateId }));
  }, [dispatch, text, documentType, templateId]);

  const handleDetectType = useCallback(async () => {
    if (!text.trim()) return;
    setDetecting(true);
    setDetected(null);
    setDetectError(null);
    try {
      const response = await fetch('/api/detect-type', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceText: text }) });
      if (!response.ok) throw new Error(`Server error ${response.status}`);
      const suggestion = (await response.json()).suggestion;
      if (suggestion.notBusiness || !suggestion.typeId) {
        setDetectError(`Черновик не похож на деловой документ${suggestion.reason ? `: ${suggestion.reason.replace(/\.$/, '')}` : ''}. Опишите суть: кому, о чём и что нужно`);
        return;
      }
      // Rules without a single matching phrase are a guess, not a suggestion
      if (suggestion.source === 'rules' && suggestion.evidence.length === 0) {
        setDetectError('Нейросеть сейчас не ответила, а по ключевым словам тип не ясен — повторите или выберите тип вручную');
        return;
      }
      setDetected(suggestion);
    } catch {
      setDetectError('Не удалось определить тип — выберите его вручную');
    } finally { setDetecting(false); }
  }, [text]);

  const handleGenerate = useCallback(() => {
    if (!text.trim() || !correctedText.trim()) return;
    dispatch(
      generateDocument({
        text,
        correctedText,
        requisites,
        documentType,
        templateId,
      }),
    );
  }, [dispatch, text, correctedText, requisites, documentType, templateId]);

  const handleAction = correctedText ? handleGenerate : handleProcess;
  const actionDisabled = correctedText
    ? generating
    : !text.trim() || processing;

  // Autosave: the draft, type and template survive a reload; restored once, on the first render
  const [savedDraft] = useState(() => (text.trim() ? null : loadSavedDraft()));
  const [restoredAt, setRestoredAt] = useState<string | null>(savedDraft?.savedAt ?? null);
  const restoreChecked = useRef(false);
  useEffect(() => {
    if (restoreChecked.current) return;
    restoreChecked.current = true;
    if (!savedDraft) return;
    dispatch(setText(savedDraft.text));
    if (DOCUMENT_TYPES.some((type) => type.id === savedDraft.documentType)) dispatch(setDocumentType(savedDraft.documentType));
    if (savedDraft.templateId) dispatch(setTemplateId(savedDraft.templateId));
  }, [dispatch, savedDraft]);
  useEffect(() => {
    if (!restoreChecked.current) return;
    const timer = setTimeout(() => saveDraft({ text, documentType, templateId }), 400);
    return () => clearTimeout(timer);
  }, [text, documentType, templateId]);
  const handleStartOver = useCallback(() => {
    clearSavedDraft();
    dispatch(setText(''));
    setRestoredAt(null);
  }, [dispatch]);

  // Hotkeys: Ctrl/⌘+Enter — main button, Ctrl/⌘+S — download the DOCX once the result is ready
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hotkey = matchHotkey(event);
      if (hotkey === 'primary' && !actionDisabled) {
        event.preventDefault();
        handleAction();
      } else if (hotkey === 'download' && correctedText) {
        event.preventDefault();
        if (!generating) handleGenerate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actionDisabled, handleAction, handleGenerate, correctedText, generating]);

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReduced ? 0 : 0.4, ease: "easeOut" }}
      className="site-container"
    >
      <MaxMiniAppBanner />
      <div className="workspace-heading">
        <div>
          <h1>Документ за три шага</h1>
          <p>
            Добавьте черновик, проверьте результат и скачайте DOCX.
            <br />
            Оформление возьмём на себя.
          </p>
        </div>
        <span className="workspace-badge">
          <ShieldCheck size={15} aria-hidden="true" />
          Без регистрации
        </span>
      </div>
      <StepIndicator
        currentStep={currentStep}
        complete={status === "Документ готов" && !error && !generating}
      />
      <div className="workspace-grid">
        <div className="workspace-editor">
          <AnimatePresence mode="wait" initial={false}>
            {!correctedText ? (
              <motion.div
                key="draft"
                initial={prefersReduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={prefersReduced ? {} : { opacity: 0 }}
                transition={{ duration: prefersReduced ? 0 : 0.2 }}
              >
                <DraftSection
                  text={text}
                  documentType={documentType}
                  templateId={templateId}
                  typeDescription={typeDescription}
                  onTextChange={handleTextChange}
                  onTypeChange={handleTypeChange}
                  onTemplateChange={handleTemplateChange}
                  onAudioTranscribed={handleAudioTranscribed}
                  disabled={processing || generating}
                  templates={catalog?.templates}
                />
                {restoredAt && text.trim() && (
                  <p className="mt-3 text-xs text-muted-foreground" role="status">
                    Восстановили черновик от {new Date(restoredAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                    <button type="button" className="ml-2 text-primary underline underline-offset-4" onClick={handleStartOver}>Начать заново</button>
                  </p>
                )}
                <DraftAssistant text={text} documentType={documentType} onTextChange={handleTextChange} disabled={processing || generating} />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" className="rounded-md border border-primary/30 px-3 py-2 text-xs text-primary hover:bg-primary/5" onClick={() => void handleDetectType()} disabled={detecting || !text.trim()}>{detecting ? 'Нейросеть анализирует черновик…' : 'Определить тип по черновику'}</button>
                  {detected && (
                    <span className="text-xs text-muted-foreground">
                      Похоже на <b>{detected.typeName}</b> · уверенность {Math.round(detected.confidence * 100)}% · {detected.source === 'ai' ? 'анализ нейросети' : 'по ключевым словам'}
                      {detected.typeId === documentType
                        ? <span className="ml-2 text-emerald-700">уже выбран</span>
                        : <button type="button" className="ml-2 underline" onClick={() => { dispatch(setDocumentType(detected.typeId)); setDetected(null); }}>Подтвердить</button>}
                      {detected.evidence.length > 0 && <span className="mt-1 block">Основание: {detected.evidence.map((quote) => `«${quote}»`).join(', ')}</span>}
                    </span>
                  )}
                  {detectError && <span className="text-xs text-red-700">{detectError}</span>}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="corrected"
                initial={prefersReduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReduced ? {} : { opacity: 0 }}
                transition={{ duration: prefersReduced ? 0 : 0.25 }}
              >
                <CorrectedSection
                  correctedText={correctedText}
                  sourceText={text}
                  changes={changes}
                  sourceQuotes={sourceQuotes}
                  requisites={requisites}
                  docTypeFields={docTypeFields}
                  onTextChange={handleCorrectedTextChange}
                  onRequisiteChange={handleRequisiteChange}
                  disabled={processing || generating}
                />
              </motion.div>
            )}
          </AnimatePresence>
          {(status || error) && (
            <div className="workspace-alert">
              <StatusBar
                status={status}
                isVisible={!!status && !error}
                busy={processing || generating}
              />
              <ErrorBar error={error} isVisible={!!error} />
            </div>
          )}
          <ValidationAlert missingFields={missingFields} warnings={warnings} />
          {correctedText && <GostChecklist documentId={documentId} />}
          {correctedText && <HistoryPanel documentId={documentId} onRestore={(doc) => { if (doc.version) { dispatch(setCorrectedText(doc.version.body.map(stripMarkup).filter(Boolean).join('\n'))); dispatch({ type: 'document/setRequisites', payload: doc.userFields }); } }} />}
          <div className="mt-5 flex flex-wrap gap-2"><TemplateImport onImported={() => dispatch(fetchCatalog())} /></div>
          <BatchPanel />
          <div className="workspace-action-bar">
            <p className="workspace-action-note">
              {correctedText
                ? "Все правки попадут в итоговый файл."
                : "Сначала покажем результат. Вы сможете всё проверить."}
              <span className="mt-1 block opacity-80">
                <kbd>Ctrl</kbd> + <kbd>Enter</kbd> — {correctedText ? "скачать" : "обработать"}
                {correctedText && <>, <kbd>Ctrl</kbd> + <kbd>S</kbd> — скачать DOCX</>}
              </span>
            </p>
            <ActionButton
              step={currentStep}
              processing={processing}
              generating={generating}
              onClick={handleAction}
              disabled={actionDisabled}
            />
          </div>
        </div>
        <aside
          className="workspace-sidebar"
          aria-label="Предпросмотр документа"
        >
          <h2 className="preview-heading">
            <span>
              <Eye size={15} aria-hidden="true" />
              Предпросмотр структуры
            </span>
            <span>DOCX</span>
          </h2>
          <DocumentPreview
            documentType={documentType}
            templateId={templateId}
            text={correctedText || text}
            requisites={requisites}
          />
          <p className="preview-template-name">{templateLabel}</p>
          <p className="preview-template-description">
            {
              catalog?.templates?.find((template) => template.id === templateId)?.description || TEMPLATES.find((template) => template.id === templateId)?.description
            }
          </p>
          <p className="preview-disclaimer">
            Точное оформление будет в скачанном файле.
          </p>
        </aside>
      </div>
    </motion.div>
  );
}
