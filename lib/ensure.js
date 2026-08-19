/**
 * dsh-safemode-profile — 核心逻辑（平台无关、零依赖）。
 *
 * 唯一职责：保证 `$DSH_HOME/profiles/safemode/` 永远是白名单模板——
 *   - `ensureSafeModeProfile({ force: true })`：**无条件还原**。不管 profile
 *     是否存在、是否被改过，一律重写为白名单模板（package.json 的
 *     dsh.profile.bundles = 白名单，cordis.patch.yml = 空层）。
 *   - `detectDrift()`：检查 profile 是否偏离模板（bundle 列表被加/删、
 *     patch 层被写入内容），供守护逻辑判断。
 *   - 白名单默认 @deepseek-ai/dsh-base + @deepseek-ai/dsh-web-app，
 *     可用 DSH_SAFEMODE_BUNDLES（逗号分隔）覆盖。
 *
 * 写入策略：
 *   - force 模式先读现状，与目标模板比较；已一致则什么都不写（避免
 *     fs.watch 自触发死循环），不一致才重写。
 *   - 只管理三个文件：package.json / cordis.patch.yml / pnpm-workspace.yaml。
 *     其他文件（如启动时自动生成的 cordis.yml）不动。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 安全模式 profile 名（固定，与文档/命令保持一致）。 */
export const SAFEMODE_PROFILE_NAME = 'safemode';

/** 默认白名单：DSH 安装自带的核心 bundle，解析不依赖 profile 的 node_modules。 */
const DEFAULT_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];

/** 与 dsh-app-boot 的 PROFILE_PATCH_TEMPLATE 完全一致的用户 patch 层模板。 */
const PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`;

/** 与 dsh-app-boot 的 PROFILE_PNPM_WORKSPACE 完全一致的 pnpm 设置。 */
const PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`;

/** 目标 manifest 的内容（白名单 bundle）。 */
function targetManifest(bundles) {
  return {
    name: `dsh-profile-${SAFEMODE_PROFILE_NAME}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  };
}

/**
 * 解析 DSH 主目录：$DSH_HOME 优先（空白视为未设置），否则 ~/.dsh。
 * 与 @deepseek-ai/dsh-home-paths 的 resolveDshHome 语义一致。
 */
export function resolveDshHome(env = process.env) {
  const fromEnv = env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  return join(homedir(), '.dsh');
}

/** 读取白名单：默认核心 bundle，可用 DSH_SAFEMODE_BUNDLES 覆盖。 */
export function safemodeBundles(env = process.env) {
  const raw = env.DSH_SAFEMODE_BUNDLES;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [...DEFAULT_BUNDLES];
}

/** safemode profile 的三个受管文件路径。 */
export function safemodePaths({ home } = {}) {
  const dshHome = home ?? resolveDshHome();
  const dir = join(dshHome, 'profiles', SAFEMODE_PROFILE_NAME);
  return {
    dshHome,
    dir,
    manifest: join(dir, 'package.json'),
    patch: join(dir, 'cordis.patch.yml'),
    workspace: join(dir, 'pnpm-workspace.yaml'),
  };
}

/**
 * 读取当前 profile 的实际内容（容错：文件缺失/解析失败返回 null 字段）。
 */
function readCurrent(paths) {
  const current = { manifest: null, patch: null };
  try {
    if (existsSync(paths.manifest)) {
      current.manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'));
    }
  } catch { current.manifest = null; }
  try {
    if (existsSync(paths.patch)) {
      current.patch = readFileSync(paths.patch, 'utf8');
    }
  } catch { current.patch = null; }
  return current;
}

/** 数组逐项相等。 */
function sameBundles(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((v, i) => v === right[i]);
}

/**
 * 检测 safemode profile 是否偏离白名单模板。
 * @returns 偏离描述数组（每一项 { field, actual, expected }），无偏离返回 []。
 */
export function detectDrift({ home } = {}) {
  const paths = safemodePaths({ home });
  const expected = safemodeBundles();
  const current = readCurrent(paths);
  const drift = [];

  if (current.manifest === null) {
    drift.push({ field: 'package.json', actual: 'missing', expected: 'white-list manifest' });
  } else {
    const actualBundles = current.manifest?.dsh?.profile?.bundles;
    if (!sameBundles(actualBundles, expected)) {
      drift.push({ field: 'dsh.profile.bundles', actual: actualBundles ?? null, expected });
    }
    const deps = current.manifest?.dependencies;
    if (deps && Object.keys(deps).length > 0) {
      drift.push({ field: 'dependencies', actual: Object.keys(deps), expected: [] });
    }
  }

  if (current.patch === null) {
    drift.push({ field: 'cordis.patch.yml', actual: 'missing', expected: 'empty patch layer' });
  } else if (current.patch !== PATCH_TEMPLATE) {
    drift.push({ field: 'cordis.patch.yml', actual: 'modified', expected: 'empty patch layer' });
  }

  return drift;
}

/**
 * 确保 safemode profile 是白名单模板。
 * @param options - { home?, force? }：force=false 且已存在时跳过（旧语义）；
 *   force=true 时**无条件还原**：与模板不一致就重写，一致则不动。
 * @returns { ok, created, unchanged, overwritten, drift, path, dshHome, bundles }
 */
export function ensureSafeModeProfile({ home, force = false } = {}) {
  const paths = safemodePaths({ home });
  const dshHome = paths.dshHome;
  const dir = paths.dir;
  const bundles = safemodeBundles();
  const existed = existsSync(paths.manifest);

  if (existed && !force) {
    return { ok: true, created: false, unchanged: true, overwritten: false, drift: [], path: dir, dshHome };
  }

  const drift = existed && force ? detectDrift({ home }) : [];
  if (existed && force && drift.length === 0) {
    return { ok: true, created: false, unchanged: true, overwritten: false, drift, path: dir, dshHome };
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(paths.manifest, `${JSON.stringify(targetManifest(bundles), null, 2)}\n`, 'utf8');
  writeFileSync(paths.patch, PATCH_TEMPLATE, 'utf8');
  writeFileSync(paths.workspace, PNPM_WORKSPACE, 'utf8');

  return {
    ok: true,
    created: !existed,
    unchanged: false,
    overwritten: existed,
    drift,
    path: dir,
    dshHome,
    bundles,
  };
}
