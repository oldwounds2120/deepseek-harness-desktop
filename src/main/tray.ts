import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'node:path'
import { getMainWindow, markQuitting } from './windows'
import { dshService } from './dsh/service'
import { logger } from './logger'

let tray: Tray | null = null

function trayIcon(): Electron.NativeImage {
  // 优先使用应用图标（打包后位于 resources/ico.png）；缺失时用占位
  const candidates = [
    join(process.resourcesPath, 'ico.png'),
    join(app.getAppPath(), 'resources', 'ico.png'),
    join(app.getAppPath(), '..', 'resources', 'ico.png')
  ]
  for (const p of candidates) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
  }
  return nativeImage.createEmpty()
}

/** 真正退出：停 dsh 服务 → 放行窗口关闭 → 退出应用 */
export function quitApp(): void {
  markQuitting()
  logger.system('[app] 托盘退出：停止 dsh 服务')
  void dshService.stop().finally(() => {
    logger.system('[app] dsh 服务已停止，退出应用')
    app.quit()
  })
}

export function createTray(): Tray {
  if (tray) return tray
  tray = new Tray(trayIcon())
  tray.setToolTip('DeepSeek Harness Desktop')

  const rebuild = () => {
    const status = dshService.status()
    const running = status.state === 'running'
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开主窗口', click: () => getMainWindow()?.show() },
        {
          label: running ? `dsh 运行中${status.url ? ` · ${status.url.replace('http://', '')}` : ''}` : 'dsh 未运行',
          enabled: false
        },
        { type: 'separator' },
        {
          label: running ? '重启 dsh 服务' : '启动 dsh 服务',
          click: () => {
            void (running ? dshService.restart() : dshService.start())
          }
        },
        { type: 'separator' },
        { label: '退出', click: () => quitApp() }
      ])
    )
  }

  tray.on('click', () => getMainWindow()?.show())
  dshService.on('status', rebuild)
  rebuild()
  logger.system('[tray] 托盘已创建')
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
