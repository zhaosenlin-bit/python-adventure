import { NextRequest, NextResponse } from "next/server";

/**
 * 把「本地桌面版启动器」的请求转发给 FastAPI。
 *
 * 为什么要这一层：开发时前端跑在 Next dev（:3000），后端跑在 FastAPI（:8000），
 * 两边不同源，前端直接 ``fetch("/api/v1/launcher/...")`` 会打到 Next 自己身上，
 * 而 Next 里并没有这个路由——于是「启动游戏」按钮在开发环境永远是坏的。
 *
 * 打包版（exe / 静态导出）里，站点本身就是后端在托管，同源，不需要这一层。
 */

export const runtime = "nodejs";

const DEFAULT_BACKEND = "http://127.0.0.1:8000";

function backendRoot(): string {
    if (process.env.LAUNCHER_PROXY_DISABLED === "true") return "";
    const configured = process.env.LAUNCHER_API_PROXY_URL?.trim();
    return (configured || DEFAULT_BACKEND).replace(/\/+$/, "");
}

type RouteContext = { params: Promise<{ game: string }> };

async function forward(request: NextRequest, context: RouteContext, method: "GET" | "POST") {
    const { game } = await context.params;
    const root = backendRoot();
    if (!root) {
        return NextResponse.json(
            { available: false, reason: "本地启动器代理已关闭", running: false },
            { status: 503 },
        );
    }

    const url = `${root}/api/v1/launcher/${encodeURIComponent(game)}`;
    try {
        const init: RequestInit = { method, cache: "no-store", headers: { accept: "application/json" } };
        if (method === "POST") {
            init.headers = { ...init.headers, "content-type": "application/json" };
            init.body = "{}";
        }
        const response = await fetch(url, init);
        const text = await response.text();
        return new NextResponse(text || "{}", {
            status: response.status,
            headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
        });
    } catch (error) {
        return NextResponse.json(
            {
                available: false,
                reason: `连不上本地后端（${error instanceof Error ? error.message : String(error)}）`,
                running: false,
            },
            { status: 503 },
        );
    }
}

export async function GET(request: NextRequest, context: RouteContext) {
    return forward(request, context, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
    return forward(request, context, "POST");
}
