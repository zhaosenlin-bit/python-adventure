import type * as Phaser from 'phaser';

type PhaserGameHandle = Pick<Phaser.Game, 'destroy'> & {
  canvas?: HTMLCanvasElement | null;
};

function removeCanvasFromDom(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) {
    return;
  }

  try {
    if (canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
  } catch (error) {
    console.warn('[PhaserLifecycle] Failed to remove Phaser canvas:', error);
  }
}

export function clearPhaserContainer(parent: HTMLElement | null | undefined): void {
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
  try {
    game?.destroy(false);
  } catch (error) {
    console.warn('[PhaserLifecycle] Phaser game destroy failed:', error);
  } finally {
    // Phaser 的销毁发生在下一帧，canvas 节点在此之前仍留在 DOM 中。
    // WebGL 上下文丢失后这块画布会显示成黑屏，还会把新的 canvas 挤出可视区域，
    // 所以这里按引用同步移除，React StrictMode 双挂载时也必须生效。
    removeCanvasFromDom(game?.canvas);
    clearPhaserContainer(parent);
  }
}

/**
 * 清掉容器里残留的 canvas（热更新或上一次挂载遗留的失效画布）
 */
export function clearStalePhaserCanvases(parent?: HTMLElement | null): void {
  if (!parent) {
    return;
  }

  Array.from(parent.querySelectorAll('canvas')).forEach(removeCanvasFromDom);
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
