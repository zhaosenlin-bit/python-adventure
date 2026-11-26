'use client';

/**
 * 迷宫探索（3D 第一人称）路由
 * 场景依赖 WebGL，必须关掉服务端渲染再挂载。
 */

import dynamic from 'next/dynamic';

const Maze3DGame = dynamic(() => import('@/components/maze3d/Maze3DGame'), {
    ssr: false,
    loading: () => (
        <div className="flex min-h-screen items-center justify-center bg-[#07060c]">
            <div className="font-pixel text-xl text-cyan-200 animate-pulse">正在进入 3D 迷宫…</div>
        </div>
    ),
});

export default function Maze3DPage() {
    return <Maze3DGame />;
}
