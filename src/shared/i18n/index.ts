type MessageValue = string | ((params?: Record<string, string | number>) => string);

type MessageSchema = Record<string, MessageValue>;

export type AppLocale = "zh-CN";

interface LocaleState {
  appLocale: AppLocale;
  systemLocale: string;
  hasPendingLocaleHook: boolean;
}

const DEFAULT_LOCALE: AppLocale = "zh-CN";

const messages: Record<AppLocale, MessageSchema> = {
  "zh-CN": {
    "app.name": "TermoraX",
    "app.boot": "正在准备工作台状态…",
    "status.idle": "空闲",
    "status.connecting": "连接中",
    "status.connected": "已连接",
    "status.disconnected": "已断开",
    "workspace.title": "桌面 SSH 工作台",
    "workspace.metric.connections": "连接",
    "workspace.metric.sessions": "会话",
    "workspace.metric.extensions": "扩展点",
    "workspace.panel.activity": "活动",
    "workspace.panel.activitySubtitle": "最近宿主事件",
    "workspace.panel.extensions": "扩展注册表",
    "workspace.panel.extensionsSubtitle": "内建贡献项",
    "workspace.action.files": "文件",
    "workspace.action.snippets": "片段",
    "workspace.action.activity": "活动",
    "workspace.action.transfers": "传输",
    "workspace.action.resetSettings": "重置设置",
    "workspace.currentTheme": "当前主题：{theme}",
    "workspace.theme.midnight": "夜航",
    "workspace.theme.sand": "砂岩",
    "connections.title": "连接",
    "connections.subtitle": "{count} 个配置",
    "connections.new": "新建",
    "connections.clear": "清除",
    "connections.editorTitle": "编辑器",
    "connections.editorEditing": "正在编辑 {name}",
    "connections.editorCreate": "创建新的 SSH 目标",
    "connections.delete": "删除",
    "connections.field.name": "名称",
    "connections.field.host": "主机",
    "connections.field.port": "端口",
    "connections.field.user": "用户",
    "connections.field.group": "分组",
    "connections.field.auth": "认证",
    "connections.field.tags": "标签",
    "connections.field.note": "备注",
    "connections.auth.password": "密码",
    "connections.auth.privateKey": "私钥",
    "connections.field.password": "密码",
    "connections.field.privateKeyPath": "私钥路径",
    "connections.field.privateKeyPassphrase": "私钥口令",
    "connections.placeholder.password": "secret123",
    "connections.placeholder.privateKeyPath": "C:/Users/me/.ssh/id_rsa",
    "connections.placeholder.privateKeyPassphrase": "如果密钥有口令，可留空",
    "connections.save": "保存配置",
    "connections.openSession": "打开会话",
    "connections.searchPlaceholder": "搜索名称、主机、用户或标签",
    "connections.searchEmpty": "没有匹配的连接配置。",
    "connections.test": "测试连接",
    "connections.import": "导入",
    "connections.export": "导出",
    "connections.importSuccess": "已导入 {count} 个连接，跳过 {skipped} 个重复项。",
    "connections.exportSuccess": "已导出 {count} 个连接配置。",
    "connections.importInvalid": "导入内容不是有效的连接配置 JSON。",
    "connections.validation.nameRequired": "请填写连接名称。",
    "connections.validation.hostRequired": "请填写主机地址。",
    "connections.validation.usernameRequired": "请填写登录用户。",
    "connections.validation.portInvalid": "端口必须是 1 到 65535 之间的整数。",
    "connections.validation.passwordRequired": "请选择后输入连接密码。",
    "connections.validation.privateKeyRequired": "请填写用于认证的私钥路径。",
    "connections.duplicateWarning": "检测到可能重复的连接：{name} 与当前主机、端口、用户相同。",
    "connections.testSuccess": "连接配置校验通过，当前仍为传输层接入前的模拟测试。",
    "connections.testDuplicate": "连接配置可用，但与现有连接重复。",
    "connections.hostTrusted": "主机 {host}:{port} 已在信任列表中。",
    "connections.hostVerification.title": "主机指纹确认",
    "connections.hostVerification.untrustedBody": "这是第一次连接到该主机，请确认以下 SSH 指纹是否可信。",
    "connections.hostVerification.mismatchBody": "当前主机指纹与本地已信任记录不一致，请确认是否信任新的指纹。",
    "connections.hostVerification.algorithm": "主机算法",
    "connections.hostVerification.fingerprint": "当前指纹",
    "connections.hostVerification.trustedFingerprint": "已信任指纹",
    "connections.hostVerification.trustAndContinue": "信任并继续",
    "connections.hostVerification.cancel": "取消",
    "connections.deleteConfirmTitle": "确认删除连接配置",
    "connections.deleteConfirmBody": "删除后将同时移除关联会话。此操作不可撤销。",
    "connections.deleteConfirmAction": "确认删除",
    "connections.deleteCancel": "取消",
    "connections.hostInspectionTitle": "请确认主机指纹",
    "connections.hostInspectionMessage": "目标主机 {host}:{port} 的 {algorithm} 指纹为：",
    "connections.hostInspectionFingerprint": "指纹：{fingerprint}",
    "connections.hostInspectionTrustedFingerprint": "已信任指纹：{fingerprint}",
    "connections.hostInspectionMismatch": "当前指纹与已信任记录不一致，请特别留意。",
    "connections.hostInspectionWarning": "若指纹与预期不符，请确认网络环境后再继续。",
    "connections.hostInspectionTrust": "信任并继续",
    "connections.hostInspectionCancel": "暂不信任",
    "connections.hostInspectionPending": "等待主机指纹确认：{host}:{port}",
    "terminal.title": "工作台",
    "terminal.emptyTitle": "会话区域已准备就绪",
    "terminal.emptyBody": "从左侧连接栏打开一个连接，即可开始远程终端工作区会话。",
    "terminal.lastUpdate": "最近更新：{time}",
    "terminal.commandPlaceholder": "输入命令",
    "terminal.send": "发送",
    "terminal.toggleTheme": "主题",
    "terminal.togglePanel": "面板",
    "terminal.openHint": "打开一个连接即可开始。",
    "terminal.copy": "复制",
    "terminal.paste": "粘贴",
    "terminal.reconnect": "重连",
    "terminal.clearOutput": "清屏",
    "terminal.closeOthers": "关闭其它",
    "terminal.size": "终端尺寸：{cols} × {rows}",
    "terminal.noOtherSessions": "当前没有其它会话可关闭。",
    "terminal.reconnected": "会话已重新连接。",
    "terminal.outputCleared": "已清空当前终端输出。",
    "terminal.closedOthers": "已关闭其它会话。",
    "files.title": "远程文件",
    "files.loading": "正在加载远程目录…",
    "files.empty": "打开会话后会在这里显示远程文件数据。",
    "files.noSession": "尚未选择会话",
    "files.currentPathLabel": "当前路径：",
    "files.entryCount": "{count} 项",
    "files.name": "名称",
    "files.type": "类型",
    "files.size": "大小",
    "files.modifiedAt": "修改时间",
    "files.folder": "目录",
    "files.file": "文件",
    "files.folderSizeUnknown": "目录大小不可用",
    "files.goParent": "返回上一级",
    "files.refresh": "刷新",
    "files.newFolder": "新建目录",
    "files.upload": "上传",
    "files.download": "下载",
    "files.rename": "重命名",
    "files.delete": "删除",
    "files.uploadPrompt": "请输入要上传的本地文件路径",
    "files.downloadPrompt": "请输入下载后的本地保存路径",
    "files.newFolderPrompt": "请输入新目录名称",
    "files.renamePrompt": "请输入 {name} 的新名称",
    "files.deleteFileConfirm": "确认删除文件 {name} 吗？",
    "files.deleteDirectoryConfirm": "确认删除目录 {name} 吗？",
    "transfers.title": "传输任务",
    "transfers.loading": "正在获取传输状态…",
    "transfers.empty": "暂无传输任务。",
    "transfers.taskCount": "{count} 个传输",
    "transfers.upload": "上传",
    "transfers.download": "下载",
    "transfers.status.running": "传输中",
    "transfers.status.succeeded": "已完成",
    "transfers.status.failed": "失败",
    "transfers.retry": "重试",
    "transfers.clearCompleted": "清理已完成",
    "transfers.cancel": "取消",
    "snippets.title": "片段",
    "snippets.subtitle": "{count} 个复用命令",
    "snippets.edit": "编辑",
    "snippets.run": "执行",
    "snippets.delete": "删除",
    "snippets.field.name": "名称",
    "snippets.field.command": "命令",
    "snippets.field.description": "说明",
    "snippets.field.group": "分组",
    "snippets.field.tags": "标签",
    "snippets.save": "保存片段",
    "errors.unexpectedWorkspace": "工作台发生未预期错误",
    "errors.remoteEntries": "刷新远程文件失败",
    "errors.connectionNotFound": "未找到连接配置",
    "errors.snippetNotFound": "未找到命令片段",
    "errors.connectionImportEmpty": "导入内容为空。",
    "errors.connectionExportFailed": "导出连接配置失败。",
    "mock.browserFallback": "当前运行在浏览器回退模式。使用 `bun tauri dev` 可切换到宿主运行时。",
    "mock.simConnected": "已连接到 {user}@{host}:{port}",
    "mock.simTransport": "[模拟器] SSH 传输层尚未接入。",
    "mock.simShell": "[模拟器] 当前工作台已验证应用壳、状态流与命令边界。",
    "mock.savedSettings": "已保存工作台设置。",
    "mock.resetSettings": "已重置工作台设置。",
    "mock.savedConnection": "已保存连接配置 {name}。",
    "mock.deletedConnection": "已删除连接配置 {name}。",
    "mock.testedConnection": "已完成连接配置测试：{name}。",
    "mock.importedConnections": "已导入 {count} 个连接配置。",
    "mock.exportedConnections": "已导出 {count} 个连接配置。",
    "mock.savedSnippet": "已保存命令片段 {name}。",
    "mock.deletedSnippet": "已删除命令片段 {name}。",
    "mock.openedSession": "已为 {name} 打开模拟会话。",
    "mock.closedSession": "已关闭会话 {name}。",
    "mock.sentCommand": "已向会话发送命令。",
    "mock.commandAccepted": "[模拟器] 宿主边界已接收该命令。",
    "locale.pendingHook": "检测到系统语言为 {locale}，当前已预留多语言扩展入口，暂回退为简体中文。",
  },
};

function detectSystemLocale(): string {
  if (typeof navigator === "undefined") {
    return DEFAULT_LOCALE;
  }

  const locales = navigator.languages?.filter(Boolean) ?? [];
  return locales[0] ?? navigator.language ?? DEFAULT_LOCALE;
}

function normalizeLocale(locale: string): string {
  return locale.trim().replace("_", "-");
}

function resolveLocaleState(): LocaleState {
  const systemLocale = normalizeLocale(detectSystemLocale());
  const hasPendingLocaleHook = !systemLocale.toLowerCase().startsWith("zh");

  if (typeof document !== "undefined") {
    document.documentElement.lang = DEFAULT_LOCALE;
    document.documentElement.dataset.systemLocale = systemLocale;
  }

  return {
    appLocale: DEFAULT_LOCALE,
    systemLocale,
    hasPendingLocaleHook,
  };
}

const localeState = resolveLocaleState();

export function getLocaleState(): LocaleState {
  return localeState;
}

export function t(key: keyof typeof messages["zh-CN"], params?: Record<string, string | number>): string {
  const value = messages[DEFAULT_LOCALE][key];

  if (typeof value === "function") {
    return value(params);
  }

  if (!params) {
    return value;
  }

  return value.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? ""));
}
