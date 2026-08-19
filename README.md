# dsh-safemode-profile

> [English](README.en.md)

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

前置：已安装 DSH（`@deepseek-ai/dsh`）与 Node.js（≥18）。

**方式 A（推荐，npm 一条命令）** — 本插件已发布到 npm 并声明 `dsh.bundle` manifest，直接用官方插件命令安装：

```powershell
dsh plugin --profile web add dsh-safemode-profile
```

**方式 B（GitHub 直装）** — 从源码仓库直接安装（显式指定默认分支 `main`，npm 与 pnpm 均兼容）：

```powershell
dsh plugin --profile web add github:jinsiyu/dsh-safemode-profile#main
```

**方式 C（本地打包/未发布）** — 本地构建 tgz 安装：

```powershell
# 在插件目录打包
npm pack                          # → dsh-safemode-profile-0.3.5.tgz

# 安装进目标 profile（例如 web）
dsh plugin --profile web add .\dsh-safemode-profile-0.3.5.tgz
```

装完重启 DSH，插件行生效后 safemode 进入"强制还原 + 常驻守护"状态。
启动时插件会打印一行简短横幅（守护状态、启动命令、白名单、仓库链接）。

## 自定义白名单

白名单是**唯一的**定制入口，请通过环境变量设置（**不要**手动改 safemode
profile 文件——任何改动都会被守护逻辑还原）：

```powershell
# 只想留纯 CLI（无 GUI）
$env:DSH_SAFEMODE_BUNDLES = "@deepseek-ai/dsh-base"
```

`dsh` 启动时继承该环境变量即生效（本插件读取 `process.env`，守护与还原
都用同一个白名单）。

## 加固建议：把 safemode 的三个受管文件设为只读

**推荐**将 `~/.dsh/profiles/safemode/` 下三个受管文件设为只读，从文件
系统层面阻止 `dsh plugin --profile safemode add <包>` 向 safemode 安装
任何插件（pnpm 写这些文件失败 → 安装报错、插件进不去；DSH 启动不受
影响，它只读这些文件、只写 cordis.yml）：

- `package.json`（dependencies + bundles，安装的必经关卡）
- `cordis.patch.yml`（用户 patch 层）
- `pnpm-workspace.yaml`（pnpm 管理文件）

> ⚠️ **不要锁整个目录**：DSH 每次启动都会**重写** `cordis.yml`
> （`prepareProfile` 无条件 writeFileSync），目录或其内文件被锁成只读
> 会导致 safemode 启动失败（实测 exit 1）。Windows 的
> `attrib +R <目录> /S` 会递归锁住所有文件（含 cordis.yml），**不要用**。

```powershell
# Windows：只锁三个文件（不要 /S 递归）
attrib +R "$env:USERPROFILE\.dsh\profiles\safemode\package.json" `
         "$env:USERPROFILE\.dsh\profiles\safemode\cordis.patch.yml" `
         "$env:USERPROFILE\.dsh\profiles\safemode\pnpm-workspace.yaml"

# POSIX：三个文件设为 444（目录仍需可读可执行，不能被锁）
chmod 444 ~/.dsh/profiles/safemode/package.json \
          ~/.dsh/profiles/safemode/cordis.patch.yml \
          ~/.dsh/profiles/safemode/pnpm-workspace.yaml
```

解除锁定：

```powershell
attrib -R "$env:USERPROFILE\.dsh\profiles\safemode\package.json" `
         "$env:USERPROFILE\.dsh\profiles\safemode\cordis.patch.yml" `
         "$env:USERPROFILE\.dsh\profiles\safemode\pnpm-workspace.yaml"  # Windows
chmod 644 ~/.dsh/profiles/safemode/package.json \
          ~/.dsh/profiles/safemode/cordis.patch.yml \
          ~/.dsh/profiles/safemode/pnpm-workspace.yaml                 # POSIX
```

注意：
- **先让插件创建/还原 profile，再锁定**——锁定前内容必须与白名单模板
  一致（守护启动时检测到 drift 才写文件；一致则完全不碰，锁定与之共存
  无冲突）。若锁定后发现 drift，守护还原会因只读失败并记 warn——这正是
  锁定的预期行为：锁住 = 不该有漂移。
