/**
 * 3D 编程迷宫 —— 墙壁材质主题
 *
 * 模型本身是顶点色的低多边形石墙，没有 UV，所以主题不是贴图而是
 * 「材质参数 + 灯光 + 雾」整套一起换：颜色相乘、自发光、金属度、粗糙度，
 * 再配上地面网格色和雾色，四种主题的氛围就完全不同了。
 */

export interface MazeTheme {
    id: string;
    name: string;
    hint: string;
    wall: {
        color: number;
        emissive: number;
        emissiveIntensity: number;
        metalness: number;
        roughness: number;
    };
    floor: {
        color: number;
        grid: number;
        metalness: number;
        roughness: number;
    };
    fog: { color: number; near: number; far: number };
    sky: number;
    hemi: { sky: number; ground: number; intensity: number };
    dirIntensity: number;
    /** 墙顶压顶石：冰霜是积雪、熔岩是余烬、霓虹是发光边条 */
    wallCap: { color: number; emissive: number; emissiveIntensity: number };
    /** UI 强调色 */
    accent: string;
}

export const MAZE_THEMES: readonly MazeTheme[] = [
    {
        id: 'cemetery',
        name: '墓园石墙',
        hint: '模型原色，月光下的白石墓园',
        wall: { color: 0xffffff, emissive: 0x1b1409, emissiveIntensity: 0.35, metalness: 0.02, roughness: 0.92 },
        floor: { color: 0x2a2a25, grid: 0x46453a, metalness: 0.05, roughness: 0.95 },
        fog: { color: 0x0b0f16, near: 8, far: 34 },
        sky: 0x080b12,
        hemi: { sky: 0x93a7c9, ground: 0x241d14, intensity: 1.05 },
        dirIntensity: 0.65,
        wallCap: { color: 0x4a4a38, emissive: 0x000000, emissiveIntensity: 0 },
        accent: '#d8c69a',
    },
    {
        id: 'lava',
        name: '熔岩地宫',
        hint: '墙体泛红，空气里全是火光',
        wall: { color: 0xffc9ad, emissive: 0xff3d08, emissiveIntensity: 0.85, metalness: 0.05, roughness: 0.78 },
        floor: { color: 0x190a06, grid: 0x6d1f08, metalness: 0.1, roughness: 0.9 },
        fog: { color: 0x1b0703, near: 6, far: 26 },
        sky: 0x170502,
        hemi: { sky: 0xff8a55, ground: 0x2c0c04, intensity: 0.75 },
        dirIntensity: 1.0,
        wallCap: { color: 0x4d1607, emissive: 0xff4a12, emissiveIntensity: 0.75 },
        accent: '#ff8a55',
    },
    {
        id: 'frost',
        name: '冰霜回廊',
        hint: '青蓝色冰墙，雾很重',
        wall: { color: 0xbfe8ff, emissive: 0x2a6f9e, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.55 },
        floor: { color: 0x0b1a26, grid: 0x2b5872, metalness: 0.25, roughness: 0.6 },
        fog: { color: 0x07131d, near: 9, far: 38 },
        sky: 0x061019,
        hemi: { sky: 0xc7f0ff, ground: 0x0d2733, intensity: 1.1 },
        dirIntensity: 0.8,
        wallCap: { color: 0xe6f6ff, emissive: 0x2a6f9e, emissiveIntensity: 0.28 },
        accent: '#8fdcff',
    },
    {
        id: 'neon',
        name: '赛博霓虹',
        hint: '紫红自发光，最赛博的一档',
        wall: { color: 0xff8ce8, emissive: 0x8a1bff, emissiveIntensity: 1.15, metalness: 0.35, roughness: 0.35 },
        floor: { color: 0x05030a, grid: 0x37105a, metalness: 0.45, roughness: 0.4 },
        fog: { color: 0x04010a, near: 5, far: 24 },
        sky: 0x030008,
        hemi: { sky: 0xff5ce0, ground: 0x150030, intensity: 0.7 },
        dirIntensity: 0.9,
        wallCap: { color: 0x2a0a44, emissive: 0xff5ce0, emissiveIntensity: 0.9 },
        accent: '#ff5ce0',
    },
];

export function getTheme(id: string): MazeTheme {
    return MAZE_THEMES.find((theme) => theme.id === id) ?? MAZE_THEMES[0];
}
