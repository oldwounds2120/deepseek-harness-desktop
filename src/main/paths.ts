import { app } from 'electron'
import { join } from 'node:path'

/**
 * 固定用户数据目录（%APPDATA%/DeepSeek Harness Desktop）。
 * 必须在任何 app.getPath('userData') 读取之前执行：
 * 否则 dev（package.json name）与打包（productName）会各自生成不同
 * 的数据目录，导致配置/runtime 漂移。显式固定后两端一致。
 * 作为副作用模块，必须放在 index.ts 的第一个 import。
 */
app.setPath('userData', join(app.getPath('appData'), 'DeepSeek Harness Desktop'))

export {}
