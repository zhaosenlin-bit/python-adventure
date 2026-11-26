/**
 * 迷宫探险门 —— 关卡数据、机关与机器人移动规则
 *
 * 地图用字符串表示：
 *  '#' 墙   '.' 通路   'S' 起点   'E' 出口
 *  'g' 宝石 'K' 钥匙  'G' 金门  'P' 压力板  '1'/'2'/'3' 配对传送阵
 */

export type Direction = 'east' | 'south' | 'west' | 'north';
export type MazeCommand = 'forward' | 'left' | 'right';

/** 机关类型 */
export type MechanismKind = 'gem' | 'key' | 'gate' | 'plate' | 'teleport';

export interface MazeMechanism {
    kind: MechanismKind;
    x: number;
    y: number;
    /** 传送阵的配对编号：相同 pair 的两个传送阵互相连通 */
    pair?: number;
}

const MECHANISM_CHARS: Record<string, { kind: MechanismKind; pair?: number }> = {
    g: { kind: 'gem' },
    K: { kind: 'key' },
    G: { kind: 'gate' },
    P: { kind: 'plate' },
    '1': { kind: 'teleport', pair: 1 },
    '2': { kind: 'teleport', pair: 2 },
    '3': { kind: 'teleport', pair: 3 },
};

export interface MazeLevel {
    id: string;
    name: string;
    goal: string;
    /** 地图行，必须为矩形 */
    grid: string[];
    /** 编辑器里的初始代码 */
    starterCode: string;
    hint: string;
    /** 参考解法（指令序列），用于校验关卡可解与教学示范 */
    solution: MazeCommand[];
}

export interface MazeGrid {
    width: number;
    height: number;
    /** walls[y][x] === true 表示该格是墙 */
    walls: boolean[][];
    start: { x: number; y: number };
    exit: { x: number; y: number };
    /** 地图里的机关列表 */
    mechanisms: MazeMechanism[];
}

export interface RobotState {
    x: number;
    y: number;
    direction: Direction;
}

const CLOCKWISE: Direction[] = ['east', 'south', 'west', 'north'];

const DELTAS: Record<Direction, { dx: number; dy: number }> = {
    east: { dx: 1, dy: 0 },
    south: { dx: 0, dy: 1 },
    west: { dx: -1, dy: 0 },
    north: { dx: 0, dy: -1 },
};

export const START_DIRECTION: Direction = 'east';

export const DIRECTION_LABELS: Record<Direction, string> = {
    east: '东',
    south: '南',
    west: '西',
    north: '北',
};

export function parseMaze(grid: string[]): MazeGrid {
    const height = grid.length;
    const width = grid[0].length;
    let start = { x: 1, y: 1 };
    let exit = { x: 1, y: 1 };
    const mechanisms: MazeMechanism[] = [];
    const walls: boolean[][] = [];

    for (let y = 0; y < height; y++) {
        const row = grid[y];
        if (row.length !== width) {
            throw new Error(`迷宫第 ${y} 行宽度不一致`);
        }
        const line: boolean[] = [];
        for (let x = 0; x < width; x++) {
            const cell = row[x];
            if (cell === 'S') start = { x, y };
            if (cell === 'E') exit = { x, y };
            const mechanism = MECHANISM_CHARS[cell];
            if (mechanism) {
                mechanisms.push({ x, y, ...mechanism });
            }
            line.push(cell === '#');
        }
        walls.push(line);
    }

    return { width, height, walls, start, exit, mechanisms };
}

export function turn(direction: Direction, command: 'left' | 'right'): Direction {
    const index = CLOCKWISE.indexOf(direction);
    const offset = command === 'right' ? 1 : 3;
    return CLOCKWISE[(index + offset) % 4];
}

export function isWall(grid: MazeGrid, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
        return true;
    }
    return grid.walls[y][x];
}

export function isExit(grid: MazeGrid, state: { x: number; y: number }): boolean {
    return state.x === grid.exit.x && state.y === grid.exit.y;
}

export interface RunState {
    robot: RobotState;
    /** 已收集宝石的坐标 key */
    gems: string[];
    /** 是否捡到了钥匙 */
    hasKey: boolean;
    /** 压力板是否被踩下（踩下后所有金门常开） */
    platesOpen: boolean;
}

export function initRunState(grid: MazeGrid): RunState {
    return {
        robot: { ...grid.start, direction: START_DIRECTION },
        gems: [],
        hasKey: false,
        platesOpen: false,
    };
}

export interface StepResult {
    run: RunState;
    blocked: boolean;
    /** 被挡住的原因：普通墙壁，还是没开的金门 */
    blockedBy?: 'wall' | 'gate';
    /** 本步触发的事件，供界面做反馈 */
    collectedGem?: boolean;
    pickedKey?: boolean;
    pressedPlate?: boolean;
    /** 踩上传送阵被传送 */
    warped?: { from: { x: number; y: number }; to: { x: number; y: number } };
}

function mechanismAt(grid: MazeGrid, kind: MechanismKind, x: number, y: number): MazeMechanism | undefined {
    return grid.mechanisms.find((m) => m.kind === kind && m.x === x && m.y === y);
}

