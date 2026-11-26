'use client';

/**
 * 3D 编程迷宫 —— three.js 第一人称场景
 *
 * 墙体用用户提供的 GLB 模型（cemetery-wall-run）：
 * 单个墙段正好 2m 宽、1.8m 高，所以 1 格 = 2m，一格一面墙，
 * 全部塞进一个 InstancedMesh，几百面墙也只有 1 次 draw call。
 *
 * 视口本身不处理输入：键盘事件由主界面转成指令，统一走 play() 后由这里
 * 按命令逐帧推进相机 —— 第一人称的「走」本身也是一种反馈。
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MazeCommand } from '@/lib/maze/levels';
import { applyBackward, applyCommand, bounceBack, createRunState, type RunState } from '@/lib/maze3d/engine';
import { type Door, type Level3D, cellKey, isWall } from '@/lib/maze3d/level';
import { type GizmoHint, type GizmoMood, senseGizmo } from '@/lib/maze3d/gizmo';
import { type MazeTheme, getTheme } from '@/lib/maze3d/themes';
import { createGizmo, type GizmoMesh } from './gizmoMesh';
import { sfx } from '@/lib/maze/sound';

const CELL = 2;
const WALL_MODEL_URL = '/models/maze-wall.glb';
const EYE_HEIGHT = 1.5;
const STEP_MS = 330;
const TURN_MS = 260;

export interface PlayHandlers {
    onState?: (state: RunState) => void;
    onBlocked?: (state: RunState) => void;
    /** 踩到陷阱门：题目答对返回 'resume'，放弃返回 'abort' */
    onTrap?: (door: Door) => Promise<'resume' | 'abort'>;
}

export interface PlayResult {
    status: 'win' | 'blocked' | 'done' | 'stopped';
    state: RunState;
}

/** 代码里没有「后退」，方向键 ↓ 才用得到 */
export type Maze3DCommand = MazeCommand | 'back';

export interface MazeWorldHandle {
    play: (commands: Maze3DCommand[], handlers?: PlayHandlers) => Promise<PlayResult>;
    stop: () => void;
    reset: () => void;
    setLeading: (leading: boolean) => void;
}

interface Burst {
    points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    velocity: Float32Array;
    life: number;
}

interface Runtime {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    hemi: THREE.HemisphereLight;
    sun: THREE.DirectionalLight;
    floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
    sky: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    dust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    dustBase: Float32Array;
    wallMesh: THREE.InstancedMesh | null;
    /** 墙顶压顶石，每个主题一种材质 */
    wallCap: THREE.InstancedMesh | null;
    /** 玩家提灯：只照亮身边几格，让近处墙面有明暗层次 */
    lantern: THREE.PointLight;
    coins: Map<string, THREE.Group>;
    doorEmblems: THREE.MeshStandardMaterial[];
    /** 门上的符文环，慢慢自转 */
    doorRunes: THREE.Mesh[];
    /** 门芯的半透明幕帘，透明度要呼吸 */
    doorVeils: THREE.MeshBasicMaterial[];
    accentMaterials: THREE.MeshStandardMaterial[];
    startRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshStandardMaterial>;
    /** 通关时在出口脉动扩散的金色光环 */
    exitRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    exitFlash: number;
    gizmo: GizmoMesh;
    gizmoMood: GizmoMood;
    gizmoArrow: number | null;
    bursts: Burst[];
    target: { x: number; z: number; yaw: number };
    phase: number;
    shake: number;
    last: number;
    raf: number;
    observer: ResizeObserver | null;
    disposed: boolean;
    theme: MazeTheme;
    level: Level3D;
    leading: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const worldX = (x: number, width: number) => (x - (width - 1) / 2) * CELL;
const worldZ = (z: number, height: number) => (z - (height - 1) / 2) * CELL;

function mixHex(hex: number, factor: number): string {
    const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * factor));
    const b = Math.min(255, Math.round((hex & 0xff) * factor));
    return `rgb(${r},${g},${b})`;
}

/**
 * 地面：一格一块石板，灰缝留白、每块明暗不同，
 * 再在贴墙的那一侧刷一层柔和阴影 —— 这是成本最低的“接地感”。
 */
