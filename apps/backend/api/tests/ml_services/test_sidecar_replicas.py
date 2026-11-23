import json
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests
from django.test import SimpleTestCase

from api.runtime import replicas, sidecars
from api.runtime.sidecars import SERVICES

FACE = "face_recognition"
BASE = SERVICES[FACE]


def _ok():
    response = MagicMock()
    response.raise_for_status.return_value = None
    return response


class ReplicaDirTestCase(SimpleTestCase):
    def setUp(self):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(replicas, "runtime_dir", return_value=self.dir))
        self.enterContext(patch.object(replicas, "router", replicas.Router()))


class PortsTest(SimpleTestCase):
    def test_a_replica_listens_a_stride_above_the_first(self):
        self.assertEqual(
            [8005, 8105, 8205],
            [replicas.replica_port(8005, index) for index in range(3)],
        )

    def test_the_replica_comes_from_the_command_line(self):
        cases = [
            (["main.py"], 0),
            (["main.py", "--replica", "2"], 2),
            (["librephotos.exe", "service", FACE, "--replica", "7"], 7),
            (["main.py", "--replica", "x"], 0),
            (["main.py", "--replica", "99"], 0),
        ]
        for argv, index in cases:
            with self.subTest(argv):
                self.assertEqual(index, replicas.replica_argument(argv))

    def test_replica_zero_has_no_argument(self):
        self.assertEqual([], replicas.replica_arguments(0))
        self.assertEqual(["--replica", "3"], replicas.replica_arguments(3))

    def test_a_replica_on_another_sidecars_port_is_refused(self):
        with self.assertRaisesRegex(ValueError, "8105"):
            replicas.all_ports({FACE: 8005, "exif": 8105})

    def test_the_default_ports_do_not_collide(self):
        taken = replicas.all_ports(SERVICES)

        self.assertEqual(len(SERVICES) + replicas.MAX_REPLICAS - 1, len(taken))


class LiveStateTest(ReplicaDirTestCase):
    def test_without_a_state_only_the_first_replica_is_live(self):
        self.assertEqual((BASE,), replicas.read_live(FACE, BASE).ports)

    def test_the_supervisor_lists_the_live_replicas(self):
        replicas.write_live(FACE, BASE, [BASE, BASE + 100], "webgpu")

        live = replicas.read_live(FACE, BASE)

        self.assertEqual(((BASE, BASE + 100), "webgpu"), (live.ports, live.device))

    def test_a_state_the_supervisor_stopped_writing_is_ignored(self):
        replicas.write_live(FACE, BASE, [BASE, BASE + 100], None)
        later = time.time() + replicas.STATE_TTL_SECONDS + 1

        self.assertEqual((BASE,), replicas.read_live(FACE, BASE, now=later).ports)

    def test_ports_that_are_not_replicas_are_dropped(self):
        replicas.state_path(FACE, BASE).write_text(
            json.dumps({"ports": [8010, "x", BASE + 200], "at": time.time()})
        )

        self.assertEqual((BASE + 200,), replicas.read_live(FACE, BASE).ports)

    def test_a_broken_state_is_ignored(self):
        replicas.state_path(FACE, BASE).parent.mkdir(parents=True, exist_ok=True)
        replicas.state_path(FACE, BASE).write_text("{")

        self.assertEqual((BASE,), replicas.read_live(FACE, BASE).ports)

    def test_clearing_the_state_leaves_the_first_replica(self):
        replicas.write_live(FACE, BASE, [BASE, BASE + 100], None)
        replicas.clear_live(FACE, BASE)

        self.assertEqual((BASE,), replicas.read_live(FACE, BASE).ports)


