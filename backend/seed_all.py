#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""统一内容初始化入口

用法
----
    python seed_all.py                # 重置内容表并灌入全部种子数据（推荐）
    python seed_all.py --keep         # 保留现有内容，增量补种
    python seed_all.py --only map     # 只执行某一组：schema / map / content
    python seed_all.py --list         # 列出所有步骤
    python seed_all.py --dry-run      # 只打印将要执行的动作

为什么需要这个脚本
------------------
仓库里有 20 多个 ``init_*.py``，其中 5 个会执行 ``db.query(MapObject).delete()``
做全量清空。单独按任意顺序跑，结果完全取决于「谁最后跑」——先跑的被删光，
于是 10 个地图区域里有 7 个最终一个对象都没有。

这个脚本把「清理」集中到自己手里：各步骤脚本通过环境变量 ``SEED_SKIP_CLEAR=1``
跳过自身的清空，于是所有地图对象可以叠加起来，最后统一做一次区域名归一化。

安全范围
--------
只清理「内容定义」表：地图区域、地图对象、任务、题库、技能、角色、AI 机器人。
**不会碰** users / user_progress / pets / inventory / achievements 等用户数据。
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

# ---------------------------------------------------------------------------
# 旧脚本里的区域名和 init_map_regions.py 的规范区域名对不上。
# 不归一化的话，这些对象对前端来说就是孤儿 —— 前端按 map_regions 里的区域名
# 去拉地图，名字对不上的对象永远拉不到，等于白灌。
# ---------------------------------------------------------------------------
LEGACY_AREA_ALIASES = {
    "算法森林": "编程森林",
    "数据结构山": "数据结构山脉",
    "神经网络迷宫": "算法迷宫",
    "Web开发海岸": "代码海洋",
    "守护天空之城": "云端之城",
    "AI研究所": "云端之城",
    "盛世天下": "猇亭广场",
}


@dataclass
class Step:
    """一个种子步骤。"""

    name: str
    script: str
    group: str
    # 该脚本自己是否会清空整张表；True 表示需要 SEED_SKIP_CLEAR=1
    self_clearing: bool = False
    note: str = ""


# 执行顺序很重要：后面的步骤会叠加在前面之上。
STEPS: list[Step] = [
    # ---- 地图区域（规范区域名，其它脚本都依赖它）----
    Step("regions", "init_map_regions.py", "map",
         note="10 个规范区域，后续脚本都挂在这些区域下"),
    # ---- 地图对象（全部叠加，不再互相清空）----
    Step("world-basic", "init_world_data.py", "map", self_clearing=True,
         note="基础世界数据"),
    Step("world-extended", "init_world_data_extended.py", "map", self_clearing=True,
         note="基于猇亭真实地点的扩展内容"),
    Step("map-all-regions", "init_extended_map_objects.py", "map",
         note="为每个区域铺对象"),
    Step("map-enhanced", "init_enhanced_map_objects.py", "map",
         note="算法迷宫等区域的加密内容"),
    Step("map-more", "init_more_map_content.py", "map",
         note="新手村 / 猇亭广场 的补充 NPC"),
    Step("map-landmarks", "init_shengshi_landmarks.py", "map",
         note="盛世天下地标"),
    Step("map-massive", "add_massive_map_content.py", "map", self_clearing=True,
         note="大批量内容"),
    Step("map-progressive", "init_progressive_content.py", "map", self_clearing=True,
         note="按等级渐进解锁的教学点"),
    Step("content-tasks", "init_complete_content.py", "content", self_clearing=True,
         note="Python 知识点任务 + 地图探索点（放在地图组最后，避免被清）"),
    # ---- 其它内容 ----
    Step("quiz", "init_quiz_questions.py", "content", note="对战题库"),
    Step("skills", "init_skills_and_pets.py", "content", note="技能模板"),
    Step("characters", "init_characters.py", "content", note="角色模板"),
    Step("ai-robots", "init_ai_robots.py", "content", note="AI 对战机器人"),
    Step("achievements", "init_achievements.py", "content", note="成就（已有数据则跳过）"),
]

# 会被「重置」清空的内容表（不包含任何用户数据）
RESET_MODELS = [
    ("map_objects", "app.models.map_object", "MapObject"),
    ("map_regions", "app.models.map_region", "MapRegion"),
    ("tasks", "app.models.task", "Task"),
    ("quiz_questions", "app.models.quiz_battle", "QuizQuestion"),
    ("skills", "app.models.skill", "Skill"),
    ("character_templates", "app.models.character", "CharacterTemplate"),
    ("ai_robots", "app.models.ai_robot", "AIRobot"),
]


def _model(module_path: str, class_name: str):
    module = __import__(module_path, fromlist=[class_name])
    return getattr(module, class_name)


def banner(text: str) -> None:
    print()
    print("=" * 62)
    print(f"  {text}")
    print("=" * 62)


def ensure_schema() -> None:
    from app.core.database import Base, engine

    Base.metadata.create_all(bind=engine)
    print("  ✅ 数据表结构已就绪")


def reset_content() -> None:
    """清空内容定义表。刻意不碰 users / progress / pets / inventory 等用户数据。"""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        for label, module_path, class_name in RESET_MODELS:
            model = _model(module_path, class_name)
            deleted = db.query(model).delete()
            print(f"  🧹 {label:<22} 清空 {deleted} 行")
        db.commit()
    finally:
        db.close()


