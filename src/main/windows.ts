import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { logger } from './logger'
import { readShellSettings } from './settings'
import { dshService } from './dsh/service'

let mainWindow: BrowserWindow | null = null
let quitting = false

/** 标记为真正退出（托盘"退出"、应用 quit 流程），此后窗口 close 不再拦截 */
export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** gate 过渡页（dsh 未就绪时显示 loading/错误） */
function loadGate(win: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/gate.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/gate.html'))
  }
}

/** 根据 dsh 状态决定加载 dsh UI 还是过渡页 */
function loadDshOrGate(win: BrowserWindow): void {
  const status = dshService.status()
  if (status.url) {
    void win.loadURL(status.url)
    logger.system(`[window] 加载 dsh Web UI: ${status.url}`)
  } else {
    loadGate(win)
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'DeepSeek Harness Desktop',
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 隐藏菜单栏（用户当前用不到）
  mainWindow.setMenuBarVisibility(false)
  mainWindow.setAutoHideMenuBar(true)

  // 菜单栏隐藏后保留 F12 调试入口
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 外部链接一律交给系统浏览器（dsh Web UI 内的文档链接等）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 防止页面导航离开本地 dsh 服务
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('file:')) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })

  const closeToTray = (e: Electron.Event) => {
    // 真正退出时放行；否则最小化到托盘
    if (!isQuitting() && readShellSettings().minimizeToTray) {
      e.preventDefault()
      mainWindow?.hide()
      logger.system('[window] 关闭窗口 → 最小化到托盘')
    }
  }
  mainWindow.on('close', closeToTray)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // dsh 状态变化：url 就绪 → 加载 dsh UI；异常/未就绪 → 过渡页
  const onStatus = () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    const status = dshService.status()
    const current = win.webContents.getURL()
    if (status.url) {
      if (!current.startsWith(status.url)) {
        logger.system(`[window] 加载 dsh Web UI: ${status.url}`)
        void win.loadURL(status.url)
      }
    } else if (!current.includes('gate.html')) {
      loadGate(win)
    }
  }
  dshService.on('status', onStatus)
  mainWindow.on('closed', () => {
    dshService.removeListener('status', onStatus)
  })

  loadDshOrGate(mainWindow)

  return mainWindow
}