function makeFloorTexture(theme: MazeTheme, level: Level3D): THREE.CanvasTexture {
    const cellPx = 48;
    const width = level.width * cellPx;
    const height = level.height * cellPx;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const random = (x: number, z: number) => {
        const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
        return v - Math.floor(v);
    };

    if (ctx) {
        ctx.fillStyle = `#${theme.floor.grid.toString(16).padStart(6, '0')}`;
        ctx.fillRect(0, 0, width, height);

        for (let z = 0; z < level.height; z++) {
            for (let x = 0; x < level.width; x++) {
                const tone = 0.82 + random(x, z) * 0.34;
                ctx.fillStyle = mixHex(theme.floor.color, tone);
                // 每块石板尺寸略有出入，避免死板的棋盘格
                const inset = 1.5 + random(z, x) * 1.5;
                ctx.fillRect(x * cellPx + inset, z * cellPx + inset, cellPx - inset * 2, cellPx - inset * 2);

                // 表面颗粒
                ctx.globalAlpha = 0.06;
                ctx.fillStyle = '#ffffff';
                for (let dot = 0; dot < 6; dot++) {
                    const px = x * cellPx + random(x + dot, z) * cellPx;
                    const pz = z * cellPx + random(x, z + dot) * cellPx;
                    ctx.fillRect(px, pz, 2, 2);
                }
                ctx.globalAlpha = 1;
            }
        }

        // 贴墙的柔和阴影：往墙的方向压暗，地面和墙之间不再“硬切”
        const dirs = [
            { dx: 1, dz: 0 },
            { dx: -1, dz: 0 },
            { dx: 0, dz: 1 },
            { dx: 0, dz: -1 },
        ];
        for (let z = 0; z < level.height; z++) {
            for (let x = 0; x < level.width; x++) {
                if (isWall(level, x, z)) continue;
                dirs.forEach((dir) => {
                    if (!isWall(level, x + dir.dx, z + dir.dz)) return;
                    const px = x * cellPx;
                    const pz = z * cellPx;
                    const depth = cellPx * 0.55;
                    let gradient: CanvasGradient;
                    if (dir.dx === 1) gradient = ctx.createLinearGradient(px + cellPx, pz, px + cellPx - depth, pz);
                    else if (dir.dx === -1) gradient = ctx.createLinearGradient(px, pz, px + depth, pz);
                    else if (dir.dz === 1) gradient = ctx.createLinearGradient(px, pz + cellPx, px, pz + cellPx - depth);
                    else gradient = ctx.createLinearGradient(px, pz, px, pz + depth);
                    gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
                    gradient.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(px, pz, cellPx, cellPx);
                });
            }
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

function makeSkyTexture(theme: MazeTheme): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        const top = new THREE.Color(theme.sky).lerp(new THREE.Color(theme.hemi.sky), 0.35);
        const bottom = new THREE.Color(theme.fog.color);
        const gradient = ctx.createLinearGradient(0, 0, 0, 256);
        gradient.addColorStop(0, `#${top.getHexString()}`);
        gradient.addColorStop(0.55, `#${new THREE.Color(theme.sky).getHexString()}`);
        gradient.addColorStop(1, `#${bottom.getHexString()}`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 8, 256);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function buildStars(theme: MazeTheme): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    const count = 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 0.85 + 0.12);
        const radius = 110 + Math.random() * 30;
        positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
        positions[i * 3 + 1] = Math.cos(phi) * radius;
        positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: theme.hemi.sky,
        size: 1.6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        fog: false,
    });
    return new THREE.Points(geometry, material);
}

