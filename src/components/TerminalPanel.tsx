import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { EditorPreferences } from "../types";
import {
  readTerminalTranscript,
  saveTerminalTranscript,
  trimTerminalTranscript,
} from "../terminal-workspace";

const terminalPalette = (theme: EditorPreferences["theme"]) =>
  theme === "blue-light"
    ? {
        background: "#ffffff",
        foreground: "#0b1d33",
        cursor: "#2187b5",
        cursorAccent: "#ffffff",
        selectionBackground: "#b9e0f2",
        black: "#0b1d33",
        red: "#b33a3a",
        green: "#257349",
        yellow: "#8a6417",
        blue: "#246fa8",
        magenta: "#8755a6",
        cyan: "#1b6f91",
        white: "#eaf4ff",
        brightBlack: "#526d8c",
        brightWhite: "#ffffff",
      }
    : {
        background: theme === "blue-dark" ? "#07111f" : "#111314",
        foreground: theme === "blue-dark" ? "#e5f5fc" : "#e7ecee",
        cursor: theme === "blue-dark" ? "#75b8ff" : "#89cff0",
        cursorAccent: theme === "blue-dark" ? "#07111f" : "#111314",
        selectionBackground: theme === "blue-dark" ? "#173a64" : "#34484f",
      };

export function TerminalPanel({
  id,
  interpreter,
  active,
  theme,
  projectRoot,
  persistenceId,
}: {
  id: string;
  interpreter: string;
  active: boolean;
  theme: EditorPreferences["theme"];
  projectRoot: string;
  persistenceId: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const requestFitRef = useRef<(() => void) | null>(null);
  const repaintAfterFitRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({
      fontFamily: "Fira Code",
      fontSize: 13,
      letterSpacing: 0,
      lineHeight: 1.25,
      theme: terminalPalette(theme),
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(host.current);
    terminal.current = t;
    let transcript = readTerminalTranscript(projectRoot, persistenceId);
    let persistenceTimer = 0;
    if (transcript) t.write(transcript);
    const persistTranscript = () => {
      window.clearTimeout(persistenceTimer);
      saveTerminalTranscript(projectRoot, persistenceId, transcript);
    };
    const off = window.oscode.onTerminalData((termId, data) => {
      if (termId !== id) return;
      t.write(data);
      transcript = trimTerminalTranscript(`${transcript}${data}`);
      window.clearTimeout(persistenceTimer);
      persistenceTimer = window.setTimeout(persistTranscript, 180);
    });
    void window.oscode
      .createTerminal(id, interpreter)
      .catch((error) =>
        t.write(
          `\r\nUnable to start terminal: ${error instanceof Error ? error.message : String(error)}\r\n`,
        ),
      );
    const inputDisposable = t.onData((data) =>
      window.oscode.terminalWrite(id, data),
    );
    let fitFrame = 0;
    let secondFitFrame = 0;
    let lastPtyDimensions = "";
    let disposed = false;
    const fitTerminal = () => {
      if (
        disposed ||
        !activeRef.current ||
        !host.current ||
        host.current.clientWidth < 2 ||
        host.current.clientHeight < 2
      )
        return;
      fit.fit();
      const nextDimensions = `${t.cols}x${t.rows}`;
      if (nextDimensions !== lastPtyDimensions) {
        lastPtyDimensions = nextDimensions;
        window.oscode.terminalResize(id, t.cols, t.rows);
      }
      if (repaintAfterFitRef.current && t.rows > 0) {
        repaintAfterFitRef.current = false;
        t.refresh(0, t.rows - 1);
      }
    };
    const resize = () => {
      cancelAnimationFrame(fitFrame);
      cancelAnimationFrame(secondFitFrame);
      fitFrame = requestAnimationFrame(() => {
        secondFitFrame = requestAnimationFrame(fitTerminal);
      });
    };
    requestFitRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    window.addEventListener("resize", resize);
    resize();
    void document.fonts?.ready.then(resize);
    return () => {
      disposed = true;
      cancelAnimationFrame(fitFrame);
      cancelAnimationFrame(secondFitFrame);
      persistTranscript();
      off();
      inputDisposable.dispose();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      if (requestFitRef.current === resize) requestFitRef.current = null;
      t.dispose();
    };
  }, [id, interpreter, persistenceId, projectRoot]);
  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.theme = terminalPalette(theme);
  }, [theme]);
  useEffect(() => {
    if (!active || !terminal.current) return;
    repaintAfterFitRef.current = true;
    requestFitRef.current?.();
    terminal.current.focus();
  }, [active]);
  return (
    <div
      className="terminal-host"
      data-terminal-theme={theme}
      ref={host}
      hidden={!active}
    />
  );
}
