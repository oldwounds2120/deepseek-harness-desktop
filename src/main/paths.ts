import { app } from 'electron'
import { join } from 'node:path'

/**
 * 固定用户数据目录（%APPDATA%/dsh-desktop）。
 * 必须在任何 app.getPath('userData') 读取之前执行：
 * 否则 productName / package.name 变化会导致用户数据"丢失"
 * （模型配置、runtime-install、日志等会跟着目录名漂移）。
 * 作为副作用模块，必须放在 index.ts 的第一个 import。
 */
app.setPath('userData', join(app.getPath('appData'), 'dsh-desktop'))

export {}
