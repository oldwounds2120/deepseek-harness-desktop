# DeepSeek Harness Desktop

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的 Electron 桌面封装：**Electron 做壳，dsh 保持官方形态** —— 独立子进程运行官方 CLI，直接复用官方 Web UI 与插件机制，无需改造 dsh 本身。

> dsh 处于开发者预览阶段，本项目随 dsh 版本锁定演进。

## 特性

- **官方 Web UI 全屏直载**：应用打开即进入 dsh Web 界面，无多余壳层
- **独立子进程托管**：dsh 以独立进程运行（native 模块按 Node ABI 直用，免 electron-rebuild），崩溃自动重启（连续 5 次失败停止并提示）
- **数据隔离**：`DSH_HOME` 指向应用数据目录（`%APPDATA%\DeepSeek Harness Desktop\dsh-home`），卸载干净、不污染 `~/.dsh`
- **端口自动分配**：`--port 0` 由系统分配端口，自动解析服务地址
- **托盘常驻**：关闭窗口最小化到托盘，dsh 服务后台继续运行；托盘可启停/重启服务、真正退出
- **插件机制**：完整复用 dsh 官方插件体系（`dsh.bundle` + Cordis 层栈），安装即热重载；随包内置 `install-plugin.cmd` 管理脚本（add/remove/update/list）
- **开机自启**、**日志查看**、**自动更新**框架

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 22.18 | dsh 依赖 `node:zlib` 的 zstd API（`createZstdDecompress`） |
| dsh | 0.1.0-rc.7 | 版本锁定，升级走 runtime 替换 |
| pnpm | 9.15.5 | 内置运行时，无需系统安装 |
| OS | Windows x64 | 当前打包目标 |

## 快速开始（开发）

```bash
# 1. 安装项目依赖
npm install

# 2. 准备运行时（下载 Node + dsh + pnpm 到 runtime/，约 5-10 分钟）
npm run prepare:runtime

# 3. 启动开发模式
npm run dev
```

启动后自动拉起 dsh 服务并加载官方 Web UI。

## 打包发布

```bash
npm run build          # 构建 out/
npm run package:win    # NSIS 安装包（含卸载器/快捷方式）
npm run package:win:portable   # 单文件便携版
```

产物位于 `release/`。国内网络打包时若工具下载慢，可配置镜像：

```bash
# Windows cmd
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run package:win
```

## 数据与配置

| 路径 | 说明 |
|---|---|
| `%APPDATA%\DeepSeek Harness Desktop\` | 应用数据根（固定，dev 与打包统一） |
| `%APPDATA%\DeepSeek Harness Desktop\dsh-home\` | `DSH_HOME`：dsh profile、会话、模型配置 |
| `%APPDATA%\DeepSeek Harness Desktop\runtime-install\` | dsh 运行时安装根（打包后从 resources 迁移，可写，供插件安装） |
| `%APPDATA%\DeepSeek Harness Desktop\logs\` | 应用与 dsh 服务日志 |

首次使用：在对话页完成模型配置（填入 DeepSeek API Key）即可开始。

## 插件安装

插件 = 声明 `dsh.bundle.patch` 的 npm 包。安装包内置插件管理脚本 `install-plugin.cmd`（随包分发在应用根目录，源码位于 `scripts/install-plugin.cmd`），自动定位安装位置与数据目录，**任意目录下用完整路径调用即可**，无需手动设置 `DSH_HOME`。

| 命令 | 作用 |
|---|---|
| `install-plugin.cmd add <package>` | 安装插件 |
| `install-plugin.cmd remove <package>` | 卸载插件 |
| `install-plugin.cmd update <package>` | 更新插件 |
| `install-plugin.cmd list` | 查看已安装插件 |

把应用根目录加入 PATH 后可省略完整路径，任意目录直接执行：

```cmd
set PATH=%PATH%;C:\Program Files\DeepSeek Harness Desktop
install-plugin add dshmarket
```

> **注意事项**
> - 安装 / 卸载 / 更新前请先从托盘退出应用；`list` 为只读，可随时执行。
> - 无参数运行脚本会打印完整用法帮助。

**遇 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: <pkg>`**：pnpm 出于供应链安全默认忽略依赖构建脚本（例如原生终端模块 `node-pty`）。编辑 profile 下的 `pnpm-workspace.yaml`，在 `allowBuilds` 中添加放行后重跑安装命令：

```yaml
allowBuilds:
  node-pty: true
```

配置文件位置：`%APPDATA%\DeepSeek Harness Desktop\dsh-home\profiles\web\pnpm-workspace.yaml`

**验证是否装好**：`install-plugin.cmd list`；或打开 `...\dsh-home\profiles\web\package.json`，确认包名出现在 `dsh.profile.bundles`（生效中的层栈）而非仅出现在 `dependencies`。

**插件来源**：GitHub 话题 [`dsh-plugin`](https://github.com/topics/dsh-plugin)、npm 官方包 `@deepseek-ai/dsh-*`；也可先安装 `dshmarket`（可视化插件市场），在应用内浏览社区插件并一键安装。

## 架构速览

```
src/
├── main/                  # 主进程
│   ├── dsh/               #   dsh 服务托管（子进程/崩溃重启/URL 解析）、profile 管理
│   ├── plugins/           #   插件管理（pnpm 直装 + bundles reconcile，与官方等价）
│   ├── paths.ts           #   固定 userData 路径（副作用模块，最先加载）
│   ├── service(→dsh/)     #   见 dsh/service.ts
│   ├── tray.ts            #   托盘与退出流程
│   ├── updater.ts         #   自动更新（electron-updater）
│   └── windows.ts         #   主窗口（直接加载 dsh Web UI）
├── preload/               # 桥接层（gate 页经 window.dshDesktop 查询服务状态）
├── renderer/
│   └── gate.html          # 唯一页面：dsh 未就绪时的 loading/错误/重试
└── shared/                # IPC 契约（通道名 + 类型）

scripts/prepare-runtime.mjs  # 生成 runtime/（Node+dsh+pnpm，hoisted 扁平结构）
scripts/install-plugin.cmd   # 插件管理脚本（%~dp0 定位安装根，随包分发到应用根目录）
runtime/                    # 运行时资源（gitignore，随包分发，启动迁移到 userData）
```

## 常见问题

**Q：打包安装后提示"连续崩溃 N 次停止自动重启"**
A：请查看 `%APPDATA%\DeepSeek Harness Desktop\logs\app.log`。历史版本曾因 pnpm 符号链接在打包复制后失效导致，现已通过 hoisted 安装 + 复制解引用修复；如仍出现请附带日志反馈。

**Q：runtime 目录很大（400MB+）**
A：包含完整 Node 22 与 dsh 依赖闭包，是独立运行时的正常体积；打包时已排除缓存目录。

## 许可证

[MIT](./LICENSE)
