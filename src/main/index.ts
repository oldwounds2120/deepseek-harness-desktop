// 必须最先导入：固定 userData 路径（副作用模块），随后所有模块的 userData 读取都指向同一目录
import './paths'
import { app } from 'electron'
import { logger } from './logger'
import { Env } from './env'
import { ensureDshHome } from './dsh/profile'
import { dshService } from './dsh/service'
import { registerIpc } from './ipc'
import { createMainWindow, getMainWindow, markQuitting } from './windows'
import { createTray } from './tray'
import { setupAutoUpdater } from './updater'
import { readShellSettings } from './settings'
import { ensureRuntimeInstalled } from './runtime'

// 单实例：重复启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setName('DeepSeek Harness Desktop')
    logger.system(`[app] dsh-desktop 启动 v${app.getVersion()} platform=${process.platform}`)

    // 数据目录初始化（DSH_HOME）
    ensureDshHome()
    logger.system(`[app] DSH_HOME=${Env.dshHome}`)

    // 运行时迁移（打包/首次运行）
    ensureRuntimeInstalled()

    // IPC 必须先于窗口注册
    registerIpc()

    // 开机自启还原（设置持久化在 userData）
    if (readShellSettings().launchAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true })
    }

    createMainWindow()
    createTray()
    setupAutoUpdater()

    // 启动 dsh 服务（窗口关闭后仍在托盘驻留运行）
    const status = await dshService.start()
    logger.system(`[app] dsh 初始状态: ${status.state}`)

    app.on('activate', () => {
      const win = getMainWindow()
      if (win) win.show()
      else createMainWindow()
    })
  })

  // 退出前清理（任何退出路径兜底：标记放行窗口关闭 + 停止 dsh）
  app.on('before-quit', () => {
    markQuitting()
    logger.system('[app] 退出中，停止 dsh 服务')
    void dshService.stop()
  })

  // 托盘常驻：窗口全部关闭不退出
  app.on('window-all-closed', () => {
    // 不调用 app.quit() —— dsh 服务与托盘继续运行
  })

  // 未捕获异常兜底（不崩溃）
  process.on('uncaughtException', (err) => {
    logger.system(`[app] uncaughtException: ${err.message}`)
  })
}
