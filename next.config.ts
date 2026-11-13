import type { NextConfig } from "next";

process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA ??= "true";
process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= "true";

const nextConfig: NextConfig = {
    // NEXT_OUTPUT_EXPORT=1 时输出纯静态站点（供桌面版 exe 由后端直接托管）。
    // 线上部署仍走默认的 standalone/server 模式，不受影响。
    ...(process.env.NEXT_OUTPUT_EXPORT === '1'
        ? { output: 'export' as const, images: { unoptimized: true } }
        : {}),
  // Empty turbopack config to acknowledge we're using Turbopack
  turbopack: {},
  // Needed after upgrading Next 16.2.x: QA scripts hit 127.0.0.1 in dev.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  transpilePackages: ['phaser'],
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
