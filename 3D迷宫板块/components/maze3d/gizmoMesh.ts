/**
 * 3D 编程迷宫 —— 小跟班「小弟」的模型
 *
 * 纯 three.js，不用外部资源：一个小机器球 + 面罩眼睛 + 天线 + 悬浮光环，
 * 配色跟着墙壁主题走。它不参与碰撞，只是飘在你右前方，负责卖萌和报警。
 */

import * as THREE from 'three';
import type { GizmoMood } from '@/lib/maze3d/gizmo';
import type { MazeTheme } from '@/lib/maze3d/themes';

export interface GizmoUpdateOptions {
    mood: GizmoMood;
    /** 箭头指向的世界朝向，null = 收起箭头 */
    arrowFacing: number | null;
    /** 相机朝向（弧度），让小弟脸朝玩家 */
    cameraYaw: number;
    moving: boolean;
}

export interface GizmoMesh {
    group: THREE.Group;
    update: (dt: number, time: number, options: GizmoUpdateOptions) => void;
    applyTheme: (theme: MazeTheme) => void;
    dispose: () => void;
    /** 捡金币时让小弟转一圈 */
    cheer: () => void;
}

const MOOD_COLOR: Record<GizmoMood, number> = {
    idle: 0x7fe7ff,
    lead: 0xffd166,
    warn: 0xff4d5e,
    cheer: 0xffe066,
};