function buildDust(level: Level3D, theme: MazeTheme): {
    points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    base: Float32Array;
} {
    const count = 260;
    const base = new Float32Array(count * 3);
    const halfW = (level.width * CELL) / 2;
    const halfH = (level.height * CELL) / 2;
    for (let i = 0; i < count; i++) {
        base[i * 3] = (Math.random() * 2 - 1) * halfW;
        base[i * 3 + 1] = 0.2 + Math.random() * 2.6;
        base[i * 3 + 2] = (Math.random() * 2 - 1) * halfH;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
    const material = new THREE.PointsMaterial({
        color: theme.accent,
        size: 0.055,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
    });
    return { points: new THREE.Points(geometry, material), base };
}

function makeBurst(x: number, y: number, z: number, color: number): Burst {
    const count = 26;
    const positions = new Float32Array(count * 3);
    const velocity = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        const theta = Math.random() * Math.PI * 2;
        const speed = 1.1 + Math.random() * 2.2;
        velocity[i * 3] = Math.cos(theta) * speed * 0.55;
        velocity[i * 3 + 1] = 1.2 + Math.random() * 2.4;
        velocity[i * 3 + 2] = Math.sin(theta) * speed * 0.55;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color,
        size: 0.11,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    return { points: new THREE.Points(geometry, material), velocity, life: 1 };
}

function buildCoin(): THREE.Group {
    const group = new THREE.Group();

    const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd166,
        emissive: 0xb97a00,
        emissiveIntensity: 0.9,
        metalness: 0.88,
        roughness: 0.24,
    });
    // 浮雕外圈：略亮一档，转起来能看出币的厚度
    const rimMaterial = new THREE.MeshStandardMaterial({
        color: 0xffe9a8,
        emissive: 0xffb300,
        emissiveIntensity: 1.05,
        metalness: 0.95,
        roughness: 0.16,
    });
    const faceMaterial = new THREE.MeshStandardMaterial({
        color: 0xc98c12,
        emissive: 0x6b3f00,
        emissiveIntensity: 0.6,
        metalness: 0.8,
        roughness: 0.35,
    });

    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.06, 24), goldMaterial);
    disc.rotation.x = Math.PI / 2;

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.03, 10, 32), rimMaterial);

    // 正反两面的内凹币面
    const faceGeometry = new THREE.CircleGeometry(0.168, 24);
    const faceFront = new THREE.Mesh(faceGeometry, faceMaterial);
    faceFront.position.z = 0.032;
    const faceBack = new THREE.Mesh(faceGeometry, faceMaterial);
    faceBack.position.z = -0.032;
    faceBack.rotation.y = Math.PI;

    group.add(disc, rim, faceFront, faceBack);

    // 地上的一圈光斑：金币悬在空中，脚下总得有点“落点”
    const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.46, 28),
        new THREE.MeshBasicMaterial({
            color: 0xffc94d,
            transparent: true,
            opacity: 0.26,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -1.03;
    group.add(halo);

    group.position.y = 1.05;
    return group;
}

function buildDoor(level: Level3D, door: Door, theme: MazeTheme): THREE.Group {
    const group = new THREE.Group();

    const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 0.88, metalness: 0.08 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x3d352b, roughness: 0.78, metalness: 0.18 });
    const slabMaterial = new THREE.MeshStandardMaterial({
        color: 0x14100c,
        emissive: 0x120a03,
        emissiveIntensity: 0.7,
        roughness: 0.82,
        metalness: 0.1,
    });
    const emblemMaterial = new THREE.MeshStandardMaterial({
        color: theme.accent,
        emissive: theme.accent,
        emissiveIntensity: 1.4,
        roughness: 0.3,
        metalness: 0.2,
    });
    const runeMaterial = new THREE.MeshStandardMaterial({
        color: theme.accent,
        emissive: theme.accent,
        emissiveIntensity: 1.1,
        roughness: 0.35,
        metalness: 0.25,
    });

    // 柱础 + 立柱 + 檐口：门框是石作的，比光秃秃两根柱子稳得多
    const plinthGeometry = new THREE.BoxGeometry(0.28, 0.16, 0.46);
    const postGeometry = new THREE.BoxGeometry(0.16, 1.94, 0.36);
    [-0.78, 0.78].forEach((x) => {
        const plinth = new THREE.Mesh(plinthGeometry, trimMaterial);
        plinth.position.set(x, 0.08, 0);
        const post = new THREE.Mesh(postGeometry, stoneMaterial);
        post.position.set(x, 1.13, 0);
        group.add(plinth, post);
    });

    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.22, 0.36), stoneMaterial);
    lintel.position.set(0, 2.02, 0);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.1, 0.44), trimMaterial);
    cornice.position.set(0, 2.17, 0);

    // 门芯：深色石板，留一条中缝，看着像两扇对开
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.42, 1.86, 0.12), slabMaterial);
    slab.position.set(0, 0.98, 0);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.86, 0.13), trimMaterial);
    seam.position.set(0, 0.98, 0.005);

    // 门幕：一层很淡的强调色，所有门都一样，不剧透哪扇是出口
    const veilMaterial = new THREE.MeshBasicMaterial({
        color: theme.accent,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 1.78), veilMaterial);
    veil.position.set(0, 0.98, 0.075);

    const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), emblemMaterial);
    emblem.position.set(0, 1.3, 0.085);

    // 两圈符文环，一正一反慢慢转
    const runeOuter = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.011, 8, 40), runeMaterial);
    runeOuter.position.set(0, 1.3, 0.1);
    const runeInner = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.009, 8, 32), runeMaterial);
    runeInner.position.set(0, 1.3, 0.11);

    group.add(lintel, cornice, slab, seam, veil, emblem, runeOuter, runeInner);

    // 门朝着唯一的那条通道：邻居在 x 方向就转 90°
    const openAlongX = !isWall(level, door.x - 1, door.z) || !isWall(level, door.x + 1, door.z);
    group.rotation.y = openAlongX ? Math.PI / 2 : 0;
    group.position.set(worldX(door.x, level.width), 0, worldZ(door.z, level.height));

    group.userData.emblemMaterial = emblemMaterial;
    group.userData.runeMaterial = runeMaterial;
    group.userData.veilMaterial = veilMaterial;
    group.userData.runes = [runeOuter, runeInner];
    return group;
}

