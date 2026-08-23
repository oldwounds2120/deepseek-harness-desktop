import { spawn } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Env } from '../env'
import { logger } from '../logger'
import { profileDir, readManifest, writeManifest, installedDependencies, enabledBundles, setBundleEnabled } from '../dsh/profile'
import type { PluginInfo, PluginInstallProgress } from '../../shared/ipc'

export type ProgressHandler = (p: PluginInstallProgress) => void

interface PackageJson {
  name?: string
  version?: string
  description?: string
  dsh?: { bundle?: { patch?: string } }
}

/** 在 profile 目录执行 pnpm（pnpm.exe 直接执行；pnpm.cjs 用 node 执行） */
function runPnpm(args: string[], onChunk?: (line: string) => void): Promise<{ code: number | null; error?: string }> {
  const pnpm = Env.pnpmCli()
  if (!pnpm) {
    return Promise.resolve({ code: 1, error: 'pnpm 运行时缺失，请先运行 npm run prepare:runtime' })
  }
  const isExe = pnpm.endsWith('.exe')
  const command = isExe ? pnpm : (Env.nodeExe() ?? process.execPath)
  const commandArgs = isExe ? args : [pnpm, ...args]
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: profileDir(),
      windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let errTail = ''
    const handle = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        onChunk?.(line)
        errTail = line
      }
    }
    child.stdout?.on('data', handle)
    child.stderr?.on('data', handle)
    child.on('error', (e) => resolve({ code: 1, error: e.message }))
    child.on('exit', (code) => resolve({ code, error: errTail || undefined }))
  })
}

/** 读取已安装包的 manifest，判断是否声明 dsh.bundle */
function readInstalledPackage(name: string): PackageJson | null {
  const pkgDir = join(profileDir(), 'node_modules', ...name.split('/'))
  const pkgPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson
  } catch {
    return null
  }
}

/**
 * Reconcile：把 dependencies 中声明 dsh.bundle 的包同步进 bundles 层栈，
 * 把已卸载/不再声明的包移出。与官方 dsh plugin 命令行为一致。
 */
export function reconcileBundles(): string[] {
  const m = readManifest()
  if (!m) return []
  const deps = Object.keys(m.dependencies ?? {})
  const bundles = m.dsh?.profile?.bundles ?? []
  let changed = false
  for (const name of deps) {
    const pkg = readInstalledPackage(name)
    const isBundle = pkg?.dsh?.bundle?.patch !== undefined
    if (isBundle && !bundles.includes(name)) {
      bundles.push(name)
      changed = true
    }
  }
  const depSet = new Set(deps)
  const next = bundles.filter((b) => depSet.has(b) && readInstalledPackage(b)?.dsh?.bundle?.patch !== undefined)
  if (next.length !== bundles.length) changed = true
  bundles.length = 0
  bundles.push(...next)
  if (changed) {
    m.dsh = { ...(m.dsh ?? {}), profile: { ...(m.dsh?.profile ?? {}), bundles } }
    writeManifest(m)
    logger.system(`[plugins] reconcile bundles: ${bundles.join(', ') || '(empty)'}`)
  }
  return bundles
}

/** 读取本地包 manifest 的来源/描述 */
function bundleMeta(name: string): { isBundle: boolean; version?: string; description?: string } {
  const pkg = readInstalledPackage(name)
  return {
    isBundle: pkg?.dsh?.bundle?.patch !== undefined,
    version: pkg?.version,
    description: pkg?.description
  }
}

/** 已安装插件列表 */
export function listPlugins(): PluginInfo[] {
  const deps = installedDependencies()
  const enabled = enabledBundles()
  return Object.entries(deps).map(([name, version]) => {
    const meta = bundleMeta(name)
    return {
      name,
      version: meta.version ?? version.replace(/^\^/, ''),
      isBundle: meta.isBundle,
      enabled: enabled.includes(name),
      description: meta.description,
      source: version.startsWith('file:') || version.startsWith('link:') || version.startsWith('.') ? 'local' : 'registry',
      localPath: version.startsWith('file:') || version.startsWith('link:') ? version.replace(/^(file|link):/, '') : undefined
    }
  })
}

