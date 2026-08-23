import { app } from 'electron'
import { join, dirname } from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'

/**
 * 运行时资源定位：dev 与打包（extraResources）两种形态。
 *
 * - dev:   项目根 /runtime/{node,dsh,pnpm}
 * - 打包:  <app>/resources/runtime/{node,dsh,pnpm}
 *
 * dsh 运行时在用户数据目录下单独初始化一个安装根（runtime-install），
 * 因为 dsh 的 plugin 机制需要往自身 node_modules 里安装插件依赖，
 * 不能直接写 resources（NSIS 安装目录可能只读）。
 */

/** 在 root 下递归查找指定文件（maxDepth 层内），返回首个命中 */
function findFile(root: string, filename: string, maxDepth = 2): string | null {
  if (!existsSync(root)) return null
  const walk = (dir: string, depth: number): string | null => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return null
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      try {
        if (statSync(full).isDirectory()) {
          if (depth < maxDepth) {
            const hit = walk(full, depth + 1)
            if (hit) return hit
          }
        } else if (entry === filename) {
          return full
        }
      } catch {
        // 链接损坏或权限问题，跳过
      }
    }
    return null
  }
  return walk(root, 0)
}

export class Env {
  /** 项目根（dev）/ 打包资源根 */
  static readonly appRoot = app.isPackaged ? process.resourcesPath : app.getAppPath()

  /** 运行时资源根 */
  static readonly runtimeRoot = app.isPackaged
    ? join(process.resourcesPath, 'runtime')
    : join(app.getAppPath(), 'runtime')

  /** 用户数据根（userData），所有 dsh 数据都在这里，隔离且可清理 */
  static readonly userDataDir = app.getPath('userData')

  /** dsh 用户数据根（DSH_HOME） */
  static readonly dshHome = join(Env.userDataDir, 'dsh-home')

  /** dsh 安装根：把自带运行时复制到这里，可写，供 plugin 管理依赖 */
  static readonly dshInstall = join(Env.userDataDir, 'runtime-install')

  /** 定位 node.exe（支持嵌套版本目录，如 runtime/node/node-v22.20.0-win-x64/） */
  static nodeExe(): string | null {
    return findFile(join(Env.runtimeRoot, 'node'), 'node.exe', 2)
  }

  /** dsh 入口（bin.js）：优先 userData 安装根，其次自带 runtime */
  static dshEntry(): string | null {
    const candidates = [
      join(Env.dshInstall, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      join(Env.runtimeRoot, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      join(Env.runtimeRoot, 'dsh', 'lib', 'bin.js')
    ]
    for (const p of candidates) if (existsSync(p)) return p
    // 兜底：递归查找（应对 pnpm 链接/不同布局）
    return findFile(join(Env.runtimeRoot, 'dsh', 'node_modules', '@deepseek-ai', 'dsh'), 'bin.js', 2)
  }

  /** pnpm 可执行：完整 package 结构（pnpm.cjs 由 node 执行） */
  static pnpmCli(): string | null {
    const candidates = [
      join(Env.dshInstall, 'pnpm', 'package', 'bin', 'pnpm.cjs'),
      join(Env.runtimeRoot, 'pnpm', 'package', 'bin', 'pnpm.cjs'),
      join(Env.dshInstall, 'pnpm', 'pnpm.cjs'),
      join(Env.runtimeRoot, 'pnpm', 'pnpm.cjs'),
      join(Env.runtimeRoot, 'pnpm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    ]
    for (const p of candidates) if (existsSync(p)) return p
    return null
  }

  /** logs 目录 */
  static logsDir(): string {
    return join(Env.userDataDir, 'logs')
  }

  /** dsh 进程日志文件 */
  static dshLogFile(): string {
    return join(Env.logsDir(), 'dsh.log')
  }

  /** 元信息文件：记录 dsh/pnpm 版本、来源，供升级与排错 */
  static metaFile(): string {
    return join(Env.userDataDir, 'runtime-meta.json')
  }

  static pathOf(file: string): string {
    return dirname(file)
  }
}
