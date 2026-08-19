#!/usr/bin/env node
/**
 * 手动工具：立即强制还原 safemode profile（force 语义——不管 profile 有没有、
 * 改没改过，一律写回白名单模板）。
 *
 * 本包**没有构建脚本**（无 postinstall），所以 pnpm 永远不会拦截它，
 * `dsh plugin add` 一次成功。日常保障由插件行（lib/index.js）承担：
 * DSH 每次启动时强制还原 + 运行期持续守护。
 *
 * 手动运行的场景：
 *   - 不想重启 DSH，想立刻拉回 safemode profile；
 *   - 测试/排障时确认当前状态。
 */
import { ensureSafeModeProfile } from '../lib/ensure.js';

try {
  const result = ensureSafeModeProfile({ force: true });
  if (result.created) {
    console.log(`[dsh-safemode-profile] created safemode profile at ${result.path}`);
    console.log(`  whitelist bundles: ${result.bundles.join(', ')}`);
    console.log('  boot it with: dsh --profile safemode');
  } else if (result.overwritten) {
    const drift = result.drift.map((d) => d.field).join(', ') || 'unknown';
    console.log(`[dsh-safemode-profile] restored safemode profile at ${result.path} (drift: ${drift})`);
  } else {
    console.log(
      `[dsh-safemode-profile] safemode profile already clean at ${result.path}; nothing to do`,
    );
  }
  process.exitCode = 0;
} catch (error) {
  console.error(`[dsh-safemode-profile] failed: ${String(error)}`);
  process.exitCode = 1;
}
