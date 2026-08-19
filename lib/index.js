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
 * Generate the usage banner printed on startup (keep it short - full docs live
 * in the README / repo link below).
 * @param options - { home?, bundles? }, resolved from the environment by default.
 */
export function usageText({ home, bundles } = {}) {
  const paths = safemodePaths({ home });
  const list = bundles ?? safemodeBundles();
  return [
    '[dsh-safemode-profile] guard active (safemode itself is NOT running)',
    `[dsh-safemode-profile]   start it:  dsh --profile safemode --port 3081`,
    `[dsh-safemode-profile]   whitelist: ${list.join(', ')}`,
    `[dsh-safemode-profile]   harden:    lock the 3 managed files read-only to block plugin installs (NOT the dir - DSH rewrites cordis.yml on every boot):`,
    `[dsh-safemode-profile]              Windows: attrib +R "${paths.dir}\\package.json" "${paths.dir}\\cordis.patch.yml" "${paths.dir}\\pnpm-workspace.yaml"`,
    `[dsh-safemode-profile]              POSIX:   chmod 444 "${paths.dir}/package.json" "${paths.dir}/cordis.patch.yml" "${paths.dir}/pnpm-workspace.yaml"`,
    `[dsh-safemode-profile]   docs:      https://github.com/jinsiyu/dsh-safemode-profile`,
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
