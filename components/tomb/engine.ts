/**
 * 3D 古墓剧本杀 · three.js 引擎
 *
 * 负责：场景构建、角色生成与动画、玩家操控与碰撞、NPC 行为（游荡 / 伪人偷袭）、
 * 线索拾取、袭击交互、结局判定。
 */

import * as THREE from "three";

import { TOMB_ASSETS, TOMB_CHARACTERS } from "./assets";
import { animate } from "./assets/clips.mjs";
import {
    CLUE_POSITIONS,
    CLUE_RUNE_STYLES,
    FLOOR_PALETTE,
    FLOOR_TOP,
    GATE_POSITION,
    GATE_RADIUS,
    NPC_SPAWNS,
    PLAYER_SPAWN,
    PROPS,
    ROOM_HALF,
    SCENE_KNOBS,
    buildWallSpecs,
    floorSchemeAt,
    type AssetKey,
} from "./layout";
import { mergeStatic } from "./mergeKit";
import {
    CLUES,
    GAME_DURATION_SECONDS,
    REQUIRED_CLUES,
    createInitialState,
    evaluateEnding,
    identityRevealText,
    type ClueDefinition,
    type EndingId,
    type TombState,
} from "@/lib/tomb/rules";
import { NPC_NAMES, type NpcId } from "@/lib/tomb/dialogue";
import { askNpc, createDialogueState, type DialogueState, type NpcReply } from "@/lib/tomb/dialogueEngine";

const NPC_IDS: NpcId[] = ["gao", "xiaoyuan", "xiaolin", "aze", "laozhang"];

/** 伪人认为「落单」的距离：此范围内没有其他好人，就视为落单 */
const LONE_RADIUS = 7;
/** 伪人发起攻击的距离 */
const ATTACK_RANGE = 1.35;
/** 玩家袭击距离 */
const PLAYER_ATTACK_RANGE = 2.6;
/** 伪人狩猎冷却 */
const HUNT_COOLDOWN = 9;
/** 开局保护期（秒），让玩家先熟悉场景 */
const GRACE_PERIOD = 18;
/** 交互距离 */
export const INTERACT_RANGE = 2.4;
/** 拾取距离 */
export const PICKUP_RANGE = 2.0;

export type PromptKind = "talk" | "clue" | "gate";

export interface HudState {
    timeLeft: number;
    clueIds: string[];
    prompt: string | null;
    promptKind: PromptKind | null;
    promptNpc: NpcId | null;
    promptClueId: string | null;
    threat: number;
    identityKnown: boolean;
    playerImpostor: boolean;
    deadNpcs: NpcId[];
}

export interface EngineCallbacks {
    onHud?: (state: HudState) => void;
    onEnding?: (ending: EndingId) => void;
    onClue?: (clue: ClueDefinition) => void;
    onKill?: (npc: NpcId) => void;
    onIdentity?: (isImpostor: boolean, text: string) => void;
    onWarning?: (text: string) => void;
    /** 该表决了：走到石门 / 时间耗尽但线索够 */
    onVotePrompt?: (reason: "gate" | "timeup") => void;
}

interface Collider {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

interface NpcRuntime {
    id: NpcId;
    group: THREE.Object3D;
    alive: boolean;
    isImpostor: boolean;
    position: THREE.Vector3;
    facing: number;
    target: THREE.Vector3;
    state: "wander" | "stalk" | "cooldown" | "dead";
    cooldown: number;
    pauseTimer: number;
    victim: "player" | null;
    anim: CharacterAnimator | null;
    deathT: number;
}

interface CharacterAnimator {
    locomotion: (speed: number) => void;
    update: (delta: number) => void;
}

interface ClueRuntime {
    id: string;
    position: THREE.Vector3;
    marker: THREE.Object3D;
    collected: boolean;
}

export class TombEngine {
    private container: HTMLElement;
    private callbacks: EngineCallbacks;

    private renderer!: THREE.WebGLRenderer;
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private clock = new THREE.Clock();
    private frameId = 0;

    private state: TombState = createInitialState();
    /** 固定好人「固定台词」的轮转游标，整局共用 */
    private dialogueState: DialogueState = createDialogueState();
    private timeLeft = GAME_DURATION_SECONDS;
    private elapsed = 0;
    private ended = false;
    private paused = false;
    private threatLevel = 0;
    /** 已经进入表决：石门不再自动判定结局，交给 UI 走投票流程 */
    private votePending = false;

    private colliders: Collider[] = [];
    private npcs = new Map<NpcId, NpcRuntime>();
    private clues = new Map<string, ClueRuntime>();
    private player!: THREE.Object3D;
    /** 全场只保留一盏线索光，跟随最近的未拾取线索 */
    private clueLight!: THREE.PointLight;
    private playerAnim: CharacterAnimator | null = null;
    private playerFacing = Math.PI;
    private playerPos = new THREE.Vector3();
    private playerVelocity = new THREE.Vector3();

    private keys = new Set<string>();
    private lookYaw = Math.PI;
    private lookPitch = 0.22;
    private pointerLocked = false;
    private dragging = false;
    private lastPointer = { x: 0, y: 0 };
    private cameraDistance = 4.4;

    /** 触屏虚拟摇杆 */
    private joystick = { active: false, x: 0, y: 0 };

    private hudTimer = 0;
    private lastHud: HudState | null = null;
    private ambientRats: { group: THREE.Object3D; target: THREE.Vector3; pause: number }[] = [];