/**
 * 在带机关的迷宫里执行一条指令。宝石/钥匙/压力板在走上去时自动触发，
 * 传送阵在踩上去的一瞬间把机器人送到配对的另一个传送阵（朝向不变）。
 */
export function simulateStep(grid: MazeGrid, run: RunState, command: MazeCommand): StepResult {
    if (command === 'left' || command === 'right') {
        return {
            run: { ...run, robot: { ...run.robot, direction: turn(run.robot.direction, command) } },
            blocked: false,
        };
    }

    const { dx, dy } = DELTAS[run.robot.direction];
    const nextX = run.robot.x + dx;
    const nextY = run.robot.y + dy;

    if (isWall(grid, nextX, nextY)) {
        return { run, blocked: true, blockedBy: 'wall' };
    }

    const gate = mechanismAt(grid, 'gate', nextX, nextY);
    if (gate && !run.hasKey && !run.platesOpen) {
        return { run, blocked: true, blockedBy: 'gate' };
    }

    let next: RunState = { ...run, robot: { x: nextX, y: nextY, direction: run.robot.direction } };
    const result: StepResult = { run: next, blocked: false };

    if (mechanismAt(grid, 'gem', nextX, nextY)) {
        const key = cellKey(nextX, nextY);
        if (!next.gems.includes(key)) {
            next = { ...next, gems: [...next.gems, key] };
            result.collectedGem = true;
        }
    }

    if (mechanismAt(grid, 'key', nextX, nextY) && !next.hasKey) {
        next = { ...next, hasKey: true };
        result.pickedKey = true;
    }

    if (mechanismAt(grid, 'plate', nextX, nextY) && !next.platesOpen) {
        next = { ...next, platesOpen: true };
        result.pressedPlate = true;
    }

    const pad = mechanismAt(grid, 'teleport', nextX, nextY);
    if (pad?.pair !== undefined) {
        const partner = grid.mechanisms.find(
            (m) => m.kind === 'teleport' && m.pair === pad.pair && !(m.x === nextX && m.y === nextY),
        );
        if (partner) {
            result.warped = { from: { x: nextX, y: nextY }, to: { x: partner.x, y: partner.y } };
            next = { ...next, robot: { x: partner.x, y: partner.y, direction: next.robot.direction } };
        }
    }

    result.run = next;
    return result;
}

export function gemsRemaining(grid: MazeGrid, run: RunState): number {
    const total = grid.mechanisms.filter((m) => m.kind === 'gem').length;
    return total - run.gems.length;
}

/** 到达出口且宝石集齐才算通关 */
export function isLevelComplete(grid: MazeGrid, run: RunState): boolean {
    return isExit(grid, run.robot) && gemsRemaining(grid, run) === 0;
}

export function cellKey(x: number, y: number): string {
    return `${x},${y}`;
}

export const COMMAND_LABELS: Record<MazeCommand, string> = {
    forward: 'move()',
    left: 'turn_left()',
    right: 'turn_right()',
};

