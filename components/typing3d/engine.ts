/**
 * 3D 打字闯关的渲染引擎（three.js）。
 *
 * 引擎只管「场景 + 移动 + 碰撞 + 相机」，React 那边负责界面和打字判定。
 * 两者靠下面的回调和几个 setter 通信，引擎本身不碰 DOM 之外的东西。
 */

import * as THREE from "three";

import type {
    BoxSpec,
    EasterEggSpec,
    LevelLayout,
    PanelSpec,
    SpawnOption,
    Typing3DItem,
} from "@/lib/typing3d/types";

export type EngineView = "third" | "first";

export interface EngineCallbacks {
    /** 玩家靠近（或离开）答题面板时触发，distance 为当前距离。 */
    onNearPanel: (panel: PanelSpec | null, distance: number) => void;
    /** 玩家穿过打开的门时触发。 */
    onReachDoor: () => void;
    /** 出生点选择界面里，玩家点了某个光环。 */
    onSpawnPick?: (index: number) => void;
    /** 玩家直接点了答题面板（不用走近，远处点一下也能开）。 */
    onPanelClick?: () => void;
    /** 玩家碰到了彩蛋（空中的问号方块 / 跑酷顶端的祭坛）。 */
    onEasterEgg?: (egg: EasterEggSpec, kind: "cube" | "altar") => void;
    /** 玩家踩到了弹跳板。 */
    onBouncePad?: () => void;
}

export interface EngineInput {
    forward: number;
    right: number;
    run: boolean;
}

const PLAYER_RADIUS = 0.45;
const WALK_SPEED = 6.2;
const RUN_SPEED = 9.4;
const ACCELERATION = 12;
/** 角色的身高：用来判断能不能从方块底下钻过去。 */
const PLAYER_HEIGHT = 1.9;
/** 重力加速度（单位/秒²）。 */
const GRAVITY = 26;
/** 起跳速度：一次能跳 2.1 米高。 */
const JUMP_VELOCITY = 10.6;
/** 最多能跳两次：地面一次 + 空中再蹬一次。 */
const MAX_JUMPS = 2;
/** 离开地面后的宽容期：这段时间里仍然可以起跳。 */
const COYOTE_TIME = 0.12;
/** 跳跃缓冲：落地前按了空格，落地那一瞬间自动起跳。 */
const JUMP_BUFFER = 0.14;
/** 弹跳板的弹射速度（约 2.8 米高）。 */
const BOUNCE_VELOCITY = 12;
/** 自动上台阶的容差：没到这个高度就得跳一下。 */
const STEP_UP = 0.36;
/** 下落速度上限，防止穿过地面。 */
const MAX_FALL_SPEED = 34;
const PANEL_REACH = 3.4;
const CAMERA_DISTANCE = 8.2;
const CAMERA_HEIGHT = 5.4;
/** 相机收敛速度：每秒能追上多少比例的差距。
 * 用「每秒比例」而不是「每帧比例」，帧率掉了镜头速度才不会跟着变慢。 */
const CAMERA_FOLLOW_RATE = 10;
const CAMERA_OVERVIEW_RATE = 5;

/** 画质阶梯：卡得厉害就一档一档往下调，只降不升，免得来回抖。 */
const PIXEL_RATIO_LADDER = [1.75, 1.25, 1, 0.7];

/** 浏览器打不开 3D 画面时抛这个，React 那头好给出人话提示。 */
export class WebGLUnavailableError extends Error {
    originalError: unknown;

    constructor(originalError: unknown) {
        super("这台设备的浏览器打不开 3D 画面（WebGL）");
        this.name = "WebGLUnavailableError";
        this.originalError = originalError;
    }
}

