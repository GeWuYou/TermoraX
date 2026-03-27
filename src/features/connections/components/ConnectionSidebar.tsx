import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionAuthType, ConnectionProfile } from "../../../entities/domain";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import { t } from "../../../shared/i18n";
import { detectDuplicateConnections, groupConnections } from "../model/connection-utils";

interface ConnectionSidebarProps {
  controller: WorkspaceController;
  searchTerm?: string;
  onSearchTermChange?: (value: string) => void;
  createRequestKey?: number;
}

interface ContextMenuState {
  connectionId: string;
  x: number;
  y: number;
}

const emptyDraft = {
  name: "",
  host: "",
  port: "22",
  username: "",
  group: "默认分组",
  authType: "password" as ConnectionAuthType,
  note: "",
  tags: "",
  password: "",
  privateKeyPath: "",
  privateKeyPassphrase: "",
};

function draftFromProfile(profile: ConnectionProfile) {
  return {
    name: profile.name,
    host: profile.host,
    port: String(profile.port),
    username: profile.username,
    group: profile.group,
    authType: profile.authType,
    note: profile.note,
    tags: profile.tags.join(", "),
    password: profile.password ?? "",
    privateKeyPath: profile.privateKeyPath ?? "",
    privateKeyPassphrase: profile.privateKeyPassphrase ?? "",
  };
}

