/**
 * dsh-safemode-profile — 核心逻辑（平台无关、零依赖）。
 *
 * 唯一作用：确保 `$DSH_HOME/profiles/safemode/` 存在，且只含白名单 bundle
 * （默认 @deepseek-ai/dsh-base + @deepseek-ai/dsh-web-app），使
 * `dsh --profile safemode` 能以"零第三方插件"启动。
 *
 * 幂等约定：
 *   - 仅当 profile 的 package.json 不存在时才创建（绝不覆盖已有内容）；
 *   - 已存在 → 直接跳过，不做任何修改；
 *   - 可被多个入口共用：postinstall 脚本（安装时）与插件行 apply（启动时），
 *     两者永远指向同一份实现，行为一致。
 *
 * 覆盖开关（环境变量）：
 *   - DSH_SAFEMODE_BUNDLES：逗号分隔的白名单包名（默认
 *     @deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

/**
 * 确保 safemode profile 存在。幂等：package.json 已存在时完全跳过。
 * @param options - { home?: string } 可显式指定 DSH 主目录（测试用）。
 * @returns { ok, created, skipped, path, dshHome, bundles }
 */
export function ensureSafeModeProfile({ home } = {}) {
  const dshHome = home ?? resolveDshHome();
  const dir = join(dshHome, 'profiles', SAFEMODE_PROFILE_NAME);
  const manifestPath = join(dir, 'package.json');

  if (existsSync(manifestPath)) {
    return { ok: true, created: false, skipped: true, path: dir, dshHome };
  }

  const bundles = safemodeBundles();
  mkdirSync(dir, { recursive: true });

  const manifest = {
    name: `dsh-profile-${SAFEMODE_PROFILE_NAME}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'cordis.patch.yml'), PATCH_TEMPLATE, 'utf8');
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), PNPM_WORKSPACE, 'utf8');

  return { ok: true, created: true, skipped: false, path: dir, dshHome, bundles };
}
