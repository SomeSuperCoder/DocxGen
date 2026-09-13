import { fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";
import documentReducer from "@/store/documentSlice";
import type { DocumentState } from "@/types/document";
import { saveDraft } from "@/lib/draftTools";
import { DocumentGenerator } from "../DocumentGenerator";

function renderEditor(state: Partial<DocumentState> = {}) {
  const initial = documentReducer(undefined, { type: "init" });
  const store = configureStore({
    reducer: { document: documentReducer },
    preloadedState: { document: { ...initial, ...state } },
  });
  render(<Provider store={store}><DocumentGenerator /></Provider>);
  return store;
}

describe("draft tools in the editor", () => {
  it("shows what the draft lacks and fixes colloquial words in one click", () => {
    const store = renderEditor({ text: "привет, короче надо купить комп" });
    expect(screen.getByRole("heading", { name: "Готовность черновика" })).toBeInTheDocument();
    expect(screen.getByText(/Кому документ/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Исправить все" }));
    expect(store.getState().document.text).toBe("Необходимо купить компьютер");
    expect(screen.queryByRole("button", { name: "Исправить все" })).not.toBeInTheDocument();
  });

  it("restores the saved draft after a reload and starts over on request", () => {
    saveDraft({ text: "Прошу выделить средства", documentType: "letter", templateId: "modern" });
    const store = renderEditor();
    expect(store.getState().document).toMatchObject({ text: "Прошу выделить средства", documentType: "letter", templateId: "modern" });
    expect(screen.getByText(/Восстановили черновик/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Начать заново" }));
    expect(store.getState().document.text).toBe("");
    expect(localStorage.getItem("docxgen-draft")).toBeNull();
  });

  it("processes the draft on Ctrl+Enter", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    renderEditor({ text: "Прошу выделить средства на закупку мониторов" });
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(fetchSpy).toHaveBeenCalledWith("/api/documents", expect.objectContaining({ method: "POST" }));
    fetchSpy.mockRestore();
  });
});