/** 建渲染器；浏览器没 WebGL 时抛 WebGLUnavailableError，别让整页崩掉。 */
function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
    try {
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_LADDER[0]));
        renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.domElement.style.display = "block";
        renderer.domElement.style.touchAction = "none";
        container.appendChild(renderer.domElement);
        return renderer;
    } catch (error) {
        throw new WebGLUnavailableError(error);
    }
}
function makeGradientTexture(top: number, bottom: number): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
        const gradient = context.createLinearGradient(0, 0, 0, 256);
        gradient.addColorStop(0, `#${top.toString(16).padStart(6, "0")}`);
        gradient.addColorStop(1, `#${bottom.toString(16).padStart(6, "0")}`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, 8, 256);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function makeFloorTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, 256, 256);
        context.strokeStyle = "rgba(0,0,0,0.10)";
        context.lineWidth = 2;
        for (let offset = 0; offset <= 256; offset += 64) {
            context.beginPath();
            context.moveTo(offset, 0);
            context.lineTo(offset, 256);
            context.stroke();
            context.beginPath();
            context.moveTo(0, offset);
            context.lineTo(256, offset);
            context.stroke();
        }
        context.fillStyle = "rgba(255,255,255,0.35)";
        for (let x = 12; x < 256; x += 64) {
            for (let y = 12; y < 256; y += 64) {
                context.fillRect(x, y, 8, 8);
            }
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(7, 7);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function makeGlowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, "rgba(255,255,255,0.95)");
        gradient.addColorStop(0.3, "rgba(255,255,255,0.35)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function makeShadowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
        const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
        gradient.addColorStop(0, "rgba(0,0,0,0.42)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/**
 * 画一个圆角矩形（Canvas 2D 的 roundRect 在老浏览器上不一定有）。
 */
function roundRectPath(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
}

const KIND_LABEL: Record<Typing3DItem["kind"], string> = {
    zh: "中文",
    en: "英文",
    code: "代码",
    sym: "符号",
};

/** 把题目画到画布上，贴到面板的全息屏里。 */
function paintPanelTexture(
    item: Typing3DItem,
    pinyinMode: boolean,
    solved: boolean,
): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.textAlign = "center";
        context.textBaseline = "middle";

        // 左上角的「打字」标记：远远就能认出这是答题面板。
        // 字号给到 60px（占画面高度五分之一），再垫一层深色底 + 发光边，
        // 站在房间另一头也能一眼认出，不会只剩一个模糊的方块。
        context.save();
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.font = '700 60px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
        const badgeText = "打字";
        const badgeWidth = context.measureText(badgeText).width + 52;
        const badgeHeight = 88;
        context.shadowColor = solved ? "rgba(141,255,192,0.85)" : "rgba(126,249,228,0.8)";
        context.shadowBlur = 26;
        roundRectPath(context, 30, 16, badgeWidth, badgeHeight, 18);
        context.fillStyle = solved ? "rgba(20,86,58,0.92)" : "rgba(10,38,52,0.92)";
        context.fill();
        context.shadowBlur = 0;
        roundRectPath(context, 30, 16, badgeWidth, badgeHeight, 18);
        context.strokeStyle = solved ? "rgba(141,255,192,0.95)" : "rgba(126,249,228,0.9)";
        context.lineWidth = 4;
        context.stroke();
        context.fillStyle = solved ? "#8dffc0" : "#9ef7e6";
        context.fillText(badgeText, 56, 60);
        context.restore();

        const showPinyin = item.kind === "zh" && Boolean(item.pinyin);
        const mainText = pinyinMode && showPinyin ? (item.pinyin as string) : item.text;
        const fontSize = mainText.length > 14 ? 60 : mainText.length > 9 ? 74 : 92;

        context.fillStyle = solved ? "#8dffc0" : "#ffffff";
        context.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
        context.fillText(mainText, canvas.width / 2, 168, 940);

        if (showPinyin) {
            context.fillStyle = solved ? "#63e8a2" : "#86f7e6";
            context.font = '400 44px "Segoe UI", "Microsoft YaHei", sans-serif';
            const hint = pinyinMode ? item.text : (item.pinyin as string);
            context.fillText(hint, canvas.width / 2, 240, 900);
        }

        context.fillStyle = "rgba(200,215,245,0.9)";
        context.font = '400 32px "Microsoft YaHei", sans-serif';
        context.fillText(
            `${KIND_LABEL[item.kind]} · 难度 ${"★".repeat(item.tier)}`,
            canvas.width / 2,
            292,
        );
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

export class Typing3DEngine {
    private readonly container: HTMLElement;
    private readonly callbacks: EngineCallbacks;

    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera: THREE.PerspectiveCamera;
    private lastFrameTime = 0;
    private elapsedTime = 0;

    private levelGroup = new THREE.Group();
    private blockers: THREE.Object3D[] = [];

    private player = new THREE.Group();
    private playerModel = new THREE.Group();
    private blobShadow: THREE.Mesh | null = null;

    private panelMesh: THREE.Mesh | null = null;
    private panelTexture: THREE.CanvasTexture | null = null;
    private panelGlow: THREE.Sprite | null = null;
    private panelLight: THREE.PointLight | null = null;
    private panelFloat: THREE.Group | null = null;
    private doorSlab: THREE.Mesh | null = null;
    private doorPortal: THREE.Mesh | null = null;

    private layout: LevelLayout | null = null;
    private item: Typing3DItem | null = null;
    private pinyinMode = false;

    private readonly position = new THREE.Vector3();
    private readonly velocity = new THREE.Vector3();
    private yaw = 0;
    private pitch = -0.16;
    private view: EngineView = "third";
    private walking = false;
    private walkPhase = 0;
    private doorProgress = 0;
    private doorOpen = false;
    /** 门已经触发过了：一次穿门只能进一关。 */
    private doorConsumed = false;
    private dragging = false;
    /** 画质档位（PIXEL_RATIO_LADDER 的下标），卡了就往下调。 */
    private qualityStep = 0;
    private qualityCheckedAt = 0;
    private qualityFrames = 0;
    private disposed = false;
    private frame = 0;
    private nearPanelId: number | null = null;
    private debugSample: number[] | null = null;

    // 出生点选择：地面光环 / 光柱 / 名字牌，外加一台俯视镜头
    private spawnGroup: THREE.Group | null = null;
    private spawnRings: THREE.Mesh[] = [];
    private spawnOptions: SpawnOption[] = [];
    private selectedSpawn = -1;
    private overviewMode = false;
    private spawnPickEnabled = false;
    private pointerDownAt = { x: 0, y: 0 };
    private input: EngineInput = { forward: 0, right: 0, run: false };
    /** 竖直方向的速度（重力、起跳、弹射都在这里）。 */
    private verticalVelocity = 0;
    /** 是不是踩在地面 / 平台上。 */
    private grounded = true;
    /** 还能在空中蹬几次。 */
    private jumpsLeft = MAX_JUMPS;
    /** 离开地面后的宽容期。 */
    private coyoteTimer = 0;
    /** 跳跃缓冲：按早了也认。 */
    private jumpBufferTimer = 0;
    /** 本关已经收集的彩蛋编号。 */
    private collectedEggs = new Set<number>();
    /** 彩蛋模型（动画和拾取判定都要用）。 */
    private eggMeshes: Array<{ mesh: THREE.Object3D; spec: EasterEggSpec }> = [];
    /** 弹跳板是否还能再弹：踩上去弹一次，落地不再连着弹。 */
    private bounceArmed = true;
    /** 弹跳板（踩上去时闪一下）。 */
    private bouncePads: Array<{ group: THREE.Group; glow: THREE.Mesh }> = [];

    private readonly floorTexture = makeFloorTexture();
    private readonly glowTexture = makeGlowTexture();
    private readonly shadowTexture = makeShadowTexture();

    constructor(container: HTMLElement, callbacks: EngineCallbacks) {
        this.container = container;
        this.callbacks = callbacks;

        this.renderer = createRenderer(container);

        this.camera = new THREE.PerspectiveCamera(55, this.aspect(), 0.1, 240);
        this.camera.position.set(0, 5, 10);

        this.scene.add(this.levelGroup);
        this.buildPlayer();

        const hemisphere = new THREE.HemisphereLight(0x9fb8ff, 0x2b2118, 0.95);
        this.scene.add(hemisphere);
        const sun = new THREE.DirectionalLight(0xfff1d8, 1.15);
        sun.position.set(14, 24, 9);
        this.scene.add(sun);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.24));

        this.bindEvents();
        this.exposeDebugHook();
        this.lastFrameTime = performance.now();
        this.loop();
    }

    private aspect(): number {
        const width = this.container.clientWidth || 800;
        const height = this.container.clientHeight || 600;
        return width / Math.max(1, height);
    }

    /** 开发期给自动化验收用的小钩子，正式构建会被去掉。 */
    private exposeDebugHook(): void {
        if (process.env.NODE_ENV === "production") return;
        (window as unknown as { __typing3d?: unknown }).__typing3d = {
            panel: () => this.layout?.panels[0] ?? null,
            door: () => this.layout?.door ?? null,
            player: () => ({
                x: this.position.x,
                y: this.position.y,
                z: this.position.z,
                grounded: this.grounded,
            }),
            jump: () => this.requestJump(),
            eggs: () => this.layout?.eggs ?? [],
            layout: () => this.layout ?? null,
            collected: () => Array.from(this.collectedEggs),
            input: () => ({ ...this.input }),
            yaw: () => this.yaw,
            teleport: (x: number, z: number) => {
                this.position.set(x, 0, z);
                this.velocity.set(0, 0, 0);
            },
            // 传送到空中（自动化验收跑酷用）
            teleportTo: (x: number, y: number, z: number) => {
                const safeX = Number.isFinite(x) ? x : 0;
                const safeY = Number.isFinite(y) ? y : 0;
                const safeZ = Number.isFinite(z) ? z : 0;
                this.position.set(safeX, safeY, safeZ);
                this.velocity.set(0, 0, 0);
                this.verticalVelocity = 0;
                this.grounded = false;
            },
            faceTowards: (x: number, z: number) => {
                this.yaw = Math.atan2(-(x - this.position.x), -(z - this.position.z));
            },
            doorOpen: () => this.doorOpen,
            sample: () => this.debugSample,
            spawns: () => this.spawnOptions,
            selectedSpawn: () => this.selectedSpawn,
            selectSpawn: (index: number) => this.selectSpawn(index),
            // 把出生点投影到屏幕坐标，自动化验收用（真实玩家直接点光环）
            screenPos: (index: number) => {
                const option = this.spawnOptions[index];
                if (!option) return null;
                const vector = new THREE.Vector3(option.x, 0.2, option.z).project(this.camera);
                const rect = this.renderer.domElement.getBoundingClientRect();
                return {
                    x: rect.left + ((vector.x + 1) / 2) * rect.width,
                    y: rect.top + ((1 - vector.y) / 2) * rect.height,
                };
            },
        };
    }

    private bindEvents(): void {
        const canvas = this.renderer.domElement;
        canvas.addEventListener("pointerdown", this.handlePointerDown);
        window.addEventListener("pointerup", this.handlePointerUp);
        window.addEventListener("pointermove", this.handlePointerMove);
        canvas.addEventListener("contextmenu", this.handleContextMenu);
        window.addEventListener("resize", this.handleResize);
    }

    private handleContextMenu = (event: Event) => {
        event.preventDefault();
    };

    private handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        this.dragging = true;
        this.pointerDownAt = { x: event.clientX, y: event.clientY };
    };

    private handlePointerUp = (event: PointerEvent) => {
        this.dragging = false;
        // 拖动是在转视角，只有几乎没移动的才当成点击
        const moved = Math.hypot(
            event.clientX - this.pointerDownAt.x,
            event.clientY - this.pointerDownAt.y,
        );
        if (moved > 6) return;
        if (event.target !== this.renderer.domElement) return;
        this.pickAt(event);
    };

    /** 点击拾取：出生点光环优先，其次是答题面板。 */
    private pickAt(event: PointerEvent): void {
        const rect = this.renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const pointer = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, this.camera);

        if (this.spawnPickEnabled && this.spawnGroup) {
            const hits = raycaster.intersectObjects(this.spawnGroup.children, true);
            for (const hit of hits) {
                const index = hit.object.userData.spawnIndex;
                if (typeof index === "number") {
                    this.selectSpawn(index);
                    this.callbacks.onSpawnPick?.(index);
                    return;
                }
            }
            return;
        }

        if (this.panelMesh) {
            const hits = raycaster.intersectObject(this.panelMesh, true);
            if (hits.length) this.callbacks.onPanelClick?.();
        }
    }

    private handlePointerMove = (event: PointerEvent) => {
        const locked = document.pointerLockElement === this.renderer.domElement;
        if (!locked && !this.dragging) return;
        this.look(event.movementX || 0, event.movementY || 0);
    };

    private handleResize = () => {
        const width = this.container.clientWidth || 800;
        const height = this.container.clientHeight || 600;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / Math.max(1, height);
        this.camera.updateProjectionMatrix();
    };

    /**
     * 真机太卡就降画质。
     *
     * 每两秒算一次平均帧率，低于 26 就把像素比往下调一档；只降不升，
     * 老笔记本和手机上不会来回抖，调到最差那档就不动了。
     */
    private checkPerformance(now: number): void {
        if (!this.qualityCheckedAt) {
            this.qualityCheckedAt = now;
            return;
        }
        this.qualityFrames += 1;
        const elapsed = (now - this.qualityCheckedAt) / 1000;
        if (elapsed < 2) return;
        const fps = this.qualityFrames / elapsed;
        this.qualityCheckedAt = now;
        this.qualityFrames = 0;

        if (fps >= 26) return;
        if (this.qualityStep >= PIXEL_RATIO_LADDER.length - 1) return;
        this.qualityStep += 1;
        const ratio = Math.min(
            window.devicePixelRatio || 1,
            PIXEL_RATIO_LADDER[this.qualityStep],
        );
        this.renderer.setPixelRatio(ratio);
        this.handleResize();
    }

    /** 鼠标拖动 / 指针锁定时的视角旋转。 */
    look(deltaX: number, deltaY: number): void {
        const sensitivity = 0.0026;
        this.yaw -= deltaX * sensitivity;
        this.pitch -= deltaY * sensitivity;
        const limit = Math.PI / 2 - 0.08;
        this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    }

    setInput(input: Partial<EngineInput>): void {
        this.input = { ...this.input, ...input };
    }

    /** 请求起跳：空格键 / 手机上的跳跃按钮都走这里。 */
    requestJump(): void {
        this.jumpBufferTimer = JUMP_BUFFER;
    }

    setView(view: EngineView): void {
        this.view = view;
    }

    toggleView(): EngineView {
        this.view = this.view === "third" ? "first" : "third";
        return this.view;
    }

    setPinyinMode(enabled: boolean): void {
        this.pinyinMode = enabled;
        if (this.item && this.panelMesh && this.panelTexture) {
            this.panelTexture.dispose();
            const next = paintPanelTexture(this.item, this.pinyinMode, this.doorOpen);
            this.panelTexture = next;
            const material = this.panelMesh.material as THREE.MeshBasicMaterial;
            material.map = next;
            material.needsUpdate = true;
        }
    }

    /** 载入新关卡：重建场景并把玩家放回出生点。 */
    loadLevel(layout: LevelLayout, item: Typing3DItem): void {
        this.layout = layout;
        this.item = item;
        this.doorOpen = false;
        this.doorProgress = 0;
        this.doorConsumed = false;
        this.nearPanelId = null;
        this.hideSpawnMarkers();
        this.overviewMode = false;

        this.scene.remove(this.levelGroup);
        this.levelGroup = new THREE.Group();
        this.scene.add(this.levelGroup);
        this.blockers = [];
        this.collectedEggs.clear();
        this.eggMeshes = [];
        this.bouncePads = [];

        this.scene.background = makeGradientTexture(
            new THREE.Color(layout.theme.fog).offsetHSL(0, 0, 0.08).getHex(),
            0x05060f,
        );
        this.scene.fog = new THREE.Fog(layout.theme.fog, 34, 130);

        this.buildFloor(layout);
        this.buildBoxes(layout);
        this.buildBraziers(layout);
        this.buildPlatforms(layout);
        this.buildEasterEggs(layout);
        this.buildPanel(layout, item);
        this.buildDoor(layout);
        this.levelGroup.updateMatrixWorld(true);

        this.position.set(layout.spawn.x, 0, layout.spawn.z);
        this.velocity.set(0, 0, 0);
        this.verticalVelocity = 0;
        this.grounded = true;
        this.jumpsLeft = MAX_JUMPS;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        this.bounceArmed = true;
        // 一进场就朝着答题面板，玩家一眼能看见目标
        const panel = layout.panels[0];
        this.yaw = Math.atan2(
            -(panel.x - layout.spawn.x),
            -(panel.z - layout.spawn.z),
        );
        this.pitch = -0.16;
        this.player.position.copy(this.position);
        this.levelGroup.add(this.player);
    }

    /** 出生点选择界面：地面光环 + 光柱 + 名字牌。 */
    showSpawnMarkers(options: SpawnOption[], selectedIndex: number): void {
        this.hideSpawnMarkers();
        this.spawnOptions = options;
        this.spawnPickEnabled = true;

        const group = new THREE.Group();
        options.forEach((option, index) => {
            const color = new THREE.Color(option.color);

            const pad = new THREE.Mesh(
                new THREE.CircleGeometry(1.15, 32),
                new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: 0.24,
                    side: THREE.DoubleSide,
                }),
            );
            pad.rotation.x = -Math.PI / 2;
            pad.position.set(option.x, 0.03, option.z);
            group.add(pad);

            const ring = new THREE.Mesh(
                new THREE.RingGeometry(1.25, 1.72, 44),
                new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: 0.85,
                    side: THREE.DoubleSide,
                }),
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(option.x, 0.05, option.z);
            ring.userData.spawnIndex = index;
            group.add(ring);
            this.spawnRings.push(ring);

            const beam = new THREE.Mesh(
                new THREE.CylinderGeometry(0.85, 1.05, 5.4, 20, 1, true),
                new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: 0.16,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                }),
            );
            beam.position.set(option.x, 2.7, option.z);
            beam.userData.spawnIndex = index;
            group.add(beam);

            const label = this.makeLabelSprite(option.name, color);
            label.position.set(option.x, 4.6, option.z);
            group.add(label);
        });

        this.scene.add(group);
        this.spawnGroup = group;
        if (selectedIndex >= 0) this.selectSpawn(selectedIndex);
    }

    /** 选中的光环更亮一点，并把玩家挪到那个点上。 */
    selectSpawn(index: number): void {
        if (index < 0 || index >= this.spawnOptions.length) return;
        this.selectedSpawn = index;
        this.spawnRings.forEach((ring, order) => {
            const material = ring.material as THREE.MeshBasicMaterial;
            const selected = order === index;
            material.opacity = selected ? 1 : 0.34;
            ring.scale.setScalar(selected ? 1.14 : 0.9);
        });
        this.placeAtSpawn(this.spawnOptions[index]);
    }

    /** 把玩家放到某个出生点，并转向答题面板。 */
    placeAtSpawn(option: SpawnOption): void {
        this.position.set(option.x, 0, option.z);
        this.velocity.set(0, 0, 0);
        this.player.position.copy(this.position);
        const panel = this.layout?.panels[0];
        if (panel) {
            this.yaw = Math.atan2(
                -(panel.x - this.position.x),
                -(panel.z - this.position.z),
            );
        }
        this.pitch = -0.16;
    }

    /** 关掉出生点选择，回到正常探索画面。 */
    hideSpawnMarkers(): void {
        if (this.spawnGroup) {
            this.scene.remove(this.spawnGroup);
            this.spawnGroup.traverse((object) => {
                const mesh = object as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
                if (Array.isArray(material)) material.forEach((item) => item.dispose());
                else if (material) material.dispose();
            });
            this.spawnGroup = null;
        }
        this.spawnRings = [];
        this.spawnOptions = [];
        this.selectedSpawn = -1;
        this.spawnPickEnabled = false;
    }

    /** 出生点选择时用俯视镜头，一眼看全所有光环。 */
    setOverview(enabled: boolean): void {
        this.overviewMode = enabled;
    }

    /** 给出生点做一块始终朝着相机的名字牌。 */
    private makeLabelSprite(text: string, color: THREE.Color): THREE.Sprite {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 128;
        const context = canvas.getContext("2d");
        if (context) {
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = "rgba(8, 12, 30, 0.78)";
            context.fillRect(8, 18, 496, 92);
            context.strokeStyle = `#${color.getHexString()}`;
            context.lineWidth = 4;
            context.strokeRect(8, 18, 496, 92);
            context.fillStyle = `#${color.getHexString()}`;
            context.font = '600 50px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(text, 256, 66, 460);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
        );
        sprite.scale.set(5.6, 1.4, 1);
        return sprite;
    }

    /** 一个只有字、没有底框的小标记（彩蛋上的问号用）。 */
    private makeMarkSprite(text: string, color: THREE.Color): THREE.Sprite {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext("2d");
        if (context) {
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.font = 'bold 190px system-ui, "Segoe UI", sans-serif';
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.shadowColor = "rgba(20, 10, 0, 0.6)";
            context.shadowBlur = 22;
            context.fillStyle = `#${color.getHexString()}`;
            context.fillText(text, canvas.width / 2, canvas.height / 2 + 6);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
        );
        sprite.scale.set(0.62, 0.62, 1);
        return sprite;
    }

    private buildFloor(layout: LevelLayout): void {
        const floorColor = new THREE.Color(layout.theme.floor).offsetHSL(0, 0, 0.05);
        const geometry = new THREE.PlaneGeometry(layout.width, layout.depth);
        const material = new THREE.MeshStandardMaterial({
            color: floorColor,
            map: this.floorTexture,
            roughness: 0.95,
            metalness: 0.02,
        });
        const floor = new THREE.Mesh(geometry, material);
        floor.rotation.x = -Math.PI / 2;
        this.levelGroup.add(floor);

        // 地台：让房间看着有厚度
        const base = new THREE.Mesh(
            new THREE.BoxGeometry(layout.width + 2, 1.2, layout.depth + 2),
            new THREE.MeshStandardMaterial({ color: 0x14182c, roughness: 1 }),
        );
        base.position.y = -0.62;
        this.levelGroup.add(base);
    }

    private buildBoxes(layout: LevelLayout): void {
        const wallMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(layout.theme.wall).offsetHSL(0, 0, 0.1),
            roughness: 0.88,
        });
        const pillarMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(layout.theme.wall).offsetHSL(0, 0, 0.16),
            roughness: 0.8,
        });
        const trimMaterial = new THREE.MeshStandardMaterial({
            color: layout.theme.accent,
            emissive: new THREE.Color(layout.theme.accent),
            emissiveIntensity: 0.45,
            roughness: 0.4,
        });

        for (const box of layout.boxes) {
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(box.width, box.height, box.depth),
                box.kind === "pillar" ? pillarMaterial : wallMaterial,
            );
            mesh.position.set(box.x, box.height / 2, box.z);
            mesh.userData.spec = box;
            this.levelGroup.add(mesh);
            this.blockers.push(mesh);

            const trim = new THREE.Mesh(
                new THREE.BoxGeometry(box.width + 0.05, 0.1, box.depth + 0.05),
                trimMaterial,
            );
            trim.position.set(box.x, box.height + 0.05, box.z);
            this.levelGroup.add(trim);
        }
    }

