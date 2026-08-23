import { createWriteStream, existsSync, mkdirSync, WriteStream } from 'node:fs'
import { join } from 'node:path'
import { Env } from './env'
import type { LogEntry } from '../shared/ipc'

/**
 * 应用日志：内存环形缓冲（供渲染层日志页实时查看）+ 文件追加（供排错）。
 * dsh 子进程的 stdout/stderr 也汇入此处。
 */
class Logger {
  private buffer: LogEntry[] = []
  private readonly maxBuffer = 2000
  private file: WriteStream | null = null
  private listeners = new Set<(e: LogEntry) => void>()

  constructor() {
    try {
      const dir = Env.logsDir()
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      this.file = createWriteStream(join(dir, 'app.log'), { flags: 'a' })
    } catch {
      this.file = null
    }
  }

  log(stream: LogEntry['stream'], line: string): void {
    const time = new Date().toISOString()
    const entry: LogEntry = { time, stream, line }
    if (this.buffer.length >= this.maxBuffer) this.buffer.shift()
    this.buffer.push(entry)
    this.file?.write(`[${time}] [${stream}] ${line}\n`)
    for (const fn of this.listeners) fn(entry)
  }

  system(line: string): void {
    this.log('system', line)
  }

  subscribe(fn: (e: LogEntry) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  snapshot(): LogEntry[] {
    return [...this.buffer]
  }
}

export const logger = new Logger()