/** 安装插件（npm 包名或 file:/link: 本地路径） */
export async function installPlugin(spec: string, onProgress: ProgressHandler): Promise<PluginInfo | null> {
  const name = spec.trim()
  if (!name) return null
  onProgress({ phase: 'installing', packageName: name })
  logger.system(`[plugins] install: ${name}`)
  const result = await runPnpm(['add', name], (line) => {
    if (/Downloading|Packages:|Progress|added|removed/.test(line)) {
      onProgress({ phase: 'installing', packageName: name, message: line.trim() })
    }
  })
  if (result.code !== 0) {
    onProgress({ phase: 'error', packageName: name, message: result.error ?? `pnpm 退出码 ${result.code}` })
    throw new Error(result.error ?? `插件安装失败（pnpm 退出码 ${result.code}）`)
  }
  // 记录本地导入来源（file:/link: 形式）
  const manifest = readManifest()
  const actualVersion = manifest?.dependencies?.[name]
  if (!actualVersion) {
    // pnpm 别名/作用域可能变更实际包名，reconcile 后重读
    reconcileBundles()
    const found = listPlugins().find((p) => p.name === name || spec.includes(p.name))
    if (found) return found
    throw new Error('安装完成但未在 profile 中发现该插件')
  }
  reconcileBundles()
  onProgress({ phase: 'done', packageName: name })
  return listPlugins().find((p) => p.name === name) ?? null
}

/** 本地导入（.tgz 或目录）：复制到 userData 本地插件库，以 file: 形式安装 */
export async function importLocalPlugin(localPath: string, onProgress: ProgressHandler): Promise<PluginInfo | null> {
  const { statSync, copyFileSync } = await import('node:fs')
  const { basename } = await import('node:path')
  try {
    const stat = statSync(localPath)
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('仅支持 .tgz 文件或目录')
    const localStore = join(Env.userDataDir, 'local-plugins')
    if (!existsSync(localStore)) mkdirSync(localStore, { recursive: true })
    const dest = join(localStore, basename(localPath))
    if (stat.isFile()) {
      if (existsSync(dest)) {
        // 同名覆盖：先删旧文件
        const { rmSync } = await import('node:fs')
        rmSync(dest, { force: true })
      }
      copyFileSync(localPath, dest)
      logger.system(`[plugins] 本地导入 tgz: ${localPath} -> ${dest}`)
      return installPlugin(`file:${dest}`, onProgress)
    }
    // 目录：复制为 dest 目录
    const destDir = dest.replace(/\.tgz$/, '') + '-dir'
    if (existsSync(destDir)) {
      const { rmSync } = await import('node:fs')
      rmSync(destDir, { recursive: true, force: true })
    }
    const { cpSync } = await import('node:fs')
    cpSync(localPath, destDir, { recursive: true })
    logger.system(`[plugins] 本地导入目录: ${localPath} -> ${destDir}`)
    return installPlugin(`link:${destDir}`, onProgress)
  } catch (e) {
    onProgress({ phase: 'error', packageName: basename(localPath), message: (e as Error).message })
    throw e
  }
}

/** 卸载插件 */
export async function uninstallPlugin(name: string): Promise<void> {
  logger.system(`[plugins] uninstall: ${name}`)
  const result = await runPnpm(['remove', name])
  if (result.code !== 0) throw new Error(result.error ?? `卸载失败（pnpm 退出码 ${result.code}）`)
  reconcileBundles()
}

/** 更新插件到最新版本 */
export async function updatePlugin(name: string): Promise<void> {
  logger.system(`[plugins] update: ${name}`)
  const result = await runPnpm(['update', name])
  if (result.code !== 0) throw new Error(result.error ?? `更新失败（pnpm 退出码 ${result.code}）`)
  reconcileBundles()
}

/** 启用/禁用（增删 bundles 层栈，依赖保留） */
export function setPluginEnabled(name: string, enabled: boolean): boolean {
  const ok = setBundleEnabled(name, enabled)
  if (ok) logger.system(`[plugins] ${enabled ? '启用' : '禁用'}: ${name}`)
  return ok
}