/** 跑酷平台 + 弹跳板。 */
    private buildPlatforms(layout: LevelLayout): void {
        const slabMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(layout.theme.wall).offsetHSL(0, 0, 0.24),
            roughness: 0.72,
        });
        const edgeMaterial = new THREE.MeshStandardMaterial({
            color: layout.theme.glow,
            emissive: new THREE.Color(layout.theme.glow),
            emissiveIntensity: 0.75,
            roughness: 0.35,
        });

        for (const platform of layout.platforms ?? []) {
            const baseY = platform.baseY ?? 0;
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(platform.width, platform.height, platform.depth),
                slabMaterial,
            );
            mesh.position.set(platform.x, baseY + platform.height / 2, platform.z);
            this.levelGroup.add(mesh);
            this.blockers.push(mesh);

            // 边沿发光：远处也能看清该往哪儿跳
            const edge = new THREE.Mesh(
                new THREE.BoxGeometry(platform.width + 0.08, 0.12, platform.depth + 0.08),
                edgeMaterial,
            );
            edge.position.set(platform.x, baseY + platform.height + 0.06, platform.z);
            this.levelGroup.add(edge);
        }

        // 弹跳板：矮墩 + 发光顶面
        for (const pad of layout.boxes.filter((box) => box.kind === "bounce")) {
            const group = new THREE.Group();
            const base = new THREE.Mesh(
                new THREE.BoxGeometry(pad.width, pad.height, pad.depth),
                new THREE.MeshStandardMaterial({ color: 0x3c2350, roughness: 0.8 }),
            );
            base.position.y = pad.height / 2;
            group.add(base);

            const glow = new THREE.Mesh(
                new THREE.BoxGeometry(pad.width * 0.78, 0.1, pad.depth * 0.78),
                new THREE.MeshBasicMaterial({ color: 0xff7ad9, transparent: true }),
            );
            glow.position.y = pad.height + 0.05;
            group.add(glow);

            group.position.set(pad.x, 0, pad.z);
            this.levelGroup.add(group);
            this.bouncePads.push({ group, glow });
        }
    }

    /** 彩蛋：空中浮动的问号方块 + 跑酷顶端的祭坛。 */
    private buildEasterEggs(layout: LevelLayout): void {
        for (const egg of layout.eggs ?? []) {
            const group = new THREE.Group();

            if (egg.kind === "altar") {
                const ring = new THREE.Mesh(
                    new THREE.TorusGeometry(1.15, 0.1, 12, 36),
                    new THREE.MeshBasicMaterial({ color: 0xffd76a }),
                );
                ring.rotation.x = Math.PI / 2;
                group.add(ring);

                const obelisk = new THREE.Mesh(
                    new THREE.OctahedronGeometry(0.52, 0),
                    new THREE.MeshStandardMaterial({
                        color: 0xffe9a8,
                        emissive: new THREE.Color(0xffc94d),
                        emissiveIntensity: 1.2,
                        roughness: 0.25,
                    }),
                );
                obelisk.position.y = 0.72;
                group.add(obelisk);

                const light = new THREE.PointLight(0xffc94d, 1.5, 10);
                light.position.y = 1;
                group.add(light);
            } else {
                const cube = new THREE.Mesh(
                    new THREE.BoxGeometry(0.78, 0.78, 0.78),
                    new THREE.MeshStandardMaterial({
                        color: 0xfff1c9,
                        emissive: new THREE.Color(0xffc94d),
                        emissiveIntensity: 0.95,
                        roughness: 0.35,
                    }),
                );
                group.add(cube);

                const mark = this.makeMarkSprite("?", new THREE.Color(0x6b3f04));
                mark.position.y = 0.02;
                group.add(mark);

                const halo = new THREE.Sprite(
                    new THREE.SpriteMaterial({
                        map: this.glowTexture,
                        color: 0xffd76a,
                        transparent: true,
                        depthWrite: false,
                        blending: THREE.AdditiveBlending,
                    }),
                );
                halo.scale.set(3.4, 3.4, 1);
                group.add(halo);

                const light = new THREE.PointLight(0xffd76a, 0.9, 7);
                group.add(light);
            }

            group.position.set(egg.x, egg.y, egg.z);
            this.levelGroup.add(group);
            this.eggMeshes.push({ mesh: group, spec: egg });
        }
    }

    /** 彩蛋判定：碰到就收集，收集后隐藏。 */
    private updateEasterEggs(): void {
        for (const entry of this.eggMeshes) {
            if (this.collectedEggs.has(entry.spec.id)) continue;
            const egg = entry.spec;
            const radius = egg.kind === "altar" ? 2.3 : 1.2;
            const dx = this.position.x - egg.x;
            const dy = this.position.y + 0.9 - egg.y;
            if (!Number.isFinite(dy)) continue;
            const dz = this.position.z - egg.z;
            if (Math.hypot(dx, dy, dz) > radius) continue;
            this.collectedEggs.add(egg.id);
            entry.mesh.visible = false;
            this.callbacks.onEasterEgg?.(egg, egg.kind);
        }
    }

    /** 四角火盆：给冷色调的房间补一点暖光，也给玩家一个方位参考。 */
    private buildBraziers(layout: LevelLayout): void {
        const halfWidth = layout.width / 2 - 2.4;
        const halfDepth = layout.depth / 2 - 2.4;
        const spots: Array<[number, number]> = [
            [-halfWidth, -halfDepth],
            [halfWidth, -halfDepth],
            [-halfWidth, halfDepth],
            [halfWidth, halfDepth],
        ];
        const stone = new THREE.MeshStandardMaterial({ color: 0x2b3352, roughness: 0.85 });
        const flame = new THREE.MeshStandardMaterial({
            color: 0xffb765,
            emissive: new THREE.Color(0xff9a3c),
            emissiveIntensity: 1.4,
            roughness: 0.4,
        });
        for (const [x, z] of spots) {
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 1.5, 10), stone);
            base.position.set(x, 0.75, z);
            this.levelGroup.add(base);
            this.blockers.push(base);
            const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), flame);
            bowl.position.set(x, 1.72, z);
            this.levelGroup.add(bowl);
            const light = new THREE.PointLight(0xffa347, 14, 12, 2);
            light.position.set(x, 2, z);
            this.levelGroup.add(light);
        }
    }

    private buildPanel(layout: LevelLayout, item: Typing3DItem): void {
        const panel = layout.panels[0];
        const group = new THREE.Group();
        group.position.set(panel.x, 0, panel.z);
        group.rotation.y = panel.rotation;

        const pedestal = new THREE.Mesh(
            new THREE.CylinderGeometry(0.62, 0.82, 0.62, 18),
            new THREE.MeshStandardMaterial({ color: 0x1d2440, roughness: 0.65 }),
        );
        pedestal.position.y = 0.31;
        group.add(pedestal);
        // 底座也算障碍，相机别钻进模型里
        this.blockers.push(pedestal);

        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.68, 0.05, 8, 26),
            new THREE.MeshStandardMaterial({
                color: layout.theme.accent,
                emissive: new THREE.Color(layout.theme.accent),
                emissiveIntensity: 0.85,
                roughness: 0.35,
            }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.64;
        group.add(ring);

        // 站位圈：告诉玩家「站这儿答题」
        const pad = new THREE.Mesh(
            new THREE.TorusGeometry(1.45, 0.045, 8, 44),
            new THREE.MeshBasicMaterial({
                color: layout.theme.glow,
                transparent: true,
                opacity: 0.55,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(0, 0.03, 1.5);
        group.add(pad);

        const texture = paintPanelTexture(item, this.pinyinMode, false);
        this.panelTexture = texture;

        // 面板本体（屏幕 / 光晕 / 灯光）挂在一个浮动节点上，整体微微上下浮动
        const floatGroup = new THREE.Group();
        group.add(floatGroup);
        this.panelFloat = floatGroup;

        const back = new THREE.Mesh(
            new THREE.PlaneGeometry(4.6, 1.72),
            new THREE.MeshBasicMaterial({
                color: 0x0a1024,
                transparent: true,
                opacity: 0.62,
                depthWrite: false,
            }),
        );
        back.position.set(0, 2.15, -0.04);
        floatGroup.add(back);

        const screen = new THREE.Mesh(
            new THREE.PlaneGeometry(4.2, 1.32),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
        );
        screen.position.set(0, 2.15, 0.02);
        floatGroup.add(screen);
        this.panelMesh = screen;

        const glow = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: this.glowTexture,
                color: layout.theme.glow,
                transparent: true,
                opacity: 0.4,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        glow.position.set(0, 2.1, 0);
        glow.scale.set(5.4, 2.6, 1);
        floatGroup.add(glow);
        this.panelGlow = glow;

        const light = new THREE.PointLight(layout.theme.accent, 16, 13, 2);
        light.position.set(0, 2.2, 0.9);
        floatGroup.add(light);
        this.panelLight = light;

        // 光柱：远远就能看见这一关要答的面板（做细，别挡住视线）
        const beacon = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.3, 9, 12, 1, true),
            new THREE.MeshBasicMaterial({
                color: layout.theme.glow,
                transparent: true,
                opacity: 0.13,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        beacon.position.set(0, 6.6, 0);
        group.add(beacon);

        this.levelGroup.add(group);
    }

    private buildDoor(layout: LevelLayout): void {
        const door = layout.door;
        const group = new THREE.Group();
        group.position.set(door.x, 0, door.z);

        const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x28304f, roughness: 0.7 });
        const accentMaterial = new THREE.MeshStandardMaterial({
            color: layout.theme.accent,
            emissive: new THREE.Color(layout.theme.accent),
            emissiveIntensity: 0.55,
            roughness: 0.4,
        });

        for (const side of [-1, 1]) {
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.9), frameMaterial);
            pillar.position.set(side * (door.width / 2 + 0.25), 2.5, 0);
            group.add(pillar);
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.6, 1.0), accentMaterial);
            strip.position.set(side * (door.width / 2 + 0.02), 2.5, 0);
            group.add(strip);
        }
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(door.width + 1, 0.6, 0.9), frameMaterial);
        lintel.position.set(0, 5, 0);
        group.add(lintel);

        const slab = new THREE.Mesh(
            new THREE.BoxGeometry(door.width, 4.6, 0.45),
            new THREE.MeshStandardMaterial({
                color: 0x303a60,
                emissive: new THREE.Color(layout.theme.accent).multiplyScalar(0.12),
                roughness: 0.55,
            }),
        );
        slab.position.set(0, 2.3, 0);
        group.add(slab);
        this.doorSlab = slab;

        const portal = new THREE.Mesh(
            new THREE.PlaneGeometry(door.width, 4.6),
            new THREE.MeshBasicMaterial({
                color: layout.theme.glow,
                transparent: true,
                opacity: 0.32,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        portal.position.set(0, 2.3, -0.3);
        group.add(portal);
        this.doorPortal = portal;

        this.levelGroup.add(group);
    }

    private buildPlayer(): void {
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xdfe6f5, roughness: 0.72 });
        const accentMaterial = new THREE.MeshStandardMaterial({
            color: 0x2fd2c0,
            emissive: new THREE.Color(0x2fd2c0),
            emissiveIntensity: 0.55,
            roughness: 0.35,
        });
        const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2a3252, roughness: 0.75 });

        const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.8, 0.48), bodyMaterial);
        body.position.y = 1.04;
        this.playerModel.add(body);

        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.12, 0.52), accentMaterial);
        belt.position.y = 0.74;
        this.playerModel.add(belt);

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.46, 0.46), bodyMaterial);
        head.position.y = 1.66;
        this.playerModel.add(head);

        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.06), accentMaterial);
        visor.position.set(0, 1.7, -0.25);
        this.playerModel.add(visor);

        const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.16), darkMaterial);
        pack.position.set(0, 1.14, 0.3);
        this.playerModel.add(pack);

        for (const side of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.6, 0.25), darkMaterial);
            leg.position.set(side * 0.18, 0.3, 0);
            this.playerModel.add(leg);

            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.52, 0.19), bodyMaterial);
            arm.position.set(side * 0.46, 1.06, 0);
            this.playerModel.add(arm);
        }

        const shadow = new THREE.Mesh(
            new THREE.PlaneGeometry(1.5, 1.5),
            new THREE.MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false }),
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.02;
        this.blobShadow = shadow;

        this.player.add(this.playerModel);
        this.player.add(shadow);
    }

    /** 脚下能踩到的最高平面（地面算 0）。 */
    private supportHeight(nextY?: number): { height: number; box: BoxSpec | null } {
        const layout = this.layout;
        let best = 0;
        let bestBox: BoxSpec | null = null;
        if (!layout) return { height: best, box: bestBox };
        // 正在往下落：这一帧会穿过的平台也算脚下，不然会从平台里掉穿过去
        const falling = nextY !== undefined && nextY < this.position.y;
        const candidates = [...layout.boxes, ...(layout.platforms ?? [])];
        for (const box of candidates) {
            const top = (box.baseY ?? 0) + box.height;
            if (top <= best + 0.001) continue;
            // 太高了踩不上去，得先跳
            if (top > this.position.y + STEP_UP) {
                // 正在往这一层下落：仍然算脚下（不然会穿过去）
                if (!falling || nextY === undefined || top > nextY) continue;
            }
            const overlapX =
                Math.abs(this.position.x - box.x) <= box.width / 2 + PLAYER_RADIUS * 0.5;
            const overlapZ =
                Math.abs(this.position.z - box.z) <= box.depth / 2 + PLAYER_RADIUS * 0.5;
            if (!overlapX || !overlapZ) continue;
            best = top;
            bestBox = box;
        }
        return { height: best, box: bestBox };
    }

    /** 玩家撞到方块时把它推出去。 */
    private resolveCollisions(): void {
        const layout = this.layout;
        if (!layout) return;
        for (const box of [...layout.boxes, ...(layout.platforms ?? [])]) {
            const baseY = box.baseY ?? 0;
            const topY = baseY + box.height;
            // 悬空平台是「单向」的：可以从下面跳穿上去，落下来才会踩住
            if (box.kind === "platform") continue;
            // 站在方块顶上：随便走
            if (this.position.y >= topY - 0.02) continue;
            // 从方块底下钻过去：也放行
            if (baseY >= this.position.y + PLAYER_HEIGHT - 0.02) continue;
            const halfWidth = box.width / 2;
            const halfDepth = box.depth / 2;
            const closestX = Math.max(box.x - halfWidth, Math.min(this.position.x, box.x + halfWidth));
            const closestZ = Math.max(box.z - halfDepth, Math.min(this.position.z, box.z + halfDepth));
            const deltaX = this.position.x - closestX;
            const deltaZ = this.position.z - closestZ;
            const distance = Math.hypot(deltaX, deltaZ);

            if (distance >= PLAYER_RADIUS) continue;
            // 小台阶（弹跳板、矮沿）：直接踩上去，而不是把玩家推开
            if (this.grounded && topY > this.position.y && topY - this.position.y <= STEP_UP) {
                this.position.y = topY;
                continue;
            }

            if (distance > 0.0001) {
                const push = (PLAYER_RADIUS - distance) / distance;
                this.position.x += deltaX * push;
                this.position.z += deltaZ * push;
            } else {
                // 人在方块正中间：往最近的一条边推
                const toLeft = Math.abs(this.position.x - (box.x - halfWidth));
                const toRight = Math.abs(box.x + halfWidth - this.position.x);
                const toBack = Math.abs(this.position.z - (box.z - halfDepth));
                const toFront = Math.abs(box.z + halfDepth - this.position.z);
                const smallest = Math.min(toLeft, toRight, toBack, toFront);
                if (smallest === toLeft) this.position.x = box.x - halfWidth - PLAYER_RADIUS;
                else if (smallest === toRight) this.position.x = box.x + halfWidth + PLAYER_RADIUS;
                else if (smallest === toBack) this.position.z = box.z - halfDepth - PLAYER_RADIUS;
                else this.position.z = box.z + halfDepth + PLAYER_RADIUS;
            }
        }
    }

    /** 答对了：面板变绿，门缓缓升起来。 */
    solvePanel(): void {
        if (!this.item || !this.panelMesh || !this.panelTexture) return;
        this.doorOpen = true;
        const texture = paintPanelTexture(this.item, this.pinyinMode, true);
        this.panelTexture.dispose();
        this.panelTexture = texture;
        const material = this.panelMesh.material as THREE.MeshBasicMaterial;
        material.map = texture;
        material.needsUpdate = true;
        if (this.panelLight) this.panelLight.color.setHex(0x7bffb2);
        if (this.panelGlow) (this.panelGlow.material as THREE.SpriteMaterial).color.setHex(0x7bffb2);
    }

    /** 玩家是否已经走到门口并且门开着。 */
    private checkDoor(): void {
        const layout = this.layout;
        if (!layout || !this.doorOpen) return;
        // 一扇门只能进一关。换关的那一帧场景还没重建完，
        // 这里再触发一次就会白白跳过一关，所以用过就作废。
        if (this.doorConsumed) return;
        const door = layout.door;
        if (
            this.position.z > layout.depth / 2 + 0.4 &&
            Math.abs(this.position.x - door.x) < door.width / 2 + 1.6
        ) {
            this.doorConsumed = true;
            this.callbacks.onReachDoor();
        }
    }

    private updateCamera(delta: number): void {
        const layout = this.layout;
        if (!layout) return;

        if (this.overviewMode) {
            this.updateOverviewCamera(delta);
            return;
        }

        if (this.view === "first") {
            this.camera.position.set(this.position.x, this.position.y + 1.62, this.position.z);
            const look = new THREE.Vector3(
                -Math.sin(this.yaw) * Math.cos(this.pitch),
                Math.sin(this.pitch),
                -Math.cos(this.yaw) * Math.cos(this.pitch),
            );
            this.camera.lookAt(this.camera.position.clone().add(look));
            return;
        }

        // 竖屏时水平视野很窄，相机要往后拉一点才看得清整个房间
        const portrait = Math.max(0, 1 - this.aspect());
        const distance = CAMERA_DISTANCE * (1 + portrait * 1.15);
        const height = CAMERA_HEIGHT * (1 + portrait * 0.55);
        const offset = new THREE.Vector3(
            Math.sin(this.yaw) * distance,
            height,
            Math.cos(this.yaw) * distance,
        );
        const desired = this.position.clone().add(offset);

        // 别把镜头塞进墙里或面板模型里
        const rayOrigin = this.position.clone().setY(this.position.y + 1.6);
        const rayDirection = desired.clone().sub(rayOrigin);
        const rayLength = rayDirection.length();
        rayDirection.normalize();
        const raycaster = new THREE.Raycaster(rayOrigin, rayDirection, 0.1, rayLength);
        const hits = raycaster.intersectObjects(this.blockers, false);
        if (hits.length) {
            const hit = hits[0];
            const allowed = Math.max(2.4, hit.distance - 0.6);
            desired
                .copy(rayOrigin)
                .add(rayDirection.clone().multiplyScalar(allowed));
            // 被墙挡住时把相机抬起来，从头顶俯视，总比怼在角色脸上强
            const blocked = 1 - allowed / Math.max(1, rayLength);
            desired.y = Math.max(this.position.y + 2, this.position.y + 1.6 + blocked * 3.6);
        }

        const halfWidth = layout.width / 2 + 1;
        const halfDepth = layout.depth / 2 + 1;
        desired.x = Math.max(-halfWidth, Math.min(halfWidth, desired.x));
        desired.z = Math.max(-halfDepth, Math.min(halfDepth, desired.z));

        this.camera.position.lerp(desired, Math.min(1, delta * CAMERA_FOLLOW_RATE));
        const focus = this.position.clone().setY(this.position.y + 1.2);
        this.camera.lookAt(focus);
    }

    /** 出生点选择：镜头拉到房间上方，所有光环一次看全。 */
    private updateOverviewCamera(delta: number): void {
        const options = this.spawnOptions;
        let minX = 0;
        let maxX = 0;
        let minZ = 0;
        let maxZ = 0;
        if (options.length) {
            minX = Math.min(...options.map((option) => option.x));
            maxX = Math.max(...options.map((option) => option.x));
            minZ = Math.min(...options.map((option) => option.z));
            maxZ = Math.max(...options.map((option) => option.z));
        }
        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;
        const spreadX = Math.max(8, maxX - minX);
        const spreadZ = Math.max(8, maxZ - minZ);
        const portrait = Math.max(0, 1 - this.aspect());
        const distance = (Math.max(spreadX, spreadZ) * 1.2 + 9) * (1 + portrait * 0.7);
        const desired = new THREE.Vector3(
            centerX,
            distance * 0.58,
            centerZ - distance * 0.78,
        );
        this.camera.position.lerp(desired, Math.min(1, delta * CAMERA_OVERVIEW_RATE));
        this.camera.lookAt(new THREE.Vector3(centerX, 0, centerZ));
    }

    private updateMovement(delta: number): void {
        const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const desired = new THREE.Vector3()
            .add(forward.multiplyScalar(this.input.forward))
            .add(right.multiplyScalar(this.input.right));
        if (desired.lengthSq() > 1) desired.normalize();

        const speed = this.input.run ? RUN_SPEED : WALK_SPEED;
        const target = desired.multiplyScalar(speed);
        const blend = Math.min(1, ACCELERATION * delta);
        this.velocity.lerp(target, blend);

        // ---- 跳跃：地面一次 + 空中再蹬一次 ----
        if (this.grounded) {
            this.coyoteTimer = COYOTE_TIME;
        } else {
            this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
        }
        this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - delta);
        if (this.jumpBufferTimer > 0) {
            if (this.grounded || this.coyoteTimer > 0) {
                this.verticalVelocity = JUMP_VELOCITY;
                this.grounded = false;
                this.coyoteTimer = 0;
                this.jumpsLeft = MAX_JUMPS - 1;
                this.jumpBufferTimer = 0;
            } else if (this.jumpsLeft > 0) {
                this.verticalVelocity = JUMP_VELOCITY * 0.92;
                this.jumpsLeft = 0;
                this.jumpBufferTimer = 0;
            }
        }

        // ---- 水平移动 ----
        this.position.addScaledVector(this.velocity, delta);

        // 万一算出非法值（NaN），把玩家放回出生点，别让整个场景卡死
        if (
            !Number.isFinite(this.position.x) ||
            !Number.isFinite(this.position.y) ||
            !Number.isFinite(this.position.z)
        ) {
            const spawn = this.layout?.spawn;
            this.position.set(spawn?.x ?? 0, 0, spawn?.z ?? 0);
            this.velocity.set(0, 0, 0);
            this.verticalVelocity = 0;
            this.grounded = true;
        }

        // ---- 竖直积分 + 落地 ----
        this.verticalVelocity = Math.max(
            -MAX_FALL_SPEED,
            this.verticalVelocity - GRAVITY * delta,
        );
        const nextY = this.position.y + this.verticalVelocity * delta;
        const support = this.supportHeight(nextY);
        this.position.y = nextY;
        const onBouncePad = support.box?.kind === "bounce";
        // 不在弹跳板上时重新武装：走下来再踩上去还能再弹一次
        if (!onBouncePad) this.bounceArmed = true;
        if (this.position.y <= support.height && this.verticalVelocity <= 0) {
            this.position.y = support.height;
            this.verticalVelocity = 0;
            this.grounded = true;
            this.jumpsLeft = MAX_JUMPS;
            if (onBouncePad && this.bounceArmed) {
                // 弹跳板：直接给一个向上的冲量
                this.bounceArmed = false;
                this.verticalVelocity = BOUNCE_VELOCITY;
                this.grounded = false;
                this.jumpsLeft = 1;
                this.callbacks.onBouncePad?.();
            }
        } else {
            this.grounded = false;
        }

        this.resolveCollisions();

        this.walking = this.velocity.lengthSq() > 0.6;
        if (this.walking) {
            this.walkPhase += delta * (this.input.run ? 13 : 9);
            const heading = Math.atan2(this.velocity.x, this.velocity.z);
            const current = this.playerModel.rotation.y;
            let diff = heading - current;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            this.playerModel.rotation.y += diff * Math.min(1, delta * 12);
        }
    }

    private updateNearPanel(): void {
        const layout = this.layout;
        if (!layout) return;
        const panel = layout.panels[0];
        const distance = Math.hypot(this.position.x - panel.x, this.position.z - panel.z);
        const inside = distance < PANEL_REACH;
        const id = inside ? 0 : null;
        if (id !== this.nearPanelId) {
            this.nearPanelId = id;
            this.callbacks.onNearPanel(inside ? panel : null, distance);
        }
    }

    private updateAnimations(delta: number, elapsed: number): void {
        // 彩蛋：自转 + 上下浮动
        this.eggMeshes.forEach((entry, index) => {
            entry.mesh.rotation.y += delta * 1.1;
            entry.mesh.position.y = entry.spec.y + Math.sin(elapsed * 2 + index) * 0.18;
        });

        // 弹跳板：一直呼吸，踩上去时更亮
        this.bouncePads.forEach((pad) => {
            const material = pad.glow.material as THREE.MeshBasicMaterial;
            material.opacity = 0.7 + Math.sin(elapsed * 6) * 0.3;
        });

        this.playerModel.children.forEach((child) => {
            if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BoxGeometry)) return;
            const height = (child.geometry.parameters as { height?: number }).height ?? 0;
            if (height >= 0.7) return;
            if (this.walking) {
                child.rotation.x = Math.sin(this.walkPhase) * 0.55;
            } else {
                child.rotation.x *= 0.85;
            }
        });

        const bob = this.walking ? Math.abs(Math.sin(this.walkPhase)) * 0.08 : Math.sin(elapsed * 2.2) * 0.03;
        this.playerModel.position.y = bob;
        if (this.blobShadow) this.blobShadow.scale.setScalar(1 - bob * 0.5);

        if (this.panelGlow) {
            const pulse = 0.34 + Math.sin(elapsed * 2.6) * 0.1;
            (this.panelGlow.material as THREE.SpriteMaterial).opacity = pulse;
        }

        if (this.panelFloat) {
            // 面板微微上下浮动（和 Ursina 桌面版保持一致）
            this.panelFloat.position.y = Math.sin(elapsed * 1.6) * 0.09;
        }

        const targetProgress = this.doorOpen ? 1 : 0;
        this.doorProgress += (targetProgress - this.doorProgress) * Math.min(1, delta * 2.2);
        if (this.doorSlab) {
            this.doorSlab.position.y = 2.3 + this.doorProgress * 4.9;
        }
        if (this.doorPortal) {
            const material = this.doorPortal.material as THREE.MeshBasicMaterial;
            material.opacity =
                0.16 + this.doorProgress * 0.4 + Math.sin(elapsed * 3) * 0.05 * this.doorProgress;
        }
    }

    private loop = () => {
        if (this.disposed) return;
        this.frame = requestAnimationFrame(this.loop);
        const now = performance.now();
        const delta = Math.min((now - this.lastFrameTime) / 1000, 0.05);
        this.lastFrameTime = now;
        this.elapsedTime += delta;
        const elapsed = this.elapsedTime;

        this.checkPerformance(now);
        this.updateMovement(delta);
        this.updateCamera(delta);
        this.updateNearPanel();
        this.updateEasterEggs();
        this.updateAnimations(delta, elapsed);
        this.checkDoor();

        this.player.position.copy(this.position);
        this.renderer.render(this.scene, this.camera);
        if (process.env.NODE_ENV !== "production") this.captureSample();
    };

    /** 读一小块画面像素，给自动化验收判断「画面是不是空的」。 */
    private captureSample(): void {
        const gl = this.renderer.getContext();
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        if (!width || !height) return;
        const pixels = new Uint8Array(4 * 16);
        gl.readPixels(
            Math.max(0, Math.floor(width / 2) - 2),
            Math.max(0, Math.floor(height / 2) - 2),
            4,
            4,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
        );
        this.debugSample = Array.from(pixels);
    }

    dispose(): void {
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        const canvas = this.renderer.domElement;
        canvas.removeEventListener("pointerdown", this.handlePointerDown);
        window.removeEventListener("pointerup", this.handlePointerUp);
        window.removeEventListener("pointermove", this.handlePointerMove);
        canvas.removeEventListener("contextmenu", this.handleContextMenu);
        window.removeEventListener("resize", this.handleResize);

        this.scene.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (Array.isArray(material)) material.forEach((item) => item.dispose());
            else if (material) material.dispose();
        });
        this.floorTexture.dispose();
        this.glowTexture.dispose();
        this.shadowTexture.dispose();
        this.renderer.dispose();
        if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
    }
}

/** 给定关卡盒子，测试用：判断一个点是否落在方块里。 */
export function pointInsideBox(x: number, z: number, box: BoxSpec): boolean {
    return Math.abs(x - box.x) <= box.width / 2 && Math.abs(z - box.z) <= box.depth / 2;
}
