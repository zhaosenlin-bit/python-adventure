import type * as Phaser from 'phaser';

type PhaserGameHandle = Pick<Phaser.Game, 'destroy'> & Partial<Pick<Phaser.Game, 'canvas'>>;

/**
 * 找到 Phaser 容器。
 *
 * React 在开发模式的 StrictMode 里会做「挂载 → 卸载 → 再挂载」，
 * 卸载那一刻组件的 ref 已经被置空，调用方传进来的 parent 拿不到，
 * 于是 clearPhaserContainer 变成空转：旧画布会留在页面里
 * （游戏已销毁、画面全黑），把新画布挤到屏幕外，整个页面看着就是黑屏。
 * Phaser 的画布此刻还挂在 DOM 上，可以从它反查回容器。
 */
function resolveContainer(
  game: PhaserGameHandle | null | undefined,
  parent?: HTMLElement | null,
): HTMLElement | null {
  if (parent) {
    return parent;
  }

  const canvasParent = game?.canvas?.parentElement;
  return canvasParent ?? null;
}

function clearPhaserContainer(parent: HTMLElement | null | undefined): void {
  if (!parent) {
    return;
  }

  for (const child of Array.from(parent.childNodes)) {
    if (child.parentNode !== parent) {
      continue;
    }

    try {
      parent.removeChild(child);
    } catch (error) {
      if (
        typeof DOMException !== 'undefined' &&
        error instanceof DOMException &&
        error.name === 'NotFoundError'
      ) {
        continue;
      }

      console.warn('[PhaserLifecycle] Failed to clear Phaser container child:', error);
    }
  }
}

export function destroyPhaserGameSafely(
  game: PhaserGameHandle | null | undefined,
  parent?: HTMLElement | null,
): void {
  const container = resolveContainer(game, parent);

  try {
    game?.destroy(false);
  } catch (error) {
    console.warn('[PhaserLifecycle] Phaser game destroy failed:', error);
  } finally {
    clearPhaserContainer(container);
  }
}

export function schedulePhaserDestroy(
  game: PhaserGameHandle,
  onDestroyed: () => void,
  parent?: HTMLElement | null,
): number {
  return window.setTimeout(() => {
    try {
      destroyPhaserGameSafely(game, parent);
    } finally {
      onDestroyed();
    }
  }, 0);
}
