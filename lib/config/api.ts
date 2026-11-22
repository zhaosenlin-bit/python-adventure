/**
 * API配置
 * 自动检测环境并使用正确的API地址
 */

/**
 * 后端端口。默认 8000，可用 .env.local 里的 NEXT_PUBLIC_API_PORT 覆盖。
 *
 * 本机同时跑着别的项目（也占 8000）时，只要改这一个值，
 * 前端请求地址、WebSocket、一键启动后端、QA 脚本都会跟着走。
 */
export const BACKEND_PORT = Number(process.env.NEXT_PUBLIC_API_PORT) || 8000;

/** WebSocket 端口，默认跟 HTTP 端口一致 */
export const BACKEND_WS_PORT = Number(process.env.NEXT_PUBLIC_WS_PORT) || BACKEND_PORT;

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

/**
 * 获取API基础URL
 * 根据当前访问的域名自动判断：
 * - game.codebn.cn: 生产环境，通过Nginx代理
 * - localhost/其他: 开发环境，直接访问后端端口
 */
export function getApiBaseUrl(): string {
    // SSR环境 - 返回相对路径
    if (typeof window === 'undefined') {
        return '/api/v1';
    }
    
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    
    // 生产环境：通过Nginx代理，不需要端口
    if (isProduction()) {
        return `${protocol}//${hostname}/api/v1`;
    }
    
    // 开发环境：直接访问后端端口
    return `${protocol}//${hostname}:${BACKEND_PORT}/api/v1`;
}

/**
 * 获取WebSocket URL
 */
export function getWebSocketUrl(path: string): string {
    if (typeof window === 'undefined') {
    return `ws://localhost:${BACKEND_WS_PORT}${path}`;
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;
    
    // 生产环境：通过Nginx代理
    if (isProduction()) {
        return `${protocol}//${hostname}${path}`;
    }
    
    // 开发环境：直接访问后端端口
    return `${protocol}//${hostname}:${BACKEND_WS_PORT}${path}`;
}

// 导出常量（兼容旧代码）
export const API_BASE_URL = getApiBaseUrl();
