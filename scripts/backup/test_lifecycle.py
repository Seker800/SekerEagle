"""Regression tests: all subprocesses and remote writes are isolated mocks."""

import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from test_backup import backup
import test_plain_nas

nas = test_plain_nas.nas


class LifecycleTests(unittest.TestCase):
    def test_ssh_checks_host_keys_and_forbids_proxies(self):
        good = (
            "hostname 192.168.31.146\nuser seker\nport 22\nstricthostkeychecking true\n"
        )
        backup.assert_ssh_target(good)
        for suffix in ["proxycommand nc elsewhere 22\n", "proxyjump elsewhere\n"]:
            with self.assertRaises(ValueError):
                backup.assert_ssh_target(good + suffix)
        for value in ["no", "accept-new"]:
            with self.assertRaises(ValueError):
                backup.assert_ssh_target(good.replace("true", value))
        with patch.object(backup, "run", return_value=Mock(stdout=b"ok")) as run:
            backup.ssh("hostname")
            self.assertIn("StrictHostKeyChecking=yes", run.call_args.args[0])

    def test_owned_restore_container_removed_but_foreign_one_untouched(self):
        for owned in [True, False]:
            container = {
                "Id": "container-id",
                "Config": {
                    "Labels": {
                        "com.sekereagle.backup.role": "restore" if owned else "foreign"
                    }
                },
            }
            with patch.object(
                backup,
                "run",
                return_value=Mock(
                    returncode=0, stdout=json.dumps([container]).encode()
                ),
            ) as run:
                if owned:
                    backup.cleanup_restore_container()
                    self.assertEqual(
                        run.call_args.args[0],
                        ["docker", "rm", "-f", "-v", "container-id"],
                    )
                else:
                    with self.assertRaises(ValueError):
                        backup.cleanup_restore_container()
                    self.assertEqual(run.call_count, 1)

    def test_docker_run_timeout_still_cleans_restore_container(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "deployment.json").write_text(
                json.dumps(
                    {"images": {"api": {"id": "api"}, "postgres": {"id": "postgres"}}}
                )
            )

            def run(args, **kwargs):
                if "--name" in args:
                    raise subprocess.TimeoutExpired("docker", 120)
                return Mock(returncode=0)

            with patch.object(backup, "run", side_effect=run), patch.object(
                backup, "cleanup_restore_container"
            ) as cleanup:
                with self.assertRaises(subprocess.TimeoutExpired):
                    backup.restore_database_check(root)
                self.assertEqual(cleanup.call_count, 2)
                self.assertFalse((root / "postgres.env").exists())

    def test_prune_failure_does_not_undo_durably_published_success(self):
        state = {"nextScheduledAt": "2026-10-23T17:00:00Z"}
        persisted = []

        def remote(command, generation=None):
            if command == "prune":
                self.assertEqual(persisted[-1]["status"], "succeeded")
                raise RuntimeError("connection lost")
            return b'{"objects":1,"bytes":12}'

        def resume(value):
            value["pausedServices"] = []

        with tempfile.TemporaryDirectory() as directory, patch.object(
            backup, "PRIVATE", Path(directory)
        ), patch.object(backup, "INPUT", Path(directory) / "input"), patch.object(
            backup, "load_state", return_value=state
        ), patch.object(
            backup, "save_state", side_effect=lambda s: persisted.append(dict(s))
        ), patch.object(
            backup, "preflight", return_value={}
        ), patch.object(
            backup, "prepare_input", return_value={"frozenAt": "now"}
        ), patch.object(
            backup, "restore_services", side_effect=resume
        ), patch.object(
            backup, "restore_database_check", return_value={"assets": 1}
        ), patch.object(
            backup, "cleanup_restore_container"
        ), patch.object(
            backup, "transfer_archive"
        ), patch.object(
            backup, "remote", side_effect=remote
        ), patch.object(
            backup, "run"
        ), patch.object(
            backup.os, "getpgrp", return_value=123
        ), patch.object(
            backup.os, "getpid", return_value=123
        ):
            backup.backup()
        self.assertEqual(persisted[-1]["status"], "succeeded")
        self.assertTrue(persisted[-1]["cleanupPending"])
        self.assertIn("lastSuccessAt", persisted[-1])

    def test_recovery_discards_only_recorded_attempt_and_cleans_restore(self):
        state = {"attemptGeneration": "a" * 32}
        with tempfile.TemporaryDirectory() as directory, patch.object(
            backup, "PRIVATE", Path(directory)
        ), patch.object(backup, "run"), patch.object(
            backup, "cleanup_restore_container"
        ) as cleanup, patch.object(
            backup, "remote", return_value=b"{}"
        ) as remote, patch.object(
            backup, "save_state"
        ):
            backup.recover(state)
        cleanup.assert_called_once()
        remote.assert_called_once_with("discard", "a" * 32)
        self.assertNotIn("attemptGeneration", state)


