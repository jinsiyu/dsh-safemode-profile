# dsh-safemode-profile

**唯一职责：让 `dsh --profile safemode` 永远是干净的——启动即强制还原，
运行期持续守护，任何时刻都只含白名单核心 bundle。**

```
dsh --profile safemode        # 零第三方插件启动（建议: dsh --profile safemode --port 3081）
```

## 它做什么（两个阶段）

### 1. 启动时：强制还原（不管 profile 有没有、改没改过）

DSH 每次启动加载本插件行时，无条件把 `$DSH_HOME/profiles/safemode/`
写回白名单模板：

| 文件 | 强制内容 |
|---|---|
| `package.json` | `dsh.profile.bundles` = 白名单（默认 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`），`dependencies` 清空 |
| `cordis.patch.yml` | 空用户 patch 层（`[]` 模板） |
| `pnpm-workspace.yaml` | 与官方 profile 相同的 pnpm 设置 |

与模板一致时不动（避免自触发死循环），不一致一律重写。

### 2. 运行期：持续守护（平时检查）

插件行存活期间双通道监控 profile 是否被改动：

- **fs.watch 实时监听**：`package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml`
  任何变更 → 防抖 300ms → 立即还原；
- **30s 轮询兜底**：`detectDrift()` 全量比对（覆盖 watch 不可靠的挂载场景、
  文件被外部整体替换的场景）。

发现漂移（bundle 被加/删、patch 层被写入内容、dependencies 被加东西）→
自动还原，并记录 warn 日志：`safemode profile was modified (...); restored to whitelist template`。

## 触发机制（无构建脚本，一次装好）

**本包没有 postinstall / 任何构建脚本**——pnpm 永远不会拦截它，
`dsh plugin add` 一次成功、退出码 0、reconcile 正常执行，不需要
`approve-builds` / `allowBuilds` 配置。

全部工作由**插件行**（`lib/index.js` → `lib/guard.js`）承担：
DSH 每次启动加载本插件时强制还原一次，并进入常驻守护。

另附手动工具（可选）：`node scripts/ensure-safemode.mjs` 立即强制还原
一次（不想重启 DSH 或排障时用）。

## 安装

```powershell
# 在插件目录打包
npm pack                          # → dsh-safemode-profile-0.3.0.tgz

# 安装进目标 profile（例如 web）
dsh plugin --profile web add .\dsh-safemode-profile-0.3.0.tgz
```

装完重启 DSH，插件行生效后 safemode 进入"强制还原 + 常驻守护"状态。

## 自定义白名单

白名单是**唯一的**定制入口，请通过环境变量设置（**不要**手动改 safemode
profile 文件——任何改动都会被守护逻辑还原）：

```powershell
# 只想留纯 CLI（无 GUI）
$env:DSH_SAFEMODE_BUNDLES = "@deepseek-ai/dsh-base"
# 想保留撤销工具（需先把它装进 safemode profile；注意：手动加的白名单外
# bundle 会被还原掉）
$env:DSH_SAFEMODE_BUNDLES = "@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app,dsh-undo-savepoint"
```

`dsh` 启动时继承该环境变量即生效（本插件读取 `process.env`，守护与还原
都用同一个白名单）。

## 注意

- **端口**：safemode 也带 webServer，默认 3080。与 web profile 同时跑会
  冲突（`EADDRINUSE` 导致启动失败），用 `--port` 错开：
  `dsh --profile safemode --port 3081`。
- **会话/凭据不隔离**：sessions、settings.yaml、.env 是 home 级共享，
  safemode 隔离的只有插件。
- **home patch 串层**：`~/.dsh/cordis.patch.yml` 对每个 profile 生效，
  别往里面挂插件（守护逻辑只盯 safemode 自己的目录，管不到 home patch）。
- **cordis.yml 勿手改**：DSH 每次启动自动重写，要改改 cordis.patch.yml
  ——但 safemode 的 patch 层会被本插件还原为空，定制请走白名单环境变量。
