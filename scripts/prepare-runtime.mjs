/**
 * 准备 dsh-desktop 运行时资源（runtime/ 目录）：
 *   1. 下载 Node.js LTS（win-x64）→ runtime/node
 *   2. 下载 pnpm standalone（独立可执行，无需 npm）→ runtime/pnpm/pnpm.exe
 *   3. 用 pnpm 安装 @deepseek-ai/dsh（锁定版本）→ runtime/dsh
 *
 * 用法：node scripts/prepare-runtime.mjs [--skip-node]
 * 产物会被 electron-builder 作为 extraResources 打包进 resources/runtime/。
 */
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync, readdirSync, createWriteStream, lstatSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = join(ROOT, 'runtime')

// dsh 0.1.x 需要 node:zlib 的 zstd API（Node 22.18+ 引入），使用 22 LTS 最新
const NODE_VERSION = 'v22.20.0'
const NODE_ZIP = `node-${NODE_VERSION}-win-x64.zip`
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP}`
const DSH_VERSION = process.env.DSH_VERSION ?? '0.1.0-rc.7'
const DSH_PACKAGE = `@deepseek-ai/dsh@${DSH_VERSION}`
const PNPM_VERSION = process.env.PNPM_VERSION ?? '9.15.5'

/** pnpm 源码包（npm registry 下载，bin/pnpm.cjs 由 node 直接执行，不依赖 npm 命令） */
const PNPM_TGZ = `https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VERSION}.tgz`

/** pnpm store（项目内，规避沙箱对系统目录的限制，且打包时剔除） */
const PNPM_STORE = join(RUNTIME, '.pnpm-store')

const log = (msg) => console.log(`[prepare-runtime] ${msg}`)

async function download(url, dest) {
  if (existsSync(dest)) {
    log(`已存在，跳过下载: ${dest}`)
    return
  }
  log(`下载 ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`)
  mkdirSync(dirname(dest), { recursive: true })
  await pipeline(res.body, createWriteStream(dest))
  log(`完成: ${dest}`)
}

function extractZip(zipPath, outDir) {
  if (existsSync(outDir)) return
  log(`解压 ${zipPath} → ${outDir}`)
  mkdirSync(outDir, { recursive: true })
  const ps = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir}' -Force`],
    { stdio: 'inherit' }
  )
  if (ps.status !== 0) throw new Error('解压失败: ' + zipPath)
}

/** 在 runtime/node 下定位 node.exe（可能嵌套一层版本目录） */
function nodeBin() {
  const candidates = [join(RUNTIME, 'node', 'node.exe')]
  if (existsSync(join(RUNTIME, 'node'))) {
    for (const name of readdirSync(join(RUNTIME, 'node'))) {
      candidates.push(join(RUNTIME, 'node', name, 'node.exe'))
    }
  }
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

/** pnpm.cjs 路径（node 直接执行；需保留完整 package 结构） */
function pnpmCli() {
  return join(RUNTIME, 'pnpm', 'package', 'bin', 'pnpm.cjs')
}

/** 用 node 执行 pnpm */
function runPnpm(node, args, opts = {}) {
  return run(node, [pnpmCli(), ...args], opts)
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    stdio: opts.stdio ?? 'inherit',
    env: { ...process.env, NODE_OPTIONS: '' },
    ...opts
  })
}

async function installNode() {
  const zipPath = join(RUNTIME, NODE_ZIP)
  await download(NODE_URL, zipPath)
  extractZip(zipPath, join(RUNTIME, 'node'))
  const bin = nodeBin()
  if (!bin) throw new Error('Node 安装失败：未找到 node.exe')
  const v = run(bin, ['--version'], { stdio: 'pipe' }).stdout.toString().trim()
  log(`Node 就绪: ${bin} (${v})`)
  if (existsSync(zipPath)) rmSync(zipPath, { force: true })
}

