/**
 * 共享 IPC 契约：主进程与渲染进程之间所有通道名与类型定义。
 * 渲染层通过 preload 暴露的 dshDesktop 对象访问，类型从此文件导出。
 */

export const IPC = {
  // dsh 服务状态
  dshStatus: 'dsh:status',
  dshStart: 'dsh:start',
  dshStop: 'dsh:stop',
  dshRestart: 'dsh:restart',
  dshOpenExternal: 'dsh:open-external',
  dshOnStatus: 'dsh:on-status',
  dshOnLog: 'dsh:on-log',
  dshOpenDataDir: 'dsh:open-data-dir',

  // 插件管理
  pluginList: 'plugin:list',
  pluginSearch: 'plugin:search',
  pluginInstall: 'plugin:install',
  pluginUninstall: 'plugin:uninstall',
  pluginUpdate: 'plugin:update',
  pluginSetEnabled: 'plugin:set-enabled',
  pluginImportLocal: 'plugin:import-local',
  pluginOnProgress: 'plugin:on-progress',

  // 设置
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsGetLaunchAtLogin: 'settings:launch-at-login',
  settingsSetLaunchAtLogin: 'settings:set-launch-at-login',
  appCheckUpdate: 'app:check-update',
  appVersion: 'app:version',
  appQuit: 'app:quit'
} as const

export type DshServiceState = 'stopped' | 'starting' | 'running' | 'error' | 'restarting'

export interface DshStatus {
  state: DshServiceState
  /** Web UI 实际访问地址（端口为 OS 分配后的真实值） */
  url: string | null
  /** dsh 版本 */
  version: string | null
  /** 最近一次错误信息 */
  error?: string | null
  /** 进程 pid（运行中时） */
  pid?: number | null
}

export interface PluginInfo {
  /** 包名，如 @deepseek-ai/dsh-tool-web */
  name: string
  /** 已安装版本 */
  version: string
  /** 是否声明了 dsh.bundle（是则为 profile 层插件） */
  isBundle: boolean
  /** 是否在 dsh.profile.bundles 层栈中（启用状态） */
  enabled: boolean
  /** 描述（来自包 manifest） */
  description?: string
  /** 安装来源：registry | local */
  source: 'registry' | 'local'
  /** 本地导入时的原始路径 */
  localPath?: string
}

export interface PluginSearchResult {
  name: string
  version: string
  description?: string
  author?: string
  /** 是否声明 dsh.bundle（近似判断，npm 元数据可能不完整） */
  isBundle?: boolean
}

export interface PluginInstallProgress {
  phase: 'resolving' | 'installing' | 'reconciling' | 'done' | 'error'
  packageName: string
  message?: string
}

export interface AppSettings {
  /** 是否开机自启 */
  launchAtLogin: boolean
  /** 关闭窗口时最小化到托盘 */
  minimizeToTray: boolean
  /** 数据目录（DSH_HOME 根） */
  dataDir: string
  /** dsh 运行时版本 */
  dshVersion: string | null
  /** 是否已配置模型（引导用，读取 dsh 凭据目录是否存在） */
  modelConfigured: boolean
}

export interface LogEntry {
  time: string
  stream: 'stdout' | 'stderr' | 'system'
  line: string
}
