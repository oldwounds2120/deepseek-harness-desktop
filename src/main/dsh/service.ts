import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Env } from '../env'
import { logger } from '../logger'
import type { DshStatus } from '../../shared/ipc'

/** 从 dsh 进程 stdout 解析 Web UI 地址（web-runtime 会打印 URL 行） */
const URL_RE = /https?:\/\/127\.0\.0\.1:\d+/

const MAX_CONSECUTIVE_CRASHES = 5
const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 30000

export interface DshServiceEvents {
  status: (status: DshStatus) => void
}

/**
 * dsh 服务托管：独立 Node 子进程运行官方 dsh，Web UI 地址通过
 * --port 0（OS 分配）+ stdout URL 解析获得，实现零端口冲突。
 */
export class DshService extends EventEmitter {
  private child: ChildProcess | null = null
  private state: DshStatus['state'] = 'stopped'
  private url: string | null = null
  private version: string | null = null
  private lastError: string | null = null
  private crashCount = 0
  private restartTimer: NodeJS.Timeout | null = null
  private stopping = false
  private startedAt: number | null = null

  constructor() {
    super()
    this.version = this.resolveVersion()
  }

  status(): DshStatus {
    return {
      state: this.state,
      url: this.url,
      version: this.version,
      error: this.lastError,
      pid: this.child?.pid ?? null
    }
  }

  private setState(state: DshStatus['state']): void {
    this.state = state
    this.emit('status', this.status())
  }

  private resolveVersion(): string | null {
    try {
      const pkgPath = join(Env.dshInstall, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
      if (!existsSync(pkgPath)) {
        const alt = join(Env.runtimeRoot, 'dsh', 'package.json')
        if (!existsSync(alt)) return null
        return JSON.parse(readFileSync(alt, 'utf8')).version ?? null
      }
      return JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? null
    } catch {
      return null
    }
  }

  /** 启动（或重启）dsh 服务 */
  async start(): Promise<DshStatus> {
    if (this.child && this.state === 'running') return this.status()
    await this.stop()
    this.stopping = false
    this.crashCount = 0
    return this.launch()
  }

  private launch(): DshStatus {
    const nodeExe = Env.nodeExe()
    const dshEntry = Env.dshEntry()

    if (!nodeExe || !dshEntry) {
      const missing = [!nodeExe && 'node', !dshEntry && 'dsh'].filter(Boolean).join(', ')
      this.lastError = `运行时缺失: ${missing}。请先运行 npm run prepare:runtime`
      this.setState('error')
      logger.system(`[dsh] 启动失败: ${this.lastError}`)
      return this.status()
    }

    this.setState('starting')
    logger.system(`[dsh] 启动: ${nodeExe} ${dshEntry} --profile web --no-open --host 127.0.0.1 --port 0`)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_HOME: Env.dshHome,
      // 桌面场景固定回环地址；端口 0 由 OS 分配
      NODE_OPTIONS: '', // 避免外部注入的 node 选项（如沙箱钩子）破坏 dsh
      DSH_NO_TELEMETRY: process.env.DSH_NO_TELEMETRY ?? '1'
    }

    const child = spawn(nodeExe, [dshEntry, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
      env,
      cwd: Env.dshHome,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    this.startedAt = Date.now()
    this.lastError = null
    this.url = null

    child.stdout?.on('data', (chunk: Buffer) => this.onOutput(chunk, 'stdout'))
    child.stderr?.on('data', (chunk: Buffer) => this.onOutput(chunk, 'stderr'))

    child.on('error', (err) => {
      this.lastError = err.message
      logger.system(`[dsh] 进程错误: ${err.message}`)
      this.setState('error')
    })

    child.on('exit', (code, signal) => {
      logger.system(`[dsh] 进程退出 code=${code} signal=${signal}`)
      const wasRunning = this.state === 'running' || this.state === 'starting'
      this.child = null
      this.url = null
      if (this.stopping) {
        this.setState('stopped')
        return
      }
      if (wasRunning && !this.stopping) {
        this.crashCount += 1
        this.setState('restarting')
        this.scheduleRestart()
      } else {
        this.setState('stopped')
      }
    })

    return this.status()
  }

  /** 输出处理：日志归档 + 解析 URL（stdout/stderr 均可能输出）+ 广播 */
  private onOutput(chunk: Buffer, stream: 'stdout' | 'stderr'): void {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      logger.log(stream, line)
      if (!this.url) {
        const m = line.match(URL_RE)
        if (m) {
          this.url = m[0]
          this.crashCount = 0
          this.setState('running')
          logger.system(`[dsh] Web UI 就绪: ${this.url}`)
        }
      }
    }
  }

  private scheduleRestart(): void {
    if (this.crashCount > MAX_CONSECUTIVE_CRASHES) {
      this.lastError = `连续崩溃 ${MAX_CONSECUTIVE_CRASHES} 次，停止自动重启，请查看日志`
      this.setState('error')
      return
    }
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (this.crashCount - 1), BACKOFF_MAX_MS)
    logger.system(`[dsh] ${delay}ms 后自动重启（第 ${this.crashCount} 次）`)
    this.restartTimer = setTimeout(() => {
      if (!this.stopping) this.launch()
    }, delay)
  }

  /** 停止服务（优雅终止 + 递归清理子进程） */
  async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    if (!child || child.killed) {
      this.setState('stopped')
      return
    }
    const pid = child.pid
    logger.system(`[dsh] 停止进程 pid=${pid}`)
    // Windows：先 taskkill /T 递归终止（pty/sandbox 子进程一并清理），再 SIGTERM 兜底
    if (process.platform === 'win32') {
      const { spawn } = await import('node:child_process')
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
      await new Promise<void>((resolve) => {
        killer.on('exit', () => resolve())
        killer.on('error', () => resolve())
      })
      child.kill()
    } else {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 3000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    this.setState('stopped')
    this.stopping = false
  }

  /** 重启 */
  async restart(): Promise<DshStatus> {
    await this.stop()
    this.stopping = false
    return this.launch()
  }

  /** 运行时长（毫秒） */
  uptimeMs(): number | null {
    return this.startedAt ? Date.now() - this.startedAt : null
  }

  dispose(): void {
    this.removeAllListeners()
    void this.stop()
  }
}

export const dshService = new DshService()