def run_step(step: Step) -> tuple[bool, str]:
    """以子进程执行一个种子脚本，返回 (是否成功, 输出摘要)。"""
    script_path = BACKEND_DIR / step.script
    if not script_path.exists():
        return False, f"脚本不存在: {step.script}"

    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    if step.self_clearing:
        # 跳过脚本自身的清空，清理由 seed_all 统一管理
        env["SEED_SKIP_CLEAR"] = "1"

    try:
        proc = subprocess.run(
            [sys.executable, script_path.name],
            cwd=str(BACKEND_DIR),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        return False, "执行超时（300s）"

    output = (proc.stdout or "") + (proc.stderr or "")
    tail = [ln.rstrip() for ln in output.splitlines() if ln.strip()][-6:]
    if proc.returncode != 0:
        return False, "\n".join(tail) or f"退出码 {proc.returncode}"
    return True, "\n".join(tail)


def normalize_areas() -> tuple[int, list[str], list[str]]:
    """把旧区域名归一化到规范区域名。返回 (修正数, 孤儿区域, 说明)。"""
    from app.core.database import SessionLocal
    from app.models.map_object import MapObject
    from app.models.map_region import MapRegion

    db = SessionLocal()
    try:
        canonical = {r.name for r in db.query(MapRegion).all()}
        if not canonical:
            return 0, [], "没有规范区域，先跑 regions 步骤"

        fixed = 0
        touched: set[str] = set()
        for obj in db.query(MapObject).all():
            if obj.map_area in canonical:
                continue
            target = LEGACY_AREA_ALIASES.get(obj.map_area)
            if target and target in canonical:
                touched.add(obj.map_area)
                obj.map_area = target
                fixed += 1
        db.commit()

        orphans = sorted({
            area for (area,) in db.query(MapObject.map_area).distinct()
            if area not in canonical
        })
        return fixed, orphans, ", ".join(sorted(touched)) if touched else ""
    finally:
        db.close()


def report() -> None:
    from app.core.database import SessionLocal
    from app.models.map_object import MapObject
    from app.models.map_region import MapRegion

    db = SessionLocal()
    try:
        regions = db.query(MapRegion).order_by(MapRegion.id).all()
        counts: dict[str, int] = {}
        rows = db.query(MapObject.map_area).all()
        for (area,) in rows:
            counts[area] = counts.get(area, 0) + 1

        print()
        print("  地图区域内容分布")
        print("  " + "-" * 46)
        empty = []
        for region in regions:
            n = counts.get(region.name, 0)
            flag = "" if n else "   ← 空"
            print(f"  {region.name:<12} {n:>5} 个对象{flag}")
            if not n:
                empty.append(region.name)
        print("  " + "-" * 46)
        print(f"  合计 {len(regions)} 个区域，{sum(counts.values())} 个地图对象")
        if empty:
            print(f"  ⚠️ 仍然为空的区域: {', '.join(empty)}")
        else:
            print("  ✅ 所有区域都有内容")
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="统一内容初始化入口")
    parser.add_argument("--keep", action="store_true",
                        help="保留现有内容，增量补种（默认会重置内容表）")
    parser.add_argument("--only", choices=["schema", "map", "content"],
                        help="只执行某一组步骤")
    parser.add_argument("--list", action="store_true", help="列出所有步骤后退出")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不实际执行")
    args = parser.parse_args()

    if args.list:
        banner("种子步骤")
        for step in STEPS:
            mark = "🧹" if step.self_clearing else "  "
            print(f"  {mark} {step.group:<8} {step.script:<34} {step.note}")
        print()
        print("  🧹 = 该脚本自身会清空表，seed_all 会用 SEED_SKIP_CLEAR=1 跳过")
        return 0

    groups = [args.only] if args.only else ["schema", "map", "content"]
    steps = [s for s in STEPS if s.group in groups]

    banner("编程冒险岛 · 内容初始化")
    print(f"  模式: {'增量补种 (--keep)' if args.keep else '重置内容表'}")
    print(f"  分组: {', '.join(groups)}")
    if args.dry_run:
        print()
        for step in steps:
            print(f"  - {step.group:<8} {step.script}")
        print("\n  (dry-run，未实际执行)")
        return 0

    if "schema" in groups:
        banner("1/4 建表")
        ensure_schema()

    if not args.keep and "map" in groups:
        banner("2/4 重置内容表（不动用户数据）")
        reset_content()

    banner("3/4 执行种子步骤")
    failures: list[tuple[str, str]] = []
    for index, step in enumerate(steps, start=1):
        label = f"[{index}/{len(steps)}] {step.group}/{step.name} — {step.script}"
        print(f"  ▶ {label}")
        ok, summary = run_step(step)
        if ok:
            print("    ✅ 完成")
            for line in summary.splitlines():
                print(f"       {line}")
        else:
            print("    ❌ 失败")
            for line in summary.splitlines():
                print(f"       {line}")
            failures.append((step.script, summary))

    banner("4/4 区域名归一化 + 统计")
    fixed, orphans, touched = normalize_areas()
    if fixed:
        print(f"  ✅ 修正了 {fixed} 个对象的区域名（{touched}）")
    else:
        print("  ℹ️  没有需要修正的区域名")
    if orphans:
        print(f"  ⚠️  以下区域名不在 map_regions 里（前端拉不到这些对象）: {', '.join(orphans)}")
    report()

    if failures:
        banner("部分步骤失败")
        for script, summary in failures:
            print(f"  ❌ {script}")
            for line in summary.splitlines():
                print(f"       {line}")
        return 1

    print()
    print("  ✅ 全部完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
