#!/usr/bin/env node
/**
 * postinstall 入口：安装时强制写入 safemode profile（force 还原语义，
 * 与插件行启动时的行为一致——不管 profile 有没有、改没改过，一律写回
 * 白名单模板）。
 *
 * 注意：pnpm 10+ 默认忽略依赖的构建脚本（需 pnpm approve-builds 批准），
 * 未批准时此脚本不会运行——此时由插件行（lib/index.js）在 DSH 启动时兜底。
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
