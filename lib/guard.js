/**
 * dsh-safemode-profile — 守护逻辑（零依赖）。
 *
 * 职责：
 *   1. 启动时强制还原 safemode profile（force=true，无条件写回白名单模板）；
 *   2. 运行期间持续检查 profile 是否被改动（bundle 列表被加/删、patch 层
 *      被写入内容），发现漂移立即还原，并记录日志。
 *
 * 监控实现（双通道，保证"平时检查"不漏）：
 *   - fs.watch 监听 profile 目录：package.json / cordis.patch.yml 的变更
 *     事件，防抖 300ms 后还原；
 *   - setInterval 每 30s 全量 detectDrift() 兜底（fs.watch 在部分平台/挂载
 *     场景不可靠，且能覆盖文件被外部替换的情况）。
 *
 * 写入策略与 ensure.js 一致：与模板一致则不动，避免自触发死循环。
 */
import { watch } from 'node:fs';
import { detectDrift, ensureSafeModeProfile, safemodePaths } from './ensure.js';

const WATCH_DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 30_000;
const WATCHED_FILES = new Set(['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']);

/** 空日志器（无 ctx 时静默）。 */
const NOOP_LOGGER = { info() {}, warn() {}, debug() {} };

function log(logger, level, message) {
  try {
    (logger?.[level] ?? NOOP_LOGGER[level])(message);
  } catch { /* 日志失败不影响守护 */ }
}

/**
 * 启动守护：强制还原一次，然后监控漂移并自动还原。
 * @param logger - { info, warn, debug }，缺省静默。
 * @returns 清理函数（停止 watch / 定时器）。插件停止时必须调用。
 */
export function startGuard(logger = NOOP_LOGGER) {
  const { dir } = safemodePaths();

  // ── 1. 启动即强制还原（不管 profile 有没有、改没改过）──
  let result;
  try {
    result = ensureSafeModeProfile({ force: true });
  } catch (error) {
    log(logger, 'warn', `[dsh-safemode-profile] startup restore failed: ${String(error)}`);
    result = null;
  }
  if (result) {
    if (result.created) {
      log(logger, 'info', `[dsh-safemode-profile] created safemode profile at ${result.path} (whitelist: ${result.bundles.join(', ')})`);
    } else if (result.overwritten) {
      const drift = result.drift.map((d) => d.field).join(', ') || 'unknown';
      log(logger, 'info', `[dsh-safemode-profile] restored safemode profile at ${result.path} (drift: ${drift})`);
    } else {
      log(logger, 'debug', `[dsh-safemode-profile] safemode profile already clean at ${result.path}`);
    }
  }

  // ── 2. 运行期守护 ──
  let restoredOnce = false;
  const restoreNow = () => {
    let res;
    try {
      res = ensureSafeModeProfile({ force: true });
    } catch (error) {
      log(logger, 'warn', `[dsh-safemode-profile] guard restore failed: ${String(error)}`);
      return;
    }
    if (res.overwritten && !res.unchanged) {
      restoredOnce = true;
      const drift = res.drift.map((d) => d.field).join(', ') || 'unknown';
      log(logger, 'warn', `[dsh-safemode-profile] safemode profile was modified (${drift}); restored to whitelist template`);
    }
  };

  // fs.watch：目录级监听，防抖合并写入风暴
  let watcher = null;
  let debounce = null;
  try {
    watcher = watch(dir, { persistent: false }, (_event, filename) => {
      if (filename && !WATCHED_FILES.has(String(filename))) return;
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        restoreNow();
      }, WATCH_DEBOUNCE_MS);
    });
    watcher.on('error', (error) => {
      log(logger, 'warn', `[dsh-safemode-profile] fs.watch error (polling fallback stays active): ${String(error)}`);
    });
  } catch (error) {
    log(logger, 'warn', `[dsh-safemode-profile] fs.watch unavailable (polling fallback active): ${String(error)}`);
    watcher = null;
  }

  // setInterval：兜底轮询（也覆盖目录被整个删除的情况）
  const poller = setInterval(() => {
    let drift;
    try {
      drift = detectDrift();
    } catch (error) {
      log(logger, 'warn', `[dsh-safemode-profile] drift check failed: ${String(error)}`);
      return;
    }
    if (drift.length > 0) {
      log(logger, 'debug', `[dsh-safemode-profile] drift detected by poll: ${drift.map((d) => d.field).join(', ')}`);
      restoreNow();
    }
  }, POLL_INTERVAL_MS);
  // 定时器不要拖住进程退出
  if (typeof poller.unref === 'function') poller.unref();

  return () => {
    if (debounce !== null) clearTimeout(debounce);
    clearInterval(poller);
    if (watcher !== null) {
      try { watcher.close(); } catch { /* 已关闭 */ }
    }
  };
}