export function ConnectionSidebar({
  controller,
  searchTerm,
  onSearchTermChange,
  createRequestKey = 0,
}: ConnectionSidebarProps) {
  const { state, selectedConnection } = controller;
  const [draft, setDraft] = useState(emptyDraft);
  const [localSearchTerm, setLocalSearchTerm] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveSearchTerm = searchTerm ?? localSearchTerm;

  const groupedConnections = useMemo(
    () => groupConnections(state.connections, effectiveSearchTerm),
    [state.connections, effectiveSearchTerm],
  );
  const duplicateEntries = detectDuplicateConnections(state.connections);
  const pendingHostVerification =
    selectedConnection && state.pendingHostVerification?.connectionId === selectedConnection.id
      ? state.pendingHostVerification
      : null;
  const lastHostInspection =
    pendingHostVerification && state.lastHostInspection?.connectionId === pendingHostVerification.connectionId
      ? state.lastHostInspection
      : null;

  useEffect(() => {
    const handlePointerDown = () => setContextMenu(null);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!selectedConnection || !editorOpen || editingConnectionId !== selectedConnection.id) {
      return;
    }

    setDraft(draftFromProfile(selectedConnection));
  }, [editingConnectionId, editorOpen, selectedConnection?.id]);

  useEffect(() => {
    if (createRequestKey <= 0) {
      return;
    }

    openCreateEditor();
  }, [createRequestKey]);

  function updateSearchTerm(value: string) {
    if (onSearchTermChange) {
      onSearchTermChange(value);
      return;
    }

    setLocalSearchTerm(value);
  }

  function buildDraftProfile(): Partial<ConnectionProfile> {
    return {
      id: editingConnectionId ?? undefined,
      name: draft.name,
      host: draft.host,
      port: Number(draft.port || 22),
      username: draft.username,
      group: draft.group,
      authType: draft.authType,
      note: draft.note,
      tags: draft.tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      password: draft.password,
      privateKeyPath: draft.privateKeyPath,
      privateKeyPassphrase: draft.privateKeyPassphrase,
    };
  }

  function toggleGroup(group: string) {
    setCollapsedGroups((current) => ({
      ...current,
      [group]: !current[group],
    }));
  }

  function selectProfile(profile: ConnectionProfile) {
    controller.selectConnection(profile.id);
    controller.clearConnectionFeedback();
    setContextMenu(null);
  }

  function openCreateEditor() {
    controller.clearConnectionFeedback();
    setConfirmDeleteId(null);
    setDraft(emptyDraft);
    setEditingConnectionId(null);
    setEditorOpen(true);
    setContextMenu(null);
  }

  function openEditEditor(profile: ConnectionProfile) {
    controller.selectConnection(profile.id);
    controller.clearConnectionFeedback();
    setConfirmDeleteId(null);
    setDraft(draftFromProfile(profile));
    setEditingConnectionId(profile.id);
    setEditorOpen(true);
    setContextMenu(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await controller.saveConnectionProfile(buildDraftProfile());
    setEditorOpen(false);
  }

  async function handleDeleteConfirm() {
    if (!selectedConnection) {
      return;
    }

    await controller.deleteConnectionProfile(selectedConnection.id);
    setConfirmDeleteId(null);
    setDraft(emptyDraft);
    setEditingConnectionId(null);
    setEditorOpen(false);
  }

  async function handleExport() {
    const result = await controller.exportConnectionProfiles();

    if (!result) {
      return;
    }

    const url = URL.createObjectURL(new Blob([result.content], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `termorax-connections-${result.exportedAt}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const content = await file.text();
    await controller.importConnectionProfilesFromJson(content);
    event.target.value = "";
  }

  async function handleOpenFiles(connectionId: string) {
    await controller.openSession(connectionId);
    await controller.selectBottomPanel("files");
  }

  const contextProfile = contextMenu
    ? state.connections.find((profile) => profile.id === contextMenu.connectionId) ?? null
    : null;

  return (
    <div className="connections-pane">
      <input hidden accept="application/json" onChange={handleImport} ref={fileInputRef} type="file" />

      <div className="connections-pane__header">
        <div className="connections-pane__title">
          <strong>{t("connections.title")}</strong>
          <span>{t("connections.subtitle", { count: state.connections.length })}</span>
        </div>
      </div>

      <div className="connections-pane__search-row">
        <input
          onChange={(event) => updateSearchTerm(event.currentTarget.value)}
          placeholder={t("connections.searchPlaceholder")}
          value={effectiveSearchTerm}
        />
        <button className="ghost-button toolbar-button" onClick={openCreateEditor} type="button">
          {t("connections.new")}
        </button>
      </div>

      <div className="connections-pane__actions">
        {selectedConnection ? (
          <button
            className="ghost-button toolbar-button"
            onClick={() => openEditEditor(selectedConnection)}
            type="button"
          >
            {t("connections.editInline")}
          </button>
        ) : null}
        <button className="ghost-button toolbar-button" onClick={() => fileInputRef.current?.click()} type="button">
          {t("connections.import")}
        </button>
        <button className="ghost-button toolbar-button" onClick={() => void handleExport()} type="button">
          {t("connections.export")}
        </button>
      </div>

      {state.connectionStatusMessage ? <div className="info-banner">{state.connectionStatusMessage}</div> : null}
      {state.connectionDuplicateWarning ? (
        <div className="warning-banner">{state.connectionDuplicateWarning.message}</div>
      ) : null}
      {duplicateEntries.length ? (
        <div className="warning-banner">
          <p>发现重复连接配置，请检查 host:port@user：</p>
          <ul>
            {duplicateEntries.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div aria-label={t("connections.title")} className="connection-tree" role="tree">
        {groupedConnections.length === 0 ? (
          <div className="empty-panel">
            <p>{t("connections.treeEmpty")}</p>
          </div>
        ) : (
          groupedConnections.map(({ group, entries }) => {
            const isCollapsed = collapsedGroups[group];

            return (
              <section className="connection-tree__group" key={group}>
                <button
                  className="connection-tree__group-header"
                  onClick={() => toggleGroup(group)}
                  type="button"
                >
                  <span className="connection-tree__group-title">{group}</span>
                  <span className="connection-tree__group-count">{t("connections.groupCount", { count: entries.length })}</span>
                  <span>{isCollapsed ? "▸" : "▾"}</span>
                </button>

                {!isCollapsed ? (
                  <div className="connection-tree__group-body">
                    {entries.map((profile) => (
                      <button
                        aria-selected={state.selectedConnectionId === profile.id}
                        className={`connection-tree__item ${
                          state.selectedConnectionId === profile.id ? "is-active" : ""
                        }`}
                        key={profile.id}
                        onClick={() => selectProfile(profile)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          selectProfile(profile);
                          setContextMenu({
                            connectionId: profile.id,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                        onDoubleClick={() => void controller.openSession(profile.id)}
                        role="treeitem"
                        type="button"
                      >
                        <span className="connection-tree__item-title">{profile.name}</span>
                        <span className="connection-tree__item-meta">
                          {profile.username}@{profile.host}:{profile.port}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>

      {contextProfile ? (
        <div
          aria-label={t("connections.contextMenuLabel")}
          className="connection-context-menu"
          role="menu"
          style={{ left: `${contextMenu?.x ?? 0}px`, top: `${contextMenu?.y ?? 0}px` }}
        >
          <button onClick={() => void controller.openSession(contextProfile.id)} role="menuitem" type="button">
            {t("connections.openSession")}
          </button>
          <button onClick={() => void handleOpenFiles(contextProfile.id)} role="menuitem" type="button">
            {t("connections.openFiles")}
          </button>
          <button onClick={() => openEditEditor(contextProfile)} role="menuitem" type="button">
            {t("connections.editInline")}
          </button>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="connection-editor-overlay" role="presentation">
          <section aria-modal="true" className="connection-editor-dialog" role="dialog">
            <header className="connection-editor-dialog__header">
              <div>
                <strong>{t("connections.editorTitle")}</strong>
                <span>
                  {selectedConnection
                    ? editingConnectionId
                      ? t("connections.editorEditing", { name: selectedConnection.name })
                      : t("connections.editorCreate")
                    : t("connections.editorCreate")}
                </span>
              </div>
              <button
                className="ghost-button toolbar-button"
                onClick={() => {
                  setEditorOpen(false);
                  setEditingConnectionId(null);
                  setConfirmDeleteId(null);
                }}
                type="button"
              >
                {t("connections.closeEditor")}
              </button>
            </header>

            <form className="stack-form" onSubmit={handleSubmit}>
              <label>
                <span>{t("connections.field.name")}</span>
                <input
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="生产应用-01"
                  value={draft.name}
                />
                {state.connectionValidationErrors.name ? (
                  <span className="field-error">{state.connectionValidationErrors.name}</span>
                ) : null}
              </label>

              <label>
                <span>{t("connections.field.host")}</span>
                <input
                  onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
                  placeholder="10.10.0.12"
                  value={draft.host}
                />
                {state.connectionValidationErrors.host ? (
                  <span className="field-error">{state.connectionValidationErrors.host}</span>
                ) : null}
              </label>

              <div className="form-grid">
                <label>
                  <span>{t("connections.field.port")}</span>
                  <input
                    onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))}
                    placeholder="22"
                    value={draft.port}
                  />
                  {state.connectionValidationErrors.port ? (
                    <span className="field-error">{state.connectionValidationErrors.port}</span>
                  ) : null}
                </label>

                <label>
                  <span>{t("connections.field.user")}</span>
                  <input
                    onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
                    placeholder="deploy"
                    value={draft.username}
                  />
                  {state.connectionValidationErrors.username ? (
                    <span className="field-error">{state.connectionValidationErrors.username}</span>
                  ) : null}
                </label>
              </div>

              <div className="form-grid">
                <label>
                  <span>{t("connections.field.group")}</span>
                  <input
                    onChange={(event) => setDraft((current) => ({ ...current, group: event.target.value }))}
                    placeholder="生产环境"
                    value={draft.group}
                  />
                </label>

                <label>
                  <span>{t("connections.field.auth")}</span>
                  <select
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, authType: event.target.value as ConnectionAuthType }))
                    }
                    value={draft.authType}
                  >
                    <option value="password">{t("connections.auth.password")}</option>
                    <option value="privateKey">{t("connections.auth.privateKey")}</option>
                  </select>
                </label>
              </div>

              {draft.authType === "password" ? (
                <label>
                  <span>{t("connections.field.password")}</span>
                  <input
                    onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
                    placeholder={t("connections.placeholder.password")}
                    type="password"
                    value={draft.password}
                  />
                  {state.connectionValidationErrors.password ? (
                    <span className="field-error">{state.connectionValidationErrors.password}</span>
                  ) : null}
                </label>
              ) : (
                <>
                  <label>
                    <span>{t("connections.field.privateKeyPath")}</span>
                    <input
                      onChange={(event) => setDraft((current) => ({ ...current, privateKeyPath: event.target.value }))}
                      placeholder={t("connections.placeholder.privateKeyPath")}
                      value={draft.privateKeyPath}
                    />
                    {state.connectionValidationErrors.privateKeyPath ? (
                      <span className="field-error">{state.connectionValidationErrors.privateKeyPath}</span>
                    ) : null}
                  </label>
                  <label>
                    <span>{t("connections.field.privateKeyPassphrase")}</span>
                    <input
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, privateKeyPassphrase: event.target.value }))
                      }
                      placeholder={t("connections.placeholder.privateKeyPassphrase")}
                      type="password"
                      value={draft.privateKeyPassphrase}
                    />
                  </label>
                </>
              )}

              <label>
                <span>{t("connections.field.tags")}</span>
                <input
                  onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                  placeholder="api, cn-sha"
                  value={draft.tags}
                />
              </label>

              <label>
                <span>{t("connections.field.note")}</span>
                <textarea
                  onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                  placeholder="用途、网络说明、注意事项"
                  rows={3}
                  value={draft.note}
                />
              </label>

              <div className="button-row">
                <button className="primary-button" type="submit">
                  {t("connections.save")}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => void controller.testConnectionProfile(buildDraftProfile())}
                  type="button"
                >
                  {t("connections.test")}
                </button>
                {editingConnectionId && selectedConnection ? (
                  <button
                    className="ghost-button"
                    onClick={() => void controller.openSession(selectedConnection.id)}
                    type="button"
                  >
                    {t("connections.openSession")}
                  </button>
                ) : null}
                {editingConnectionId && selectedConnection ? (
                  <button
                    className="danger-button"
                    onClick={() => setConfirmDeleteId(selectedConnection.id)}
                    type="button"
                  >
                    {t("connections.delete")}
                  </button>
                ) : null}
              </div>

              {pendingHostVerification ? (
                <div className="host-verification-panel">
                  <strong>{t("connections.hostInspectionTitle")}</strong>
                  <p>
                    {t("connections.hostInspectionMessage", {
                      host: pendingHostVerification.host,
                      port: pendingHostVerification.port,
                      algorithm: pendingHostVerification.algorithm,
                    })}
                  </p>
                  <p className="host-verification-panel__fingerprint">
                    {t("connections.hostInspectionFingerprint", { fingerprint: pendingHostVerification.fingerprint })}
                  </p>
                  {lastHostInspection?.trustedFingerprint ? (
                    <div className="warning-banner">
                      {t("connections.hostInspectionTrustedFingerprint", {
                        fingerprint: lastHostInspection.trustedFingerprint,
                      })}
                    </div>
                  ) : null}
                  {lastHostInspection?.trustStatus === "mismatch" ? (
                    <div className="warning-banner">{t("connections.hostInspectionMismatch")}</div>
                  ) : null}
                  <p className="info-banner">{t("connections.hostInspectionWarning")}</p>
                  <div className="button-row">
                    <button className="primary-button" onClick={() => void controller.trustPendingHost()} type="button">
                      {t("connections.hostInspectionTrust")}
                    </button>
                    <button className="ghost-button" onClick={() => controller.dismissPendingHostVerification()} type="button">
                      {t("connections.hostInspectionCancel")}
                    </button>
                  </div>
                </div>
              ) : null}
            </form>

            {confirmDeleteId ? (
              <div className="danger-zone">
                <strong>{t("connections.deleteConfirmTitle")}</strong>
                <p>{t("connections.deleteConfirmBody")}</p>
                <div className="button-row">
                  <button className="danger-button" onClick={() => void handleDeleteConfirm()} type="button">
                    {t("connections.deleteConfirmAction")}
                  </button>
                  <button className="ghost-button" onClick={() => setConfirmDeleteId(null)} type="button">
                    {t("connections.deleteCancel")}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
