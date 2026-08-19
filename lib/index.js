/**
 * dsh-safemode-profile — Cordis 插件行。
 *
 * apply 时调用 ensureSafeModeProfile()（幂等）：safemode profile 不存在则
 * 创建，已存在则跳过。这是 postinstall 之外的第二道保险——postinstall 在
 * pnpm 10+ 默认被忽略（ERR_PNPM_IGNORED_BUILDS，需 approve-builds），
 * 插件行保证无论安装方式如何，DSH 下一次启动后 safemode profile 一定就绪。
 *
 * 本插件无其他运行时行为：没有服务、没有事件、没有工具、没有客户端 UI。
 */
import { ensureSafeModeProfile } from './ensure.js';

export const name = 'dsh-safemode-profile';

function log(ctx, level, message) {
  if (ctx?.logger?.[level]) {
    ctx.logger[level](message);
  } else if (typeof console !== 'undefined') {
    (console[level] ?? console.log)(message);
  }
}

export function apply(ctx) {
  try {
    const result = ensureSafeModeProfile();
    if (result.created) {
      log(
        ctx,
        'info',
        `[dsh-safemode-profile] created safemode profile at ${result.path} (whitelist: ${result.bundles.join(', ')})`,
      );
    } else {
      log(
        ctx,
        'debug',
        `[dsh-safemode-profile] safemode profile already exists at ${result.path}; nothing to do`,
      );
    }
  } catch (error) {
    // 安全模式写入失败绝不能拖垮 DSH 启动。
    log(ctx, 'warn', `[dsh-safemode-profile] failed to ensure safemode profile: ${String(error)}`);
  }
}