function buildScene(
    container: HTMLDivElement,
    level: Level3D,
    theme: MazeTheme,
    onReady?: () => void,
): Runtime {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.sky);
    scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);

    // 天空穹顶：一层竖向渐变，比纯色背景有空间感
    const skyMaterial = new THREE.MeshBasicMaterial({
        map: makeSkyTexture(theme),
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 20, 14), skyMaterial);
    scene.add(sky);

    const stars = buildStars(theme);
    scene.add(stars);

    const dust = buildDust(level, theme);
    scene.add(dust.points);

    const gizmo = createGizmo(theme);
    scene.add(gizmo.group);

    // 起点光圈
    const ringMaterial = new THREE.MeshStandardMaterial({
        color: theme.accent,
        emissive: theme.accent,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 32), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(worldX(level.start.x, level.width), 0.02, worldZ(level.start.z, level.height));
    scene.add(ring);

    const camera = new THREE.PerspectiveCamera(76, 1, 0.05, 240);
    camera.rotation.order = 'YXZ';

    const hemi = new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, theme.dirIntensity);
    sun.position.set(-8, 16, 6);
    scene.add(sun);

    // 玩家提灯：跟着相机走的小范围点光，近处墙面亮、远处沉进雾里
    const lantern = new THREE.PointLight(theme.accent, 0.5, 6.5, 2);
    lantern.position.set(0, 1.4, 0);
    scene.add(lantern);

    // 通关光环：平时藏着，走到出口才在脚下爆开
    const exitRing = new THREE.Mesh(
        new THREE.RingGeometry(0.45, 0.62, 36),
        new THREE.MeshBasicMaterial({
            color: 0xffd166,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    exitRing.rotation.x = -Math.PI / 2;
    exitRing.position.set(worldX(level.exit.x, level.width), 0.06, worldZ(level.exit.z, level.height));
    exitRing.visible = false;
    scene.add(exitRing);

    const floorMaterial = new THREE.MeshStandardMaterial({
        map: makeFloorTexture(theme, level),
        metalness: theme.floor.metalness,
        roughness: theme.floor.roughness,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(level.width * CELL, level.height * CELL), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const runtime: Runtime = {
        scene,
        camera,
        renderer,
        hemi,
        sun,
        floor,
        sky,
        stars,
        dust: dust.points,
        dustBase: dust.base,
        wallMesh: null,
        wallCap: null,
        lantern,
        coins: new Map(),
        doorEmblems: [],
        doorRunes: [],
        doorVeils: [],
        accentMaterials: [ringMaterial],
        startRing: ring,
        exitRing,
        exitFlash: 0,
        gizmo,
        gizmoMood: 'idle',
        gizmoArrow: null,
        bursts: [],
        target: { x: 0, z: 0, yaw: 0 },
        phase: 0,
        shake: 0,
        last: performance.now(),
        raf: 0,
        observer: null,
        disposed: false,
        theme,
        level,
        leading: false,
    };

    // ---- 金币 ----
    level.coins.forEach((coin) => {
        const group = buildCoin();
        group.position.x = worldX(coin.x, level.width);
        group.position.z = worldZ(coin.z, level.height);
        scene.add(group);
        runtime.coins.set(cellKey(coin.x, coin.z), group);
    });

    // ---- 门 ----
    const doorGroup = new THREE.Group();
    level.doors.forEach((door) => {
        const group = buildDoor(level, door, theme);
        const emblem = group.userData.emblemMaterial as THREE.MeshStandardMaterial | undefined;
        if (emblem) runtime.doorEmblems.push(emblem);
        const runeMaterial = group.userData.runeMaterial as THREE.MeshStandardMaterial | undefined;
        if (runeMaterial) runtime.doorEmblems.push(runeMaterial);
        const runes = group.userData.runes as THREE.Mesh[] | undefined;
        if (runes) runtime.doorRunes.push(...runes);
        const veil = group.userData.veilMaterial as THREE.MeshBasicMaterial | undefined;
        if (veil) runtime.doorVeils.push(veil);
        doorGroup.add(group);
    });
    scene.add(doorGroup);

    // ---- 墙体（GLB 模型 → InstancedMesh）----
    const loader = new GLTFLoader();
    loader.load(
        WALL_MODEL_URL,
        (gltf) => {
            onReady?.();
            if (runtime.disposed) return;
            const source = findMesh(gltf.scene, 'wall') ?? findMesh(gltf.scene);
            if (!source) return;

            const activeTheme = runtime.theme;
            const geometry = source.geometry.clone();
            geometry.computeBoundingBox();
            const box = geometry.boundingBox;
            const scale = box ? CELL / Math.max(box.max.x - box.min.x, 0.0001) : 1;

            const material = new THREE.MeshStandardMaterial({
                vertexColors: true,
                color: activeTheme.wall.color,
                emissive: activeTheme.wall.emissive,
                emissiveIntensity: activeTheme.wall.emissiveIntensity,
                metalness: activeTheme.wall.metalness,
                roughness: activeTheme.wall.roughness,
            });

            // 墙体是没 UV 的低多边形模型，贴图无从下手，
            // 于是按世界坐标做程序化石材：斑驳纹理 + 接地压暗 + 顶部受光 + 顶沿高光。
            const wallHeight = box ? Math.max(box.max.y * scale, 0.001) : CELL;
            const rimUniform = { value: new THREE.Color(activeTheme.accent) };
            material.userData.rimUniform = rimUniform;

            material.onBeforeCompile = (shader) => {
                shader.uniforms.uWallHeight = { value: wallHeight };
                shader.uniforms.uRim = rimUniform;

                shader.vertexShader = shader.vertexShader
                    .replace(
                        '#include <common>',
                        `#include <common>
varying vec3 vWallWorld;`,
                    )
                    .replace(
                        '#include <begin_vertex>',
                        `#include <begin_vertex>
#ifdef USE_INSTANCING
    vWallWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
#else
    vWallWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif`,
                    );

                shader.fragmentShader = shader.fragmentShader
                    .replace(
                        '#include <common>',
                        `#include <common>
uniform float uWallHeight;
uniform vec3 uRim;
varying vec3 vWallWorld;
float wallHash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
float wallNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
        mix( wallHash( i ), wallHash( i + vec2( 1.0, 0.0 ) ), u.x ),
        mix( wallHash( i + vec2( 0.0, 1.0 ) ), wallHash( i + vec2( 1.0, 1.0 ) ), u.x ),
        u.y
    );
}`,
                    )
                    .replace(
                        '#include <color_fragment>',
                        `#include <color_fragment>
{
    // 石块斑驳：两层噪声叠在一起，避免规则的重复感
    vec2 np = vec2( vWallWorld.x * 0.85 + vWallWorld.z * 0.35, vWallWorld.y * 1.6 + vWallWorld.z * 0.2 );
    float mottle = wallNoise( np * 1.7 ) * 0.62 + wallNoise( np * 5.1 ) * 0.38;
    diffuseColor.rgb *= mix( 0.87, 1.13, mottle );

    // 高度渐变：贴地处压暗（代替环境光遮蔽），越往上越受光
    float h = clamp( vWallWorld.y / uWallHeight, 0.0, 1.0 );
    diffuseColor.rgb *= mix( 0.55, 1.05, smoothstep( 0.0, 0.9, h ) );

    // 顶沿被光打亮的一道边，顺带把轮廓勾出来
    diffuseColor.rgb += uRim * smoothstep( 0.9, 1.0, h ) * 0.22;
}`,
                    );
            };
            material.customProgramCacheKey = () => 'maze-wall-stone';

            const cells: { x: number; z: number; yaw: number }[] = [];
            for (let z = 0; z < level.height; z++) {
                for (let x = 0; x < level.width; x++) {
                    if (!isWall(level, x, z)) continue;
                    const horizontal = Number(isWall(level, x - 1, z)) + Number(isWall(level, x + 1, z));
                    const vertical = Number(isWall(level, x, z - 1)) + Number(isWall(level, x, z + 1));
                    cells.push({ x, z, yaw: horizontal >= vertical ? 0 : Math.PI / 2 });
                }
            }

            const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
            const matrix = new THREE.Matrix4();
            const quaternion = new THREE.Quaternion();
            const position = new THREE.Vector3();
            const size = new THREE.Vector3(scale, scale, scale);
            const blockTint = new THREE.Color();

            cells.forEach((cell, index) => {
                position.set(worldX(cell.x, level.width), 0, worldZ(cell.z, level.height));
                quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), cell.yaw);
                matrix.compose(position, quaternion, size);
                mesh.setMatrixAt(index, matrix);

                // 每块墙一点点明暗/冷暖差异，整排墙就不会像同一个模子刻出来的
                const seed = Math.abs(Math.sin(cell.x * 12.9898 + cell.z * 78.233));
                const value = 0.9 + (seed % 1) * 0.2;
                const warm = (Math.abs(Math.sin(cell.x * 3.7 + cell.z * 9.1)) % 1) * 0.06 - 0.03;
                blockTint.setRGB(value + warm, value, value - warm);
                mesh.setColorAt(index, blockTint);
            });
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.frustumCulled = false;
            runtime.wallMesh = mesh;
            scene.add(mesh);

            // 墙顶压顶石：墓园是苔石、熔岩是余烬、冰霜是积雪、霓虹是发光边条
            const capGeometry = new THREE.BoxGeometry(CELL * 0.96, 0.12, CELL * 0.96);
            const capMaterial = new THREE.MeshStandardMaterial({
                color: activeTheme.wallCap.color,
                emissive: activeTheme.wallCap.emissive,
                emissiveIntensity: activeTheme.wallCap.emissiveIntensity,
                roughness: 0.82,
                metalness: 0.12,
            });
            const capMesh = new THREE.InstancedMesh(capGeometry, capMaterial, cells.length);
            const capScale = new THREE.Vector3(1, 1, 1);
            cells.forEach((cell, index) => {
                position.set(worldX(cell.x, level.width), wallHeight - 0.05, worldZ(cell.z, level.height));
                quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), cell.yaw);
                matrix.compose(position, quaternion, capScale);
                capMesh.setMatrixAt(index, matrix);
            });
            capMesh.instanceMatrix.needsUpdate = true;
            capMesh.frustumCulled = false;
            runtime.wallCap = capMesh;
            scene.add(capMesh);
        },
        undefined,
        (error) => {
            onReady?.();
            console.error('[Maze3D] 墙体模型加载失败，只渲染地面', error);
        },
    );

    return runtime;
}

