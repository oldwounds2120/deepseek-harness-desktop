import { ipcMain, app, shell, dialog } from 'electron'
import { IPC } from '../shared/ipc'
import { dshService } from './dsh/service'
import { ensureDshHome } from './dsh/profile'
import { logger } from './logger'
import { getAppSettings, writeShellSettings } from './settings'
import * as plugins from './plugins/manager'
import { searchPlugins } from './plugins/registry'
import { checkForUpdates } from './updater'
import { getMainWindow } from './windows'
import { quitApp } from './tray'

export function registerIpc(): void {
  // ── dsh 服务 ──────────────────────────────────────────────
  ipcMain.handle(IPC.dshStatus, () => dshService.status())
  ipcMain.handle(IPC.dshStart, () => dshService.start())
  ipcMain.handle(IPC.dshStop, () => dshService.stop())
  ipcMain.handle(IPC.dshRestart, () => dshService.restart())
  ipcMain.handle(IPC.dshOpenDataDir, () => shell.openPath(app.getPath('userData')))
  ipcMain.handle(IPC.dshOpenExternal, (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  // 状态/日志推送（渲染层订阅）
  ipcMain.on(IPC.dshOnStatus, (e) => {
    e.sender.send('dsh:status-changed', dshService.status())
  })
  ipcMain.on(IPC.dshOnLog, (e) => {
    e.sender.send('dsh:log-snapshot', logger.snapshot())
  })

  // ── 插件管理 ──────────────────────────────────────────────
  ipcMain.handle(IPC.pluginList, () => plugins.listPlugins())
  ipcMain.handle(IPC.pluginSearch, (_e, query: string) => searchPlugins(query))
  ipcMain.handle(IPC.pluginInstall, async (e, spec: string) => {
    ensureDshHome()
    const progress = (p: { phase: string; packageName: string; message?: string }) => {
      e.sender.send('plugin:progress', p)
    }
    return plugins.installPlugin(spec, progress)
  })
  ipcMain.handle(IPC.pluginUninstall, async (_e, name: string) => {
    await plugins.uninstallPlugin(name)
    return plugins.listPlugins()
  })
  ipcMain.handle(IPC.pluginUpdate, async (_e, name: string) => {
    await plugins.updatePlugin(name)
    return plugins.listPlugins()
  })
  ipcMain.handle(IPC.pluginSetEnabled, (_e, name: string, enabled: boolean) => {
    plugins.setPluginEnabled(name, enabled)
    return plugins.listPlugins()
  })
  ipcMain.handle(IPC.pluginImportLocal, async (e) => {
    const result = await dialog.showOpenDialog({
      title: '导入本地插件',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: '插件包', extensions: ['tgz', 'tar.gz'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    ensureDshHome()
    const progress = (p: { phase: string; packageName: string; message?: string }) => {
      e.sender.send('plugin:progress', p)
    }
    return plugins.importLocalPlugin(result.filePaths[0], progress)
  })

  // ── 设置 ──────────────────────────────────────────────────
  ipcMain.handle(IPC.settingsGet, () => getAppSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: { minimizeToTray?: boolean; launchAtLogin?: boolean }) => {
    const next = writeShellSettings(patch)
    if (patch.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin })
    }
    return next
  })
  ipcMain.handle(IPC.settingsGetLaunchAtLogin, () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle(IPC.settingsSetLaunchAtLogin, (_e, open: boolean) => {
    app.setLoginItemSettings({ openAtLogin: open })
    return open
  })

  // ── 应用 ──────────────────────────────────────────────────
  ipcMain.handle(IPC.appCheckUpdate, (_e, silent = true) => checkForUpdates(silent))
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  ipcMain.handle(IPC.appQuit, () => {
    quitApp()
  })
}

/** 广播 dsh 状态变更（供 service 事件 → 渲染层） */
export function broadcastDshStatus(): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('dsh:status-changed', dshService.status())
  }
}

// 服务状态变化统一推送给渲染层
dshService.on('status', () => broadcastDshStatus())
