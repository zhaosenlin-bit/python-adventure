/**
 * polyfork.dev 低多边形 3D 素材模块（ESM）类型声明。
 * 素材模块通过裸标识符 `three` / `three/addons/*` 导入，由打包器解析到 node_modules/three。
 */
declare module "*.mjs" {
    import type { Object3D } from "three";

    export function createAsset(params?: Record<string, unknown>): Object3D;
    export const params: Record<string, any>;
    export const presets: Record<string, any>;
    export const rig: unknown;
    export const detach: string[];
    export const night: Record<string, any>;
    export const decals: unknown[];
    export const view: unknown;
    export const materials: unknown;

    export function mergeAssets(
        list: unknown[],
        options?: { keepDynamic?: boolean },
    ): { merged: Object3D; dynamic: Object3D[] };

    const _default: typeof createAsset;
    export default _default;
}