class PartialGenerationTests(unittest.TestCase):
    generation = test_plain_nas.PlainNasTests.generation
    setUp = test_plain_nas.PlainNasTests.setUp
    fixture = test_plain_nas.PlainNasTests.fixture

    def test_receive_failure_removes_new_directory_only(self):
        with self.assertRaises(ValueError):
            nas.receive(self.root, self.generation, self.fixture(damage=True))
        path = self.root / "generations" / self.generation
        self.assertFalse(path.exists())
        path.mkdir()
        (path / "precious").write_text("keep")
        with self.assertRaises(FileExistsError):
            nas.receive(self.root, self.generation, self.fixture())
        self.assertEqual((path / "precious").read_text(), "keep")

    def test_discard_cleans_interrupted_generation_and_refuses_current_or_unknown(self):
        nas.receive(self.root, self.generation, self.fixture())
        nas.verify(self.root, self.generation)
        nas.publish(self.root, self.generation)
        with self.assertRaises(ValueError):
            nas.discard(self.root, self.generation)
        other = "b" * 32
        nas.receive(self.root, other, self.fixture())
        nas.discard(self.root, other)
        nas.discard(self.root, other)
        path = self.root / "generations" / other
        path.mkdir()
        with self.assertRaises(ValueError):
            nas.discard(self.root, other)
        self.assertTrue(path.exists())

    def test_unknown_entries_quarantined_without_following_links(self):
        nas.receive(self.root, self.generation, self.fixture())
        nas.verify(self.root, self.generation)
        nas.publish(self.root, self.generation)
        outside = self.root / "precious"
        outside.mkdir()
        (outside / "keep").write_text("keep")
        (self.root / "generations" / "unknown-link").symlink_to(outside)
        result = nas.prune(self.root)
        self.assertEqual(result["quarantined"], 1)
        self.assertEqual((outside / "keep").read_text(), "keep")
        self.assertEqual(len(list((self.root / "quarantine").iterdir())), 1)


class PublicationRecoveryTests(unittest.TestCase):
    def test_reconcile_lost_publish_acknowledgement_without_discard(self):
        generation = "a" * 32
        state = {
            "status": "failed",
            "attemptGeneration": generation,
            "pendingPublication": {
                "status": "succeeded",
                "lastGenerationId": generation,
                "lastSuccessAt": "2026-10-19T00:00:00Z",
            },
        }
        with patch.object(
            backup,
            "remote",
            return_value=json.dumps({"generation": generation}).encode(),
        ) as remote:
            self.assertTrue(backup.cleanup_attempt(state))
        remote.assert_called_once_with("status")
        self.assertEqual(state["status"], "succeeded")
        self.assertNotIn("attemptGeneration", state)
        self.assertNotIn("pendingPublication", state)

    def test_unknown_publish_outcome_keeps_recovery_intent(self):
        state = {
            "attemptGeneration": "a" * 32,
            "pendingPublication": {"lastGenerationId": "a" * 32},
        }
        with patch.object(
            backup, "remote", side_effect=RuntimeError("offline")
        ) as remote:
            self.assertFalse(backup.cleanup_attempt(state))
        remote.assert_called_once_with("status")
        self.assertIn("attemptGeneration", state)
        self.assertIn("pendingPublication", state)

    def test_unpublished_generation_can_be_discarded(self):
        state = {
            "attemptGeneration": "a" * 32,
            "pendingPublication": {"lastGenerationId": "a" * 32},
        }
        with patch.object(
            backup, "remote", return_value=b'{"generation":"old"}'
        ) as remote:
            self.assertTrue(backup.cleanup_attempt(state))
        self.assertEqual(
            [c.args[0] for c in remote.call_args_list], ["status", "discard"]
        )

    def test_busy_nas_lock_blocks_cleanup_without_touching_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "owner-marker").write_text(nas.MARKER)
            with nas.operation_lock(root):
                with self.assertRaises(BlockingIOError):
                    with nas.operation_lock(root):
                        self.fail("Concurrent cleanup was permitted")


