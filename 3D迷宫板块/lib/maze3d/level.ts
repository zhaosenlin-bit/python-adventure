/**
 * 3D 编程迷宫 —— 关卡数据与生成
 *
 * 迷宫用「递归回溯」在奇数格网上挖出来，保证任意两格之间只有一条路，
 * 所以「正确出口」永远可达，而「陷阱门」全部放在死路上 ——
 * 玩家只有主动钻进死胡同才会被逮到，探索是安全的，贪心才有代价。
 *
 * 生成过程完全由难度本身决定（固定种子），因此同一难度每次进去都是同一张图，
 * 玩家可以复盘、可以背路线，单元测试也能稳定断言。
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DifficultyConfig {
    id: Difficulty;
    label: string;
    subtitle: string;
    /** 迷宫边长（奇数，含外墙） */
    size: number;
    coinCount: number;
    trapCount: number;
}

export const DIFFICULTIES: readonly DifficultyConfig[] = [
    { id: 'easy', label: '简单', subtitle: '11 × 11 · 2 道陷阱门', size: 11, coinCount: 4, trapCount: 2 },
    { id: 'medium', label: '中等', subtitle: '15 × 15 · 4 道陷阱门', size: 15, coinCount: 7, trapCount: 4 },
    { id: 'hard', label: '困难', subtitle: '21 × 21 · 6 道陷阱门', size: 21, coinCount: 11, trapCount: 6 },
];

export function getDifficulty(id: Difficulty): DifficultyConfig {
    return DIFFICULTIES.find((item) => item.id === id) ?? DIFFICULTIES[0];
}

/** 0=北(-z) 1=东(+x) 2=南(+z) 3=西(-x) */
export type Facing = 0 | 1 | 2 | 3;

export const DIR_VECTORS: readonly { dx: number; dz: number }[] = [
    { dx: 0, dz: -1 },
    { dx: 1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: -1, dz: 0 },
];

export interface Cell {
    x: number;
    z: number;
}

export interface Door extends Cell {
    /** true = 通关门，false = 陷阱门（进门要答对 Python 题才能回来） */
    correct: boolean;
}

export interface Level3D {
    difficulty: Difficulty;
    width: number;
    height: number;
    /** 下标 z * width + x，true = 墙 */
    walls: boolean[];
    start: Cell;
    exit: Cell;
    facing: Facing;
    coins: Cell[];
    doors: Door[];
    /** 最短通关步数（只算 move()） */
    par: number;
    seed: number;
}

const DEFAULT_SEEDS: Record<Difficulty, number> = {
    easy: 20_261_031,
    medium: 20_261_032,
    hard: 20_261_033,
};

export function cellKey(x: number, z: number): string {
    return `${x},${z}`;
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function carveMaze(width: number, height: number, rand: () => number): boolean[] {
    const walls = new Array<boolean>(width * height).fill(true);
    const stack: Cell[] = [{ x: 1, z: 1 }];
    walls[1 * width + 1] = false;

    while (stack.length > 0) {
        const current = stack[stack.length - 1];
        const options = DIR_VECTORS.map((dir) => ({ x: current.x + dir.dx * 2, z: current.z + dir.dz * 2 })).filter(
            (next) =>
                next.x > 0 &&
                next.z > 0 &&
                next.x < width - 1 &&
                next.z < height - 1 &&
                walls[next.z * width + next.x],
        );

        if (options.length === 0) {
            stack.pop();
            continue;
        }

        const next = options[Math.floor(rand() * options.length)];
        walls[((current.z + next.z) / 2) * width + (current.x + next.x) / 2] = false;
        walls[next.z * width + next.x] = false;
        stack.push(next);
    }

    return walls;
}

export function isWall(level: Level3D, x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= level.width || z >= level.height) return true;
    return level.walls[z * level.width + x];
}

export function canWalk(level: Level3D, x: number, z: number): boolean {
    return !isWall(level, x, z);
}

