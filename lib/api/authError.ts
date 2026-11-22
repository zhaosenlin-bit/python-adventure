/**
 * 认证接口的错误处理工具。
 *
 * 后端在不同分支会返回不同形状的错误体：
 * - `{"detail": "..."}`（HTTPException）
 * - `{"success": false, "message": "...", "detail": "..."}`（全局异常处理）
 * - `{"detail": [{"msg": "..."}]}`（FastAPI 参数校验）
 * - 空体 / 非 JSON 错误体 / `{}`
 *
 * 这里统一兜底，保证最差也能给用户一句能看懂的中文，
 * 而不是把 `{}` 这种原始 JSON 直接甩到界面上。
 */

/** 预期内的接口失败（如密码错误），用于区分「用户输错了」和「程序真出问题了」 */
export class AuthRequestError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'AuthRequestError';
        this.status = status;
    }
}

/** 从任意形状的错误体里挑出能给人看的那句话 */
export function extractErrorText(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload.trim();
    }

    if (Array.isArray(payload)) {
        return payload
            .map((item) => extractErrorText(item))
            .filter((text) => text.length > 0)
            .join('；');
    }

    if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        // message 通常最具体（后端会填具体原因），detail 次之
        for (const key of ['message', 'detail', 'error', 'msg']) {
            const text = extractErrorText(record[key]);
            if (text) {
                return text;
            }
        }
    }

    return '';
}

/** 读取错误响应体里的可读提示；读不到就用 fallback 兜底 */
export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
    let raw = '';
    try {
        raw = await response.text();
    } catch {
        raw = '';
    }

    const trimmed = raw.trim();
    if (!trimmed) {
        return fallback || `HTTP ${response.status}`;
    }

    let payload: unknown;
    try {
        payload = JSON.parse(trimmed);
    } catch {
        // 非 JSON 错误体（例如网关返回的纯文本），截断后直接展示
        return trimmed.slice(0, 120);
    }

    // 注意：空对象 {} 会走到 fallback，绝不会再把 "{}" 当成错误提示显示出去
    return extractErrorText(payload) || fallback || `HTTP ${response.status}`;
}

/** 把底层错误翻译成用户能看懂的中文提示 */
export function normalizeFriendlyAuthError(error: unknown, fallback: string): string {
    const rawMessage = error instanceof Error ? error.message : String(error || fallback);
    const normalized = rawMessage.trim();
    const lower = normalized.toLowerCase();

    if (!normalized) {
        return fallback;
    }

    if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
        return '现在连不上服务器，请检查网络后刷新页面重试；如果刚更新服务器，也可以稍后再试。';
    }

    const httpStatus = normalized.match(/\bhttp\s*(\d{3})\b/i);
    if (httpStatus) {
        const status = Number(httpStatus[1]);
        if (status >= 500) {
            return `${fallback}，服务器刚刚开小差了，请稍后再试。`;
        }
        if (status === 401 || status === 403) {
            return '登录失败，请检查用户名和密码后重试。';
        }
        if (status === 404) {
            return '接口地址不存在，请确认后端服务已经启动。';
        }
    }

    return normalized;
}

/** 错误分类：网络不通 / 用户填错 / 服务端异常 */
export type AuthErrorKind = 'network' | 'form' | 'server';

export function classifyAuthError(error: unknown): AuthErrorKind {
    const rawMessage = error instanceof Error ? error.message : String(error || '');
    const lower = rawMessage.toLowerCase();

    if (
        lower.includes('failed to fetch') ||
        lower.includes('networkerror') ||
        lower.includes('load failed') ||
        lower.includes('econnrefused')
    ) {
        return 'network';
    }

    if (error instanceof AuthRequestError) {
        // 5xx 是服务端挂了，4xx 才是用户自己填错了
        return error.status >= 500 ? 'server' : 'form';
    }

    return 'server';
}
