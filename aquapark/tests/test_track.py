"""赛道生成与几何的单元测试。"""

from __future__ import annotations

import math
import unittest

from .. import config
from ..track import (
    KIND_LIP,
    KIND_OUTER,
    KIND_WALL,
    KIND_WATER,
    Track,
    compute_normals,
)


class TrackGenerationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.track = Track(seed=20240917)

    def test_node_count_and_length(self) -> None:
        self.assertEqual(len(self.track.nodes), config.SEGMENT_COUNT)
        self.assertAlmostEqual(
            self.track.length, config.SEGMENT_COUNT * config.SEGMENT_LENGTH, places=6
        )

    def test_same_seed_gives_same_track(self) -> None:
        a = Track(seed=7)
        b = Track(seed=7)
        c = Track(seed=8)
        self.assertEqual(a.nodes[10].position.x, b.nodes[10].position.x)
        self.assertNotEqual(a.nodes[10].position.x, c.nodes[10].position.x)

    def test_track_descends(self) -> None:
        first = self.track.nodes[0].position.y
        last = self.track.nodes[-1].position.y
        self.assertLess(last, first - 50.0, "滑梯应该一路往下走")

    def test_forward_is_unit_and_points_downhill(self) -> None:
        for node in self.track.nodes:
            self.assertAlmostEqual(node.forward.length(), 1.0, places=5)
            self.assertLess(node.forward.y, 0.0, "前进方向应该始终朝下坡")

    def test_width_and_flat_area_are_sane(self) -> None:
        for node in self.track.nodes:
            self.assertGreaterEqual(node.width, config.MIN_WIDTH - 1e-6)
            self.assertLessEqual(node.width, config.MAX_WIDTH + 1e-6)
            self.assertLessEqual(node.flat_half, node.width * 0.5 + 1e-6)
            self.assertGreaterEqual(node.flat_half, 0.0)

    def test_sample_interpolates_between_nodes(self) -> None:
        node = self.track.nodes[5]
        sample = self.track.sample(node.index * self.track.segment_length)
        self.assertAlmostEqual(sample.position.x, node.position.x, places=4)
        self.assertAlmostEqual(sample.width, node.width, places=5)

    def test_sample_clamps_out_of_range(self) -> None:
        self.assertEqual(self.track.sample(-50.0).s, 0.0)
        self.assertAlmostEqual(self.track.sample(1e9).s, self.track.length, places=3)

    def test_world_at_lands_on_the_surface(self) -> None:
        sample = self.track.sample(120.0)
        point = self.track.world_at(120.0, 0.0, 0.0)
        self.assertAlmostEqual(point.y, sample.position.y, places=4)

    def test_surface_height_matches_derivative(self) -> None:
        """表面高度的解析导数必须和数值差分一致（不然角色贴壁会飘）。"""
        worst = 0.0
        for _ in range(300):
            sample = self.track.sample(120.0)
            lateral = self.track.rng.uniform(-sample.half_width, sample.half_width)
            step = 1e-4
            numeric = (
                self.track.surface_height(sample, lateral + step)
                - self.track.surface_height(sample, lateral - step)
            ) / (2 * step)
            analytic = self.track.surface_derivative(sample, lateral)
            worst = max(worst, abs(numeric - analytic))
        self.assertLess(worst, 0.05, "槽面斜率的解析解和数值解对不上")

    def test_surface_height_is_zero_on_flat_part(self) -> None:
        sample = self.track.sample(120.0)
        self.assertAlmostEqual(self.track.surface_height(sample, 0.0), 0.0, places=6)

    def test_surface_height_rises_towards_the_rim(self) -> None:
        sample = self.track.sample(120.0)
        if sample.wall_height <= 0.0:
            self.skipTest("这一段是开放式滑板，没有槽壁")
        low = self.track.surface_height(sample, sample.flat_half)
        high = self.track.surface_height(sample, sample.half_width - 1e-3)
        self.assertGreater(high, low)


class MeshDataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.track = Track(seed=99)
        self.mesh = self.track.build_mesh_data()

    def test_mesh_is_well_formed(self) -> None:
        self.assertGreater(len(self.mesh["vertices"]), 0)
        self.assertEqual(len(self.mesh["uvs"]), len(self.mesh["vertices"]))
        self.assertEqual(len(self.mesh["colors"]), len(self.mesh["vertices"]))
        self.assertEqual(len(self.mesh["normals"]), len(self.mesh["vertices"]))
        self.assertEqual(len(self.mesh["triangles"]) % 3, 0)

    def test_triangle_indices_are_in_range(self) -> None:
        limit = len(self.mesh["vertices"])
        for triangle in self.mesh["triangles"]:
            for index in triangle:
                self.assertLess(index, limit)
                self.assertGreaterEqual(index, 0)

    def test_cross_section_contains_every_kind(self) -> None:
        section = self.track._cross_section(self.track.nodes[0])
        kinds = {kind for _, _, kind in section}
        self.assertIn(KIND_WATER, kinds)
        self.assertIn(KIND_WALL, kinds)
        self.assertIn(KIND_OUTER, kinds)
        self.assertIn(KIND_LIP, kinds)

    def test_cross_section_is_closed(self) -> None:
        """截面点数固定，条带才能首尾相连。"""
        counts = {len(self.track._cross_section(node)) for node in self.track.nodes}
        self.assertEqual(len(counts), 1, "每个节点的截面点数必须一致")

    def test_normals_point_up_for_the_water(self) -> None:
        """水面的法线必须朝上（否则水面会被打光成一片黑）。"""
        section = self.track._cross_section(self.track.nodes[0])
        water_indices = [i for i, (_, _, kind) in enumerate(section) if kind == KIND_WATER]
        self.assertTrue(water_indices)
        for index in water_indices:
            normal = self.mesh["normals"][index]
            self.assertGreater(normal[1], 0.9, "水面法线应该朝上")

    def test_compute_normals_is_negated_for_panda3d(self) -> None:
        """Panda3D 是左手坐标系，法线要取反才和正反面判定一致。"""
        vertices = [(0, 0, 0), (1, 0, 0), (0, 0, -1)]
        normals = compute_normals(vertices, [(0, 1, 2)])
        # 右手定则算出来是 +Y，取反之后是 -Y
        self.assertLess(normals[0][1], -0.9)


class ObstacleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.track = Track(seed=5)

    def test_obstacles_are_placed(self) -> None:
        self.assertGreater(len(self.track.obstacles), 10)

    def test_obstacles_have_valid_positions(self) -> None:
        for obstacle in self.track.obstacles:
            self.assertGreaterEqual(obstacle.s, 0.0)
            self.assertLessEqual(obstacle.s, self.track.length)
            self.assertGreater(obstacle.radius, 0.0)

    def test_obstacles_between_finds_nearby_ones(self) -> None:
        found = self.track.obstacles_between(0.0, 60.0)
        for obstacle in found:
            self.assertLessEqual(obstacle.s, 60.0 + 1e-6)


if __name__ == "__main__":
    unittest.main()
