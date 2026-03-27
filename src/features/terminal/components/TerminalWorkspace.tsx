import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import { getSessionOutputState, subscribeSessionOutput } from "../../../app/sessionOutputStore";
import type { ThemeId } from "../../../entities/domain";
import { getThemeDefinition } from "../../settings/model/themes";
import { StatusBadge } from "../../../shared/components/StatusBadge";
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
  const displayPath = useMemo(() => activeSession?.currentPath ?? "/", [activeSession?.currentPath]);
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
    <section className="terminal-workspace">
      <div className="terminal-shell">
        <div className="terminal-tabs">
          <div className="terminal-tabs__list">
            {state.sessions.map((session) => (
              <div key={session.id} className={`terminal-tab ${state.activeSessionId === session.id ? "is-active" : ""}`}>
                <button className="terminal-tab__trigger" onClick={() => controller.selectSession(session.id)} type="button">
                  <span className="terminal-tab__label">{session.title}</span>
                  <StatusBadge status={session.status} />
                </button>
                <button
                  aria-label={session.title}
                  className="terminal-tab__close"
                  onClick={() => void controller.closeSession(session.id)}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {state.sessions.length === 0 ? <div className="tab-strip__empty">{t("terminal.openHint")}</div> : null}
          <div className="terminal-tabs__actions">
            <button className="ghost-button toolbar-button" onClick={() => void hostActionsRef.current?.copySelection()} type="button">
              {t("terminal.copy")}
            </button>
            <button className="ghost-button toolbar-button" onClick={() => void hostActionsRef.current?.pasteClipboard()} type="button">
              {t("terminal.paste")}
            </button>
            <button
              className="ghost-button toolbar-button"
              disabled={!activeSession}
              onClick={() => activeSession && void controller.reconnectSession(activeSession.id)}
              type="button"
            >
              {t("terminal.reconnect")}
            </button>
            <button
              className="ghost-button toolbar-button"
              disabled={!activeSession}
              onClick={() => activeSession && void controller.clearSessionOutput(activeSession.id)}
              type="button"
            >
              {t("terminal.clearOutput")}
            </button>
            <button
              className="ghost-button toolbar-button"
              disabled={!activeSession || !hasOtherSessions}
              onClick={() => activeSession && void controller.closeOtherSessions(activeSession.id)}
              title={!hasOtherSessions ? t("terminal.noOtherSessions") : undefined}
              type="button"
            >
              {t("terminal.closeOthers")}
            </button>
          </div>
        </div>

        {activeSession ? (
          <div className="terminal-view">
            <div className="terminal-host">
              <TerminalHost
                key={activeSession.id}
                sessionId={activeSession.id}
                cursorStyle={state.settings.terminal.cursorStyle}
                hostActionsRef={hostActionsRef}
                initialOutput={activeSession.lastOutput}
                onClearRequest={() => void controller.clearSessionOutput(activeSession.id)}
                onInput={handleTerminalInput}
                onResize={(cols, rows) => void controller.resizeSession(activeSession.id, cols, rows)}
                theme={state.settings.terminal.theme}
                fontFamily={state.settings.terminal.fontFamily}
                fontSize={state.settings.terminal.fontSize}
                lineHeight={state.settings.terminal.lineHeight}
              />
            </div>
            <div className="terminal-statusbar">
              <span>{t("terminal.cwd", { path: displayPath })}</span>
              {sessionSize ? <span>{t("terminal.size", { cols: sessionSize.cols, rows: sessionSize.rows })}</span> : null}
              <span>{t("terminal.lastUpdate", { time: formatTimestamp(activeSession.updatedAt) })}</span>
            </div>
          </div>
        ) : (
          <div className="terminal-view">
            <div className="empty-stage">
              <h3>{t("terminal.emptyTitle")}</h3>
              <p>{t("terminal.emptyBody")}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

interface TerminalHostProps {
  sessionId: string;
  initialOutput: string;
  theme: ThemeId;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "line";
  hostActionsRef: MutableRefObject<TerminalHostActions | null>;
  onClearRequest?: () => void;
  onInput?: (input: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

function isViewportPinnedToBottom(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  return buffer.baseY - buffer.viewportY <= 1;
}

export function TerminalHost({
  sessionId,
  initialOutput,
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
  const terminalTheme = getThemeDefinition(theme).terminal;
  const lastResizeRef = useRef<string>("");
  const followOutputRef = useRef(true);
  const fitFrameRef = useRef<number | null>(null);
  const outputVersionRef = useRef(-1);
  const inputHandlerRef = useRef(onInput);
  const resizeHandlerRef = useRef(onResize);
  const clearHandlerRef = useRef(onClearRequest);
  const scheduleFitRef = useRef<(() => void) | null>(null);

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
    lastResizeRef.current = "";
    outputVersionRef.current = -1;
    followOutputRef.current = true;
    if (fitFrameRef.current != null && typeof window !== "undefined") {
      window.cancelAnimationFrame(fitFrameRef.current);
      fitFrameRef.current = null;
    }
  }, [sessionId]);

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
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.focus();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const disposable = terminal.onData((data) => {
      inputHandlerRef.current?.(data);
    });
    const scrollDisposable = terminal.onScroll(() => {
      followOutputRef.current = isViewportPinnedToBottom(terminal);
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

    const runFit = () => {
      const currentTerminal = terminalRef.current;
      const currentFitAddon = fitAddonRef.current;
      const currentContainer = containerRef.current;
      if (!currentTerminal || !currentFitAddon || !currentContainer) {
        return;
      }

      if (currentContainer.clientWidth <= 0 || currentContainer.clientHeight <= 0) {
        return;
      }

      currentFitAddon.fit();
      const sizeKey = `${currentTerminal.cols}x${currentTerminal.rows}`;

      if (currentTerminal.cols > 0 && currentTerminal.rows > 0 && sizeKey !== lastResizeRef.current) {
        lastResizeRef.current = sizeKey;
        resizeHandlerRef.current?.(currentTerminal.cols, currentTerminal.rows);
      }
    };

    const scheduleFit = () => {
      if (typeof window === "undefined") {
        runFit();
        return;
      }

      if (fitFrameRef.current != null) {
        return;
      }

      fitFrameRef.current = window.requestAnimationFrame(() => {
        fitFrameRef.current = null;
        runFit();
      });
    };

    scheduleFitRef.current = scheduleFit;

    const handleResize = () => {
      scheduleFit();
    };

    const disconnectResizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : (() => {
            const observer = new ResizeObserver(() => {
              scheduleFit();
            });
            observer.observe(container);
            return () => {
              observer.disconnect();
            };
          })();

    if (!disconnectResizeObserver && typeof window !== "undefined") {
      window.addEventListener("resize", handleResize);
    }

    scheduleFit();

    return () => {
      if (!disconnectResizeObserver && typeof window !== "undefined") {
        window.removeEventListener("resize", handleResize);
      }
      disconnectResizeObserver?.();
      if (fitFrameRef.current != null && typeof window !== "undefined") {
        window.cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      scheduleFitRef.current = null;
      disposable.dispose();
      scrollDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = terminalTheme;
    scheduleFitRef.current?.();
  }, [terminalTheme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.fontFamily = fontFamily;
    terminal.options.fontSize = fontSize;
    terminal.options.lineHeight = lineHeight;
    terminal.options.cursorStyle = cursorStyle === "line" ? "bar" : "block";
    scheduleFitRef.current?.();
  }, [cursorStyle, fontFamily, fontSize, lineHeight]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const applyOutputState = () => {
      const currentTerminal = terminalRef.current;
      if (!currentTerminal) {
        return;
      }

      const nextState = getSessionOutputState(sessionId, initialOutput);
      if (nextState.version === outputVersionRef.current) {
        return;
      }

      const shouldFollowOutput = followOutputRef.current || nextState.didReset;
      const writePayload = nextState.didReset ? nextState.text : nextState.delta;
      const normalizedPayload = writePayload.replace(/\r?\n/g, "\r\n");
      const afterWrite = () => {
        if (shouldFollowOutput) {
          currentTerminal.scrollToBottom();
          followOutputRef.current = true;
        }
      };

      if (nextState.didReset) {
        followOutputRef.current = true;
        currentTerminal.reset();
      }

      if (normalizedPayload) {
        currentTerminal.write(normalizedPayload, afterWrite);
      } else {
        afterWrite();
      }

      outputVersionRef.current = nextState.version;
    };

    applyOutputState();
    return subscribeSessionOutput(sessionId, applyOutputState);
  }, [initialOutput, sessionId]);

  return <div className="terminal-host__surface" ref={containerRef} data-testid="terminal-host" />;
}
