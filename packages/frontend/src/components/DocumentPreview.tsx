import { FileText } from "lucide-react";
import { DOCUMENT_TYPES } from "@/lib/constants";
import type { DocumentTypeId, Requisites, TemplateId } from "@/types/document";

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
  const addressee =
    documentType === "letter"
      ? [
          requisites.addresseeOrg,
          requisites.addresseePerson,
          requisites.addresseeAddress,
        ]
          .filter(Boolean)
          .join("\n") || requisites.addressee
      : requisites.addressee;
  const author =
    documentType === "letter"
      ? [requisites.signerPosition, requisites.signerName]
          .filter(Boolean)
          .join("\n") || requisites.authorName
      : [requisites.authorPosition, requisites.authorName]
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
          {requisites.number || (
            <span className="sheet-placeholder">[Номер]</span>
          )}
        </p>
      )}
      {documentType === "reference" && (
        <p className="sheet-meta">
          {requisites.period || (
            <span className="sheet-placeholder">[Период]</span>
          )}
        </p>
      )}
      {text ? (
        <p className="sheet-body">
          {text.slice(0, 650)}
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
          {requisites.date || <span className="sheet-placeholder">[Дата]</span>}
        </span>
      </div>
      {documentType === "letter" && requisites.executor && (
        <p className="sheet-meta">Исполнитель: {requisites.executor}</p>
      )}
    </div>
  );
}