/** 从起点到每个格子的最少步数，-1 表示墙或不可达 */
export function distanceMap(level: Level3D, from: Cell = level.start): number[] {
    const dist = new Array<number>(level.width * level.height).fill(-1);
    const queue: Cell[] = [from];
    dist[from.z * level.width + from.x] = 0;

    for (let head = 0; head < queue.length; head++) {
        const cell = queue[head];
        const base = dist[cell.z * level.width + cell.x];
        for (const dir of DIR_VECTORS) {
            const x = cell.x + dir.dx;
            const z = cell.z + dir.dz;
            if (!canWalk(level, x, z)) continue;
            const index = z * level.width + x;
            if (dist[index] !== -1) continue;
            dist[index] = base + 1;
            queue.push({ x, z });
        }
    }

    return dist;
}

export function doorAt(level: Level3D, x: number, z: number): Door | undefined {
    return level.doors.find((door) => door.x === x && door.z === z);
}

export function coinAt(level: Level3D, x: number, z: number): boolean {
    return level.coins.some((coin) => coin.x === x && coin.z === z);
}

export function coinIndex(level: Level3D, x: number, z: number): number {
    return level.coins.findIndex((coin) => coin.x === x && coin.z === z);
}

function openNeighbours(level: Level3D, cell: Cell): Cell[] {
    return DIR_VECTORS.map((dir) => ({ x: cell.x + dir.dx, z: cell.z + dir.dz })).filter((next) =>
        canWalk(level, next.x, next.z),
    );
}

export function createLevel(difficulty: Difficulty, seed = DEFAULT_SEEDS[difficulty]): Level3D {
    const config = getDifficulty(difficulty);
    const width = config.size;
    const height = config.size;
    const rand = mulberry32(seed);
    const walls = carveMaze(width, height, rand);

    const base: Level3D = {
        difficulty,
        width,
        height,
        walls,
        start: { x: 1, z: 1 },
        exit: { x: width - 2, z: height - 2 },
        facing: 1,
        coins: [],
        doors: [],
        par: 0,
        seed,
    };

    const dist = distanceMap(base);
    const floors: Cell[] = [];
    for (let z = 1; z < height - 1; z++) {
        for (let x = 1; x < width - 1; x++) {
            if (canWalk(base, x, z)) floors.push({ x, z });
        }
    }

    // 陷阱门优先占最远的死胡同：它们在视觉上和出口一模一样，专治「乱撞流」
    const deadEnds = floors
        .filter((cell) => openNeighbours(base, cell).length === 1)
        .filter((cell) => !(cell.x === base.exit.x && cell.z === base.exit.z))
        .filter((cell) => dist[cell.z * width + cell.x] >= 3)
        .sort(
            (a, b) =>
                dist[b.z * width + b.x] - dist[a.z * width + a.x] || a.z - b.z || a.x - b.x,
        );

    const doorCells = deadEnds.slice(0, config.trapCount);
    const doors: Door[] = doorCells.map((cell) => ({ ...cell, correct: false }));
    doors.push({ x: base.exit.x, z: base.exit.z, correct: true });

    const doorKeys = new Set(doors.map((door) => cellKey(door.x, door.z)));
    const startKey = cellKey(base.start.x, base.start.z);

    // 金币撒在中远处通路上，逼玩家真正把迷宫走一遍
    const coinCandidates = floors
        .filter((cell) => !doorKeys.has(cellKey(cell.x, cell.z)))
        .filter((cell) => cellKey(cell.x, cell.z) !== startKey)
        .filter((cell) => dist[cell.z * width + cell.x] >= 3)
        .map((cell) => ({ cell, roll: rand() }))
        .sort((a, b) => a.roll - b.roll)
        .map((entry) => entry.cell);

    const coins = coinCandidates.slice(0, Math.min(config.coinCount, coinCandidates.length));

    return {
        ...base,
        coins,
        doors,
        par: dist[base.exit.z * width + base.exit.x],
    };
}
