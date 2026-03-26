import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import { StatusBadge } from "../../../shared/components/StatusBadge";
import { Panel } from "../../../shared/components/Panel";
import { t } from "../../../shared/i18n";
import { readClipboardText, writeClipboardText } from "../../../shared/lib/clipboard";
import { formatTimestamp } from "../../../shared/lib/time";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

interface TerminalWorkspaceProps {
  controller: WorkspaceController;
}

interface TerminalHostActions {
  copySelection: () => Promise<void>;
  pasteClipboard: () => Promise<void>;
  focus: () => void;
}

export function TerminalWorkspace({ controller }: TerminalWorkspaceProps) {
  const { state, activeSession } = controller;
  const hasOtherSessions = state.sessions.length > 1;
  const hostActionsRef = useRef<TerminalHostActions | null>(null);
  // Only surface terminal dimensions when both axes are available.
  const sessionSize = useMemo(() => {
    const cols = activeSession?.terminalCols;
    const rows = activeSession?.terminalRows;
    if (cols == null || rows == null) {
      return null;
    }
    return { cols, rows };
  }, [activeSession?.terminalCols, activeSession?.terminalRows]);

  function handleTerminalInput(input: string) {
    if (!activeSession || !input) {
      return;
    }

    if (activeSession.status === "connecting") {
      return;
    }

    if (activeSession.status === "disconnected") {
      if (input.includes("\r") || input.includes("\n")) {
        void controller.reconnectSession(activeSession.id);
      }
      return;
    }

    void controller.sendSessionInput(activeSession.id, input);
  }

  return (
    <Panel
      title={t("terminal.title")}
      subtitle={activeSession ? activeSession.title : t("files.noSession")}
      actions={
        <div className="button-row">
          <button className="ghost-button" onClick={() => void controller.toggleTheme()} type="button">
            {t("terminal.toggleTheme")}
          </button>
          <button className="ghost-button" onClick={() => void controller.toggleRightPanel()} type="button">
            {t("terminal.togglePanel")}
          </button>
        </div>
      }
      className="terminal-panel"
    >
      <div className="terminal-shell">
        <div className="tab-strip">
          {state.sessions.map((session) => (
            <button
              key={session.id}
              className={`tab-chip ${state.activeSessionId === session.id ? "is-active" : ""}`}
              onClick={() => controller.selectSession(session.id)}
              type="button"
            >
              <span>{session.title}</span>
              <StatusBadge status={session.status} />
              <span
                className="tab-chip__close"
                onClick={(event) => {
                  event.stopPropagation();
                  void controller.closeSession(session.id);
                }}
                role="button"
                tabIndex={0}
              >
                ×
              </span>
            </button>
          ))}
          {state.sessions.length === 0 ? <div className="tab-strip__empty">{t("terminal.openHint")}</div> : null}
        </div>

        <div className="terminal-view">
          {activeSession ? (
            <>
              <div className="terminal-meta">
                <span>{activeSession.currentPath}</span>
                <span>{t("terminal.lastUpdate", { time: formatTimestamp(activeSession.updatedAt) })}</span>
                {sessionSize ? (
                  <span>{t("terminal.size", { cols: sessionSize.cols, rows: sessionSize.rows })}</span>
                ) : null}
              </div>
              <div className="button-row">
                <button
                  className="ghost-button"
                  onClick={() => void hostActionsRef.current?.copySelection()}
                  type="button"
                >
                  {t("terminal.copy")}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => void hostActionsRef.current?.pasteClipboard()}
                  type="button"
                >
                  {t("terminal.paste")}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => void controller.reconnectSession(activeSession.id)}
                  type="button"
                >
                  {t("terminal.reconnect")}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => void controller.clearSessionOutput(activeSession.id)}
                  type="button"
                >
                  {t("terminal.clearOutput")}
                </button>
                <button
                  className="ghost-button"
                  disabled={!hasOtherSessions}
                  onClick={() => void controller.closeOtherSessions(activeSession.id)}
                  title={!hasOtherSessions ? t("terminal.noOtherSessions") : undefined}
                  type="button"
                >
                  {t("terminal.closeOthers")}
                </button>
              </div>
              <div className="terminal-host">
                <TerminalHost
                  cursorStyle={state.settings.terminal.cursorStyle}
                  hostActionsRef={hostActionsRef}
                  output={activeSession.lastOutput}
                  onClearRequest={() => void controller.clearSessionOutput(activeSession.id)}
                  onInput={handleTerminalInput}
                  onResize={(cols, rows) => void controller.resizeSession(activeSession.id, cols, rows)}
                  theme={state.settings.terminal.theme}
                  fontFamily={state.settings.terminal.fontFamily}
                  fontSize={state.settings.terminal.fontSize}
                  lineHeight={state.settings.terminal.lineHeight}
                />
              </div>
            </>
          ) : (
            <div className="empty-stage">
              <h3>{t("terminal.emptyTitle")}</h3>
              <p>{t("terminal.emptyBody")}</p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

type TerminalTheme = "midnight" | "sand";

const terminalColorPalettes: Record<TerminalTheme, { background: string; foreground: string }> = {
  midnight: {
    background: "#0c1014",
    foreground: "#dce8d8",
  },
  sand: {
    background: "#efe7d9",
    foreground: "#2a2418",
  },
};

interface TerminalHostProps {
  output: string;
  theme: TerminalTheme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "line";
  hostActionsRef: MutableRefObject<TerminalHostActions | null>;
  onClearRequest?: () => void;
  onInput?: (input: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export function TerminalHost({
  output,
  theme,
  fontFamily,
  fontSize,
  lineHeight,
  cursorStyle,
  hostActionsRef,
  onClearRequest,
  onInput,
  onResize,
}: TerminalHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastOutputRef = useRef<string>("");
  const lastResizeRef = useRef<string>("");
  const inputHandlerRef = useRef(onInput);
  const resizeHandlerRef = useRef(onResize);
  const clearHandlerRef = useRef(onClearRequest);

  useEffect(() => {
    inputHandlerRef.current = onInput;
    resizeHandlerRef.current = onResize;
    clearHandlerRef.current = onClearRequest;
  }, [onClearRequest, onInput, onResize]);

  useEffect(() => {
    hostActionsRef.current = {
      copySelection: async () => {
        const terminal = terminalRef.current;
        const selection = terminal?.hasSelection() ? terminal.getSelection() : "";
        if (!selection) {
          return;
        }
        await writeClipboardText(selection);
        terminal?.focus();
      },
      pasteClipboard: async () => {
        const text = await readClipboardText();
        if (!text) {
          return;
        }
        inputHandlerRef.current?.(text);
        terminalRef.current?.focus();
      },
      focus: () => {
        terminalRef.current?.focus();
      },
    };

    return () => {
      hostActionsRef.current = null;
    };
  }, [hostActionsRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      fontFamily,
      fontSize,
      lineHeight,
      cursorBlink: true,
      cursorStyle: cursorStyle === "line" ? "bar" : "block",
      disableStdin: false,
      scrollback: 1000,
      theme: terminalColorPalettes[theme],
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminal.focus();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const disposable = terminal.onData((data) => {
      inputHandlerRef.current?.(data);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      const isAccel = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (isAccel && event.shiftKey && key === "c") {
        void hostActionsRef.current?.copySelection();
        return false;
      }

      if (isAccel && event.shiftKey && key === "v") {
        void hostActionsRef.current?.pasteClipboard();
        return false;
      }

      if (isAccel && !event.shiftKey && key === "l") {
        clearHandlerRef.current?.();
        terminal.clear();
        return false;
      }

      return true;
    });

    const handleResize = () => {
      fitAddon.fit();
      const sizeKey = `${terminal.cols}x${terminal.rows}`;

      if (terminal.cols > 0 && terminal.rows > 0 && sizeKey !== lastResizeRef.current) {
        lastResizeRef.current = sizeKey;
        resizeHandlerRef.current?.(terminal.cols, terminal.rows);
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) {
        return;
      }

      const lineDelta = Math.trunc(event.deltaY / 40) || (event.deltaY > 0 ? 1 : -1);
      terminal.scrollLines(lineDelta);
      event.preventDefault();
    };

    window.addEventListener("resize", handleResize);
    container.addEventListener("wheel", handleWheel, { passive: false });
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      container.removeEventListener("wheel", handleWheel);
      disposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [cursorStyle, fontFamily, fontSize, lineHeight, theme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = terminalColorPalettes[theme];
  }, [theme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.fontFamily = fontFamily;
    terminal.options.fontSize = fontSize;
    terminal.options.lineHeight = lineHeight;
    terminal.options.cursorStyle = cursorStyle === "line" ? "bar" : "block";
  }, [cursorStyle, fontFamily, fontSize, lineHeight]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || lastOutputRef.current === output) {
      return;
    }

    const previous = lastOutputRef.current;
    const normalizedFull = output.replace(/\r?\n/g, "\r\n");

    if (output.length < previous.length || !output.startsWith(previous)) {
      terminal.reset();
      if (normalizedFull) {
        terminal.write(normalizedFull);
      }
    } else {
      const delta = output.slice(previous.length);
      const normalizedDelta = delta.replace(/\r?\n/g, "\r\n");
      if (normalizedDelta) {
        terminal.write(normalizedDelta);
      }
    }

    terminal.scrollToBottom();
    lastOutputRef.current = output;
    fitAddonRef.current?.fit();
  }, [output]);

  return <div className="terminal-host__surface" ref={containerRef} data-testid="terminal-host" />;
}
