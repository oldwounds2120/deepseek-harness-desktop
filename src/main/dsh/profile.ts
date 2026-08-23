import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Env } from '../env'
import { logger } from '../logger'

/** profile 名称：web 是桌面版默认 surface */
export const PROFILE_NAME = 'web'

export interface ProfileManifest {
  name: string
  private: boolean
  dependencies: Record<string, string>
  dsh?: {
    profile?: {
      bundles?: string[]
    }
  }
}

export function profileDir(): string {
  return join(Env.dshHome, 'profiles', PROFILE_NAME)
}

export function manifestPath(): string {
  return join(profileDir(), 'package.json')
}

/** 确保 DSH_HOME 与 profile 目录存在（dsh 首次启动也会自建，这里提前兜底） */
export function ensureDshHome(): void {
  for (const dir of [Env.dshHome, profileDir(), Env.logsDir()]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      logger.system(`[profile] 创建目录: ${dir}`)
    }
  }
}

export function readManifest(): ProfileManifest | null {
  try {
    const raw = readFileSync(manifestPath(), 'utf8')
    return JSON.parse(raw) as ProfileManifest
  } catch {
    return null
  }
}

export function writeManifest(manifest: ProfileManifest): void {
  writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

/** 已安装的插件依赖（package.json dependencies，排除 dsh 自身 bundles） */
export function installedDependencies(): Record<string, string> {
  const m = readManifest()
  return m?.dependencies ?? {}
}

/** 当前启用的 bundle 层列表 */
export function enabledBundles(): string[] {
  return readManifest()?.dsh?.profile?.bundles ?? []
}

/**
 * 启用/禁用 bundle：通过增删 dsh.profile.bundles 层栈实现。
 * 依赖保留在 package.json 中，重新启用无需重新安装。
 */
export function setBundleEnabled(name: string, enabled: boolean): boolean {
  const m = readManifest()
  if (!m) return false
  const bundles = m.dsh?.profile?.bundles ?? []
  const idx = bundles.indexOf(name)
  const present = idx >= 0
  if (enabled && !present) bundles.push(name)
  if (!enabled && present) bundles.splice(idx, 1)
  m.dsh = { ...(m.dsh ?? {}), profile: { ...(m.dsh?.profile ?? {}), bundles } }
  writeManifest(m)
  logger.system(`[profile] ${enabled ? '启用' : '禁用'} bundle: ${name}`)
  return true
}
