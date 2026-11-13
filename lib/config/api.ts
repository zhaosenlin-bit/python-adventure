/**
 * API 配置
 *
 * 解析顺序（从高到低）：
 * 1. NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL —— 显式覆盖（自定义后端、反向代理）
 * 2. 生产域名（game.codebn.cn / codebn.cn）—— 走 Nginx 代理，不需要端口
 * 3. 其它（localhost 等）—— http://<当前域名>:<NEXT_PUBLIC_API_PORT 或 8000>
 *
 * 端口不再写死 8000：改由 .env.local 里的 NEXT_PUBLIC_API_PORT / NEXT_PUBLIC_WS_PORT
 * 决定，和后端的 DATABASE_URL / REDIS_URL 一起构成一套本地配置。
 */

const DEFAULT_API_PORT = '8000';

declare global {
    interface Window {
        /** 桌面版（exe）启动时由后端注入的实际端口 / 源地址 */
        __CODE_ADVENTURE_API_PORT__?: number | string;
        __CODE_ADVENTURE_API_ORIGIN__?: string;
    }
}

/**
 * 判断是否为生产环境
 */
function isProduction(): boolean {
    if (typeof window === 'undefined') {
        return process.env.NODE_ENV === 'production';
    }

    const hostname = window.location.hostname;
    // 生产环境域名列表
    const productionHosts = ['game.codebn.cn', 'codebn.cn'];

    return productionHosts.some(h => hostname === h || hostname.endsWith('.' + h));
}

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

/**
 * 后端 HTTP 端口。NEXT_PUBLIC_* 会被 Next.js 在构建期内联，所以客户端也能拿到。
 */
export function getApiPort(): string {
    // 桌面版的端口是运行时选的（可能和构建时写死的 NEXT_PUBLIC_API_PORT 不同），
    // 以页面里注入的值为准。
    if (typeof window !== 'undefined' && window.__CODE_ADVENTURE_API_PORT__) {
        return String(window.__CODE_ADVENTURE_API_PORT__);
    }
    return process.env.NEXT_PUBLIC_API_PORT || DEFAULT_API_PORT;
}

/**
 * 后端 WebSocket 端口。没单独配就跟着 HTTP 端口走。
 */
export function getWsPort(): string {
    return process.env.NEXT_PUBLIC_WS_PORT || process.env.NEXT_PUBLIC_API_PORT || DEFAULT_API_PORT;
}

/**
 * 后端源地址（不含 /api/v1）。
 *
 * 服务端渲染时返回空字符串，表示「同源」，调用方拼出的就是相对路径
 * （例如 /api/v1/xxx），由部署时的反向代理转发。
 */
export function getApiOrigin(): string {
    // 桌面版：页面和后端同源，直接用当前源地址
    if (typeof window !== 'undefined' && window.__CODE_ADVENTURE_API_ORIGIN__) {
        return trimTrailingSlash(window.__CODE_ADVENTURE_API_ORIGIN__);
    }

    const explicit = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (explicit) {
        return trimTrailingSlash(explicit);
    }

    if (typeof window === 'undefined') {
        return '';
    }

    const protocol = window.location.protocol;
    const hostname = window.location.hostname;

    // 生产环境：通过 Nginx 代理，不需要端口
    if (isProduction()) {
        return `${protocol}//${hostname}`;
    }

    // 开发环境：直接访问后端端口
    return `${protocol}//${hostname}:${getApiPort()}`;
}

/**
 * 获取 API 基础 URL（含 /api/v1）
 */
export function getApiBaseUrl(): string {
    const explicit = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (explicit) {
        return `${trimTrailingSlash(explicit)}/api/v1`;
    }

    // SSR 环境 - 返回相对路径
    if (typeof window === 'undefined') {
        return '/api/v1';
    }

    return `${getApiOrigin()}/api/v1`;
}

/**
 * 获取 WebSocket URL
 */
export function getWebSocketUrl(path: string): string {
    const explicit = process.env.NEXT_PUBLIC_WS_URL?.trim();
    if (explicit) {
        return `${trimTrailingSlash(explicit)}${path}`;
    }

    if (typeof window === 'undefined') {
        return `ws://localhost:${getWsPort()}${path}`;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;

    // 生产环境：通过 Nginx 代理
    if (isProduction()) {
        return `${protocol}//${hostname}${path}`;
    }

    // 开发环境：直接访问后端端口
    return `${protocol}//${hostname}:${getWsPort()}${path}`;
}

// 导出常量（兼容旧代码）
export const API_BASE_URL = getApiBaseUrl();