    constructor(container: HTMLElement, callbacks: EngineCallbacks = {}) {
        this.container = container;
        this.callbacks = callbacks;
    }

    // ---------------------------------------------------------------- 初始化

    async init() {
        this.setupRenderer();
        this.buildRoom();
        this.buildProps();
        this.buildClues();
        await this.buildCharacters();
        this.setupLighting();
        this.bindEvents();
        if (process.env.NODE_ENV !== "production") {
            (window as unknown as Record<string, unknown>).__tomb = this;
        }
        this.emitHud(true);
        this.clock.start();
        this.loop();
    }

    private setupRenderer() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: "high-performance",
        });
        // 墓室里同时有十几个光源，前向渲染的开销按像素走，像素比要压住
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.setSize(width, height);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x07060c);
        this.scene.fog = new THREE.FogExp2(0x08070f, 0.042);

        this.camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 120);
        this.camera.position.set(0, 3, 12);
    }

    /** 地面 + 墙体 + 天花板 */
    private buildRoom() {
        // 地面：每块砖用不同的铺装方案，避免整间墓室的地板长成一个样；
        // 合并成一个 Mesh，把上百个 draw call 压成一个。
        const tiles: THREE.Object3D[] = [];
        for (let x = -9; x <= 9; x += 2) {
            for (let z = -9; z <= 9; z += 2) {
                const scheme = floorSchemeAt(x, z);
                const tile = TOMB_ASSETS.flagstoneFloorTile({
                    colorway: "garrison-granite",
                    bond: scheme.bond,
                    flags: scheme.flags,
                    ruin: scheme.ruin,
                    tone: scheme.tone,
                    ...FLOOR_PALETTE,
                });
                tile.position.set(x, 0, z);
                tile.rotation.y = ((x + z) % 4) * (Math.PI / 2);
                tiles.push(tile);
            }
        }
        const floor = mergeStatic(tiles);
        for (const mesh of floor.merged) {
            // 地面只接收阴影、不投射阴影：否则大片地面会自己给自己打出自阴影
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
        }
        for (const object of floor.kept) this.scene.add(object);

        // 天花板：用同一套石板砖翻转铺顶，比一张纯色平面耐看得多，
        // 玩家抬头时看到的是石砌券顶而不是一片黑。
        const ceilingTiles: THREE.Object3D[] = [];
        for (let x = -9; x <= 9; x += 2) {
            for (let z = -9; z <= 9; z += 2) {
                const scheme = floorSchemeAt(z, x);
                const tile = TOMB_ASSETS.flagstoneFloorTile({
                    colorway: "garrison-granite",
                    bond: scheme.bond,
                    flags: scheme.flags,
                    ruin: scheme.ruin,
                    tone: scheme.tone,
                    ...FLOOR_PALETTE,
                });
                tile.position.set(x, 3.02, z);
                tile.rotation.x = Math.PI;
                tile.rotation.y = ((x + z) % 4) * (Math.PI / 2);
                ceilingTiles.push(tile);
            }
        }
        const ceiling = mergeStatic(ceilingTiles);
        for (const mesh of ceiling.merged) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            this.scene.add(mesh);
        }
        for (const object of ceiling.kept) this.scene.add(object);

        const walls: THREE.Object3D[] = [];
        for (const spec of buildWallSpecs()) {
            const wall = TOMB_ASSETS.dungeonWallModule(spec.params ?? {});
            wall.position.set(...spec.position);
            wall.rotation.y = spec.rotationY;
            walls.push(wall);
        }
        const wallBatch = mergeStatic(walls);
        for (const mesh of wallBatch.merged) this.scene.add(mesh);
        for (const object of wallBatch.kept) this.scene.add(object);
    }

    private registerCollider(object: THREE.Object3D, radius?: number) {
        if (radius) {
            const position = new THREE.Vector3();
            object.getWorldPosition(position);
            this.colliders.push({
                minX: position.x - radius,
                maxX: position.x + radius,
                minZ: position.z - radius,
                maxZ: position.z + radius,
            });
            return;
        }
        const box = new THREE.Box3().setFromObject(object);
        this.colliders.push({
            minX: box.min.x,
            maxX: box.max.x,
            minZ: box.min.z,
            maxZ: box.max.z,
        });
    }

    private buildProps() {
        const statics: THREE.Object3D[] = [];
        for (const spec of PROPS) {
            const factory = TOMB_ASSETS[spec.asset as AssetKey] as (
                params?: Record<string, unknown>,
            ) => THREE.Object3D;
            const params = { ...SCENE_KNOBS, ...(spec.params ?? {}) };
            const object = factory(params);
            object.position.set(...spec.position);
            if (spec.rotationY) object.rotation.y = spec.rotationY;
            if (spec.solid !== false) this.registerCollider(object, spec.radius);
            statics.push(object);
        }

        // 静态道具整体合并：几十个模型压成两三个 Mesh
        const batch = mergeStatic(statics);
        for (const mesh of batch.merged) this.scene.add(mesh);
        for (const object of batch.kept) {
            object.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            this.scene.add(object);
        }

        // 环境老鼠
        for (let i = 0; i < 3; i += 1) {
            const rat = TOMB_ASSETS.dungeonRat({});
            rat.position.set(-6 + i * 5, FLOOR_TOP, -4 + i * 3);
            rat.scale.setScalar(0.9);
            rat.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) child.castShadow = true;
            });
            this.scene.add(rat);
            this.ambientRats.push({
                group: rat,
                target: new THREE.Vector3(
                    THREE.MathUtils.randFloat(-8, 8),
                    FLOOR_TOP,
                    THREE.MathUtils.randFloat(-8, 8),
                ),
                pause: Math.random() * 3,
            });
        }

        // 角落里的游荡行尸（纯氛围，不参与攻击判定）
        const ghoul = TOMB_ASSETS.shamblingGhoul({ hue: "pallid", rot: 0.45 });
        ghoul.position.set(8.6, FLOOR_TOP, 6.4);
        ghoul.rotation.y = -2.4;
        ghoul.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) child.castShadow = true;
        });
        this.scene.add(ghoul);
        this.ambientRats.push({ group: ghoul, target: new THREE.Vector3(8.6, FLOOR_TOP, 6.4), pause: 4 });
    }

    private buildClues() {
        for (const clue of CLUE_POSITIONS) {
            const definition = CLUES.find((item) => item.id === clue.id);
            if (!definition) continue;
            const style = CLUE_RUNE_STYLES[clue.id] ?? { rune: "algiz", variant: 1 };
            const marker = TOMB_ASSETS.glowingRuneStone({
                colorway: "crypt-granite",
                hue: "cyan-ward",
                glow: "bright",
                piece: "floor-flag",
                rune: style.rune,
                variant: style.variant,
                ...SCENE_KNOBS,
            });
            marker.position.set(clue.position[0], FLOOR_TOP, clue.position[1]);
            marker.rotation.y = Math.random() * Math.PI * 2;
            marker.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) child.castShadow = true;
            });
            this.scene.add(marker);

            this.clues.set(clue.id, {
                id: clue.id,
                position: new THREE.Vector3(clue.position[0], FLOOR_TOP, clue.position[1]),
                marker,
                collected: false,
            });
        }
    }

    private async buildCharacters() {
        this.player = TOMB_CHARACTERS.player();
        this.player.position.set(PLAYER_SPAWN.position[0], FLOOR_TOP, PLAYER_SPAWN.position[1]);
        this.player.rotation.y = PLAYER_SPAWN.facing;
        this.player.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        this.scene.add(this.player);
        this.playerPos.copy(this.player.position);
        this.playerFacing = PLAYER_SPAWN.facing;
        this.lookYaw = PLAYER_SPAWN.facing;

        for (const id of NPC_IDS) {
            const spawn = NPC_SPAWNS[id];
            const group = TOMB_CHARACTERS[id]();
            group.position.set(spawn.position[0], FLOOR_TOP, spawn.position[1]);
            // YXZ：先绕自身横轴倒地、再转身，尸体才会朝面朝的方向倒下
            group.rotation.order = "YXZ";
            group.rotation.y = spawn.facing;
            group.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            this.scene.add(group);
            this.npcs.set(id, {
                id,
                group,
                alive: true,
                isImpostor: this.state.impostorIds.includes(id),
                position: new THREE.Vector3(spawn.position[0], FLOOR_TOP, spawn.position[1]),
                facing: spawn.facing,
                target: new THREE.Vector3(
                    spawn.position[0] + (Math.random() - 0.5) * 6,
                    FLOOR_TOP,
                    spawn.position[1] + (Math.random() - 0.5) * 6,
                ),
                state: "wander",
                cooldown: 0,
                pauseTimer: 1 + Math.random() * 2,
                victim: null,
                anim: null,
                deathT: 0,
            });
        }

        // 载入动画（片段来自 polyfork CDN，失败时退化为程序化待机）
        const characters: THREE.Object3D[] = [
            this.player,
            ...[...this.npcs.values()].map((npc) => npc.group),
        ];
        await Promise.all(
            characters.map(async (character) => {
                try {
                    const anim = await animate(character, { clips: ["Idle", "Walk", "Run"] });
                    const handle: CharacterAnimator = {
                        locomotion: anim.locomotion,
                        update: anim.update,
                    };
                    if (character === this.player) {
                        this.playerAnim = handle;
                    } else {
                        const npc = [...this.npcs.values()].find((item) => item.group === character);
                        if (npc) npc.anim = handle;
                    }
                } catch (error) {
                    console.warn("[TombEngine] 动画加载失败，使用程序化待机", error);
                }
            }),
        );
    }

    private setupLighting() {
        // 环境底光：冷紫，压得很低，只负责让暗部不至于纯黑
        this.scene.add(new THREE.AmbientLight(0x3b3557, 0.9));
        // 地面色偏亮一点：朝下的面（天花板上、墙脚）才不会黑成一片
        this.scene.add(new THREE.HemisphereLight(0x5b5280, 0x241f38, 0.9));

        // 四角火盆：主要暖光源
        for (const spec of PROPS.filter((prop) => prop.asset === "standingBrazier")) {
            const light = new THREE.PointLight(0xff9048, 15, 13, 2);
            light.position.set(spec.position[0], FLOOR_TOP + 1.05, spec.position[2]);
            this.scene.add(light);
        }

        // 石门冷光：引导玩家走向出口
        const gateLight = new THREE.PointLight(0x5f9cff, 5, 9, 2);
        gateLight.position.set(0, 2.2, 9.2);
        this.scene.add(gateLight);

        // 线索光：全场只保留一盏，跟随离玩家最近的未拾取线索
        this.clueLight = new THREE.PointLight(0x5fd8ff, 2.2, 5, 2);
        this.clueLight.position.set(0, FLOOR_TOP + 0.5, 0);
        this.scene.add(this.clueLight);

        // 玩家的提灯（唯一投射阴影的光源）
        const spot = new THREE.SpotLight(0xfff0d0, 16, 15, Math.PI / 3, 0.55, 1.6);
        spot.position.set(0, 2.15, 0);
        spot.target.position.set(0, 0, 1.2);
        this.player.add(spot);
        this.player.add(spot.target);
        spot.castShadow = true;
        spot.shadow.mapSize.set(1024, 1024);
        spot.shadow.camera.near = 0.5;
        spot.shadow.camera.far = 14;
        spot.shadow.bias = -0.0004;
        spot.shadow.normalBias = 0.03;

        // 顶光：给角色一点轮廓，避免完全变成剪影
        const overhead = new THREE.DirectionalLight(0x9aa4d8, 0.62);
        overhead.position.set(4, 12, -6);
        overhead.target.position.set(0, 0, 0);
        this.scene.add(overhead);
        this.scene.add(overhead.target);
    }

    // ------------------------------------------------------------------ 事件

    private bindEvents() {
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);
        window.addEventListener("resize", this.onResize);
        this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
        window.addEventListener("pointermove", this.onPointerMove);
        window.addEventListener("pointerup", this.onPointerUp);
        document.addEventListener("pointerlockchange", this.onPointerLockChange);
    }

    private onKeyDown = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();
        this.keys.add(key);
        if (
            ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)
        ) {
            event.preventDefault();
        }
    };

    private onKeyUp = (event: KeyboardEvent) => {
        this.keys.delete(event.key.toLowerCase());
    };

    private onResize = () => {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    };

    private onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        this.dragging = true;
        this.lastPointer = { x: event.clientX, y: event.clientY };
    };

    private onPointerMove = (event: PointerEvent) => {
        if (this.pointerLocked) {
            this.lookYaw -= event.movementX * 0.0026;
            this.lookPitch = clamp(this.lookPitch + event.movementY * 0.0022, -0.35, 0.85);
            return;
        }
        if (!this.dragging) return;
        const dx = event.clientX - this.lastPointer.x;
        const dy = event.clientY - this.lastPointer.y;
        this.lastPointer = { x: event.clientX, y: event.clientY };
        this.lookYaw -= dx * 0.005;
        this.lookPitch = clamp(this.lookPitch + dy * 0.004, -0.35, 0.85);
    };

    private onPointerUp = () => {
        this.dragging = false;
    };

    private onPointerLockChange = () => {
        this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    };

    requestPointerLock() {
        this.renderer.domElement.requestPointerLock?.();
    }

    // ------------------------------------------------------------------ 主循环

    private loop = () => {
        this.frameId = requestAnimationFrame(this.loop);
        const delta = Math.min(this.clock.getDelta(), 0.05);
        // 计时器始终运行（硬性规则：开局立刻启动，倒计时结束即触发结局）
        if (!this.ended) {
            this.elapsed += delta;
            this.timeLeft = Math.max(0, GAME_DURATION_SECONDS - this.elapsed);
            // 时间耗尽但线索够：石门最后一次表决，而不是直接判「困死古墓」
            // 伪人不走这条：他会在同一刻认出自己，直接崩坏（见 evaluateEnding 优先级 3）
            if (
                !this.votePending &&
                !this.paused &&
                this.timeLeft <= 0 &&
                this.state.clueIds.length >= REQUIRED_CLUES &&
                !this.state.playerIsImpostor
            ) {
                this.votePending = true;
                this.paused = true;
                this.callbacks.onVotePrompt?.("timeup");
            }
        }
        if (!this.paused) {
            this.updatePlayer(delta);
            this.updateNpcs(delta);
            this.updateAmbient(delta);
            this.updateClues(delta);
            this.checkGate();
            this.checkEnding();
        }
        this.updateCamera(delta);
        this.playerAnim?.update(delta);
        for (const npc of this.npcs.values()) npc.anim?.update(delta);
        this.renderer.render(this.scene, this.camera);

        this.hudTimer += delta;
        if (this.hudTimer > 0.1) {
            this.hudTimer = 0;
            this.emitHud();
        }
    };

    // -------------------------------------------------------------- 玩家控制

    private updatePlayer(delta: number) {
        const input = this.readMovementInput();
        const forward = new THREE.Vector3(Math.sin(this.lookYaw), 0, Math.cos(this.lookYaw));
        const right = new THREE.Vector3(-forward.z, 0, forward.x);
        const move = new THREE.Vector3()
            .addScaledVector(forward, input.forward)
            .addScaledVector(right, input.strafe);
        if (move.lengthSq() > 1) move.normalize();

        const runSpeed = input.run ? 4.6 : 2.5;
        const desired = move.multiplyScalar(runSpeed);
        this.playerVelocity.lerp(desired, Math.min(1, delta * 12));

        const next = this.playerPos.clone().addScaledVector(this.playerVelocity, delta);
        const resolved = this.resolveCircle(next.x, next.z, 0.45);
        next.x = resolved.x;
        next.z = resolved.z;
        this.playerPos.copy(next);
        this.player.position.set(this.playerPos.x, FLOOR_TOP, this.playerPos.z);

        const planarSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        if (planarSpeed > 0.12) {
            const targetFacing = Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
            this.playerFacing = lerpAngle(this.playerFacing, targetFacing, Math.min(1, delta * 12));
            this.player.rotation.y = this.playerFacing;
        }
        this.playerAnim?.locomotion(planarSpeed);
    }

    private readMovementInput() {
        const pressed = (...names: string[]) => names.some((name) => this.keys.has(name));
        let forward = 0;
        let strafe = 0;
        if (pressed("w", "arrowup")) forward += 1;
        if (pressed("s", "arrowdown")) forward -= 1;
        if (pressed("d", "arrowright")) strafe += 1;
        if (pressed("a", "arrowleft")) strafe -= 1;
        if (this.joystick.active) {
            forward += -this.joystick.y;
            strafe += this.joystick.x;
        }
        const run = pressed("shift") || Math.hypot(this.joystick.x, this.joystick.y) > 0.85;
        return { forward: clamp(forward, -1, 1), strafe: clamp(strafe, -1, 1), run };
    }

    /** 圆形角色与场景 AABB 的碰撞解算 */
    private resolveCircle(x: number, z: number, radius: number) {
        const limit = ROOM_HALF - 0.55;
        x = clamp(x, -limit, limit);
        z = clamp(z, -limit, limit);

        for (const collider of this.colliders) {
            const closestX = clamp(x, collider.minX, collider.maxX);
            const closestZ = clamp(z, collider.minZ, collider.maxZ);
            const dx = x - closestX;
            const dz = z - closestZ;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq >= radius * radius) continue;
            if (distanceSq > 1e-8) {
                const distance = Math.sqrt(distanceSq);
                x = closestX + (dx / distance) * radius;
                z = closestZ + (dz / distance) * radius;
            } else {
                const pushLeft = x - collider.minX;
                const pushRight = collider.maxX - x;
                const pushUp = z - collider.minZ;
                const pushDown = collider.maxZ - z;
                const smallest = Math.min(pushLeft, pushRight, pushUp, pushDown);
                if (smallest === pushLeft) x = collider.minX - radius;
                else if (smallest === pushRight) x = collider.maxX + radius;
                else if (smallest === pushUp) z = collider.minZ - radius;
                else z = collider.maxZ + radius;
            }
        }
        return { x, z };
    }

    private updateCamera(delta: number) {
        const target = new THREE.Vector3(this.playerPos.x, FLOOR_TOP + 1.45, this.playerPos.z);
        // 相机位于角色背后：offset = -forward（forward 与视线同向）
        const offset = new THREE.Vector3(
            -Math.sin(this.lookYaw) * Math.cos(this.lookPitch),
            Math.sin(this.lookPitch),
            -Math.cos(this.lookYaw) * Math.cos(this.lookPitch),
        );
        let distance = this.cameraDistance;
        for (let i = 0; i < 8; i += 1) {
            const candidate = target.clone().addScaledVector(offset, distance);
            if (!this.isInsideCollider(candidate.x, candidate.z, 0.45)) break;
            distance -= 0.4;
        }
        if (this.debugCamera) {
            this.camera.position.copy(this.debugCamera.position);
            this.camera.lookAt(this.debugCamera.target);
            return;
        }
        const desired = target.clone().addScaledVector(offset, Math.max(1.2, distance));
        // 保持在墓室之内
        const bound = ROOM_HALF - 0.6;
        desired.x = clamp(desired.x, -bound, bound);
        desired.z = clamp(desired.z, -bound, bound);
        this.camera.position.lerp(desired, Math.min(1, delta * 9));
        this.camera.lookAt(target);
    }

    private isInsideCollider(x: number, z: number, radius: number) {
        for (const collider of this.colliders) {
            const closestX = clamp(x, collider.minX, collider.maxX);
            const closestZ = clamp(z, collider.minZ, collider.maxZ);
            const dx = x - closestX;
            const dz = z - closestZ;
            if (dx * dx + dz * dz < radius * radius) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- NPC 行为

    private updateNpcs(delta: number) {
        const playerIsGood = !this.state.playerIsImpostor;
        let threat = 0;

        for (const npc of this.npcs.values()) {
            if (!npc.alive) {
                npc.deathT += delta;
                npc.group.rotation.x = Math.min(Math.PI / 2, npc.group.rotation.x + delta * 3);
                npc.group.position.y = FLOOR_TOP;
                continue;
            }

            if (npc.cooldown > 0) npc.cooldown -= delta;
            if (npc.pauseTimer > 0) npc.pauseTimer -= delta;

            if (npc.isImpostor && this.elapsed > GRACE_PERIOD && npc.cooldown <= 0) {
                const victim = this.findVictim(npc, playerIsGood);
                if (victim) {
                    npc.state = "stalk";
                    npc.victim = victim;
                } else if (npc.state === "stalk") {
                    npc.state = "wander";
                    npc.victim = null;
                }
            }

            let target: THREE.Vector3 | null = null;
            let speed = 0;

            if (npc.state === "stalk" && npc.victim) {
                target = this.playerPos.clone();
                speed = 2.35;
                const distance = target.distanceTo(npc.position);
                threat = Math.max(threat, clamp(1 - distance / 11, 0, 1));
                if (distance <= ATTACK_RANGE) {
                    this.performAttack(npc, "player");
                    continue;
                }
            } else {
                if (npc.pauseTimer <= 0) {
                    const reached = npc.position.distanceTo(npc.target) < 0.6;
                    if (reached) {
                        npc.target.set(
                            THREE.MathUtils.randFloat(-8.5, 8.5),
                            FLOOR_TOP,
                            THREE.MathUtils.randFloat(-8.5, 8.5),
                        );
                        npc.pauseTimer = 1.4 + Math.random() * 3;
                    }
                }
                if (npc.pauseTimer <= 0) {
                    target = npc.target;
                    speed = 1.05;
                }
            }

            let moved = 0;
            if (target) {
                const direction = target.clone().sub(npc.position);
                direction.y = 0;
                const distance = direction.length();
                if (distance > 0.05) {
                    direction.normalize();
                    const step = Math.min(speed * delta, distance);
                    const next = npc.position.clone().addScaledVector(direction, step);
                    const resolved = this.resolveCircle(next.x, next.z, 0.42);
                    npc.position.set(resolved.x, FLOOR_TOP, resolved.z);
                    moved = step;
                    const targetFacing = Math.atan2(direction.x, direction.z);
                    npc.facing = lerpAngle(npc.facing, targetFacing, Math.min(1, delta * 8));
                }
            }

            npc.group.position.set(npc.position.x, FLOOR_TOP, npc.position.z);
            npc.group.rotation.y = npc.facing;
            npc.anim?.locomotion(moved > 0.001 ? speed : 0);
        }

        this.threatLevel = threat;
    }

    /**
     * 伪人寻找袭击目标。
     *
     * 硬性规则：伪人不会主动对其他 NPC 下手，只会袭击落单的「玩家」。
     * 这样高教授与小远不会被 NPC 行为随机带走，「肃清伪人」结局的成败
     * 完全取决于玩家自己的盘问与出手。
     */
    private findVictim(attacker: NpcRuntime, playerIsGood: boolean): "player" | null {
        void attacker;
        if (!playerIsGood) return null; // 玩家是伪人时，伪人把玩家当同类
        return this.isPlayerAlone() ? "player" : null;
    }

    private isPlayerAlone() {
        for (const npc of this.npcs.values()) {
            if (!npc.alive || npc.isImpostor) continue;
            if (npc.position.distanceTo(this.playerPos) <= LONE_RADIUS) return false;
        }
        return true;
    }

    private performAttack(attacker: NpcRuntime, victim: "player") {
        if (this.state.playerIsImpostor) return; // 伪人不会袭击同类
        this.state.attackedByImpostor = true;
        attacker.cooldown = HUNT_COOLDOWN;
        attacker.state = "cooldown";
        attacker.victim = null;
        this.callbacks.onWarning?.("伪人识破了你！");
    }

    private killNpc(npc: NpcRuntime) {
        if (!npc.alive) return;
        npc.alive = false;
        npc.state = "dead";
        npc.deathT = 0;
        if (!this.state.deadNpcs.includes(npc.id)) this.state.deadNpcs.push(npc.id);
        if (!this.state.playerKills.includes(npc.id)) {
            this.state.playerKills.push(npc.id);
        }
        this.callbacks.onKill?.(npc.id);
    }

    // -------------------------------------------------------------- 氛围动画

    private updateAmbient(delta: number) {
        for (const rat of this.ambientRats) {
            if (rat.pause > 0) {
                rat.pause -= delta;
                continue;
            }
            const direction = rat.target.clone().sub(rat.group.position);
            direction.y = 0;
            if (direction.length() < 0.5) {
                rat.target.set(
                    THREE.MathUtils.randFloat(-8.5, 8.5),
                    FLOOR_TOP,
                    THREE.MathUtils.randFloat(-8.5, 8.5),
                );
                rat.pause = 1 + Math.random() * 3;
                continue;
            }
            direction.normalize();
            rat.group.position.addScaledVector(direction, 1.1 * delta);
            rat.group.rotation.y = Math.atan2(direction.x, direction.z);
        }
    }

    private updateClues(delta: number) {
        for (const clue of this.clues.values()) {
            if (clue.collected) continue;
            clue.marker.rotation.y += delta * 0.7;
        }

        // 只保留一盏线索光：跟随离玩家最近的未拾取线索，省下 4 盏点光源
        let nearest: ClueRuntime | null = null;
        let nearestDistance = Infinity;
        for (const clue of this.clues.values()) {
            if (clue.collected) continue;
            const distance = clue.position.distanceTo(this.playerPos);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = clue;
            }
        }
        if (nearest) {
            this.clueLight.position.set(
                nearest.position.x,
                FLOOR_TOP + 0.5,
                nearest.position.z,
            );
            this.clueLight.intensity = 2.2 + Math.sin(this.elapsed * 2.4) * 0.8;
        } else {
            this.clueLight.intensity = 0;
        }
    }

    private checkGate() {
        const dx = this.playerPos.x - GATE_POSITION[0];
        const dz = this.playerPos.z - GATE_POSITION[1];
        // 石门要集齐线索才开：没线索时走到门口只算「来过」，不能直接判定为抵达出口
        if (this.state.clueIds.length >= REQUIRED_CLUES && Math.hypot(dx, dz) <= GATE_RADIUS) {
            this.state.reachedGate = true;
        }
    }

    // ------------------------------------------------------------- 交互接口

    /** 当前可交互对象 */
    getInteractable(): {
        kind: PromptKind;
        npc: NpcId | null;
        clueId: string | null;
        label: string;
    } | null {
        let best: {
            kind: PromptKind;
            npc: NpcId | null;
            clueId: string | null;
            label: string;
            distance: number;
        } | null = null;

        for (const npc of this.npcs.values()) {
            if (!npc.alive) continue;
            const distance = npc.position.distanceTo(this.playerPos);
            if (distance > INTERACT_RANGE) continue;
            if (!best || distance < best.distance) {
                best = {
                    kind: "talk",
                    npc: npc.id,
                    clueId: null,
                    label: `与 ${NPC_NAMES[npc.id]} 交谈`,
                    distance,
                };
            }
        }

        for (const clue of this.clues.values()) {
            if (clue.collected) continue;
            const distance = clue.position.distanceTo(this.playerPos);
            if (distance > PICKUP_RANGE) continue;
            if (!best || distance < best.distance) {
                const definition = CLUES.find((item) => item.id === clue.id);
                best = {
                    kind: "clue",
                    npc: null,
                    clueId: clue.id,
                    label: `破解线索机关（${definition?.location ?? "未知"}）`,
                    distance,
                };
            }
        }

        if (!best) {
            const gateDistance = Math.hypot(
                this.playerPos.x - GATE_POSITION[0],
                this.playerPos.z - GATE_POSITION[1],
            );
            if (gateDistance <= GATE_RADIUS + 0.8) {
                best = {
                    kind: "gate",
                    npc: null,
                    clueId: null,
                    label:
                        this.state.clueIds.length >= REQUIRED_CLUES
                            ? "推开石门 · 全队表决"
                            : `石门纹丝不动（线索 ${this.state.clueIds.length}/${REQUIRED_CLUES}）`,
                    distance: gateDistance,
                };
            }
        }

        return best
            ? { kind: best.kind, npc: best.npc, clueId: best.clueId, label: best.label }
            : null;
    }

    /** 玩家拾取线索；forced = 靠蛮力撬开，表决时不能当证据 */
    pickUpClue(clueId: string, options: { forced?: boolean } = {}) {
        const clue = this.clues.get(clueId);
        if (!clue || clue.collected) return;
        const definition = CLUES.find((item) => item.id === clueId);
        if (!definition) return;
        clue.collected = true;
        clue.marker.visible = false;
        if (!this.state.clueIds.includes(clueId)) this.state.clueIds.push(clueId);
        if (options.forced && !(this.state.forcedClueIds ?? []).includes(clueId)) {
            this.state.forcedClueIds = [...(this.state.forcedClueIds ?? []), clueId];
        }
        this.callbacks.onClue?.(definition);
        this.revealIdentityIfNeeded();
        this.checkEnding();
        this.emitHud(true);
    }

    private revealIdentityIfNeeded() {
        if (this.state.identityRevealed) return;
        if (this.state.clueIds.length < REQUIRED_CLUES) return;
        this.state.identityRevealed = true;
        this.callbacks.onIdentity?.(this.state.playerIsImpostor, identityRevealText(this.state));
    }

    /** 玩家袭击目标（确认后调用） */
    attack(npcId: NpcId) {
        const npc = this.npcs.get(npcId);
        if (!npc || !npc.alive) return;
        this.killNpc(npc);
        this.checkEnding();
        this.emitHud(true);
    }

    /**
     * 当前可袭击的 NPC（用于确认弹窗）。
     * preferredId 优先：对话中袭击当前对象时用，只要在攻击距离内就允许，
     * 不再要求玩家把准星对准对方——正对着谁就只能打谁实在太反直觉。
     */
    getAttackTarget(preferredId?: NpcId | null): NpcId | null {
        if (preferredId) {
            const preferred = this.npcs.get(preferredId);
            if (
                preferred &&
                preferred.alive &&
                preferred.position.distanceTo(this.playerPos) <= PLAYER_ATTACK_RANGE
            ) {
                return preferredId;
            }
        }

        let best: NpcId | null = null;
        let bestDistance = Infinity;
        const forward = new THREE.Vector3(Math.sin(this.lookYaw), 0, Math.cos(this.lookYaw));
        for (const npc of this.npcs.values()) {
            if (!npc.alive) continue;
            const distance = npc.position.distanceTo(this.playerPos);
            if (distance > PLAYER_ATTACK_RANGE) continue;
            const toNpc = npc.position.clone().sub(this.playerPos).normalize();
            if (toNpc.dot(forward) < 0.3) continue;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = npc.id;
            }
        }
        return best;
    }

    /** 向 NPC 提问（关键词匹配） */
    ask(npcId: NpcId, question: string): NpcReply {
        const npc = this.npcs.get(npcId);
        // 硬性规则：NPC 被击杀后不再触发对话
        if (!npc || !npc.alive) return { text: "……", kind: "default", lied: false, truth: true };
        return askNpc(npcId, npc.isImpostor, question, this.dialogueState);
    }

    getClueIds() {
        return [...this.state.clueIds];
    }

    getTimeLeft() {
        return this.timeLeft;
    }

    isPlayerDead() {
        return !this.state.playerIsImpostor && this.state.attackedByImpostor;
    }

    // ------------------------------------------------------------- 表决与时间

    /** 走到石门前主动开启表决 */
    beginVote() {
        if (this.ended || this.votePending) return;
        this.votePending = true;
        this.paused = true;
        this.callbacks.onVotePrompt?.("gate");
    }

    /** 表决结果已交给 UI 结算，引擎停摆 */
    markVerdictEnded() {
        this.ended = true;
        this.paused = true;
        this.votePending = false;
    }

    /** 时间增减：破解机关回赠时间，蛮力撬开扣时间 */
    addSeconds(seconds: number) {
        if (this.ended) return;
        this.elapsed = Math.max(0, this.elapsed - seconds);
        this.timeLeft = Math.max(0, GAME_DURATION_SECONDS - this.elapsed);
        this.emitHud(true);
        if (this.timeLeft <= 0) this.checkEnding();
    }

    /** 表决用的局面快照（只有数据，没有渲染对象） */
    getStateSnapshot(): TombState {
        return {
            ...this.state,
            impostorIds: [...this.state.impostorIds],
            deadNpcs: [...this.state.deadNpcs],
            playerKills: [...this.state.playerKills],
            clueIds: [...this.state.clueIds],
            forcedClueIds: [...(this.state.forcedClueIds ?? [])],
        };
    }

    // ------------------------------------------------------------- 结局判定

    private checkEnding() {
        if (this.ended || this.votePending) return;
        const ending = evaluateEnding(this.state, this.timeLeft <= 0);
        if (!ending) return;
        this.ended = true;
        this.callbacks.onEnding?.(ending);
    }

    private emitHud(force = false) {
        if (!force && this.lastHud) {
            const same =
                Math.abs(this.lastHud.timeLeft - Math.ceil(this.timeLeft)) < 1 &&
                this.lastHud.clueIds.length === this.state.clueIds.length &&
                this.lastHud.prompt === this.getInteractable()?.label;
            if (same) return;
        }
        const interactable = this.getInteractable();
        const hud: HudState = {
            timeLeft: Math.ceil(this.timeLeft),
            clueIds: [...this.state.clueIds],
            prompt: interactable?.label ?? null,
            promptKind: interactable?.kind ?? null,
            promptNpc: interactable?.npc ?? null,
            promptClueId: interactable?.clueId ?? null,
            threat: this.threatLevel,
            identityKnown: this.state.identityRevealed,
            playerImpostor: this.state.playerIsImpostor,
            deadNpcs: [...this.state.deadNpcs],
        };
        this.lastHud = hud;
        this.callbacks.onHud?.(hud);
    }

    // --------------------------------------------------------------- 控制接口

    setPaused(paused: boolean) {
        this.paused = paused;
        if (paused) this.keys.clear();
    }

    setJoystick(x: number, y: number, active: boolean) {
        this.joystick = { x, y, active };
    }

    getPlayerPosition() {
        return this.playerPos;
    }

    // --------------------------------------------------------------- 调试接口
    /** 仅开发环境：暴露引擎以便自动化验证 */
    debugSnapshot() {
        return {
            player: { x: this.playerPos.x, z: this.playerPos.z },
            npcs: [...this.npcs.values()].map((npc) => ({
                id: npc.id,
                impostor: npc.isImpostor,
                alive: npc.alive,
                state: npc.state,
                x: npc.position.x,
                z: npc.position.z,
            })),
            clues: [...this.clues.values()].map((clue) => ({
                id: clue.id,
                collected: clue.collected,
            })),
            timeLeft: this.timeLeft,
            ended: this.ended,
        };
    }

    debugTeleport(x: number, z: number) {
        this.playerPos.set(x, FLOOR_TOP, z);
        this.player.position.set(x, FLOOR_TOP, z);
        this.playerVelocity.set(0, 0, 0);
    }

    debugFace(x: number, z: number) {
        this.lookYaw = Math.atan2(x - this.playerPos.x, z - this.playerPos.z);
    }

    /**
     * 仅开发环境：直接改写局面，用来自动化验证六种结局。
     * 会同步线索标记与尸体状态，让 HUD / 结局面板与真实玩法保持一致。
     */
    debugForce(overrides: Partial<TombState> & { timeLeft?: number }) {
        const { timeLeft, ...stateOverrides } = overrides;
        Object.assign(this.state, stateOverrides);

        if (stateOverrides.clueIds) {
            for (const clue of this.clues.values()) {
                if (stateOverrides.clueIds.includes(clue.id)) {
                    clue.collected = true;
                    clue.marker.visible = false;
                }
            }
        }
        if (stateOverrides.deadNpcs) {
            for (const npc of this.npcs.values()) {
                if (stateOverrides.deadNpcs.includes(npc.id)) {
                    npc.alive = false;
                    npc.state = "dead";
                }
            }
        }
        if (timeLeft !== undefined) {
            this.timeLeft = timeLeft;
            this.elapsed = GAME_DURATION_SECONDS - timeLeft;
        }
        this.revealIdentityIfNeeded();
        this.checkEnding();
        this.emitHud(true);
    }

    /** 仅开发环境：让场上某个伪人立刻对玩家动手，验证「被伪人清除」的真实链路 */
    debugTriggerAmbush() {
        for (const npc of this.npcs.values()) {
            if (npc.alive && npc.isImpostor) {
                this.performAttack(npc, "player");
                this.checkEnding();
                this.emitHud(true);
                return true;
            }
        }
        return false;
    }

    debugOverview() {
        // 相机必须留在房间内部：天花板是实体石砌券顶，跑到房间外俯视只会拍到全黑的顶板外侧
        this.debugCamera = {
            position: new THREE.Vector3(0, 2.7, 8.6),
            target: new THREE.Vector3(0, 0.6, -3),
        };
    }

    debugThirdPerson() {
        this.debugCamera = null;
    }

    private debugCamera: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

    dispose() {
        cancelAnimationFrame(this.frameId);
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
        window.removeEventListener("resize", this.onResize);
        window.removeEventListener("pointermove", this.onPointerMove);
        window.removeEventListener("pointerup", this.onPointerUp);
        document.removeEventListener("pointerlockchange", this.onPointerLockChange);
        this.renderer?.domElement.remove();
        this.renderer?.dispose();
    }
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function lerpAngle(current: number, target: number, t: number) {
    let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return current + diff * t;
}

