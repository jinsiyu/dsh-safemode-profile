/**
 * dsh-safemode-profile — Cordis 插件行。
 *
 * apply 时启动守护（startGuard）：
 *   1. **强制还原**：不管 safemode profile 有没有、被改成什么样，一律
 *      写回白名单模板（dsh.profile.bundles = 白名单，cordis.patch.yml = 空层）；
 *   2. **持续守护**：fs.watch 实时 + 30s 轮询兜底，发现 profile 被改动
 *      （bundle 被加/删、patch 层被写入）立即还原并记日志。
 *
 * 这是 postinstall 之外的第二道保险——postinstall 在 pnpm 10+ 默认被忽略
 * （ERR_PNPM_IGNORED_BUILDS，需 approve-builds），插件行保证无论安装方式
 * 如何，DSH 启动后 safemode profile 一定干净且持续干净。
 *
 * 本插件无其他运行时行为：没有服务、没有事件、没有工具、没有客户端 UI。
 */
import { startGuard } from './guard.js';

export const name = 'dsh-safemode-profile';

function log(ctx, level, message) {
  if (ctx?.logger?.[level]) {
    ctx.logger[level](message);
  } else if (typeof console !== 'undefined') {
    (console[level] ?? console.log)(message);
  }
}

export function apply(ctx) {
  let dispose = null;
  try {
    dispose = startGuard({
      info: (m) => log(ctx, 'info', m),
      warn: (m) => log(ctx, 'warn', m),
      debug: (m) => log(ctx, 'debug', m),
    });
  } catch (error) {
    // 守护启动失败绝不能拖垮 DSH 启动。
    log(ctx, 'warn', `[dsh-safemode-profile] failed to start safemode guard: ${String(error)}`);
    return;
  }

  // 插件行卸载/重启时停止 watch 与定时器（Cordis 官方清理机制）。
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      if (dispose !== null) {
        try { dispose(); } catch { /* 清理失败无影响 */ }
        dispose = null;
      }
    });
  }
}
