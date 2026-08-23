import { existsSync, mkdirSync, cpSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Env } from './env'
import { logger } from './logger'

/**
 * 运行时就绪性：确保 userData/runtime-install 中存在完整的
 * node / dsh / pnpm（打包后 resources/runtime 可能只读，且插件安装
 * 需要写入，因此首次启动迁移到 userData）。
 *
 * dev 模式：项目根 runtime/ 已由 prepare-runtime 生成，同样迁移一次，
 * 保证两端行为一致（插件安装写 userData，不污染项目目录）。
 */
export function ensureRuntimeInstalled(): boolean {
  const srcNode = Env.nodeExe()
  if (srcNode && Env.dshEntry()) {
    // runtime 已就绪（dev 时 runtime/ 直接可用，或已迁移过）
    return true
  }

  const srcRoot = Env.runtimeRoot
  const destRoot = Env.dshInstall
  if (!existsSync(srcRoot)) {
    logger.system('[runtime] 未找到运行时资源目录，请先运行 npm run prepare:runtime')
    return false
  }

  logger.system(`[runtime] 迁移运行时 → ${destRoot}`)
  const started = Date.now()
  try {
    mkdirSync(destRoot, { recursive: true })
    for (const part of ['node', 'dsh', 'pnpm']) {
      const src = join(srcRoot, part)
      const dest = join(destRoot, part)
      if (!existsSync(src)) continue
      if (!existsSync(dest)) {
        // dereference: 符号链接解引用为真实文件，避免打包后链接指向源机器绝对路径
        cpSync(src, dest, { recursive: true, dereference: true })
        logger.system(`[runtime] 迁移 ${part}`)
      }
    }
    // 元信息
    const srcMeta = join(srcRoot, 'runtime-meta.json')
    if (existsSync(srcMeta)) {
      cpSync(srcMeta, join(destRoot, 'runtime-meta.json'), { force: true })
    }
    logger.system(`[runtime] 迁移完成（${Date.now() - started}ms）`)
    return Boolean(Env.nodeExe() && Env.dshEntry())
  } catch (e) {
    logger.system(`[runtime] 迁移失败: ${(e as Error).message}`)
    return false
  }
}

/** 当前运行时元信息（版本/平台），供设置页与排错 */
export function runtimeMeta(): { node?: string; dsh?: string; pnpm?: string } | null {
  for (const base of [Env.dshInstall, Env.runtimeRoot]) {
    try {
      const p = join(base, 'runtime-meta.json')
      if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      // ignore
    }
  }
  return null
}
