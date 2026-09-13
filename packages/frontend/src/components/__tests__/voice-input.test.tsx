import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import documentReducer from "@/store/documentSlice";
import type { DocumentState } from "@/types/document";
import { DocumentGenerator } from "../DocumentGenerator";

/**
 * Голосовой ввод в редакторе. jsdom не умеет записывать звук, поэтому подменены только
 * браузерные MediaRecorder/getUserMedia и сеть; редактор и store — настоящие.
 */

function renderEditor(state: Partial<DocumentState> = {}) {
  const initial = documentReducer(undefined, { type: "init" });
  const store = configureStore({
    reducer: { document: documentReducer },
    preloadedState: { document: { ...initial, ...state } },
  });
  const view = render(
    <Provider store={store}>
      <DocumentGenerator />
    </Provider>,
  );
  return { store, ...view };
}

function recognitionResponse(body: object, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

class FakeRecorder {
  static last: FakeRecorder | null = null;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

let track: { stop: ReturnType<typeof vi.fn> };
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  track = { stop: vi.fn() };
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  FakeRecorder.last = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe("voice input", () => {
  it("appends the text recognized from an uploaded audio file to the draft", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(recognitionResponse({ ok: true, text: "для нового сотрудника" }));
    const { store } = renderEditor({ text: "Прошу выделить ноутбук" });

    const file = new File(["m4a"], "memo.m4a", { type: "audio/mp4" });
    fireEvent.change(screen.getByLabelText("Аудиофайл"), { target: { files: [file] } });
    await flush();

    expect(fetchSpy).toHaveBeenCalledWith("/api/audio/transcribe", expect.objectContaining({ method: "POST" }));
    const body = fetchSpy.mock.calls[0][1]?.body as FormData;
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect(store.getState().document.text).toBe("Прошу выделить ноутбук\nдля нового сотрудника");
    expect(screen.getByRole("textbox", { name: "Черновик" })).toHaveValue("Прошу выделить ноутбук\nдля нового сотрудника");
  });

  it("shows the elapsed time while recording", async () => {
    vi.useFakeTimers();
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Записать голосом" }));
    await flush();
    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    expect(screen.getByRole("button", { name: "Остановить запись" })).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("stops a recording by itself after five minutes and sends it for recognition", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(recognitionResponse({ ok: true, text: "прошу выделить ноутбук" }));
    const { store } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Записать голосом" }));
    await flush();
    act(() => {
      vi.advanceTimersByTime(299_000);
    });
    expect(FakeRecorder.last?.state).toBe("recording");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();

    expect(FakeRecorder.last?.state).toBe("inactive");
    expect(track.stop).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(store.getState().document.text).toBe("прошу выделить ноутбук");
  });

  it("tells the user to allow the microphone when access is denied", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Записать голосом" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(/разрешите доступ к микрофону/i);
  });

  it("tells the user that no microphone is connected", async () => {
    getUserMedia.mockRejectedValue(new DOMException("none", "NotFoundError"));
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Записать голосом" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(/микрофон не найден/i);
  });

  it("releases the microphone when the editor is closed during a recording", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { unmount } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Записать голосом" }));
    await flush();
    unmount();

    expect(track.stop).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
