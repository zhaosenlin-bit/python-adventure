import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isDirtyTyping3dPath, TYPING3D_PATH } from './lib/typing3d/route';

export function proxy(request: NextRequest) {
  // 复制网址时很容易把中文全角标点一起带上（例如 /typing-3d。），
  // 这里统一归一化回 /typing-3d，省得用户对着 404 发呆。
  // 真正的子路由（/typing-3d/xxx）放行，别劫持以后要加的页面。
  const { pathname } = request.nextUrl;
  if (isDirtyTyping3dPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = TYPING3D_PATH;
    // 用重定向而不是 rewrite：地址栏也能被洗干净，下次复制就不会再带上标点
    const rewritten = NextResponse.redirect(url);
    rewritten.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    rewritten.headers.set('Pragma', 'no-cache');
    rewritten.headers.set('Expires', '0');
    rewritten.headers.set('X-App-Cache-Policy', 'no-store');
    return rewritten;
  }

  const response = NextResponse.next();

  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  response.headers.set('X-App-Cache-Policy', 'no-store');

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|pyodide|manifest.json|.*\\..*).*)',
  ],
};
