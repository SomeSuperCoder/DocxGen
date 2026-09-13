import { memo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Download,
  FileCheck2,
  FileText,
  Globe2,
  ListChecks,
  MessageCircle,
  PenLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPES, TEMPLATES } from "@/lib/constants";
import { DOCUMENT_EXAMPLES } from "@/lib/examples";
import type { DocumentTypeId, TemplateId } from "@/types/document";
import { DocumentArtwork } from "./DocumentArtwork";
import { DocumentPreview } from "./DocumentPreview";
import { Reveal } from "./Reveal";

interface LandingProps {
  onStart: () => void;
}
const STEPS = [
  {
    icon: PenLine,
    title: "Добавьте черновик",
    text: "Вставьте текст как есть. Выберите тип документа и оформление.",
  },
  {
    icon: ListChecks,
    title: "Проверьте результат",
    text: "Отредактируйте исправленный текст и дополните реквизиты.",
  },
  {
    icon: Download,
    title: "Скачайте документ",
    text: "Получите DOCX, который можно дальше редактировать в Word.",
  },
];

export const Landing = memo(function Landing({ onStart }: LandingProps) {
  const reduced = useReducedMotion();
  const [exampleType, setExampleType] = useState<DocumentTypeId>("memo");
  const [previewTemplate, setPreviewTemplate] = useState<TemplateId>("classic");
  const example = DOCUMENT_EXAMPLES[exampleType];
  return (
    <main id="main-content" tabIndex={-1} className="landing">
      <section className="site-container hero-section">
        <Reveal className="hero-copy">
          <div className="hero-eyebrow">
            <PenLine size={14} strokeWidth={1.7} aria-hidden="true" />
            Служебные документы, без рутины
          </div>
          <h1>
            Из черновика
            <br />в <span>документ.</span>
          </h1>
          <p className="hero-description">
            Вы пишете по существу.
            <br />
            DocxGen помогает с формой.
          </p>
          <p className="hero-detail">
            Исправит текст, соберёт реквизиты и оформит редактируемый DOCX.
            Покажет правки и источники каждого значения, проверит документ по ГОСТ
            и сохранит версии. Начните с того, что уже написали.
          </p>
          <div className="hero-actions">
            <Button onClick={onStart}>
              Вставить черновик
              <ArrowUpRight size={18} aria-hidden="true" />
            </Button>
            <a href="#example" className="text-link">
              Посмотреть пример
              <ArrowDown size={16} aria-hidden="true" />
            </a>
          </div>
          <div className="hero-note">
            <Check size={15} aria-hidden="true" />
            Без регистрации
            <span className="note-divider" />
            <FileText size={15} aria-hidden="true" />
            Формат DOCX
          </div>
        </Reveal>
        <Reveal className="hero-visual" delay={0.12}>
          <DocumentArtwork />
          <div className="artwork-caption">
            <span>Меньше оформления. Больше смысла.</span>
            <span>.docx</span>
          </div>
        </Reveal>
      </section>
      <section id="how" className="site-container how-section">
        <Reveal className="how-heading">
          <span className="section-kicker">Как это работает</span>
          <h2>
            Три шага.
            <br />
            Один готовый файл.
          </h2>
        </Reveal>
        <div className="steps-grid">
          {STEPS.map((step, index) => (
            <Reveal
              key={step.title}
              className="process-step"
              delay={index * 0.07}
            >
              <div className="process-icon">
                <step.icon size={22} strokeWidth={1.6} aria-hidden="true" />
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </Reveal>
          ))}
        </div>
      </section>
      <section id="example" className="site-container section-space">
        <Reveal>
          <div className="section-heading">
            <span className="section-kicker">Было и стало</span>
            <h2>
              Ваша мысль.
              <br className="mobile-break" /> В нужной форме.
            </h2>
            <p>Посмотрите на примере, как меняется текст.</p>
          </div>
        </Reveal>
        <Reveal className="comparison-panel">
          <div className="example-toolbar">
            <div
              className="example-options"
              role="group"
              aria-label="Пример документа"
            >
              {DOCUMENT_TYPES.map((type) => (
                <button
                  type="button"
                  aria-pressed={type.id === exampleType}
                  key={type.id}
                  onClick={() => setExampleType(type.id)}
                >
                  {type.id === "reference" ? "Справка" : type.label}
                </button>
              ))}
            </div>
            <span className="example-label">Пример</span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={exampleType}
              className="comparison-grid"
              initial={reduced ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? {} : { opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.16 }}
            >
              <div className="comparison-draft">
                <div className="comparison-label">
                  <PenLine size={16} aria-hidden="true" />
                  Ваш черновик
                </div>
                <p>{example.draft}</p>
              </div>
              <div className="comparison-result">
                <div className="comparison-label">
                  <Sparkles size={16} aria-hidden="true" />
                  После обработки
                </div>
                <p>{example.corrected}</p>
                <div className="result-detail">
                  <CheckCheck size={16} aria-hidden="true" />
                  Орфография, пунктуация и деловой стиль
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
          <div className="comparison-footer">
            <ShieldCheck size={17} aria-hidden="true" />
            <p>
              Адресат и автор переносятся в реквизиты. Смысл остаётся вашим.
            </p>
          </div>
        </Reveal>
      </section>
      <section
        id="types"
        className="site-container section-space catalog-section"
      >
        <Reveal className="catalog-copy">
          <h2>
            Для повседневных
            <br />
            рабочих задач.
          </h2>
          <p className="section-description">
            Пять типов документов, два шаблона оформления и собственные бланки.
            Выберите подходящий вариант для вашей задачи.
          </p>
          <div className="type-list">
            {DOCUMENT_TYPES.map((type) => (
              <button
                type="button"
                key={type.id}
                aria-pressed={type.id === exampleType}
                onClick={() => setExampleType(type.id)}
              >
                <span className="type-icon">
                  <FileText size={20} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <span>
                  <strong>{type.label}</strong>
                  <small>{type.description}</small>
                </span>
                <ArrowUpRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </Reveal>
        <Reveal className="catalog-preview" delay={0.08}>
          <div
            className="template-options"
            role="group"
            aria-label="Предпросмотр шаблона"
          >
            {TEMPLATES.map((template) => (
              <button
                type="button"
                key={template.id}
                aria-pressed={template.id === previewTemplate}
                onClick={() => setPreviewTemplate(template.id)}
              >
                {template.id === "classic" ? "Классический" : "Современный"}
              </button>
            ))}
          </div>
          <div className="catalog-sheet">
            <DocumentPreview
              documentType={exampleType}
              templateId={previewTemplate}
              text={example.corrected}
              requisites={{
                addressee: "Директору Иванову И. И.",
                authorName: "Петров П. П.",
                date: "10.09.2026",
              }}
            />
          </div>
          <p className="preview-disclaimer">
            Пример структуры. Точное оформление будет в DOCX.
          </p>
        </Reveal>
      </section>
      <section className="site-container section-space">
        <Reveal className="trust-panel">
          <div className="trust-icon">
            <ShieldCheck size={36} strokeWidth={1.4} aria-hidden="true" />
          </div>
          <div>
            <h2>Ничего не досочиняет.</h2>
            <p>
              Реквизиты сверяются с исходным текстом. Если подтверждения нет,
              поле остаётся пустым. В документе оно выделяется жёлтой пометкой,
              чтобы вы его заметили.
            </p>
          </div>
          <div className="trust-example">
            <span>Нет в черновике?</span>
            <mark>[Номер документа]</mark>
            <span>Дополните при проверке</span>
          </div>
        </Reveal>
      </section>
      <section
        id="bots"
        className="site-container section-space channels-section"
      >
        <Reveal>
          <h2>Там, где вам удобно.</h2>
          <p className="section-description">
            В браузере или в переписке. Знакомый процесс и тот же редактируемый
            документ.
          </p>
        </Reveal>
        <div className="channel-grid">
          <Reveal className="channel-browser">
            <Globe2 size={25} strokeWidth={1.5} aria-hidden="true" />
            <h3>Браузер</h3>
            <p>Текст, реквизиты и предпросмотр на одном экране.</p>
            <button type="button" className="text-link" onClick={onStart}>
              Вставить черновик
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </Reveal>
          <Reveal className="channel-messengers" delay={0.08}>
            <MessageCircle size={25} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <h3>MAX и ВКонтакте</h3>
              <p>Пришлите черновик боту и получите готовый файл в переписке.</p>
              <div className="messenger-names">
                <span>MAX</span>
                <span>ВКонтакте</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
      <section className="site-container section-space">
        <Reveal className="closing-section">
          <FileCheck2 size={32} strokeWidth={1.4} aria-hidden="true" />
          <h2>
            Черновик уже написан.
            <br />
            <span>Осталось оформить.</span>
          </h2>
          <Button onClick={onStart}>
            Вставить черновик
            <ArrowUpRight size={18} aria-hidden="true" />
          </Button>
          <p>Без регистрации. Файл хранится сутки и удаляется.</p>
        </Reveal>
      </section>
      <footer className="site-container site-footer">
        <span className="brand-wordmark">DocxGen</span>
        <span>Документ за три шага</span>
        <a href="#how">
          Как это работает
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </footer>
    </main>
  );
});
