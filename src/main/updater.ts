import { app } from 'electron'
import { logger } from './logger'

/**
 * 自动更新（electron-updater）。
 * dev 模式下不启用；打包后从发布源检查。当前提供"检查更新"入口，
 * 发布源配置在 electron-builder.yml 的 publish 字段。
 */
export async function checkForUpdates(silent = true): Promise<{ available: boolean; version?: string }> {
  if (!app.isPackaged) {
    if (!silent) logger.system('[updater] dev 模式跳过更新检查')
    return { available: false }
  }
  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = false
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo.version
    const available = Boolean(version) && version !== app.getVersion()
    if (!silent) {
      logger.system(
        `[updater] 检查完成: ${available ? `发现新版本 ${version}` : '当前已是最新版本'}`
      )
    }
    return { available, version }
  } catch (e) {
    logger.system(`[updater] 检查失败: ${(e as Error).message}`)
    return { available: false }
  }
}

export function setupAutoUpdater(): void {
  if (!app.isPackaged) return
  void import('electron-updater').then(({ autoUpdater }) => {
    autoUpdater.autoDownload = false
    autoUpdater.on('update-available', (info) => {
      logger.system(`[updater] 发现新版本 ${info.version}`)
    })
    autoUpdater.on('update-downloaded', () => {
      logger.system('[updater] 更新已下载，重启后生效')
    })
    autoUpdater.on('error', (e) => logger.system(`[updater] 错误: ${e.message}`))
  })
}
