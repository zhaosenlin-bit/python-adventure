/**
 * 静态场景几何合并。
 *
 * polyfork 素材统一使用「顶点色 + 平面着色」材质，几何只带 position / color，
 * 因此一批已经摆好位置的静态模型可以压成单个 Mesh：draw call 从上百降到个位数。
 * three.js 是前向渲染，每个像素都要遍历场景里的所有光源，所以「合并静态几何」
 * 与「精简光源数量」是同一件事的两面。
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** 参与合并的属性白名单，其余属性一律拒绝合并，避免语义丢失 */
const ALLOWED_ATTRS = new Set(["position", "color", "normal"]);

/** 材质签名：只有渲染结果一致的材质才能共用同一个 Mesh */
function materialSignature(material: THREE.MeshStandardMaterial): string {
    const standard = material;
    const customShader =
        material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? "custom" : "std";
    return [
        standard.type,
        standard.vertexColors ? 1 : 0,
        standard.flatShading ? 1 : 0,
        standard.transparent ? 1 : 0,
        standard.opacity,
        standard.side,
        standard.depthWrite,
        standard.metalness ?? 0,
        standard.roughness ?? 0,
        standard.color?.getHexString?.() ?? "",
        standard.emissive?.getHexString?.() ?? "",
        customShader,
    ].join("|");
}

/** 判断单个 Mesh 能否被合并进公共批次 */
function canMerge(mesh: THREE.Mesh): boolean {
    if (!mesh.isMesh || Array.isArray(mesh.material)) return false;
    const geometry = mesh.geometry;
    if (!geometry) return false;
    const names = Object.keys(geometry.attributes);
    if (!names.includes("position") || !names.includes("color")) return false;
    if (names.some((name) => !ALLOWED_ATTRS.has(name))) return false;
    const material = mesh.material as THREE.MeshStandardMaterial;
    // 顶点色 + 平面着色是合并的前提：法线可以丢弃，着色由屏幕空间导数给出
    if (!material.vertexColors || !material.flatShading) return false;
    if (material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return false;
    return true;
}

/** 把单个几何规范化成「非索引 + 只剩 position/color」，保证可以互相合并 */
function normalizeGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix4) {
    let geometry = source.clone();
    if (geometry.index) {
        const flat = geometry.toNonIndexed();
        geometry.dispose();
        geometry = flat;
    }
    geometry.applyMatrix4(matrix);
    geometry.deleteAttribute("normal");
    geometry.deleteAttribute("uv");
    geometry.clearGroups();
    return geometry;
}

export interface MergeStaticResult {
    /** 合并后的 Mesh，可直接加进场景 */
    merged: THREE.Mesh[];
    /** 无法合并、需要保持独立的对象（自定义着色器、蒙皮动画等） */
    kept: THREE.Object3D[];
}

/**
 * 合并一批静态对象。
 *
 * @param objects 已经设置好 position / rotation / scale 的对象
 */
export function mergeStatic(objects: THREE.Object3D[]): MergeStaticResult {
    const kept: THREE.Object3D[] = [];
    /** 材质签名 -> 待合并几何 */
    const buckets = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
    /** 材质签名 -> 合并失败时的兜底对象 */
    const fallback = new Map<string, THREE.Object3D[]>();

    for (const object of objects) {
        object.updateWorldMatrix(true, true);
        const meshes: THREE.Mesh[] = [];
        object.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
        });
        if (!meshes.length || !meshes.every(canMerge)) {
            kept.push(object);
            continue;
        }

        const signature = materialSignature(meshes[0].material as THREE.MeshStandardMaterial);
        if (
            !meshes.every(
                (mesh) =>
                    materialSignature(mesh.material as THREE.MeshStandardMaterial) === signature,
            )
        ) {
            kept.push(object);
            continue;
        }

        const bucket = buckets.get(signature) ?? {
            material: meshes[0].material as THREE.MeshStandardMaterial,
            geometries: [],
        };
        for (const mesh of meshes) {
            bucket.geometries.push(normalizeGeometry(mesh.geometry, mesh.matrixWorld));
        }
        buckets.set(signature, bucket);
        fallback.set(signature, [...(fallback.get(signature) ?? []), object]);
    }

    const merged: THREE.Mesh[] = [];
    for (const [signature, bucket] of buckets) {
        const geometry = mergeGeometries(bucket.geometries, false);
        for (const item of bucket.geometries) item.dispose();
        if (!geometry) {
            // 合并失败就退回独立对象，绝不静默丢场景
            kept.push(...(fallback.get(signature) ?? []));
            continue;
        }
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, bucket.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        merged.push(mesh);
    }

    return { merged, kept };
}
