import type { AppSettings, ConnectionProfile, CommandSnippet } from "../../../entities/domain";

export const defaultAppSettings: AppSettings = {
  terminal: {
    fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
    fontSize: 14,
    lineHeight: 1.6,
    theme: "midnight",
    cursorStyle: "block",
    copyOnSelect: false,
  },
  workspace: {
    sidebarCollapsed: false,
    bottomPanel: "files",
    bottomPanelVisible: true,
    sidePanel: "activity",
    sidePanelVisible: true,
  },
};

export const starterConnections: ConnectionProfile[] = [
  {
    id: "conn-prod-app-01",
    name: "生产应用-01",
    host: "10.10.0.12",
    port: 22,
    username: "deploy",
    authType: "privateKey",
    password: "",
    privateKeyPath: "~/.ssh/id_ed25519",
    privateKeyPassphrase: "",
    group: "生产环境",
    tags: ["api", "cn-sha"],
    note: "主应用节点",
    lastConnectedAt: null,
  },
  {
    id: "conn-stage-bastion",
    name: "预发堡垒机",
    host: "10.20.1.5",
    port: 22,
    username: "ops",
    authType: "password",
    password: "termorax-demo",
    privateKeyPath: "",
    privateKeyPassphrase: "",
    group: "预发环境",
    tags: ["bastion"],
    note: "预发网络跳板机",
    lastConnectedAt: null,
  },
];

export const starterSnippets: CommandSnippet[] = [
  {
    id: "snippet-tail-api",
    name: "跟踪 API 日志",
    command: "tail -f /var/log/app/api.log",
    description: "持续查看主 API 服务日志。",
    group: "诊断",
    tags: ["logs", "api"],
    favorite: true,
  },
  {
    id: "snippet-disk-check",
    name: "磁盘占用",
    command: "df -h",
    description: "检查当前主机的磁盘占用情况。",
    group: "诊断",
    tags: ["disk"],
    favorite: false,
  },
  {
    id: "snippet-release-status",
    name: "发布状态",
    command: "systemctl status termorax-release",
    description: "查看发布服务当前状态。",
    group: "发布",
    tags: ["release", "systemd"],
    favorite: false,
  },
];