class MigrationTests(unittest.TestCase):
    def test_install_old_state_fails_with_executable_guidance_before_remote_access(
        self,
    ):
        with patch.object(backup, "STATE") as path, patch.object(
            backup, "load_state", return_value={"backupFormat": "restic"}
        ), patch.object(backup, "ssh") as ssh:
            path.exists.return_value = True
            with self.assertRaisesRegex(ValueError, "--migrate"):
                backup.install()
            ssh.assert_not_called()

    def test_migration_wrong_published_snapshot_never_changes_state_or_retires(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            backup, "PRIVATE", Path(directory)
        ), patch.object(
            backup,
            "load_state",
            return_value={
                "lastSnapshotId": "a" * 64,
                "lastSuccessAt": "2026-10-01T00:00:00Z",
            },
        ), patch.object(
            backup, "assert_ssh_target"
        ), patch.object(
            backup, "text"
        ), patch.object(
            backup, "ssh", return_value="SEKER_DESIGN"
        ), patch.object(
            backup, "upload_receiver"
        ), patch.object(
            backup, "remote", return_value=b'{"generation":"other"}'
        ) as remote, patch.object(
            backup, "save_state"
        ) as save:
            with self.assertRaisesRegex(ValueError, "exact legacy snapshot"):
                backup.migrate()
            save.assert_not_called()
            remote.assert_called_once_with("status")

    def test_migration_validates_downloads_and_restores_before_retiring(self):
        import hashlib

        generation = "a" * 64
        metadata = b'{"images":{}}'
        dump = b"database dump fixture"
        manifest = json.dumps(
            {
                "files": {
                    name: hashlib.sha256(data).hexdigest()
                    for name, data in [
                        ("database.dump", dump),
                        ("deployment.json", metadata),
                    ]
                }
            }
        )
        receipt = {
            "generation": generation,
            "manifestSha256": hashlib.sha256(manifest.encode()).hexdigest(),
            "objects": 1,
            "bytes": 10,
        }
        state = {
            "lastSnapshotId": generation,
            "lastSuccessAt": "2026-10-01T00:00:00Z",
            "frozenAt": "old-freeze",
        }
        events = []

        def remote(command, key=None):
            events.append(command)
            if command == "retire":
                self.assertEqual(state["backupFormat"], "plain-directory-v1")
                self.assertIn("save", events)
            return json.dumps(receipt).encode()

        def run(args, **kwargs):
            kwargs["stdout"].write(
                dump if args[-1].endswith("database.dump") else metadata
            )

        with tempfile.TemporaryDirectory() as directory, patch.object(
            backup, "PRIVATE", Path(directory)
        ), patch.object(backup, "load_state", return_value=state), patch.object(
            backup, "assert_ssh_target"
        ), patch.object(
            backup, "text"
        ), patch.object(
            backup, "ssh", side_effect=["SEKER_DESIGN", manifest]
        ), patch.object(
            backup, "upload_receiver"
        ), patch.object(
            backup, "run", side_effect=run
        ), patch.object(
            backup, "remote", side_effect=remote
        ), patch.object(
            backup,
            "restore_database_check",
            side_effect=lambda d: events.append("restore") or {"assets": 1},
        ), patch.object(
            backup, "save_state", side_effect=lambda s: events.append("save")
        ):
            password = Path(directory) / "repository-password"
            password.write_text("test fixture only")
            backup.migrate()
            self.assertFalse(password.exists())
        self.assertEqual(
            events, ["status", "verify", "restore", "save", "retire", "save"]
        )
        self.assertEqual(state["lastSuccessAt"], "2026-10-01T00:00:00Z")
        self.assertEqual(state["frozenAt"], "old-freeze")
        self.assertNotIn("retirementPending", state)


class RestoreIdentityTests(unittest.TestCase):
    def test_prelabel_restore_can_only_be_adopted_with_all_identity_evidence(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            backup, "INPUT", Path(directory)
        ):
            root = Path(directory)
            (root / "deployment.json").write_text(
                '{"images":{"postgres":{"id":"sha256:fixture"}}}'
            )
            container = {
                "Name": "/" + backup.RESTORE_CONTAINER,
                "Image": "sha256:fixture",
                "HostConfig": {"NetworkMode": "none"},
                "Config": {
                    "Env": ["POSTGRES_DB=sekereagle_test", "POSTGRES_USER=sekereagle"]
                },
                "Mounts": [
                    {
                        "Type": "bind",
                        "Destination": "/restore.dump",
                        "Source": str(root / "database.dump"),
                        "RW": False,
                    }
                ],
            }
            self.assertTrue(backup.legacy_restore_container(container))
            for key, value in [
                ("Image", "other"),
                ("HostConfig", {"NetworkMode": "host"}),
                ("Config", {"Env": ["POSTGRES_DB=sekereagle"]}),
                ("Mounts", []),
                ("Name", "/other"),
            ]:
                self.assertFalse(
                    backup.legacy_restore_container({**container, key: value})
                )

    def test_missing_container_checks_daemon_health_without_removing_anything(self):
        with patch.object(backup, "run", return_value=Mock(returncode=1)) as run:
            backup.cleanup_restore_container()
            self.assertEqual(run.call_args.args[0][:2], ["docker", "info"])

    def test_cleanup_precedes_capacity_check_for_legacy_orphans(self):
        state = {"lastGenerationId": "a" * 32}
        events = []

        def ssh(command):
            if command == "hostname":
                return "SEKER_DESIGN"
            if "owner-marker" in command:
                return nas.MARKER
            events.append("capacity")
            return "fs 1 1 0 100% /"

        with patch.object(backup, "assert_ssh_target"), patch.object(
            backup, "text"
        ), patch.object(backup, "ssh", side_effect=ssh), patch.object(
            backup, "upload_receiver"
        ), patch.object(
            backup, "cleanup_published", side_effect=lambda s: events.append("cleanup")
        ), patch.object(
            backup, "save_state"
        ):
            with self.assertRaisesRegex(ValueError, "Insufficient"):
                backup.preflight(state)
        self.assertEqual(events, ["cleanup", "capacity"])