export function createGizmo(theme: MazeTheme): GizmoMesh {
    const group = new THREE.Group();
    group.scale.setScalar(0.82);

    const bodyRig = new THREE.Group();
    group.add(bodyRig);

    const accent = new THREE.Color(theme.accent);
    const bodyMaterial = new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 0.85,
        metalness: 0.55,
        roughness: 0.3,
    });

    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), bodyMaterial);
    shell.position.y = 0;
    bodyRig.add(shell);

    // 宽扁的机甲面罩：横着一圈黑玻璃，不再凸成“鸭嘴”
    const visorMaterial = new THREE.MeshStandardMaterial({
        color: 0x0a1520,
        emissive: 0x123044,
        emissiveIntensity: 0.9,
        metalness: 0.4,
        roughness: 0.35,
    });
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.118, 24, 16), visorMaterial);
    visor.position.set(0, 0.012, 0.072);
    visor.scale.set(1.12, 0.6, 0.52);
    bodyRig.add(visor);

    // 一对发光眼睛，各带一个白色高光点
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xdffaff });
    const eyeGroup = new THREE.Group();
    const eyeGeometry = new THREE.SphereGeometry(0.028, 12, 10);
    const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eyeLeft.position.set(-0.045, 0.02, 0.125);
    const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eyeRight.position.set(0.045, 0.02, 0.125);
    const glintMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const glintGeometry = new THREE.SphereGeometry(0.009, 8, 8);
    const glintLeft = new THREE.Mesh(glintGeometry, glintMaterial);
    glintLeft.position.set(-0.037, 0.03, 0.146);
    const glintRight = new THREE.Mesh(glintGeometry, glintMaterial);
    glintRight.position.set(0.037, 0.03, 0.146);
    eyeGroup.add(eyeLeft, eyeRight, glintLeft, glintRight);
    bodyRig.add(eyeGroup);

    // 天线
    const antennaMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), antennaMaterial);
    antenna.position.set(0, 0.2, 0);
    bodyRig.add(antenna);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 10), eyeMaterial);
    bulb.position.set(0, 0.27, 0);
    bodyRig.add(bulb);

    // 两侧小翼
    const wingGeometry = new THREE.BoxGeometry(0.06, 0.02, 0.09);
    const leftWing = new THREE.Mesh(wingGeometry, bodyMaterial);
    leftWing.position.set(-0.16, 0.01, 0);
    leftWing.rotation.z = 0.35;
    const rightWing = new THREE.Mesh(wingGeometry, bodyMaterial);
    rightWing.position.set(0.16, 0.01, 0);
    rightWing.rotation.z = -0.35;
    bodyRig.add(leftWing, rightWing);

    // 悬浮光环
    const haloMaterial = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.19, 0.25, 28), haloMaterial);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.2;
    group.add(halo);

    // 指向箭头
    const arrowMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd166,
        emissive: 0xffb020,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.95,
        metalness: 0.2,
        roughness: 0.3,
    });
    const arrowGroup = new THREE.Group();
    const arrowCone = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.22, 4), arrowMaterial);
    arrowCone.rotation.x = Math.PI / 2;
    arrowCone.position.z = 0.11;
    const arrowBase = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), arrowMaterial);
    arrowGroup.add(arrowBase, arrowCone);
    arrowGroup.position.y = 0.42;
    arrowGroup.scale.setScalar(0.001);
    group.add(arrowGroup);

    const light = new THREE.PointLight(accent, 1.1, 5.5, 2);
    light.position.y = 0.05;
    group.add(light);

    const moodColor = new THREE.Color(accent);
    const targetColor = new THREE.Color(accent);
    let cheerUntil = 0;
    let arrowScale = 0.001;
    let bobPhase = 0;

    const setMoodColor = (mood: GizmoMood, themeAccent: THREE.Color) => {
        if (mood === 'idle') targetColor.setHex(themeAccent.getHex());
        else targetColor.setHex(MOOD_COLOR[mood]);
    };

    const themeAccent = accent.clone();

    return {
        group,
        cheer() {
            cheerUntil = performance.now() + 900;
        },
        applyTheme(next: MazeTheme) {
            themeAccent.set(next.accent);
        },
        update(dt, time, options) {
            const cheering = performance.now() < cheerUntil;
            const mood: GizmoMood = cheering ? 'cheer' : options.mood;
            setMoodColor(mood, themeAccent);

            moodColor.lerp(targetColor, Math.min(1, dt * 6));
            bodyMaterial.color.copy(moodColor);
            bodyMaterial.emissive.copy(moodColor);
            haloMaterial.color.copy(moodColor);
            light.color.copy(moodColor);
            light.intensity = 0.85 + (mood === 'warn' ? 0.6 : 0.25) * Math.abs(Math.sin(time * 3));

            // 悬浮 + 呼吸；面罩朝向玩家（相机 -forward = +Z 旋转 yaw）
            bobPhase += dt * (options.moving ? 4.4 : 2.1);
            bodyRig.position.y = Math.sin(bobPhase) * 0.035;
            bodyRig.rotation.y = options.cameraYaw;
            bodyRig.rotation.z = Math.sin(bobPhase * 0.5) * 0.08;

            if (mood === 'warn') {
                bodyRig.position.x = Math.sin(time * 42) * 0.018;
                bodyRig.rotation.z += Math.sin(time * 34) * 0.14;
            } else {
                bodyRig.position.x *= 0.85;
            }

            if (cheering) {
                bodyRig.rotation.y += time * 9;
                bodyRig.scale.setScalar(1 + Math.sin((time % 1) * Math.PI) * 0.12);
            } else {
                const s = bodyRig.scale.x + (1 - bodyRig.scale.x) * Math.min(1, dt * 6);
                bodyRig.scale.setScalar(s);
            }

            eyeGroup.scale.setScalar(mood === 'warn' ? 1.3 : 1);
            eyeMaterial.color.setHex(mood === 'warn' ? 0xff8a95 : 0xdffaff);

            halo.scale.setScalar(1 + Math.sin(time * 2.4) * 0.06);
            haloMaterial.opacity = 0.4 + Math.sin(time * 2.4) * 0.12;

            // 箭头：有目标才伸出来
            const wantArrow = options.arrowFacing !== null;
            arrowScale += ((wantArrow ? 1 : 0.001) - arrowScale) * Math.min(1, dt * 9);
            arrowGroup.scale.setScalar(Math.max(0.001, arrowScale));
            if (options.arrowFacing !== null) {
                const targetYaw = -options.arrowFacing * (Math.PI / 2);
                let diff = targetYaw - arrowGroup.rotation.y;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                arrowGroup.rotation.y += diff * Math.min(1, dt * 8);
            }
            arrowGroup.position.y = 0.42 + Math.sin(time * 5) * 0.02;
            arrowMaterial.color.copy(moodColor);
            arrowMaterial.emissive.copy(moodColor);
        },
        dispose() {
            group.traverse((object) => {
                const mesh = object as THREE.Mesh;
                if (mesh.isMesh) {
                    mesh.geometry?.dispose();
                    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                    materials.forEach((material) => material?.dispose());
                }
            });
        },
    };
}
