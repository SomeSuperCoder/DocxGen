/**
 * Shared constants for the DocxGen document generator.
 */

import type { DocumentTypeId, TemplateId } from '@/types/document';

export const DOCUMENT_TYPES: Array<{
  id: DocumentTypeId;
  label: string;
  description: string;
}> = [
  { id: 'memo', label: 'Служебная записка', description: 'Внутренняя переписка' },
  { id: 'report', label: 'Докладная записка', description: 'Формальный отчёт' },
  { id: 'reference', label: 'Информационная справка', description: 'Справка с фактами' },
  { id: 'letter', label: 'Письмо', description: 'Внешняя корреспонденция' },
  { id: 'explanatory-note', label: 'Пояснительная записка', description: 'Пояснение к проекту документа' },
];



export const TEMPLATES: Array<{
  id: TemplateId;
  label: string;
  description: string;
}> = [
  { id: 'classic', label: 'Классический корпоративный', description: 'Times New Roman 14 пт, полуторный интервал, адресат справа вверху, номер страницы сверху по центру со второй страницы' },
  { id: 'modern', label: 'Современный регламентный', description: 'Arial 12 пт, интервал 1.15, выравнивание по левому краю, адресат слева, организация в колонтитуле, «Страница N из M» внизу' },
];
