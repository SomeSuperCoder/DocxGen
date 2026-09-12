import { useMemo, useCallback } from "react";
import { Eye, ShieldCheck } from "lucide-react";
import { DocumentPreview } from "./DocumentPreview";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useAppDispatch, useAppSelector } from "@/hooks";
import {
  setText,
  setCorrectedText,
  setDocumentType,
  setTemplateId,
  processText,
  generateDocument,
} from "@/store/documentSlice";
import { DOCUMENT_TYPES, TEMPLATES } from "@/lib/constants";
import type { DocumentTypeId, TemplateId } from "@/types/document";

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

  const typeDescription = useMemo(
    () =>
      DOCUMENT_TYPES.find((item) => item.id === documentType)?.description ??
      "",
    [documentType],
  );

  const templateLabel = useMemo(
    () => TEMPLATES.find((item) => item.id === templateId)?.label ?? "",
    [templateId],
  );



  const currentStep = correctedText ? 2 : 1;

  const handleTextChange = useCallback(
    (value: string) => dispatch(setText(value)),
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
    dispatch(processText({ text, documentType, templateId }));
  }, [dispatch, text, documentType, templateId]);

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

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReduced ? 0 : 0.4, ease: "easeOut" }}
      className="site-container"
    >
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
                  disabled={processing || generating}
                />
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
          <div className="workspace-action-bar">
            <p className="workspace-action-note">
              {correctedText
                ? "Все правки попадут в итоговый файл."
                : "Сначала покажем результат. Вы сможете всё проверить."}
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
              TEMPLATES.find((template) => template.id === templateId)
                ?.description
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
