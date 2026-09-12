import { FileText } from "lucide-react";
import { DOCUMENT_TYPES } from "@/lib/constants";
import type { DocumentTypeId, Requisites, TemplateId } from "@/types/document";
import { RichText } from "./RichText";

interface DocumentPreviewProps {
  documentType: DocumentTypeId;
  templateId: TemplateId;
  text: string;
  requisites: Requisites;
}

/** A live structural preview, not a pixel-exact representation of the Word file. */
export function DocumentPreview({
  documentType,
  templateId,
  text,
  requisites,
}: DocumentPreviewProps) {
  const title = DOCUMENT_TYPES.find((item) => item.id === documentType)?.label;
  // Keys are the Russian field labels from the backend catalog (config/doc-types/*.json).
  const addressee =
    documentType === "letter"
      ? [
          requisites["Организация адресата"],
          requisites["Лицо адресата"],
          requisites["Адрес адресата"],
        ]
          .filter(Boolean)
          .join("\n") || requisites["Адресат"]
      : requisites["Адресат"];
  const author =
    documentType === "letter"
      ? [requisites["Должность подписывающего"], requisites["ФИО подписывающего"]]
          .filter(Boolean)
          .join("\n") || requisites["ФИО автора"]
      : [requisites["Должность автора"], requisites["ФИО автора"]]
          .filter(Boolean)
          .join("\n");
  return (
    <div
      className={`document-sheet ${templateId === "modern" ? "document-sheet-modern" : ""}`}
    >
      <div className="sheet-addressee">
        {addressee || <span className="sheet-placeholder">[Адресат]</span>}
      </div>
      <h3>{title}</h3>
      {(documentType === "memo" || documentType === "report") && (
        <p className="sheet-meta">
          №{" "}
          {requisites["Номер"] || (
            <span className="sheet-placeholder">[Номер]</span>
          )}
        </p>
      )}
      {documentType === "reference" && (
        <p className="sheet-meta">
          {requisites["Период"] || (
            <span className="sheet-placeholder">[Период]</span>
          )}
        </p>
      )}
      {text ? (
        <p className="sheet-body">
          <RichText text={text} maxLength={650} />
          {text.length > 650 && "…"}
        </p>
      ) : (
        <div className="sheet-empty">
          <FileText size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>Здесь появится ваш текст</p>
          <span>Начните с черновика</span>
        </div>
      )}
      <div className="sheet-signature">
        <span>
          {author || <span className="sheet-placeholder">[Автор]</span>}
        </span>
        <span>
          {requisites["Дата"] || <span className="sheet-placeholder">[Дата]</span>}
        </span>
      </div>
      {documentType === "letter" && requisites["Исполнитель"] && (
        <p className="sheet-meta">Исполнитель: {requisites["Исполнитель"]}</p>
      )}
    </div>
  );
}