/** 下载 pnpm 源码包并解压出 pnpm.cjs（不依赖 npm 命令） */
async function installPnpm(node) {
  const cli = pnpmCli()
  if (existsSync(cli)) {
    const v = runPnpm(node, ['--version'], { stdio: 'pipe' })
    log(`pnpm 已就绪: v${v.stdout.toString().trim()}，跳过`)
    return
  }
  const tgzPath = join(RUNTIME, 'pnpm', 'pnpm.tgz')
  await download(PNPM_TGZ, tgzPath)
  const extractDir = join(RUNTIME, 'pnpm', 'src')
  mkdirSync(extractDir, { recursive: true })
  log(`解压 pnpm → ${extractDir}`)
  const { execFileSync } = await import('node:child_process')
  // Git Bash 的 GNU tar 会把 "E:/..." 误判为远程主机；改用 Windows 自带 bsdtar
  const bsdtar = process.platform === 'win32' && existsSync('C:\\Windows\\System32\\tar.exe')
    ? 'C:\\Windows\\System32\\tar.exe'
    : 'tar'
  execFileSync(bsdtar, ['-xzf', tgzPath, '-C', extractDir], { stdio: 'inherit' })
  const srcPackage = join(extractDir, 'package')
  const srcCli = join(srcPackage, 'bin', 'pnpm.cjs')
  if (!existsSync(srcCli)) throw new Error('pnpm 包结构异常：未找到 bin/pnpm.cjs')
  const { cpSync } = await import('node:fs')
  const destPackage = join(RUNTIME, 'pnpm', 'package')
  if (existsSync(destPackage)) rmSync(destPackage, { recursive: true, force: true })
  cpSync(srcPackage, destPackage, { recursive: true })
  // 清理临时目录与压缩包（沙箱可能拦截删除，失败仅提示）
  for (const p of [extractDir, tgzPath]) {
    try {
      rmSync(p, { recursive: true, force: true })
    } catch {
      log(`提示: 无法清理 ${p}（忽略）`)
    }
  }
  const v = runPnpm(node, ['--version'], { stdio: 'pipe' })
  if (v.status !== 0) throw new Error('pnpm 不可执行')
  log(`pnpm 就绪: ${cli} (${v.stdout.toString().trim()})`)
}

/** 用 pnpm 安装 dsh 依赖闭包（node-linker=hoisted：扁平真实目录，无绝对路径符号链接，保证打包后可复制） */
function installDsh(node) {
  const target = join(RUNTIME, 'dsh')
  const marker = join(target, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  if (existsSync(marker)) {
    const meta = JSON.parse(readFileSync(marker, 'utf8'))
    log(`dsh 已安装（v${meta.version}），跳过`)
    return
  }
  mkdirSync(target, { recursive: true })
  log(`pnpm 安装 ${DSH_PACKAGE} → ${target}（store: ${PNPM_STORE}，node-linker=hoisted）`)
  const r = runPnpm(node, [
    'add', '--dir', target, '--store-dir', PNPM_STORE, '--lockfile=false',
    '--config.node-linker=hoisted', DSH_PACKAGE
  ])
  if (r.status !== 0) throw new Error('dsh 安装失败（native 模块可能需要编译工具链，见上方输出）')
  // hoisted 模式下顶层包必须是真实目录而非符号链接（否则打包复制后链接失效）
  const topPkg = join(target, 'node_modules', '@deepseek-ai', 'dsh')
  if (lstatSync(topPkg).isSymbolicLink()) throw new Error('dsh 安装后仍是符号链接（node-linker=hoisted 未生效）')
  const meta = JSON.parse(readFileSync(marker, 'utf8'))
  log(`dsh 就绪: v${meta.version}`)
}

function writeMeta(node) {
  const v = node ? run(node, ['--version'], { stdio: 'pipe' }).stdout.toString().trim() : null
  const pv = runPnpm(node, ['--version'], { stdio: 'pipe' }).stdout.toString().trim()
  const meta = {
    node: v,
    dsh: DSH_VERSION,
    pnpm: pv,
    platform: process.platform,
    arch: process.arch,
    preparedAt: new Date().toISOString()
  }
  writeFileSync(join(RUNTIME, 'runtime-meta.json'), JSON.stringify(meta, null, 2))
  log('runtime-meta.json 已写入')
}

async function main() {
  const skipNode = process.argv.includes('--skip-node')
  mkdirSync(RUNTIME, { recursive: true })
  if (!skipNode) await installNode()
  const node = nodeBin()
  if (!node) throw new Error('未找到 Node，请先执行 installNode（或使用 --skip-node 复用已有 Node）')
  await installPnpm(node)
  installDsh(node)
  writeMeta(node)
  log('完成。产物目录: ' + RUNTIME)
}

main().catch((e) => {
  console.error(`[prepare-runtime] 失败: ${e.message}`)
  process.exit(1)
})