- 锁定后要改白名单需先解锁再操作；本插件的守护逻辑不受影响（它读
  package.json 检测漂移，一致则不写）。

### 更深的防护：ACL（Windows）与 chattr +i（Linux）

上面 `attrib +R` / `chmod 444` 属于"**基础只读**"，两个平台语义不同，且
都不能阻止**删除**文件（删除取决于父目录权限，root 更是无视一切权限位）。
以下两种是"**强锁**"，按需选择：

#### Windows：ACL 拒绝（icacls）——可精确到"写"与"删"

```powershell
# 拒绝当前用户对三个文件的写入（W=写数据）
icacls "$env:USERPROFILE\.dsh\profiles\safemode\package.json" /deny "$env:USERNAME:(W)"
icacls "$env:USERPROFILE\.dsh\profiles\safemode\cordis.patch.yml" /deny "$env:USERNAME:(W)"
icacls "$env:USERPROFILE\.dsh\profiles\safemode\pnpm-workspace.yaml" /deny "$env:USERNAME:(W)"

# 更进一步：连删除也拒绝（DE=删除；WD=写数据/创建文件）
icacls "...\package.json" /deny "$env:USERNAME:(WD,DE)"
```

解除（删除该用户的 deny 条目）：

```powershell
icacls "...\package.json" /remove:d "$env:USERNAME"
```

要点：
- `(W)` 挡内容修改，`(DE)` 挡删除，`(WD)` 挡写+创建——比 attrib 更精确，
  可以只挡写入、保留"管理员能删"的余地；
- **仍挡不住管理员**：Administrators / SYSTEM 默认有完全控制（F），
  管理员可以夺回所有权或清除 deny。要连管理员一起挡，需对
  `BUILTIN\Administrators` 也加 deny，但管理员仍能通过"取得所有权"绕开；
- icacls 需要对该文件有修改 ACL 的权限（文件所有者默认有）。

#### Linux：immutable 属性（chattr +i）——root 也动不了

```bash
# 加锁：文件不可修改、不可删除、不可改名（包括 root）
sudo chattr +i ~/.dsh/profiles/safemode/package.json \
              ~/.dsh/profiles/safemode/cordis.patch.yml \
              ~/.dsh/profiles/safemode/pnpm-workspace.yaml

# 查看
lsattr ~/.dsh/profiles/safemode/package.json     # 输出含 i 即已锁定

# 解锁
sudo chattr -i ~/.dsh/profiles/safemode/package.json \
              ~/.dsh/profiles/safemode/cordis.patch.yml \
              ~/.dsh/profiles/safemode/pnpm-workspace.yaml
```

要点：
- `+i`（immutable）是最强锁：**任何人（含 root）都不能改、删、改名**，
  必须先 `-i` 才能操作——比 chmod/ACL 都硬；
- 需要 `sudo`（root 权限）执行，且文件系统要支持该属性（ext4/xfs 支持；
  某些网络/容器文件系统不支持）；
- **对 safemode 有副作用**：文件被删后守护插件本可自动重建
  （detectDrift 发现 missing → force 还原），`+i` 会连守护的重建也挡住；
  升级插件、改白名单也都要先 `-i`。所以建议只在"完全不想被任何人动"
  的场景使用，日常用基础只读（attrib/chmod 444）即可。

#### 三级防护对比

| 方案 | 挡内容修改 | 挡删除 | 挡 root | 需要权限 | 对守护自愈的影响 |
|---|---|---|---|---|---|
| `attrib +R` / `chmod 444`（基础只读） | ✅ 普通用户 | ❌ | ❌ | 无 | 无（守护一致则不写） |
| icacls deny（ACL） | ✅ | ✅（加 DE） | ❌（管理员可绕） | 文件所有者 | 无 |
| `chattr +i`（immutable） | ✅ | ✅ | ✅ | sudo | ⚠️ 挡住守护重建，需先 `-i` |

建议：**日常用基础只读即可**（pnpm 以普通用户运行，444 已完全拦截安装）；
要防误删再加 ACL `(DE)`；只有"这台机器上的任何账号（含 root）都不能动
safemode 配置"才算刚需 chattr +i。

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
