import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";
import documentReducer, {
  setProcessing,
  setStatus,
} from "@/store/documentSlice";
import type { DocumentState } from "@/types/document";
import { DOCUMENT_EXAMPLES } from "@/lib/examples";
import { DocumentGenerator } from "../DocumentGenerator";

function renderEditor(state: Partial<DocumentState> = {}) {
  const initial = documentReducer(undefined, { type: "init" });
  const store = configureStore({
    reducer: { document: documentReducer },
    preloadedState: { document: { ...initial, ...state } },
  });
  render(
    <Provider store={store}>
      <DocumentGenerator />
    </Provider>,
  );
  return store;
}

describe("editor interactions", () => {
  it("inserts a type-specific example locally without submitting or replacing an existing draft", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const store = renderEditor({ documentType: "letter" });
    fireEvent.click(screen.getByRole("button", { name: "Начать с примера" }));
    expect(screen.getByRole("textbox", { name: "Черновик" })).toHaveValue(
      DOCUMENT_EXAMPLES.letter.draft,
    );
    expect(store.getState().document.text).toBe(DOCUMENT_EXAMPLES.letter.draft);
    expect(
      screen.queryByRole("button", { name: "Начать с примера" }),
    ).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps edited requisites in the store and live preview", () => {
    const store = renderEditor({
      text: "Черновик",
      correctedText: "Исправленный текст.",
      requisites: { authorName: "Петров П. П." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "ФИО автора" }), {
      target: { value: "Сидоров С. А." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Номер" }), {
      target: { value: "42/К" },
    });
    const preview = within(
      screen.getByRole("complementary", { name: "Предпросмотр документа" }),
    );
    expect(preview.getByText("Сидоров С. А.")).toBeInTheDocument();
    expect(preview.getByText("№ 42/К")).toBeInTheDocument();
    expect(store.getState().document.requisites).toMatchObject({
      authorName: "Сидоров С. А.",
      number: "42/К",
    });
  });

  it("disables editing while processing and removes the waiting message when processing ends", () => {
    const store = renderEditor({
      text: "Черновик",
      processing: true,
      status: "Обработка текста…",
    });
    expect(screen.getByRole("textbox", { name: "Черновик" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Обработка…" })).toBeDisabled();
    expect(screen.getByText(/Обычно 25-90 секунд/)).toBeInTheDocument();
    act(() => {
      store.dispatch(setProcessing(false));
      store.dispatch(setStatus("Текст обработан"));
    });
    expect(screen.queryByText(/Обычно 25-90 секунд/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Обработать черновик" }),
    ).toBeEnabled();
  });
});