export const MAZE_LEVELS: MazeLevel[] = [
    {
        id: 'level-1',
        name: '第一关 · 直线加一个弯',
        goal: '机器人面朝东边。往前走 4 步，再 turn_right() 转身朝下走 2 步，就能到达出口。',
        grid: [
            '#######',
            '#S....#',
            '#####.#',
            '#....E#',
            '#.#####',
            '#.....#',
            '#######',
        ],
        starterCode: `# 用 Python 指挥机器人走到出口 🚪
# 可用指令：move()  turn_left()  turn_right()

move()
move()
`,
        hint: '先写 4 次 move()，再用 turn_right() 让机器人面朝下，最后 2 次 move()。',
        solution: ['forward', 'forward', 'forward', 'forward', 'right', 'forward', 'forward'],
    },
    {
        id: 'level-2',
        name: '第二关 · 连拐两个弯',
        goal: '走到迷宫左下角的出口。机器人只会听代码的话，不会自己找路。',
        grid: [
            '#######',
            '#S....#',
            '####..#',
            '#E....#',
            '#.#####',
            '#.....#',
            '#######',
        ],
        starterCode: `# 一段直路 + 一个转弯，试着把路线写完整

move()
`,
        hint: 'move() 走 3 步 → turn_right() → move() 2 步 → 再 turn_right() → move() 3 步到出口。',
        solution: ['forward', 'forward', 'forward', 'right', 'forward', 'forward', 'right', 'forward', 'forward', 'forward'],
    },
    {
        id: 'level-3',
        name: '第三关 · 学会左转',
        goal: '这一关要用到 turn_left()。机器人的左和右，是按它自己面朝的方向算的。',
        grid: [
            '#########',
            '#S....#.#',
            '####.#..#',
            '#....#..#',
            '#.####.##',
            '#......E#',
            '#########',
        ],
        starterCode: `# 用 for 循环可以少写很多重复的指令

for i in range(3):
    move()

turn_right()
`,
        hint: 'move() 3 步 → turn_right() 走 2 步 → turn_right() 走 3 步 → turn_left() 走 2 步 → turn_left() → 走 6 步到出口。',
        solution: [
            'forward', 'forward', 'forward',
            'right', 'forward', 'forward',
            'right', 'forward', 'forward', 'forward',
            'left', 'forward', 'forward',
            'left',
            'forward', 'forward', 'forward', 'forward', 'forward', 'forward',
        ],
    },
    {
        id: 'level-4',
        name: '第四关 · 蛇形长廊',
        goal: '长廊来回折返，手写 35 条指令太累了 —— 用循环把它变短。',
        grid: [
            '###########',
            '#S........#',
            '#########.#',
            '#.........#',
            '#.#########',
            '#.........#',
            '#########.#',
            '#........E#',
            '###########',
        ],
        starterCode: `# 蛇形长廊：move() 8 步 → 转弯 → move() 2 步 → 再转弯……
# 试试用 for 循环，一个来回只写一次

for i in range(8):
    move()

turn_right()

for i in range(2):
    move()
`,
        hint: '路线是「move() 8 步 → turn_right() → move() 2 步 → turn_right() → move() 8 步 → turn_left() → move() 2 步 → turn_left() → move() 8 步 → turn_right() → move() 2 步」。',
        solution: [
            'forward', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward',
            'right', 'forward', 'forward',
            'right', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward',
            'left', 'forward', 'forward',
            'left', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward',
            'right', 'forward', 'forward',
        ],
    },
    {
        id: 'level-5',
        name: '第五关 · 收集宝石',
        goal: '路上散落着 3 颗 💎 宝石，走到宝石上就会自动捡起来。集齐所有宝石，出口的魔法门才会打开。',
        grid: [
            '#########',
            '#S..g...#',
            '#####.#.#',
            '#g......#',
            '#.#####.#',
            '#..g...E#',
            '#########',
        ],
        starterCode: `# 走到宝石上就能自动收集 💎
# 集齐所有宝石，出口才会打开

move()

`,
        hint: '沿路走就能捡齐宝石：向东 6 步 → 右转走 2 步 → 右转走 6 步 → 左转走 2 步 → 再左转走 6 步到出口。',
        solution: [
            'forward', 'forward', 'forward', 'forward', 'forward', 'forward',
            'right', 'forward', 'forward',
            'right', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward',
            'left', 'forward', 'forward',
            'left', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward',
        ],
    },
    {
        id: 'level-6',
        name: '第六关 · 钥匙与门',
        goal: '出口被一扇金门挡住了。先绕路捡起 🔑 钥匙，再走到门前就能自动开门过去。',
        grid: [
            '#########',
            '#S.K#G.E#',
            '#.#.#.###',
            '#.......#',
            '#########',
        ],
        starterCode: `# 金门需要 🔑 钥匙：捡到钥匙后，走到门前会自动开门
# 先想清楚钥匙在哪、门在哪

move()

`,
        hint: '向东 2 步捡钥匙 → 右转走 2 步 → 左转走 2 步 → 左转走 2 步 → 右转走 2 步，穿过金门到出口。',
        solution: [
            'forward', 'forward',
            'right', 'forward', 'forward',
            'left', 'forward', 'forward',
            'left', 'forward', 'forward',
            'right', 'forward', 'forward',
        ],
    },
    {
        id: 'level-7',
        name: '第七关 · 压力板机关',
        goal: '通往出口的路上有一扇关着的门。先踩到 ⭕ 压力板上，门就会一直开着——顺序很重要！',
        grid: [
            '#########',
            '#S....P.#',
            '####G####',
            '#......E#',
            '#########',
        ],
        starterCode: `# 踩到 ⭕ 压力板，金门就会打开
# move() 可以带数字：move(5) 一次走 5 格

move(5)

`,
        hint: 'move(5) 踩上压力板 → 连转两次 turn_right() 掉头 → move(2) 走回门前 → turn_left() 穿过门再走一步 → turn_left() → move(3) 到出口。',
        solution: [
            'forward', 'forward', 'forward', 'forward', 'forward',
            'right', 'right',
            'forward', 'forward',
            'left', 'forward', 'forward',
            'left', 'forward', 'forward', 'forward',
        ],
    },
    {
        id: 'level-8',
        name: '第八关 · 传送阵',
        goal: '路断了！走到 🌀 传送阵上，会被瞬间送到配对的另一个传送阵（落地后朝向不变）。借传送阵跨过峡谷，顺路捡走宝石。',
        grid: [
            '##########',
            '#S...1...#',
            '##########',
            '#1....g.E#',
            '##########',
        ],
        starterCode: `# 🌀 传送阵：踩上去就会被送到配对的另一个传送阵
# 落地后朝向不变，接着走就行

move(4)

`,
        hint: 'move(4) 踩上传送阵 → 落到对岸后继续 move(7)，一路捡宝石走到出口。',
        solution: [
            'forward', 'forward', 'forward', 'forward',
            'forward', 'forward', 'forward', 'forward', 'forward', 'forward', 'forward',
        ],
    },
];
