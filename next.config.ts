import type { NextConfig } from "next";

process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA ??= "true";
process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= "true";

const nextConfig: NextConfig = {
  // Empty turbopack config to acknowledge we're using Turbopack
  turbopack: {},
  // Needed after upgrading Next 16.2.x: QA scripts hit 127.0.0.1 in dev.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  transpilePackages: ['phaser'],
  // /api/dev/backend 只在开发期生效（生产环境直接返回 403），
  // 它会用 node:child_process 拉起本地后端，动态文件访问会被 Turbopack
  // 误判成「要追踪整个项目」，导致发布包体积暴涨，这里显式排除。
  outputFileTracingExcludes: {
    '/api/dev/backend': ['**/*'],
  },
  async headers() {
    return [
      {
        source: "/assets/bosses/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/assets/player/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/sounds/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/typing", destination: "/typing/index.html" },
      { source: "/typing/", destination: "/typing/index.html" },
      { source: "/data/catalog.json", destination: "/typing/data/catalog.json" },
      { source: "/data/asset-map.json", destination: "/typing/data/asset-map.json" },
      { source: "/data/:path*", destination: "/typing/data/:path*" },
      { source: "/assets/:path*", destination: "/typing/assets/:path*" },
      { source: "/game-res/:path*", destination: "/typing/game-res/:path*" },
    ];
  },
};

export default nextConfig;
