import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Env } from '../env'

/**
 * dsh 配置辅助：判断是否已配置模型（引导用）。
 * dsh 的模型凭据存储在 DSH_HOME 的凭据/配置目录中，这里通过
 * 存在性判断是否进入过配置流程，避免误导用户重复配置。
 */
export function modelConfigured(): boolean {
  const candidates = [
    join(Env.dshHome, 'credentials'),
    join(Env.dshHome, 'settings'),
    join(Env.dshHome, 'data', 'settings.json')
  ]
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue
      const stat = statSync(p)
      if (stat.isFile()) {
        const content = readFileSync(p, 'utf8')
        if (content.trim().length > 2) return true
      } else if (stat.isDirectory() && readdirSync(p).length > 0) {
        return true
      }
    } catch {
      // ignore
    }
  }
  return false
}
