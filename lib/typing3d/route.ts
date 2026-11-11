/**
 * 3D 打字闯关的网址归一化。
 *
 * 从聊天窗口复制网址时，很容易把中文全角标点一起粘进来
 * （比如 `http://localhost:3000/typing-3d。`），打开就是 404。
 * proxy.ts 靠这里判断「该重定向回干净地址」还是「照常放行」。
 *
 * 抽成纯函数是为了能直接单测，不用把 next/server 拖进测试环境。
 */

/** 3D 打字闯关的干净地址。 */
export const TYPING3D_PATH = "/typing-3d";

/** 合法的子路由，例如 `/typing-3d/leaderboard`。 */
const CLEAN_SUFFIX = /^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/;

/** 复制网址时粘进来的标点：中文标点、全角符号、弯引号。 */
const JUNK_PUNCTUATION = /[\u3000-\u303F\uFF00-\uFFEF\u2018-\u201F\u2026\u2014\u2015]/;

/**
 * 判断这个路径是不是「粘了标点」的脏地址。
 *
 * - `/typing-3d`             → 干净，不动
 * - `/typing-3d。`           → 脏，该重定向
 * - `/typing-3d%E3%80%82`    → 脏，该重定向（浏览器会先把中文标点编码掉）
 * - `/typing-3d/`            → 脏，该重定向
 * - `/typing-3d/leaderboard` → 是真的子路由，放行，别劫持
 * - `/typing-3d-home`        → 别的页面，放行
 */
export function isDirtyTyping3dPath(pathname: string): boolean {
    if (pathname === TYPING3D_PATH) return false;
    // 只认 `/typing-3d` 本身和它的子路径，`/typing-3d-home` 是别的页面
    if (!pathname.startsWith(TYPING3D_PATH)) return false;

    const rest = pathname.slice(TYPING3D_PATH.length);
    // 浏览器会把中文标点编码成 %E3%80%82 之类，先还原再判断
    let decoded = rest;
    try {
        decoded = decodeURIComponent(rest);
    } catch {
        /* 不是合法的百分号编码，按原样判断 */
    }

    if (JUNK_PUNCTUATION.test(decoded)) return true;

    // 多余的斜杠 / 句点
    if (/^\/+$/.test(rest) || rest === "." || rest === "..") return true;

    // 真正的子路由放行，别劫持以后要加的页面
    if (CLEAN_SUFFIX.test(rest)) return false;

    return false;
}
