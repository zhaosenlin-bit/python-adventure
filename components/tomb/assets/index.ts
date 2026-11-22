/**
 * polyfork 素材注册表：把 3D 素材模块集中映射成可读的工厂函数。
 * 所有模型均为 polyfork.dev 的免费低多边形素材（Dungeon & Crypt 等套件）。
 */

import type * as THREE from "three";

import { createAsset as createFlagstoneFloorTile } from "./flagstone-floor-tile-2a04ea.mjs";
import { createAsset as createDrainGrateTile } from "./drain-grate-tile-5568d9.mjs";
import { createAsset as createDungeonWallModule } from "./dungeon-wall-module-a537b3.mjs";
import { createAsset as createBurialNicheWall } from "./burial-niche-wall-1b937f.mjs";
import { createAsset as createBarredPortcullis } from "./barred-portcullis-2aa444.mjs";
import { createAsset as createBarredCellDoor } from "./barred-cell-door-571e9c.mjs";
import { createAsset as createIronBoundDoor } from "./iron-bound-door-e0e953.mjs";
import { createAsset as createStoneSarcophagus } from "./stone-sarcophagus-cc96a4.mjs";
import { createAsset as createTombSlab } from "./tomb-slab-ca9895.mjs";
import { createAsset as createCarvedKnightEffigy } from "./carved-knight-effigy-900a64.mjs";
import { createAsset as createStandingKnightStatue } from "./standing-knight-statue-8bdcc9.mjs";
import { createAsset as createTimberTrestleTable } from "./timber-trestle-table-024d88.mjs";
import { createAsset as createScrollRack } from "./scroll-rack-f465dd.mjs";
import { createAsset as createFuneraryUrn } from "./funerary-urn-688493.mjs";
import { createAsset as createClayStoragePot } from "./clay-storage-pot-626452.mjs";
import { createAsset as createFallenAshlarBlock } from "./fallen-ashlar-block-87824e.mjs";
import { createAsset as createBoneScatter } from "./bone-scatter-90313d.mjs";
import { createAsset as createTrapdoorPit } from "./trapdoor-pit-8d9a78.mjs";
import { createAsset as createRootIntrusion } from "./root-intrusion-9f1eaa.mjs";
import { createAsset as createGlowingRuneStone } from "./glowing-rune-stone-5a5558.mjs";
import { createAsset as createCarvedGraveStele } from "./carved-grave-stele-a1359c.mjs";
import { createAsset as createStandingBrazier } from "./standing-brazier-c9e4ee.mjs";
import { createAsset as createWallTorchBracket } from "./wall-torch-bracket-f5ad14.mjs";
import { createAsset as createCandleSpikeCluster } from "./candle-spike-cluster-d7c566.mjs";
import { createAsset as createIronChandelier } from "./iron-chandelier-1337dc.mjs";
import { createAsset as createStandingWaterPool } from "./standing-water-pool-daafcb.mjs";
import { createAsset as createMossPatch } from "./moss-patch-3ecaf4.mjs";
import { createAsset as createCobwebDrape } from "./cobweb-drape-f65d43.mjs";
import { createAsset as createStrawPile } from "./straw-pile-ebd54d.mjs";
import { createAsset as createOssuarySkullShelf } from "./ossuary-skull-shelf-a8fdf0.mjs";
import { createAsset as createArmourStand } from "./armour-stand-3d77c4.mjs";
import { createAsset as createWeaponRack } from "./weapon-rack-082d7f.mjs";
import { createAsset as createOakBarrel } from "./oak-barrel-b65311.mjs";
import { createAsset as createTimberCrate } from "./timber-crate-ba0739.mjs";
import { createAsset as createIronBandedStrongbox } from "./iron-banded-strongbox-698383.mjs";
import { createAsset as createJewelledDagger } from "./jewelled-dagger-38f556.mjs";
import { createAsset as createPotionBottle } from "./potion-bottle-099ad7.mjs";
import { createAsset as createGoblet } from "./goblet-87c3ba.mjs";
import { createAsset as createWallManacleFitting } from "./wall-manacle-fitting-e80d3a.mjs";
import { createAsset as createSpiralStairShaft } from "./spiral-stair-shaft-80de26.mjs";
import { createAsset as createStoneAltar } from "./stone-altar-8f3a0a.mjs";
import { createAsset as createDungeonRat } from "./dungeon-rat-cbb03c.mjs";
import { createAsset as createShamblingGhoul } from "./shambling-ghoul-256f2f.mjs";
import { createAsset as createGreatHelm } from "./great-helm-2551bc.mjs";
import { createAsset as createHeaterShield } from "./heater-shield-c51b76.mjs";
import { createAsset as createArmingSword } from "./arming-sword-401972.mjs";
import { createAsset as createGoldIngot } from "./gold-ingot-8da28a.mjs";
import { createAsset as createLooseFacetedGem } from "./loose-faceted-gem-d88a5b.mjs";