class RouterTest(ReplicaDirTestCase):
    def test_each_lane_starts_at_its_own_replica(self):
        replicas.write_live(FACE, BASE, [BASE, BASE + 100, BASE + 200], None)
        orders = {}
        for lane in range(4):
            replicas.set_lane(lane)
            orders[lane] = replicas.router.order(FACE, BASE)[0]

        self.assertEqual({0: BASE, 1: BASE + 100, 2: BASE + 200, 3: BASE}, orders)

    def test_a_replica_that_refused_is_skipped_for_a_while(self):
        replicas.write_live(FACE, BASE, [BASE, BASE + 100], None)
        replicas.set_lane(0)
        replicas.router.mark_down(BASE)

        self.assertEqual([BASE + 100], replicas.router.order(FACE, BASE))

    def test_when_all_refused_all_are_tried_again(self):
        replicas.write_live(FACE, BASE, [BASE, BASE + 100], None)
        replicas.router.mark_down(BASE)
        replicas.router.mark_down(BASE + 100)

        self.assertEqual(2, len(replicas.router.order(FACE, BASE)))

    def test_a_claimed_replica_is_passed_over_for_a_free_one(self):
        with replicas.claim([BASE, BASE + 100]) as first:
            with replicas.claim([BASE, BASE + 100]) as second:
                self.assertEqual(
                    ([BASE, BASE + 100], [BASE + 100, BASE]), (first, second)
                )
                with replicas.claim([BASE, BASE + 100]) as third:
                    self.assertEqual([BASE, BASE + 100], third)
        with replicas.claim([BASE, BASE + 100]) as again:
            self.assertEqual([BASE, BASE + 100], again)


class RoutedRequestTest(ReplicaDirTestCase):
    def setUp(self):
        super().setUp()
        replicas.set_lane(0)

    def url(self, port):
        return f"http://127.0.0.1:{port}/face-locations"

    def test_one_live_replica_is_called_as_before(self):
        with patch.object(sidecars.http, "post", return_value=_ok()) as post:
            sidecars.post(FACE, "/face-locations", json={}, timeout=1)

        self.assertEqual(self.url(BASE), post.call_args.args[0])

    def test_a_busy_replica_sends_the_request_to_a_free_one(self):
        replicas.write_live(FACE, BASE, [BASE, BASE + 100], None)
        with (
            replicas.claim([BASE]),
            patch.object(sidecars.failover, "post", return_value=_ok()) as post,
        ):
            sidecars.post(FACE, "/face-locations", json={}, timeout=1)

        self.assertEqual(self.url(BASE + 100), post.call_args.args[0])

    def test_a_replica_that_is_down_fails_over_to_the_next(self):
        replicas.write_live(FACE, BASE, [BASE, BASE + 100], None)
        with (
            patch.object(
                sidecars.failover, "post", side_effect=requests.ConnectionError
            ),
            patch.object(sidecars.http, "post", return_value=_ok()) as post,
        ):
            sidecars.post(FACE, "/face-locations", json={}, timeout=1)

        self.assertEqual(self.url(BASE + 100), post.call_args.args[0])
        self.assertEqual([BASE + 100], replicas.router.order(FACE, BASE))

    def test_an_error_answer_is_not_retried_elsewhere(self):
        replicas.write_live(FACE, BASE, [BASE, BASE + 100], None)
        failed = MagicMock()
        failed.raise_for_status.side_effect = requests.HTTPError("500")
        with (
            patch.object(sidecars.failover, "post", return_value=failed),
            patch.object(sidecars.http, "post") as last,
            self.assertRaises(requests.HTTPError),
        ):
            sidecars.post(FACE, "/face-locations", json={}, timeout=1)

        last.assert_not_called()

    def test_other_sidecars_ignore_replicas(self):
        replicas.state_path("exif", SERVICES["exif"]).parent.mkdir(
            parents=True, exist_ok=True
        )
        with patch.object(sidecars.http, "get", return_value=_ok()) as get:
            sidecars.get("exif", "/health", timeout=1)

        self.assertEqual(
            f"http://127.0.0.1:{SERVICES['exif']}/health", get.call_args.args[0]
        )

    def test_the_supervisor_addresses_one_replica(self):
        with patch.object(sidecars.http, "get", return_value=_ok()) as get:
            sidecars.get_replica(FACE, 2, "/unload-model", timeout=1)

        self.assertEqual(
            f"http://127.0.0.1:{BASE + 200}/unload-model", get.call_args.args[0]
        )
