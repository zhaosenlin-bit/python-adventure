"use client";

import { useEffect, useRef, useState } from 'react';
import * as Phaser from 'phaser';
import { gameConfig } from '@/lib/game/config';
import { installPhaserAudioGuard } from '@/lib/game/phaserAudioGuard';
import { clearStalePhaserCanvases, destroyPhaserGameSafely } from '@/lib/game/phaserLifecycle';

type WorldDebugWindow = Window & {
  __worldPhaserGame?: Phaser.Game | null;
  __enableWorldDebug?: boolean;
};

function shouldExposeDebugHandle(): boolean {
  if (process.env.NODE_ENV === 'development') {
    return true;
  }
  return typeof window !== 'undefined' && Boolean((window as WorldDebugWindow).__enableWorldDebug);
}

export default function PhaserGame() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const gameParentRef = useRef<HTMLDivElement | null>(null);
  const destroyTimerRef = useRef<number | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || !parentRef.current) {
      return;
    }

    // React StrictMode 双挂载 / Fast Refresh 热更新都会立刻重跑一次 effect。
    // 上一轮 cleanup 排队的销毁在这里取消掉，游戏实例继续复用。
    // 否则会出现两个 Phaser.Game 抢同一个容器：旧实例在启动途中被销毁时，
    // 新实例的场景启动流程会被一起带崩（世界黑屏、站点不生成）。
    if (destroyTimerRef.current !== null) {
      window.clearTimeout(destroyTimerRef.current);
      destroyTimerRef.current = null;
    }

    const parentElement = parentRef.current;

    let game = gameRef.current;

    if (!game) {
      try {
        installPhaserAudioGuard();
        clearStalePhaserCanvases(parentElement);
        game = new Phaser.Game({ ...gameConfig, parent: parentElement });
        gameRef.current = game;
        gameParentRef.current = parentElement;

        window.setTimeout(() => {
          const canvas = parentElement.querySelector('canvas');
          if (canvas instanceof HTMLCanvasElement) {
            canvas.focus();
          }
        }, 100);
      } catch (error) {
        console.error('[PhaserGame] Failed to initialize:', error);
      }
    } else if (gameParentRef.current && gameParentRef.current !== parentElement) {
      // 容器被换掉了（热更新重建了 DOM）：旧画布在旧容器里，重建一个跟着新容器走。
      destroyPhaserGameSafely(game, gameParentRef.current);
      gameRef.current = null;
      gameParentRef.current = null;

      try {
        installPhaserAudioGuard();
        clearStalePhaserCanvases(parentElement);
        game = new Phaser.Game({ ...gameConfig, parent: parentElement });
        gameRef.current = game;
        gameParentRef.current = parentElement;
      } catch (error) {
        console.error('[PhaserGame] Failed to re-initialize:', error);
      }
    }

    if (game && shouldExposeDebugHandle()) {
      (window as WorldDebugWindow).__worldPhaserGame = game;
    }

    setIsLoading(false);

    return () => {
      // 销毁推迟到下一个宏任务：StrictMode 的第二次挂载在同一批次里马上执行，
      // 那时会把这次销毁取消掉；真正离开页面时才会真正销毁。
      destroyTimerRef.current = window.setTimeout(() => {
        destroyTimerRef.current = null;
        if (!game || gameRef.current !== game) {
          return;
        }

        destroyPhaserGameSafely(game, gameParentRef.current);
        gameRef.current = null;
        gameParentRef.current = null;

        if (shouldExposeDebugHandle()) {
          (window as WorldDebugWindow).__worldPhaserGame = null;
        }
      }, 0);
    };
  }, []);

  return (
    <div className="relative h-screen w-full bg-black">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="font-pixel text-xl text-white">开放世界加载中...</div>
        </div>
      )}
      <div ref={parentRef} id="phaser-game" className="h-full w-full" style={{ width: '100%', height: '100vh' }} />
    </div>
  );
}
