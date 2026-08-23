import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  DshStatus,
  PluginInfo,
  PluginInstallProgress,
  PluginSearchResult,
  AppSettings,
  LogEntry
} from '../shared/ipc'

/** 渲染层可用的 API（通过 window.dshDesktop 访问） */
const api = {
  // dsh 服务
  dshStatus: (): Promise<DshStatus> => ipcRenderer.invoke(IPC.dshStatus),
  dshStart: (): Promise<DshStatus> => ipcRenderer.invoke(IPC.dshStart),
  dshStop: (): Promise<DshStatus> => ipcRenderer.invoke(IPC.dshStop),
  dshRestart: (): Promise<DshStatus> => ipcRenderer.invoke(IPC.dshRestart),
  dshOpenDataDir: (): Promise<string> => ipcRenderer.invoke(IPC.dshOpenDataDir),
  dshOpenExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.dshOpenExternal, url),
  onDshStatus: (cb: (status: DshStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: DshStatus) => cb(status)
    ipcRenderer.on('dsh:status-changed', listener)
    return () => ipcRenderer.removeListener('dsh:status-changed', listener)
  },
  onDshLog: (cb: (entries: LogEntry[]) => void): (() => void) => {
    const listener = (_e: unknown, entries: LogEntry[]) => cb(entries)
    ipcRenderer.on('dsh:log-snapshot', listener)
    return () => ipcRenderer.removeListener('dsh:log-snapshot', listener)
  },

  // 插件管理
  pluginList: (): Promise<PluginInfo[]> => ipcRenderer.invoke(IPC.pluginList),
  pluginSearch: (q: string): Promise<PluginSearchResult[]> => ipcRenderer.invoke(IPC.pluginSearch, q),
  pluginInstall: (spec: string): Promise<PluginInfo | null> => ipcRenderer.invoke(IPC.pluginInstall, spec),
  pluginUninstall: (name: string): Promise<PluginInfo[]> => ipcRenderer.invoke(IPC.pluginUninstall, name),
  pluginUpdate: (name: string): Promise<PluginInfo[]> => ipcRenderer.invoke(IPC.pluginUpdate, name),
  pluginSetEnabled: (name: string, enabled: boolean): Promise<PluginInfo[]> =>
    ipcRenderer.invoke(IPC.pluginSetEnabled, name, enabled),
  pluginImportLocal: (): Promise<PluginInfo | null> => ipcRenderer.invoke(IPC.pluginImportLocal),
  onPluginProgress: (cb: (p: PluginInstallProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: PluginInstallProgress) => cb(p)
    ipcRenderer.on('plugin:progress', listener)
    return () => ipcRenderer.removeListener('plugin:progress', listener)
  },

  // 设置
  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (patch: Partial<Pick<AppSettings, 'minimizeToTray' | 'launchAtLogin'>>): Promise<unknown> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),

  // 应用
  checkUpdate: (silent?: boolean): Promise<{ available: boolean; version?: string }> =>
    ipcRenderer.invoke(IPC.appCheckUpdate, silent),
  appVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  appQuit: (): Promise<void> => ipcRenderer.invoke(IPC.appQuit)
}

export type DshDesktopApi = typeof api

contextBridge.exposeInMainWorld('dshDesktop', api)
