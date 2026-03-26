import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import { ConnectionSidebar } from "../../connections/components/ConnectionSidebar";
import { SnippetPanel } from "../../snippets/components/SnippetPanel";
import { FilePanel } from "../../sftp/components/FilePanel";
import { TransferPanel } from "../../transfers/components/TransferPanel";
import { TerminalWorkspace } from "../../terminal/components/TerminalWorkspace";
import { formatTimestamp } from "../../../shared/lib/time";
import { getLocaleState, t } from "../../../shared/i18n";
import { debugLog, isDebugFlagEnabled } from "../../../shared/lib/debug";
import { computeWorkspaceScale, WORKSPACE_BASE_HEIGHT, WORKSPACE_BASE_WIDTH } from "../model/layout";

interface WorkspaceShellProps {
  controller: WorkspaceController;
}

const MAIN_STACK_GAP = 18;
const MAIN_STACK_DIVIDER_HEIGHT = 10;
const MIN_TERMINAL_PANEL_HEIGHT = 260;
const MIN_BOTTOM_PANEL_HEIGHT = 280;
const WHEEL_DEBUG_FLAG = "termorax-debug-wheel";

function clampBottomPanelHeight(nextHeight: number, stackHeight: number): number {
  const reservedHeight = MIN_TERMINAL_PANEL_HEIGHT + MAIN_STACK_DIVIDER_HEIGHT + MAIN_STACK_GAP * 2;
  const maxBottomHeight = Math.max(stackHeight - reservedHeight, MIN_BOTTOM_PANEL_HEIGHT);
  return Math.min(Math.max(nextHeight, MIN_BOTTOM_PANEL_HEIGHT), maxBottomHeight);
}

function describeElement(element: HTMLElement | null): string {
  if (!element) {
    return "null";
  }

  const className =
    typeof element.className === "string"
      ? element.className
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join(".")
      : "";

  return [element.tagName.toLowerCase(), element.id ? `#${element.id}` : "", className ? `.${className}` : ""].join("");
}

