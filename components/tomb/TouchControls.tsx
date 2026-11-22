"use client";

/** 触屏虚拟摇杆 + 操作按钮（移动端） */

import { useEffect, useRef, useState } from "react";
import { Crosshair, Swords } from "lucide-react";

interface TouchControlsProps {
    onInteract: () => void;
    onAttack: () => void;
    onJoystick: (x: number, y: number, active: boolean) => void;
}

const RADIUS = 52;

export default function TouchControls({ onInteract, onAttack, onJoystick }: TouchControlsProps) {
    const padRef = useRef<HTMLDivElement>(null);
    const [knob, setKnob] = useState({ x: 0, y: 0 });
    const pointerIdRef = useRef<number | null>(null);

    useEffect(() => {
        return () => onJoystick(0, 0, false);
    }, [onJoystick]);

    const handleDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (pointerIdRef.current !== null) return;
        pointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
    };

    const update = (event: React.PointerEvent<HTMLDivElement>) => {
        const pad = padRef.current;
        if (!pad) return;
        const rect = pad.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let dx = event.clientX - centerX;
        let dy = event.clientY - centerY;
        const distance = Math.hypot(dx, dy);
        if (distance > RADIUS) {
            dx = (dx / distance) * RADIUS;
            dy = (dy / distance) * RADIUS;
        }
        setKnob({ x: dx, y: dy });
        onJoystick(dx / RADIUS, dy / RADIUS, true);
    };

    const handleUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (pointerIdRef.current !== event.pointerId) return;
        pointerIdRef.current = null;
        setKnob({ x: 0, y: 0 });
        onJoystick(0, 0, false);
    };

    return (
        <div className="tomb-touch-controls pointer-events-none absolute inset-x-0 bottom-0 z-20 items-end justify-between p-4">
            <div
                ref={padRef}
                onPointerDown={handleDown}
                onPointerMove={(event) => {
                    if (pointerIdRef.current === event.pointerId) update(event);
                }}
                onPointerUp={handleUp}
                onPointerCancel={handleUp}
                role="application"
                aria-label="移动摇杆"
                className="pointer-events-auto relative h-32 w-32 touch-none rounded-full border border-white/15 bg-black/40"
            >
                <div
                    className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300/40 bg-amber-300/20"
                    // 只用 transform 做偏移：居中交给 -translate-x/y-1/2，
                    // 否则 Tailwind 的 translate 属性与 transform 会各平移一次，手柄会偏出摇杆中心。
                    style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
                />
            </div>

            <div className="pointer-events-auto flex items-end gap-3">
                <button
                    type="button"
                    onClick={onAttack}
                    aria-label="袭击"
                    title="袭击面前的 NPC"
                    className="flex h-14 w-14 items-center justify-center rounded-full border border-rose-400/40 bg-rose-950/60 text-rose-200"
                >
                    <Swords className="h-6 w-6" />
                </button>
                <button
                    type="button"
                    onClick={onInteract}
                    aria-label="交互"
                                title="交谈 / 解谜拿线索 / 推石门"
                    className="flex h-16 w-16 items-center justify-center rounded-full border border-amber-300/45 bg-amber-500/20 text-amber-100"
                >
                    <Crosshair className="h-7 w-7" />
                </button>
            </div>
        </div>
    );
}