function findMesh(root: THREE.Object3D, nameHint?: string): THREE.Mesh | null {
    let found: THREE.Mesh | null = null;
    root.traverse((object) => {
        if (found) return;
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (nameHint && !object.name.toLowerCase().includes(nameHint)) return;
        found = mesh;
    });
    return found;
}

function applyTheme(runtime: Runtime, theme: MazeTheme): void {
    runtime.theme = theme;
    runtime.scene.background = new THREE.Color(theme.sky);
    if (runtime.scene.fog instanceof THREE.Fog) {
        runtime.scene.fog.color.setHex(theme.fog.color);
        runtime.scene.fog.near = theme.fog.near;
        runtime.scene.fog.far = theme.fog.far;
    }
    runtime.hemi.color.setHex(theme.hemi.sky);
    runtime.hemi.groundColor.setHex(theme.hemi.ground);
    runtime.hemi.intensity = theme.hemi.intensity;
    runtime.sun.intensity = theme.dirIntensity;

    const oldSkyMap = runtime.sky.material.map;
    runtime.sky.material.map = makeSkyTexture(theme);
    runtime.sky.material.needsUpdate = true;
    oldSkyMap?.dispose();

    runtime.stars.material.color.setHex(theme.hemi.sky);
    runtime.dust.material.color.set(theme.accent);
    runtime.gizmo.applyTheme(theme);

    const oldMap = runtime.floor.material.map;
    runtime.floor.material.map = makeFloorTexture(theme, runtime.level);
    runtime.floor.material.metalness = theme.floor.metalness;
    runtime.floor.material.roughness = theme.floor.roughness;
    runtime.floor.material.needsUpdate = true;
    oldMap?.dispose();

    if (runtime.wallMesh) {
        const material = runtime.wallMesh.material as THREE.MeshStandardMaterial;
        material.color.setHex(theme.wall.color);
        material.emissive.setHex(theme.wall.emissive);
        material.emissiveIntensity = theme.wall.emissiveIntensity;
        material.metalness = theme.wall.metalness;
        material.roughness = theme.wall.roughness;
        const rim = material.userData.rimUniform as { value: THREE.Color } | undefined;
        rim?.value.set(theme.accent);
        material.needsUpdate = true;
    }

    if (runtime.wallCap) {
        const capMaterial = runtime.wallCap.material as THREE.MeshStandardMaterial;
        capMaterial.color.setHex(theme.wallCap.color);
        capMaterial.emissive.setHex(theme.wallCap.emissive);
        capMaterial.emissiveIntensity = theme.wallCap.emissiveIntensity;
        capMaterial.needsUpdate = true;
    }

    runtime.lantern.color.set(theme.accent);
    runtime.doorVeils.forEach((material) => material.color.set(theme.accent));

    runtime.doorEmblems.forEach((material) => {
        material.color.set(theme.accent);
        material.emissive.set(theme.accent);
    });
    runtime.accentMaterials.forEach((material) => {
        material.color.set(theme.accent);
        material.emissive.set(theme.accent);
    });
}

