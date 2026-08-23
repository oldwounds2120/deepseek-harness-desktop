import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dshService } from './dsh/service'
import { modelConfigured } from './dsh/config'
import type { AppSettings } from '../shared/ipc'

interface ShellSettings {
  minimizeToTray: boolean
  launchAtLogin: boolean
}

const DEFAULTS: ShellSettings = {
  minimizeToTray: true,
  launchAtLogin: false
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'shell-settings.json')
}

export function readShellSettings(): ShellSettings {
  try {
    if (!existsSync(settingsPath())) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<ShellSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeShellSettings(patch: Partial<ShellSettings>): ShellSettings {
  const next = { ...readShellSettings(), ...patch }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/** 供 IPC settings:get 返回给渲染层的完整设置快照 */
export async function getAppSettings(): Promise<AppSettings> {
  const shell = readShellSettings()
  return {
    launchAtLogin: shell.launchAtLogin,
    minimizeToTray: shell.minimizeToTray,
    dataDir: app.getPath('userData'),
    dshVersion: dshService.status().version,
    modelConfigured: modelConfigured()
  }
}
