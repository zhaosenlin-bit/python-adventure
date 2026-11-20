"""赛道空间物理的单元测试。"""

from __future__ import annotations

import unittest

from .. import config, physics
from ..physics import Controls, RiderState
from ..track import Track


class PhysicsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.track = Track(seed=31337)

    def _run(self, state: RiderState, seconds: float, controls: Controls = None) -> RiderState:
        controls = controls or Controls()
        steps = int(seconds * 60)
        for _ in range(steps):
            physics.step(state, self.track, controls, 1.0 / 60.0)
            state.events.clear()
        return state

    def test_racer_accelerates_downhill(self) -> None:
        state = RiderState()
        self._run(state, 3.0)
        self.assertGreater(state.v_s, 8.0, "应该越滑越快")
        self.assertGreater(state.s, 5.0)

    def test_speed_is_capped(self) -> None:
        state = RiderState()
        self._run(state, 40.0)
        self.assertLessEqual(state.v_s, config.MAX_SPEED + 1e-6)

    def test_steering_moves_laterally(self) -> None:
        state = RiderState()
        self._run(state, 1.0)
        right = self._run(RiderState(), 1.5, Controls(steer=1.0))
        self.assertGreater(right.lateral, state.lateral + 0.5)

    def test_racer_cannot_leave_the_track(self) -> None:
        state = RiderState()
        self._run(state, 6.0, Controls(steer=1.0))
        sample = self.track.sample(state.s)
        self.assertLessEqual(abs(state.lateral), sample.half_width + 1e-6)

    def test_pinned_to_the_wall_keeps_speed(self) -> None:
        """贴着槽壁滑行时不能每帧掉速，否则会被磨到停住。"""
        state = RiderState()
        self._run(state, 2.0)
        speed_before = state.v_s
        self._run(state, 2.0, Controls(steer=1.0))
        self.assertGreater(state.v_s, speed_before * 0.5, "撞墙不应该把速度磨光")

    def test_jump_leaves_the_ground_and_lands(self) -> None:
        state = RiderState()
        self._run(state, 1.0)
        physics.step(state, self.track, Controls(jump=True), 1.0 / 60.0)
        self.assertTrue(state.airborne)
        peak = 0.0
        for _ in range(120):
            physics.step(state, self.track, Controls(), 1.0 / 60.0)
            state.events.clear()
            peak = max(peak, state.height)
            if not state.airborne and peak > 0.2:
                break
        self.assertGreater(peak, 1.0, "起跳应该能离地一段")
        self.assertFalse(state.airborne, "最后应该落回地面")

    def test_dive_goes_down_fast(self) -> None:
        state = RiderState()
        self._run(state, 1.0)
        physics.step(state, self.track, Controls(jump=True), 1.0 / 60.0)
        for _ in range(6):
            physics.step(state, self.track, Controls(), 1.0 / 60.0)
            state.events.clear()
        physics.step(state, self.track, Controls(dive=True), 1.0 / 60.0)
        self.assertTrue(state.diving)
        self.assertTrue(physics.is_diving(state))

    def test_jet_launch_is_higher_than_a_jump(self) -> None:
        jumper = RiderState()
        self._run(jumper, 1.0)
        physics.step(jumper, self.track, Controls(jump=True), 1.0 / 60.0)
        launch = RiderState()
        physics.apply_launch(launch)
        self.assertGreater(launch.v_height, jumper.v_height)

    def test_boost_makes_faster(self) -> None:
        state = RiderState()
        self._run(state, 2.0)
        plain = state.v_s
        physics.apply_boost(state)
        self._run(state, 0.5)
        self.assertGreater(state.v_s, plain)

    def test_finish_line_is_detected(self) -> None:
        state = RiderState()
        state.s = self.track.length - 1.0
        state.v_s = 30.0
        for _ in range(30):
            physics.step(state, self.track, Controls(), 1.0 / 60.0)
            if state.finished:
                break
        self.assertTrue(state.finished)
        self.assertGreater(state.s, self.track.length - 2.0)

    def test_bump_pushes_laterally(self) -> None:
        state = RiderState()
        state.v_lateral = 0.0
        physics.apply_bump(state, 6.0)
        self.assertGreater(state.v_lateral, 0.0)

    def test_world_position_is_above_the_surface(self) -> None:
        state = RiderState()
        state.s = 100.0
        position = physics.world_position(self.track, state)
        sample = self.track.sample(state.s)
        self.assertGreater(position.y, sample.position.y - 0.01)


if __name__ == "__main__":
    unittest.main()
