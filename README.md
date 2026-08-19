# dsh-safemode-profile

**唯一作用：在安装时写入安全的 profile。** 安装后自动确保
`$DSH_HOME/profiles/safemode/` 存在且只含白名单核心 bundle，之后不再做任何事。

```
dsh --profile safemode        # 零第三方插件启动
```

## 它写什么

`profiles/safemode/` 下三份文件（与 DSH `initProfile` 输出完全一致的布局）：

| 文件 | 内容 |
|---|---|
| `package.json` | `dsh.profile.bundles` 白名单：`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`（默认） |
| `cordis.patch.yml` | 空用户 patch 层（`[]` 模板） |
| `pnpm-workspace.yaml` | 与官方 profile 相同的 pnpm 设置 |

关键性质：

- **白名单即 `dsh.profile.bundles`**：没列出的插件（`dsh-auto-open-web` 及未来
  安装的所有第三方插件）在 safemode profile 里根本不存在，结构性排除，无需维护名单。
- **不需要 pnpm / node_modules**：核心 bundle 从 dsh 安装目录解析
  （`resolveBundleDir` 安装锚点优先），safemode profile 是一份纯配置文件。
- **绝不覆盖**：`package.json` 已存在 → 完全跳过。用户对 safemode 的定制永远优先。

## 安装

```powershell
# 在插件目录打包
npm pack                          # → dsh-safemode-profile-0.1.0.tgz

# 安装进目标 profile（例如 web）
dsh plugin --profile web add .\dsh-safemode-profile-0.1.0.tgz
```

## 触发机制（双保险）

1. **postinstall**（安装瞬间）：`dsh plugin add` 底层是 pnpm add，若 pnpm 允许
   依赖构建脚本，安装完成即写入。
2. **插件行**（启动兜底）：`cordis.patch.yml` 插入一行
   `safemode-profile-writer`，DSH 下一次启动时 apply 幂等确保。**pnpm 10+ 默认
   忽略依赖构建脚本**（`ERR_PNPM_IGNORED_BUILDS`，需 `pnpm approve-builds`），
   所以插件行才是真正可靠的机制——postinstall 只是锦上添花。

两个入口共用同一份 `lib/ensure.js`，行为完全一致：存在即跳过，绝不覆盖。

## 自定义白名单

```powershell
# 只想留纯 CLI（无 GUI）
$env:DSH_SAFEMODE_BUNDLES = "@deepseek-ai/dsh-base"
# 想保留撤销工具（需先把它装进 safemode profile）
dsh plugin --profile safemode add dsh-undo-savepoint
```

## 与 undo_safe_mode 的区别

- `undo_safe_mode on`：改写**当前 profile** 的 `cordis.patch.yml` 为最小 patch，
  只处理 patch 层、不裁剪 bundle（对你的 bundle 模式 profile 无效）。
- 本插件：新建**独立 profile**，`dsh.profile.bundles` 本身即白名单，任何第三方
  插件都无法进入，结构性隔离。
