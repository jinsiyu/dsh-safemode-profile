/**
 * dsh-safemode-profile — Cordis 插件行。
 *
 * apply 时：
 *   1. 启动守护（startGuard）：
 *      - **强制还原**：不管 safemode profile 有没有、被改成什么样，一律
 *        写回白名单模板（dsh.profile.bundles = 白名单，cordis.patch.yml = 空层）；
 *      - **持续守护**：fs.watch 实时 + 30s 轮询兜底，发现 profile 被改动
 *        （bundle 被加/删、patch 层被写入）立即还原并记日志。
 *   2. 在命令行打印 safemode 使用方式（方便大家使用）。
 *
 * 本插件无构建脚本、无 postinstall——pnpm 永不拦截，`dsh plugin add`
 * 一次成功。全部工作由插件行承担。
 *
 * 本插件无其他运行时行为：没有服务、没有事件、没有工具、没有客户端 UI。
 */
import { startGuard } from './guard.js';
import { safemodeBundles, safemodePaths } from './ensure.js';

export const name = 'dsh-safemode-profile';

function log(ctx, level, message) {
  if (ctx?.logger?.[level]) {
    ctx.logger[level](message);
  } else if (typeof console !== 'undefined') {
    (console[level] ?? console.log)(message);
  }
}

/**
 * Generate the usage banner printed on startup.
 * @param options - { home?, bundles? }, resolved from the environment by default.
 */
export function usageText({ home, bundles } = {}) {
  const paths = safemodePaths({ home });
  const list = bundles ?? safemodeBundles();
  return [
    '[dsh-safemode-profile] =================================================',
    '[dsh-safemode-profile] dsh-safemode-profile plugin loaded (guard active)',
    '[dsh-safemode-profile]   NOTE: safemode is NOT active yet - this plugin only',
    '[dsh-safemode-profile]   keeps the safemode profile clean so you CAN boot it.',
    `[dsh-safemode-profile]   whitelist bundles : ${list.join(', ')}`,
    `[dsh-safemode-profile]   profile directory : ${paths.dir}`,
    '[dsh-safemode-profile]   --- how to use ---',
    '[dsh-safemode-profile]   start safemode (use a different port to avoid the',
    '[dsh-safemode-profile]   web profile occupying 3080):',
    '[dsh-safemode-profile]     dsh --profile safemode --port 3081',
    '[dsh-safemode-profile]     dsh --profile safemode',
    '[dsh-safemode-profile]   custom whitelist (env var, takes effect on next dsh start):',
    '[dsh-safemode-profile]     $env:DSH_SAFEMODE_BUNDLES = "pkg1,pkg2"',
    '[dsh-safemode-profile]   restore the profile right now without a restart:',
    '[dsh-safemode-profile]     node scripts/ensure-safemode.mjs',
    '[dsh-safemode-profile]   guard behavior: force-restores the profile on startup,',
    '[dsh-safemode-profile]   auto-restores it whenever modified (see WARN logs).',
    '[dsh-safemode-profile] =================================================',
  ].join('\n');
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

  // 启动时在命令行输出使用方式（console 直出，日志系统之外也能看到）。
  try {
    console.log(usageText());
  } catch (error) {
    log(ctx, 'debug', `[dsh-safemode-profile] usage banner skipped: ${String(error)}`);
  }
}
