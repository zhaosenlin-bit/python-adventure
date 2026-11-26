'use client';

/**
 * 3D 编程迷宫 —— 小地图
 *
 * 只画「已经看过的地方」：每走一格，四周可视范围内的通道才被点亮，
 * 没去过的区域保持全黑 —— 既好看，又不至于把迷宫答案直接送给玩家。
 * 门在小地图上和墙里长得一样（一个棕色小门框），不会泄露哪扇是陷阱。
 */

import { useEffect, useRef } from 'react';
import type { RunState } from '@/lib/maze3d/engine';
import { DIR_VECTORS, type Level3D, cellKey, isWall } from '@/lib/maze3d/level';

interface MinimapProps {
    level: Level3D;
    state: RunState | null;
    size?: number;
    className?: string;
}

const SIGHT = 3;

export default function Minimap({ level, state, size = 168, className }: MinimapProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const seenRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        seenRef.current = new Set();
    }, [level]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.round(size * dpr)) {
            canvas.width = Math.round(size * dpr);
            canvas.height = Math.round(size * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);

        const seen = seenRef.current;
        const seenWalls = new Set<string>();

        if (state) {
            // 视线：朝四个方向最多看 SIGHT 格，遇到墙就停
            seen.add(cellKey(state.x, state.z));
            DIR_VECTORS.forEach((dir) => {
                for (let step = 1; step <= SIGHT; step++) {
                    const x = state.x + dir.dx * step;
                    const z = state.z + dir.dz * step;
                    if (isWall(level, x, z)) {
                        seenWalls.add(cellKey(x, z));
                        break;
                    }
                    seen.add(cellKey(x, z));
                }
            });
            // 站在路口时，左右斜前方也顺便看一眼，转角不至于全黑
            seen.forEach((key) => {
                const [sx, sz] = key.split(',').map(Number);
                DIR_VECTORS.forEach((dir) => {
                    const wx = sx + dir.dx;
                    const wz = sz + dir.dz;
                    if (isWall(level, wx, wz)) seenWalls.add(cellKey(wx, wz));
                });
            });
        }

        const pad = 7;
        const cell = (size - pad * 2) / Math.max(level.width, level.height);
        const originX = pad + (size - pad * 2 - cell * level.width) / 2;
        const originY = pad + (size - pad * 2 - cell * level.height) / 2;

        const px = (x: number) => originX + x * cell;
        const py = (z: number) => originY + z * cell;

        // 底：未探索的暗色
        ctx.fillStyle = '#05040a';
        ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2);

        // 墙壁
        ctx.fillStyle = '#2b3350';
        for (let z = 0; z < level.height; z++) {
            for (let x = 0; x < level.width; x++) {
                if (!isWall(level, x, z)) continue;
                if (!seenWalls.has(cellKey(x, z))) continue;
                ctx.fillRect(px(x) + 0.5, py(z) + 0.5, cell - 1, cell - 1);
            }
        }

        // 走过的通道
        ctx.fillStyle = '#101a2e';
        seen.forEach((key) => {
            const [x, z] = key.split(',').map(Number);
            ctx.fillRect(px(x), py(z), cell, cell);
        });

        // 门（陷阱与出口同一图标，不剧透）
        level.doors.forEach((door) => {
            if (!seen.has(cellKey(door.x, door.z))) return;
            ctx.fillStyle = '#c08a4a';
            ctx.fillRect(px(door.x) + cell * 0.2, py(door.z) + cell * 0.16, cell * 0.6, cell * 0.68);
            ctx.fillStyle = '#2a1a0c';
            ctx.fillRect(px(door.x) + cell * 0.44, py(door.z) + cell * 0.38, cell * 0.12, cell * 0.14);
        });

        // 金币
        const collected = new Set(state?.coins ?? []);
        ctx.fillStyle = '#ffd166';
        level.coins.forEach((coin) => {
            if (!seen.has(cellKey(coin.x, coin.z))) return;
            if (collected.has(cellKey(coin.x, coin.z))) return;
            ctx.beginPath();
            ctx.arc(px(coin.x) + cell / 2, py(coin.z) + cell / 2, cell * 0.17, 0, Math.PI * 2);
            ctx.fill();
        });

        // 玩家
        if (state) {
            const cx = px(state.x) + cell / 2;
            const cy = py(state.z) + cell / 2;
            const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 2.4);
            glow.addColorStop(0, 'rgba(103,232,249,0.35)');
            glow.addColorStop(1, 'rgba(103,232,249,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(cx - cell * 2.4, cy - cell * 2.4, cell * 4.8, cell * 4.8);

            const angle = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][state.facing];
            const r = cell * 0.38;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(r, 0);
            ctx.lineTo(-r * 0.72, r * 0.72);
            ctx.lineTo(-r * 0.72, -r * 0.72);
            ctx.closePath();
            ctx.fillStyle = '#67e8f9';
            ctx.fill();
            ctx.restore();
        }

        // 边框
        ctx.strokeStyle = 'rgba(148,163,184,0.16)';
        ctx.lineWidth = 1;
        ctx.strokeRect(pad + 0.5, pad + 0.5, size - pad * 2 - 1, size - pad * 2 - 1);
    }, [level, state, size]);

    return (
        <div
            className={`overflow-hidden rounded-2xl border border-white/10 bg-black/55 p-1.5 backdrop-blur ${className ?? ''}`}
            style={{ width: size + 12 }}
        >
            <div className="flex items-center justify-between px-1 pb-1">
                <span className="font-pixel text-[10px] tracking-wider text-slate-400">小地图</span>
                <span className="text-[10px] text-slate-600">{level.width}×{level.height}</span>
            </div>
            <canvas
                ref={canvasRef}
                width={size}
                height={size}
                style={{ width: size, height: size, display: 'block', borderRadius: 10 }}
            />
        </div>
    );
}
