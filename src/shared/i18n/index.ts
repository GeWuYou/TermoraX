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
    "workspace.action.resetSettings": "重置设置",
    "workspace.currentTheme": "当前主题：{theme}",
    "workspace.theme.midnight": "夜航",
    "workspace.theme.sand": "砂岩",
    "connections.title": "连接",
    "connections.subtitle": "{count} 个配置",
    "connections.new": "新建",
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
    "connections.save": "保存配置",
    "connections.openSession": "打开会话",
    "terminal.title": "工作台",
    "terminal.emptyTitle": "会话区域已准备就绪",
    "terminal.emptyBody": "从左侧连接栏打开一个连接。当前构建使用模拟传输层，但真实的 Tauri 命令边界和状态流已经就位。",
    "terminal.lastUpdate": "最近更新：{time}",
    "terminal.commandPlaceholder": "输入命令",
    "terminal.send": "发送",
    "terminal.toggleTheme": "主题",
    "terminal.togglePanel": "侧栏",
    "terminal.openHint": "打开一个连接即可开始。",
    "files.title": "远程文件",
    "files.empty": "打开会话后会在这里显示远程文件数据。",
    "files.noSession": "尚未选择会话",
    "files.folder": "目录",
    "files.file": "文件",
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
    "mock.browserFallback": "当前运行在浏览器回退模式。使用 `bun tauri dev` 可切换到宿主运行时。",
    "mock.simConnected": "已连接到 {user}@{host}:{port}",
    "mock.simTransport": "[模拟器] SSH 传输层尚未接入。",
    "mock.simShell": "[模拟器] 当前工作台已验证应用壳、状态流与命令边界。",
    "mock.savedSettings": "已保存工作台设置。",
    "mock.resetSettings": "已重置工作台设置。",
    "mock.savedConnection": "已保存连接配置 {name}。",
    "mock.deletedConnection": "已删除连接配置 {name}。",
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