const MazeWorld = forwardRef<MazeWorldHandle, { level: Level3D; themeId: string; onReady?: () => void }>(
    function MazeWorld({ level, themeId, onReady }, ref) {
        const containerRef = useRef<HTMLDivElement | null>(null);
        const runtimeRef = useRef<Runtime | null>(null);
        const stateRef = useRef<RunState>(createRunState(level));
        const tokenRef = useRef(0);
        const onReadyRef = useRef(onReady);
        onReadyRef.current = onReady;
        const themeRef = useRef(themeId);
        themeRef.current = themeId;

        // 关卡变化 → 重建场景（切换材质主题不重建，只改材质参数）
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            const runtime = buildScene(container, level, getTheme(themeRef.current), () => onReadyRef.current?.());
            runtimeRef.current = runtime;
            stateRef.current = createRunState(level);

            const startX = worldX(level.start.x, level.width);
            const startZ = worldZ(level.start.z, level.height);
            runtime.camera.position.set(startX, EYE_HEIGHT, startZ);
            runtime.camera.rotation.y = -level.facing * (Math.PI / 2);
            runtime.target = { x: startX, z: startZ, yaw: runtime.camera.rotation.y };

            const resize = () => {
                const width = container.clientWidth || 1;
                const height = container.clientHeight || 1;
                runtime.renderer.setSize(width, height, false);
                runtime.camera.aspect = width / height;
                runtime.camera.updateProjectionMatrix();
            };
            resize();
            const observer = new ResizeObserver(resize);
            observer.observe(container);
            runtime.observer = observer;

            const tick = () => {
                if (runtime.disposed) return;
                const now = performance.now();
                const dt = Math.min((now - runtime.last) / 1000, 0.05);
                runtime.last = now;

                const camera = runtime.camera;
                const k = 1 - Math.exp(-9 * dt);
                const dx = runtime.target.x - camera.position.x;
                const dz = runtime.target.z - camera.position.z;
                const moving = Math.hypot(dx, dz) > 0.04;

                camera.position.x += dx * k;
                camera.position.z += dz * k;

                let diff = runtime.target.yaw - camera.rotation.y;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                camera.rotation.y += diff * (1 - Math.exp(-14 * dt));

                if (moving) runtime.phase += dt * 7.5;
                const bob = moving ? Math.sin(runtime.phase) * 0.032 : 0;
                camera.position.y += (EYE_HEIGHT + bob - camera.position.y) * Math.min(1, k * 1.6);

                if (runtime.shake > 0) {
                    camera.position.x += Math.sin(now * 0.05) * 0.06 * runtime.shake;
                    runtime.shake = Math.max(0, runtime.shake - dt * 2.4);
                }

                const time = now / 1000;
                runtime.coins.forEach((coin) => {
                    if (!coin.visible) return;
                    coin.rotation.y += dt * 2.2;
                    coin.position.y = 1.05 + Math.sin(time * 2 + coin.position.x) * 0.08;
                });
                runtime.doorEmblems.forEach((material, index) => {
                    material.emissiveIntensity = 1.1 + Math.sin(time * 2.4 + index) * 0.35;
                });
                runtime.doorRunes.forEach((rune, index) => {
                    rune.rotation.z += dt * (index % 2 === 0 ? 0.5 : -0.36);
                });
                runtime.doorVeils.forEach((material, index) => {
                    material.opacity = 0.1 + Math.sin(time * 1.6 + index * 0.8) * 0.05;
                });

                // 小弟：飘在视线右前方（偏下一点，不挡路）
                const yaw = camera.rotation.y;
                const fx = -Math.sin(yaw);
                const fz = -Math.cos(yaw);
                const rx = Math.cos(yaw);
                const rz = -Math.sin(yaw);
                runtime.gizmo.group.position.set(
                    camera.position.x + fx * 1.2 + rx * 0.55,
                    camera.position.y - 0.3 + Math.sin(time * 1.7) * 0.035,
                    camera.position.z + fz * 1.2 + rz * 0.55,
                );
                runtime.gizmo.update(dt, time, {
                    mood: runtime.gizmoMood,
                    arrowFacing: runtime.gizmoArrow,
                    cameraYaw: yaw,
                    moving,
                });

                // 提灯跟着视点走偏前一点，微弱呼吸
                runtime.lantern.position.set(
                    camera.position.x + fx * 0.45,
                    camera.position.y - 0.18,
                    camera.position.z + fz * 0.45,
                );
                runtime.lantern.intensity = 0.42 + Math.sin(time * 6.5) * 0.035;

                // 空气里的粒子：石头墓园是浮尘，熔岩是往上飘的火星，
                // 冰霜是缓缓落下又回卷的雪，霓虹是横向游走的光点
                const dustAttr = runtime.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
                const dustArray = dustAttr.array as Float32Array;
                const dustBase = runtime.dustBase;
                const dustTheme = runtime.theme.id;
                for (let i = 0; i < dustArray.length; i += 3) {
                    const seed = dustBase[i] * 0.37 + dustBase[i + 2] * 0.19;
                    if (dustTheme === 'lava') {
                        dustArray[i + 1] = 0.25 + ((time * 0.55 + seed) % 2.8);
                        dustArray[i] = dustBase[i] + Math.sin(time * 1.6 + seed) * 0.08;
                    } else if (dustTheme === 'frost') {
                        dustArray[i + 1] = 0.2 + (2.9 - ((time * 0.32 + seed) % 2.7));
                        dustArray[i] = dustBase[i] + Math.sin(time * 0.7 + seed) * 0.14;
                        dustArray[i + 2] = dustBase[i + 2] + Math.cos(time * 0.5 + seed) * 0.1;
                    } else if (dustTheme === 'neon') {
                        dustArray[i] = dustBase[i] + Math.sin(time * 0.6 + seed * 3.0) * 0.55;
                        dustArray[i + 1] = dustBase[i + 1] + Math.sin(time * 0.9 + seed) * 0.18;
                    } else {
                        dustArray[i + 1] = dustBase[i + 1] + Math.sin(time * 0.55 + seed * 2.0) * 0.22;
                    }
                }
                dustAttr.needsUpdate = true;

                // 金币爆闪粒子
                for (let i = runtime.bursts.length - 1; i >= 0; i--) {
                    const burst = runtime.bursts[i];
                    burst.life -= dt * 1.5;
                    const attr = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
                    const array = attr.array as Float32Array;
                    for (let p = 0; p < array.length; p += 3) {
                        burst.velocity[p + 1] -= dt * 6.4;
                        array[p] += burst.velocity[p] * dt;
                        array[p + 1] += burst.velocity[p + 1] * dt;
                        array[p + 2] += burst.velocity[p + 2] * dt;
                    }
                    attr.needsUpdate = true;
                    burst.points.material.opacity = Math.max(0, burst.life);
                    if (burst.life <= 0) {
                        runtime.scene.remove(burst.points);
                        burst.points.geometry.dispose();
                        burst.points.material.dispose();
                        runtime.bursts.splice(i, 1);
                    }
                }

                runtime.startRing.material.opacity = 0.36 + Math.sin(time * 2.2) * 0.18;
                runtime.startRing.scale.setScalar(1 + Math.sin(time * 2.2) * 0.05);
                runtime.stars.rotation.y = time * 0.006;

                // 通关光环：从出口向外扩散一圈就淡掉
                if (runtime.exitFlash > 0) {
                    runtime.exitFlash = Math.max(0, runtime.exitFlash - dt);
                    const progress = 1 - runtime.exitFlash / 1.6;
                    runtime.exitRing.visible = true;
                    runtime.exitRing.scale.setScalar(1 + progress * 3.6);
                    runtime.exitRing.material.opacity = Math.max(0, 0.85 * (1 - progress));
                } else if (runtime.exitRing.visible) {
                    runtime.exitRing.visible = false;
                }

                runtime.renderer.render(runtime.scene, runtime.camera);
                runtime.raf = requestAnimationFrame(tick);
            };
            runtime.raf = requestAnimationFrame(tick);

            return () => {
                runtime.disposed = true;
                tokenRef.current += 1;
                cancelAnimationFrame(runtime.raf);
                runtime.observer?.disconnect();

                runtime.gizmo.dispose();
                [runtime.dust, runtime.stars].forEach((points) => {
                    points.geometry.dispose();
                    points.material.dispose();
                });
                runtime.bursts.forEach((burst) => {
                    burst.points.geometry.dispose();
                    burst.points.material.dispose();
                });
                runtime.bursts = [];
                runtime.sky.material.map?.dispose();

                runtime.scene.traverse((object) => {
                    const mesh = object as THREE.Mesh;
                    if (!mesh.isMesh) return;
                    mesh.geometry?.dispose();
                    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                    materials.forEach((material) => {
                        if (material && 'map' in material) {
                            const map = (material as THREE.MeshStandardMaterial).map;
                            map?.dispose();
                        }
                        material?.dispose();
                    });
                });
                runtime.renderer.dispose();
                if (runtime.renderer.domElement.parentNode === container) {
                    container.removeChild(runtime.renderer.domElement);
                }
                runtimeRef.current = null;
            };
        }, [level]);

        useEffect(() => {
            const runtime = runtimeRef.current;
            if (!runtime) return;
            applyTheme(runtime, getTheme(themeId));
        }, [themeId]);

        useImperativeHandle(
            ref,
            () => ({
                stop() {
                    tokenRef.current += 1;
                },
                reset() {
                    tokenRef.current += 1;
                    const runtime = runtimeRef.current;
                    stateRef.current = createRunState(level);
                    if (!runtime) return;
                    runtime.coins.forEach((coin) => {
                        coin.visible = true;
                    });
                    const startX = worldX(level.start.x, level.width);
                    const startZ = worldZ(level.start.z, level.height);
                    runtime.camera.position.set(startX, EYE_HEIGHT, startZ);
                    runtime.camera.rotation.y = -level.facing * (Math.PI / 2);
                    runtime.target = { x: startX, z: startZ, yaw: runtime.camera.rotation.y };
                    runtime.shake = 0;
                    runtime.gizmoMood = 'idle';
                    runtime.gizmoArrow = null;
                    runtime.exitFlash = 0;
                    runtime.exitRing.visible = false;
                },
                setLeading(leading: boolean) {
                    const runtime = runtimeRef.current;
                    if (!runtime) return;
                    runtime.leading = leading;
                    const hint = senseGizmo(level, stateRef.current, leading);
                    runtime.gizmoMood = hint.mood;
                    runtime.gizmoArrow = hint.arrow;
                },
                async play(commands: Maze3DCommand[], handlers?: PlayHandlers): Promise<PlayResult> {
                    const runtime = runtimeRef.current;
                    if (!runtime) return { status: 'stopped', state: stateRef.current };

                    const token = ++tokenRef.current;
                    let state = stateRef.current;
                    const alive = () => token === tokenRef.current && !runtime.disposed;

                    const moveCamera = (next: RunState) => {
                        runtime.target.x = worldX(next.x, level.width);
                        runtime.target.z = worldZ(next.z, level.height);
                        runtime.target.yaw = -next.facing * (Math.PI / 2);
                    };

                    /** 每走一步都让小弟重新嗅一遍，箭头和心情跟着变 */
                    const refreshGizmo = (next: RunState) => {
                        const hint: GizmoHint = senseGizmo(level, next, runtime.leading);
                        runtime.gizmoMood = hint.mood;
                        runtime.gizmoArrow = hint.arrow;
                    };

                    refreshGizmo(state);

                    for (const command of commands) {
                        if (!alive()) return { status: 'stopped', state };

                        const outcome =
                            command === 'back' ? applyBackward(level, state) : applyCommand(level, state, command);

                        if (outcome.kind === 'turn') {
                            state = outcome.state;
                            moveCamera(state);
                            refreshGizmo(state);
                            sfx.turn();
                            stateRef.current = state;
                            handlers?.onState?.(state);
                            await sleep(TURN_MS);
                            continue;
                        }

                        if (outcome.kind === 'blocked') {
                            sfx.crash();
                            runtime.shake = 1;
                            runtime.gizmoArrow = null;
                            runtime.gizmoMood = 'warn';
                            handlers?.onBlocked?.(state);
                            return { status: 'blocked', state };
                        }

                        if (outcome.kind === 'trap') {
                            state = outcome.state;
                            moveCamera(state);
                            refreshGizmo(state);
                            stateRef.current = state;
                            handlers?.onState?.(state);
                            await sleep(STEP_MS);
                            if (!alive()) return { status: 'stopped', state };

                            const decision = (await handlers?.onTrap?.(outcome.door)) ?? 'resume';
                            if (!alive()) return { status: 'stopped', state };

                            state = bounceBack(state, outcome.from);
                            moveCamera(state);
                            refreshGizmo(state);
                            stateRef.current = state;
                            handlers?.onState?.(state);
                            await sleep(STEP_MS);
                            if (decision === 'abort') return { status: 'stopped', state };
                            continue;
                        }

                        if (outcome.kind === 'exit') {
                            state = outcome.state;
                            moveCamera(state);
                            refreshGizmo(state);
                            runtime.gizmo.cheer();
                            sfx.win();

                            // 出口爆一片金色粒子，脚下光环扩散
                            const exitX = worldX(level.exit.x, level.width);
                            const exitZ = worldZ(level.exit.z, level.height);
                            [0xffd166, 0xfff2c4, 0xffb347].forEach((color, index) => {
                                const burst = makeBurst(exitX, 1.1 + index * 0.35, exitZ, color);
                                runtime.bursts.push(burst);
                                runtime.scene.add(burst.points);
                            });
                            runtime.exitFlash = 1.6;

                            stateRef.current = state;
                            handlers?.onState?.(state);
                            await sleep(STEP_MS * 2);
                            return { status: 'win', state };
                        }

                        state = outcome.state;
                        moveCamera(state);
                        if (outcome.kind === 'coin') {
                            const coin = runtime.coins.get(outcome.coin);
                            if (coin) {
                                coin.visible = false;
                                runtime.bursts.push(
                                    makeBurst(coin.position.x, 1.05, coin.position.z, 0xffd166),
                                );
                            }
                            runtime.gizmo.cheer();
                            sfx.pickup();
                        } else {
                            sfx.step();
                        }
                        refreshGizmo(state);
                        stateRef.current = state;
                        handlers?.onState?.(state);
                        await sleep(STEP_MS);
                    }

                    return { status: 'done', state };
                },
            }),
            [level],
        );

        return <div ref={containerRef} className="absolute inset-0" aria-label="3D 迷宫场景" />;
    },
);

export default MazeWorld;