export function WorkspaceShell({ controller }: WorkspaceShellProps) {
  const { state, activeSession } = controller;
  const localeState = getLocaleState();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mainStackRef = useRef<HTMLDivElement | null>(null);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(420);
  const [workspaceScale, setWorkspaceScale] = useState(1);
  const bottomPanelVisible =
    state.settings.workspace.rightPanelVisible && state.settings.workspace.rightPanel === "files";
  const sidePanelVisible =
    state.settings.workspace.rightPanelVisible && state.settings.workspace.rightPanel !== "files";

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    // Keep the desktop layout intact and scale the whole stage down when the viewport
    // becomes smaller than the designed workspace frame.
    const syncWorkspaceScale = () => {
      setWorkspaceScale(computeWorkspaceScale(window.innerWidth, window.innerHeight));
    };

    syncWorkspaceScale();
    window.addEventListener("resize", syncWorkspaceScale);

    return () => {
      window.removeEventListener("resize", syncWorkspaceScale);
    };
  }, []);

  useEffect(() => {
    debugLog(WHEEL_DEBUG_FLAG, "wheel_debug.mount", {
      enabled: isDebugFlagEnabled(WHEEL_DEBUG_FLAG),
      width: typeof window === "undefined" ? null : window.innerWidth,
      height: typeof window === "undefined" ? null : window.innerHeight,
      scale: workspaceScale,
    });
  }, [workspaceScale]);

  useEffect(() => {
    if (!mainStackRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const element = mainStackRef.current;
    const syncBottomPanelHeight = () => {
      setBottomPanelHeight((currentHeight) => clampBottomPanelHeight(currentHeight, element.clientHeight));
    };

    syncBottomPanelHeight();

    const observer = new ResizeObserver(() => {
      syncBottomPanelHeight();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [bottomPanelVisible]);

  useEffect(() => {
    if (!stageRef.current || typeof window === "undefined") {
      return undefined;
    }

    const stage = stageRef.current;
    let wheelEventCount = 0;

    const isScrollable = (element: HTMLElement, axis: "x" | "y") => {
      const computedStyle = window.getComputedStyle(element);
      const overflow = axis === "y" ? computedStyle.overflowY : computedStyle.overflowX;
      const canOverflow = overflow === "auto" || overflow === "scroll" || overflow === "overlay";

      if (!canOverflow) {
        return false;
      }

      return axis === "y"
        ? element.scrollHeight > element.clientHeight + 1
        : element.scrollWidth > element.clientWidth + 1;
    };

    const describeScrollState = (element: HTMLElement) => {
      const computedStyle = window.getComputedStyle(element);
      return [
        describeElement(element),
        `overflowY=${computedStyle.overflowY}`,
        `overflowX=${computedStyle.overflowX}`,
        `client=${element.clientWidth}x${element.clientHeight}`,
        `scroll=${element.scrollWidth}x${element.scrollHeight}`,
        `offset=${element.scrollLeft},${element.scrollTop}`,
      ].join(" ");
    };

    const logWheelEvent = (scope: "window" | "document" | "stage", event: WheelEvent) => {
      wheelEventCount += 1;
      if (wheelEventCount > 30) {
        return;
      }

      debugLog(WHEEL_DEBUG_FLAG, `wheel_debug.${scope}`, {
        index: wheelEventCount,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        clientX: event.clientX,
        clientY: event.clientY,
        target: describeElement(event.target instanceof HTMLElement ? event.target : null),
      });
    };

    // WebView-based desktop shells can lose native wheel scrolling inside transformed
    // or deeply nested scroll containers. Forward wheel delta to the nearest scrollable ancestor.
    const handleWheel = (event: WheelEvent) => {
      logWheelEvent("stage", event);
      const pointElement = document.elementFromPoint(event.clientX, event.clientY);
      const hoveredElement = pointElement instanceof HTMLElement ? pointElement : null;
      let element = hoveredElement ?? (event.target instanceof HTMLElement ? event.target : null);
      const chain: string[] = [];

      while (element && element !== stage) {
        const canScrollY = isScrollable(element, "y");
        const canScrollX = isScrollable(element, "x");
        chain.push(
          `${describeScrollState(element)} canScrollY=${canScrollY} canScrollX=${canScrollX}`,
        );

        if (canScrollY || canScrollX) {
          let didScroll = false;

          if (canScrollY && event.deltaY !== 0) {
            const maxScrollTop = element.scrollHeight - element.clientHeight;
            const nextScrollTop = Math.min(Math.max(element.scrollTop + event.deltaY, 0), maxScrollTop);
            if (nextScrollTop !== element.scrollTop) {
              element.scrollTop = nextScrollTop;
              didScroll = true;
            }
          }

          if (canScrollX && event.deltaX !== 0) {
            const maxScrollLeft = element.scrollWidth - element.clientWidth;
            const nextScrollLeft = Math.min(Math.max(element.scrollLeft + event.deltaX, 0), maxScrollLeft);
            if (nextScrollLeft !== element.scrollLeft) {
              element.scrollLeft = nextScrollLeft;
              didScroll = true;
            }
          }

          if (didScroll) {
            debugLog(WHEEL_DEBUG_FLAG, "wheel_debug.scrolled", {
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              hovered: describeElement(hoveredElement),
              target: describeElement(event.target instanceof HTMLElement ? event.target : null),
              scrolled: describeElement(element),
              chain,
              chainText: chain.join(" -> "),
            });
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }

        element = element.parentElement;
      }

      debugLog(WHEEL_DEBUG_FLAG, "wheel_debug.unhandled", {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        hovered: describeElement(hoveredElement),
        target: describeElement(event.target instanceof HTMLElement ? event.target : null),
        chain,
        chainText: chain.join(" -> "),
      });
    };

    const handleWindowWheel = (event: WheelEvent) => {
      logWheelEvent("window", event);
    };

    const handleDocumentWheel = (event: WheelEvent) => {
      logWheelEvent("document", event);
    };

    window.addEventListener("wheel", handleWindowWheel, { capture: true, passive: true });
    document.addEventListener("wheel", handleDocumentWheel, { capture: true, passive: true });
    stage.addEventListener("wheel", handleWheel, { passive: false, capture: true });

    return () => {
      window.removeEventListener("wheel", handleWindowWheel, true);
      document.removeEventListener("wheel", handleDocumentWheel, true);
      stage.removeEventListener("wheel", handleWheel, true);
    };
  }, []);

  const handleBottomSplitPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!mainStackRef.current || typeof window === "undefined") {
        return;
      }

      event.preventDefault();
      const startY = event.clientY;
      const startHeight = bottomPanelHeight;
      const stackHeight = mainStackRef.current.clientHeight;

      const onMove = (moveEvent: PointerEvent) => {
        const deltaY = (moveEvent.clientY - startY) / workspaceScale;
        const nextHeight = clampBottomPanelHeight(startHeight - deltaY, stackHeight);
        setBottomPanelHeight(nextHeight);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [bottomPanelHeight, workspaceScale],
  );

  const workspaceContent = (
    <div className={`workspace workspace--${state.settings.terminal.theme}`}>
            <header className="workspace-topbar">
              <div>
                <p className="workspace-topbar__eyebrow">{t("app.name")}</p>
                <h1>{t("workspace.title")}</h1>
                {localeState.hasPendingLocaleHook ? (
                  <p className="workspace-locale-hint">
                    {t("locale.pendingHook", { locale: localeState.systemLocale })}
                  </p>
                ) : null}
              </div>
              <div className="workspace-topbar__stats">
                <div>
                  <strong>{state.connections.length}</strong>
                  <span>{t("workspace.metric.connections")}</span>
                </div>
                <div>
                  <strong>{state.sessions.length}</strong>
                  <span>{t("workspace.metric.sessions")}</span>
                </div>
                <div>
                  <strong>{state.extensions.length}</strong>
                  <span>{t("workspace.metric.extensions")}</span>
                </div>
              </div>
            </header>

            {state.error ? <div className="error-banner">{state.error}</div> : null}

            <div className="workspace-grid">
              <aside className="workspace-sidebar">
                <ConnectionSidebar controller={controller} />
              </aside>

              <main className="workspace-main">
                <div className="workspace-main-stack" ref={mainStackRef}>
                  <TerminalWorkspace controller={controller} />
                  {bottomPanelVisible ? (
                    <>
                      <div
                        className="workspace-main-divider"
                        role="separator"
                        aria-orientation="horizontal"
                        onPointerDown={handleBottomSplitPointerDown}
                      />
                      <section className="workspace-bottom-panel" style={{ height: `${bottomPanelHeight}px` }}>
                        <FilePanel
                          currentPath={activeSession?.currentPath ?? null}
                          entries={state.remoteEntries}
                          rootEntries={state.remoteRootEntries}
                          layoutScale={workspaceScale}
                          loading={state.remoteEntriesLoading}
                          onOpenDirectory={controller.openRemoteDirectory}
                          onGoParent={controller.goRemoteParent}
                          onRefresh={controller.refreshRemoteEntriesForActiveSession}
                          onUpload={controller.uploadFileToCurrentDirectory}
                          onCreateDirectory={controller.createRemoteDirectory}
                          onDownload={controller.downloadRemoteFile}
                          onRename={controller.renameRemoteEntry}
                          onDelete={controller.deleteRemoteEntry}
                        />
                      </section>
                    </>
                  ) : null}
                </div>
              </main>

              {sidePanelVisible ? (
                <aside className="workspace-right">
                  {state.settings.workspace.rightPanel === "transfers" ? (
                    <TransferPanel
                      tasks={state.transfers}
                      onRetry={controller.retryTransfer}
                      onClearCompleted={controller.clearCompletedTransfers}
                    />
                  ) : null}
                  {state.settings.workspace.rightPanel === "snippets" ? <SnippetPanel controller={controller} /> : null}
                  {state.settings.workspace.rightPanel === "activity" ? (
                    <section className="panel">
                      <header className="panel__header">
                        <div>
                          <p className="panel__eyebrow">{t("workspace.panel.activity")}</p>
                          <h2 className="panel__title">{t("workspace.panel.activitySubtitle")}</h2>
                        </div>
                      </header>
                      <div className="panel__body">
                        <div className="activity-list">
                          {state.activity.map((item) => (
                            <article className="activity-row" key={item.id}>
                              <strong>{item.title}</strong>
                              <span>{formatTimestamp(item.timestamp)}</span>
                            </article>
                          ))}
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <section className="panel panel--compact">
                    <header className="panel__header">
                      <div>
                        <p className="panel__eyebrow">{t("workspace.panel.extensions")}</p>
                        <h2 className="panel__title">{t("workspace.panel.extensionsSubtitle")}</h2>
                      </div>
                    </header>
                    <div className="panel__body">
                      <div className="extension-list">
                        {state.extensions.map((extension) => (
                          <article className="extension-row" key={extension.id}>
                            <strong>{extension.title}</strong>
                            <p>{extension.kind}</p>
                          </article>
                        ))}
                      </div>
                    </div>
                  </section>
                </aside>
              ) : null}
            </div>

            <footer className="workspace-footer">
              <div className="button-row">
                <button className="ghost-button" onClick={() => void controller.updateRightPanel("files")} type="button">
                  {t("workspace.action.files")}
                </button>
                <button className="ghost-button" onClick={() => void controller.updateRightPanel("snippets")} type="button">
                  {t("workspace.action.snippets")}
                </button>
                <button className="ghost-button" onClick={() => void controller.updateRightPanel("activity")} type="button">
                  {t("workspace.action.activity")}
                </button>
                <button className="ghost-button" onClick={() => void controller.updateRightPanel("transfers")} type="button">
                  {t("workspace.action.transfers")}
                </button>
              </div>
              <div className="button-row">
                <button className="ghost-button" onClick={() => void controller.resetSettings()} type="button">
                  {t("workspace.action.resetSettings")}
                </button>
                <span>
                  {t("workspace.currentTheme", {
                    theme: t(`workspace.theme.${state.settings.terminal.theme}`),
                  })}
                </span>
              </div>
            </footer>
    </div>
  );

  return (
    <div className={`workspace-stage workspace-stage--${state.settings.terminal.theme}`} ref={stageRef}>
      {workspaceScale < 1 ? (
        <div
          className="workspace-stage__viewport workspace-stage__viewport--scaled"
          style={{
            width: `${WORKSPACE_BASE_WIDTH * workspaceScale}px`,
            height: `${WORKSPACE_BASE_HEIGHT * workspaceScale}px`,
          }}
        >
          <div
            className="workspace-stage__scale workspace-stage__scale--scaled"
            style={{
              width: `${WORKSPACE_BASE_WIDTH}px`,
              height: `${WORKSPACE_BASE_HEIGHT}px`,
              transform: `scale(${workspaceScale})`,
            }}
          >
            {workspaceContent}
          </div>
        </div>
      ) : (
        <div className="workspace-stage__fill">{workspaceContent}</div>
      )}
    </div>
  );
}