import { createAsset as createProspector } from "./prospector-69a481.mjs";
import { createAsset as createProfessor } from "./professor-14dc4d.mjs";
import { createAsset as createGraduateStudent } from "./graduate-student-945ef0.mjs";
import { createAsset as createStudentWithBackpack } from "./student-with-backpack-65d2b4.mjs";
import { createAsset as createHiker } from "./hiker-3d1a41.mjs";
import { createAsset as createPorter } from "./porter-e4e566.mjs";

export interface AssetFactory {
    (params?: Record<string, unknown>): THREE.Object3D;
}

export const TOMB_ASSETS: Record<string, AssetFactory> = {
    flagstoneFloorTile: createFlagstoneFloorTile,
    drainGrateTile: createDrainGrateTile,
    dungeonWallModule: createDungeonWallModule,
    burialNicheWall: createBurialNicheWall,
    barredPortcullis: createBarredPortcullis,
    barredCellDoor: createBarredCellDoor,
    ironBoundDoor: createIronBoundDoor,
    stoneSarcophagus: createStoneSarcophagus,
    tombSlab: createTombSlab,
    carvedKnightEffigy: createCarvedKnightEffigy,
    standingKnightStatue: createStandingKnightStatue,
    timberTrestleTable: createTimberTrestleTable,
    scrollRack: createScrollRack,
    funeraryUrn: createFuneraryUrn,
    clayStoragePot: createClayStoragePot,
    fallenAshlarBlock: createFallenAshlarBlock,
    boneScatter: createBoneScatter,
    trapdoorPit: createTrapdoorPit,
    rootIntrusion: createRootIntrusion,
    glowingRuneStone: createGlowingRuneStone,
    carvedGraveStele: createCarvedGraveStele,
    standingBrazier: createStandingBrazier,
    wallTorchBracket: createWallTorchBracket,
    candleSpikeCluster: createCandleSpikeCluster,
    ironChandelier: createIronChandelier,
    standingWaterPool: createStandingWaterPool,
    mossPatch: createMossPatch,
    cobwebDrape: createCobwebDrape,
    strawPile: createStrawPile,
    ossuarySkullShelf: createOssuarySkullShelf,
    armourStand: createArmourStand,
    weaponRack: createWeaponRack,
    oakBarrel: createOakBarrel,
    timberCrate: createTimberCrate,
    ironBandedStrongbox: createIronBandedStrongbox,
    jewelledDagger: createJewelledDagger,
    potionBottle: createPotionBottle,
    goblet: createGoblet,
    wallManacleFitting: createWallManacleFitting,
    spiralStairShaft: createSpiralStairShaft,
    stoneAltar: createStoneAltar,
    dungeonRat: createDungeonRat,
    shamblingGhoul: createShamblingGhoul,
    greatHelm: createGreatHelm,
    heaterShield: createHeaterShield,
    armingSword: createArmingSword,
    goldIngot: createGoldIngot,
    looseFacetedGem: createLooseFacetedGem,
};

/** 角色工厂：每个角色一套参数，区分年龄/性别/气质 */
export const TOMB_CHARACTERS: Record<string, AssetFactory> = {
    player: () => createProspector({ figure: "masculine", age: "adult", colorway: "sage", build: 0.94 }),
    gao: () => createProfessor({ figure: "feminine", age: "old", build: 0.9 }),
    xiaoyuan: () => createGraduateStudent({ figure: "feminine", age: "adult", expression: "alert", hair: "brown" }),
    xiaolin: () => createStudentWithBackpack({ figure: "masculine", age: "adult", build: 0.9 }),
    aze: () => createHiker({ figure: "masculine", age: "adult", build: 1.06 }),
    laozhang: () => createPorter({ figure: "masculine", age: "old", colorway: "timber" }),
} as const;
