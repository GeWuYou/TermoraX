import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import type { ThemeId } from "../../../entities/domain";
import { getThemeDefinition, listThemeDefinitions } from "../../settings/model/themes";
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
  const themeOptions = listThemeDefinitions();
  const displayPath = useMemo(
    () => deriveDisplayedTerminalPath(activeSession?.lastOutput ?? "", activeSession?.currentPath ?? null),
    [activeSession?.currentPath, activeSession?.lastOutput],
  );
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
          <label className="theme-select">
            <span className="sr-only">{t("terminal.themeLabel")}</span>
            <select
              aria-label={t("terminal.themeLabel")}
              value={state.settings.terminal.theme}
              onChange={(event) => void controller.updateTheme(event.target.value as ThemeId)}
            >
              {themeOptions.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {t(theme.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-button" onClick={() => void controller.toggleBottomPanel()} type="button">
            {t("terminal.toggleBottomPanel")}
          </button>
          <button className="ghost-button" onClick={() => void controller.toggleSidePanel()} type="button">
            {t("terminal.toggleSidePanel")}
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
                <span>{displayPath}</span>
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
                  key={activeSession.id}
                  sessionId={activeSession.id}
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

interface TerminalHostProps {
  sessionId: string;
  output: string;
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

const INITIAL_VIEWPORT_LOCK_MS = 1200;
const MAX_PATH_SCAN_CHARS = 8192;

function deriveDisplayedTerminalPath(output: string, fallbackPath: string | null): string {
  const recentOutput =
    output.length > MAX_PATH_SCAN_CHARS ? output.slice(-MAX_PATH_SCAN_CHARS) : output;
  const pathFromOsc = extractOsc7Path(recentOutput);
  if (pathFromOsc) {
    return pathFromOsc;
  }

  const strippedOutput = stripTerminalControlSequences(recentOutput);
  const promptLines = strippedOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  for (let index = promptLines.length - 1; index >= 0; index -= 1) {
    const match = promptLines[index]?.match(/[^@\s]+@[^:\s]+:(~(?:\/[^\s#$]*)?|\/[^\s#$]*)\s*[#$]\s*$/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return fallbackPath ?? "/";
}

function extractOsc7Path(output: string): string | null {
  const osc7Pattern = /\u001b]7;file:\/\/[^/\u0007\u001b]*([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
  let match: RegExpExecArray | null = null;

  for (const current of output.matchAll(osc7Pattern)) {
    match = current;
  }

  const encodedPath = match?.[1];
  if (!encodedPath) {
    return null;
  }

  try {
    return decodeURIComponent(encodedPath) || null;
  } catch {
    return encodedPath;
  }
}

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "");
}

export function TerminalHost({
  sessionId,
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
  const terminalTheme = getThemeDefinition(theme).terminal;
  const lastOutputRef = useRef<string>("");
  const lastResizeRef = useRef<string>("");
  const shouldScrollToTopRef = useRef(true);
  const initialViewportLockTimerRef = useRef<number | null>(null);
  const fitFrameRef = useRef<number | null>(null);
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
    lastOutputRef.current = "";
    lastResizeRef.current = "";
    shouldScrollToTopRef.current = true;
    if (initialViewportLockTimerRef.current != null && typeof window !== "undefined") {
      window.clearTimeout(initialViewportLockTimerRef.current);
    }
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

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) {
        return;
      }

      shouldScrollToTopRef.current = false;
      const lineDelta = Math.trunc(event.deltaY / 40) || (event.deltaY > 0 ? 1 : -1);
      terminal.scrollLines(lineDelta);
      event.preventDefault();
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      if (!disconnectResizeObserver && typeof window !== "undefined") {
        window.removeEventListener("resize", handleResize);
      }
      disconnectResizeObserver?.();
      container.removeEventListener("wheel", handleWheel);
      if (fitFrameRef.current != null && typeof window !== "undefined") {
        window.cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      scheduleFitRef.current = null;
      if (initialViewportLockTimerRef.current != null && typeof window !== "undefined") {
        window.clearTimeout(initialViewportLockTimerRef.current);
        initialViewportLockTimerRef.current = null;
      }
      disposable.dispose();
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
    if (!terminal || lastOutputRef.current === output) {
      return;
    }

    const previous = lastOutputRef.current;
    const normalizedFull = output.replace(/\r?\n/g, "\r\n");
    const didResetOutput = output.length < previous.length || !output.startsWith(previous);
    if (didResetOutput) {
      shouldScrollToTopRef.current = true;
    }
    const keepViewportAtTop = shouldScrollToTopRef.current;
    const afterWrite = () => {
      if (keepViewportAtTop) {
        terminal.scrollToTop();
        if (typeof window !== "undefined") {
          if (initialViewportLockTimerRef.current != null) {
            window.clearTimeout(initialViewportLockTimerRef.current);
          }
          initialViewportLockTimerRef.current = window.setTimeout(() => {
            shouldScrollToTopRef.current = false;
            initialViewportLockTimerRef.current = null;
          }, INITIAL_VIEWPORT_LOCK_MS);
        }
      }
    };

    if (didResetOutput) {
      terminal.reset();
      if (normalizedFull) {
        terminal.write(normalizedFull, afterWrite);
      }
    } else {
      const delta = output.slice(previous.length);
      const normalizedDelta = delta.replace(/\r?\n/g, "\r\n");
      if (normalizedDelta) {
        terminal.write(normalizedDelta, afterWrite);
      }
    }

    lastOutputRef.current = output;
  }, [output]);

  return <div className="terminal-host__surface" ref={containerRef} data-testid="terminal-host" />;
}