class CliContractTests(unittest.TestCase):
    def test_host_cli_exposes_install_migrate_run_and_watchdog(self):
        for option, function in [
            ("install", "install"),
            ("migrate", "migrate"),
            ("run", "backup"),
            ("tick", "tick"),
        ]:
            with patch.object(
                backup.sys, "argv", ["backup.py", "--" + option]
            ), patch.object(backup, function) as action:
                backup.main()
                action.assert_called_once_with()

    def test_nas_cli_serializes_and_dispatches_all_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "owner-marker").write_text(nas.MARKER)
            generation = "c" * 32
            for command, key in [
                ("receive", generation),
                ("verify", generation),
                ("publish", generation),
                ("status", None),
                ("prune", None),
                ("discard", "d" * 32),
                ("retire", None),
                ("convert", "e" * 64),
            ]:
                with patch.object(nas, "ROOT", root), patch.object(
                    nas.sys, "argv", ["plain_nas.py", command] + ([key] if key else [])
                ), patch.object(
                    nas.sys,
                    "stdin",
                    Mock(buffer=test_plain_nas.PlainNasTests().fixture()),
                ), patch.object(
                    nas.sys, "stdout", io.StringIO()
                ) as output, patch.object(
                    nas.os, "sync"
                ), patch.object(
                    nas, "convert"
                ):
                    nas.main()
                    self.assertIsInstance(json.loads(output.getvalue()), dict)

    def test_scheduler_retries_cleanup_without_starting_an_early_backup(self):
        state = {
            "nextScheduledAt": "2099-01-01T00:00:00Z",
            "cleanupPending": True,
            "lastGenerationId": "a" * 32,
        }
        with tempfile.TemporaryDirectory() as directory, patch.object(
            backup, "PRIVATE", Path(directory)
        ), patch.object(backup, "load_state", return_value=state), patch.object(
            backup, "save_state"
        ), patch.object(
            backup, "remote", return_value=b'{"quarantined":1}'
        ) as remote, patch.object(
            backup.subprocess, "Popen"
        ) as spawn:
            backup.tick()
            remote.assert_called_once_with("prune")
            spawn.assert_not_called()
        self.assertFalse(state["cleanupPending"])
        self.assertTrue(state["quarantinePending"])

    def test_retirement_retry_preserves_success_when_remote_cleanup_fails(self):
        state = {
            "backupFormat": "plain-directory-v1",
            "retirementPending": True,
            "lastSuccessAt": "2026-10-01T00:00:00Z",
        }
        with tempfile.TemporaryDirectory() as directory, patch.object(
            backup, "PRIVATE", Path(directory)
        ), patch.object(backup, "load_state", return_value=state), patch.object(
            backup, "assert_ssh_target"
        ), patch.object(
            backup, "text"
        ), patch.object(
            backup, "ssh", return_value="SEKER_DESIGN"
        ), patch.object(
            backup, "remote", side_effect=RuntimeError("offline")
        ), patch.object(
            backup, "save_state"
        ) as save:
            with self.assertRaises(RuntimeError):
                backup.migrate()
            save.assert_not_called()
            self.assertTrue(state["retirementPending"])
            self.assertEqual(state["lastSuccessAt"], "2026-10-01T00:00:00Z")


class TransportPolicyTests(unittest.TestCase):
    def test_every_ssh_call_including_stream_and_upload_uses_the_shared_policy(self):
        import ast

        tree = ast.parse(Path(backup.__file__).read_text())
        calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.List)
            and node.elts
            and isinstance(node.elts[0], ast.Constant)
            and node.elts[0].value == "ssh"
        ]
        self.assertGreaterEqual(len(calls), 7)
        for call in calls:
            self.assertTrue(
                any(
                    isinstance(item, ast.Starred)
                    and isinstance(item.value, ast.Name)
                    and item.value.id == "SSH_OPTIONS"
                    for item in call.elts
                )
            )
        for option in [
            "StrictHostKeyChecking=yes",
            "ProxyCommand=none",
            "ProxyJump=none",
            "Hostname=192.168.31.146",
            "User=seker",
            "Port=22",
            "HostKeyAlias=192.168.31.146",
        ]:
            self.assertIn(option, backup.SSH_OPTIONS)
