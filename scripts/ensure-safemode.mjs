#!/usr/bin/env node
/**
 * postinstall 入口：安装时立即写入 safemode profile（幂等）。
 * 注意：pnpm 10+ 默认忽略依赖的构建脚本（需 pnpm approve-builds 批准），
 * 未批准时此脚本不会运行——此时由插件行（lib/index.js）在 DSH 下次启动时兜底。
 */
import { ensureSafeModeProfile } from '../lib/ensure.js';

try {
  const result = ensureSafeModeProfile();
  if (result.created) {
    console.log(`[dsh-safemode-profile] created safemode profile at ${result.path}`);
    console.log(`  whitelist bundles: ${result.bundles.join(', ')}`);
    console.log('  boot it with: dsh --profile safemode');
  } else {
    console.log(
      `[dsh-safemode-profile] safemode profile already exists at ${result.path}; nothing to do`,
    );
  }
  process.exitCode = 0;
} catch (error) {
  console.error(`[dsh-safemode-profile] failed: ${String(error)}`);
  process.exitCode = 1;
}
