import importlib.util
import unittest
import io
import json
import hashlib
import tarfile
import tempfile
from unittest.mock import patch
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "backup", Path(__file__).with_name("backup.py")
)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupPolicyTests(unittest.TestCase):
    def test_next_slot_is_saturday_one_in_shanghai(self):
        now = datetime(2026, 10, 18, 4, tzinfo=timezone.utc)
        self.assertEqual(
            backup.first_slot(now).isoformat(), "2026-10-23T17:00:00+00:00"
        )

    def test_schedule_keeps_anchor_after_delayed_backup(self):
        self.assertEqual(
            backup.following_slot(
                "2026-10-23T17:00:00Z", datetime(2026, 11, 8, tzinfo=timezone.utc)
            ),
            "2026-11-20T17:00:00Z",
        )

    def test_rejects_protected_or_changed_ssh_target(self):
        good = "hostname 192.168.31.146\nuser seker\nport 22\n"
        backup.assert_ssh_target(good)
        for bad in (
            good.replace("146", "89"),
            good.replace("146", "147"),
            good.replace("seker", "root"),
        ):
            with self.assertRaises(ValueError):
                backup.assert_ssh_target(bad)

    def test_only_backup_owned_snapshots_can_be_deleted(self):
        snaps = [
            {"id": "a" * 64, "tags": ["sekereagle-complete"]},
            {"id": "b" * 64, "tags": ["sekereagle-complete"]},
        ]
        self.assertEqual(backup.obsolete_snapshots(snaps, "b" * 64), ["a" * 64])
        with self.assertRaises(ValueError):
            backup.obsolete_snapshots(snaps + [{"id": "c" * 64, "tags": []}], "b" * 64)
        with self.assertRaises(ValueError):
            backup.obsolete_snapshots(snaps, "c" * 64)

    def test_archive_key_cannot_escape_objects(self):
        self.assertEqual(
            backup.object_path("owner/assets/file.jpg"), "objects/owner/assets/file.jpg"
        )
        for key in ("../secret", "/absolute", "a/../x", "a//b", "a\\b", ""):
            with self.assertRaises(ValueError):
                backup.object_path(key)

    def test_failed_attempt_preserves_success_time(self):
        state = {"lastSuccessAt": "2026-10-01T00:00:00Z", "lastSnapshotId": "a" * 64}
        failed = backup.attempt_state(state, "failed", "2026-10-18T00:00:00Z")
        self.assertEqual(failed["lastSuccessAt"], state["lastSuccessAt"])
        self.assertEqual(failed["lastSnapshotId"], state["lastSnapshotId"])


class ArchiveIntegrityTests(unittest.TestCase):
    def test_binary_export_never_creates_container_logs_or_writable_layer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "deployment.json").write_text(
                json.dumps({"images": {"api": {"id": "sha256:test"}}})
            )
            for name in ("database.dump", "globals.sql", "deployment.env", "source.tar.gz"):
                (root / name).write_bytes(b"test")
            process = unittest.mock.Mock()
            process.stdout = io.BytesIO(b'{"complete":true,"count":0,"bytes":0}\n')
            process.wait.return_value = 0
            process.poll.return_value = 0
            output = io.BytesIO()
            stdout = unittest.mock.Mock(buffer=output)
            with (
                patch.object(backup, "INPUT", root),
                patch.object(backup, "PRIVATE", root),
                patch.object(backup.sys, "stdout", stdout),
                patch.object(backup.subprocess, "Popen", return_value=process) as spawn,
            ):
                backup.archive_stream()
            args = spawn.call_args.args[0]
            self.assertIn("--log-driver=none", args)
            self.assertIn("--read-only", args)
            output.seek(0)
            self.assertEqual(backup.verify_archive(output), {"objects": 0, "bytes": 0})

    def fixture(self, damage=False, missing=False):
        output = io.BytesIO()
        files = {}
        objects = []
        with tarfile.open(fileobj=output, mode="w") as archive:
            for name in (
                "database.dump",
                "globals.sql",
                "deployment.env",
                "deployment.json",
                "source.tar.gz",
                "objects/users/asset/original",
            ):
                data = b"example data"
                archive.addfile(backup.tar_info(name, len(data)), io.BytesIO(data))
                digest = hashlib.sha256(data).hexdigest()
                if name.startswith("objects/"):
                    objects.append(
                        {
                            "key": name[8:],
                            "sha256": "incorrect" if damage else digest,
                            "size": len(data),
                        }
                    )
                else:
                    files[name] = digest
            if not missing:
                data = json.dumps(
                    {"formatVersion": 1, "files": files, "objects": objects}
                ).encode()
                archive.addfile(
                    backup.tar_info("manifest.json", len(data)), io.BytesIO(data)
                )
        output.seek(0)
        return output

    def test_complete_archive_is_verified(self):
        self.assertEqual(
            backup.verify_archive(self.fixture()), {"objects": 1, "bytes": 12}
        )

    def test_changed_object_is_rejected(self):
        with self.assertRaises(ValueError):
            backup.verify_archive(self.fixture(damage=True))

    def test_missing_final_manifest_is_rejected(self):
        with self.assertRaises(ValueError):
            backup.verify_archive(self.fixture(missing=True))

    def test_path_escape_is_rejected_before_extracting(self):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as archive:
            archive.addfile(
                backup.tar_info("objects/../../secret", 1), io.BytesIO(b"x")
            )
        stream.seek(0)
        with self.assertRaises(ValueError):
            backup.verify_archive(stream)


class RecoveryTests(unittest.TestCase):
    def test_export_failure_restores_writers_and_never_deletes_old_backup(self):
        state = {
            "lastSuccessAt": "2026-10-01T00:00:00Z",
            "nextScheduledAt": "2026-10-23T17:00:00Z",
        }

        def resumed(s):
            s["pausedServices"] = []

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(backup, "PRIVATE", Path(directory)),
            patch.object(backup, "INPUT", Path(directory) / "input"),
            patch.object(backup, "load_state", return_value=state),
            patch.object(backup, "save_state") as save,
            patch.object(backup, "preflight", return_value={}),
            patch.object(backup, "prepare_input", return_value={"frozenAt": "now"}),
            patch.object(backup, "restore_services", side_effect=resumed) as restore,
            patch.object(backup, "run"),
            patch.object(
                backup, "restic", side_effect=RuntimeError("source failed")
            ) as restic,
            patch.object(backup.os, "getpgrp", return_value=123),
            patch.object(backup.os, "getpid", return_value=123),
        ):
            with self.assertRaises(RuntimeError):
                backup.backup()
            restore.assert_called_once()
            self.assertEqual(save.call_args.args[0]["status"], "failed")
            self.assertEqual(
                save.call_args.args[0]["lastSuccessAt"], state["lastSuccessAt"]
            )
            self.assertTrue(all(c.args[0] != "forget" for c in restic.call_args_list))

    def test_plain_backup_verifies_database_before_publish_and_never_uses_restic(self):
        state = {"nextScheduledAt": "2026-10-23T17:00:00Z"}
        events = []
        def resumed(value):
            value["pausedServices"] = []
        def remote(command, generation=None):
            events.append(command)
            return b'{"objects":1,"bytes":12}'
        def restored(directory):
            events.append("database-restored")
            return {"assets":1}
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(backup, "PRIVATE", Path(directory)),
            patch.object(backup, "INPUT", Path(directory) / "input"),
            patch.object(backup, "load_state", return_value=state),
            patch.object(backup, "save_state") as save,
            patch.object(backup, "preflight", return_value={}),
            patch.object(backup, "prepare_input", return_value={"frozenAt":"now"}),
            patch.object(backup, "restore_services", side_effect=resumed),
            patch.object(backup, "restore_database_check", side_effect=restored),
            patch.object(backup, "transfer_archive", create=True),
            patch.object(backup, "remote", side_effect=remote, create=True),
            patch.object(backup, "restic", side_effect=RuntimeError("Legacy encryption forbidden"), create=True),
            patch.object(backup, "run"),
            patch.object(backup.os, "getpgrp", return_value=123),
            patch.object(backup.os, "getpid", return_value=123),
        ):
            backup.backup()
            self.assertEqual(events, ["verify", "database-restored", "publish", "prune"])
            self.assertEqual(save.call_args.args[0]["backupFormat"], "plain-directory-v1")
            self.assertEqual(save.call_args.args[0]["status"], "succeeded")

    def test_restart_recovery_reopens_only_previously_paused_services(self):
        state = {"pausedServices": ["gateway", "api", "worker"]}

        def resumed(s):
            s["pausedServices"] = []

        with (
            patch.object(backup, "run"),
            patch.object(backup, "restore_services", side_effect=resumed) as restore,
            patch.object(backup, "save_state"),
        ):
            self.assertTrue(backup.recover(state))
            restore.assert_called_once()
            self.assertEqual(state["status"], "failed")

    def test_scheduler_does_not_run_before_requested_slot(self):
        with (
            patch.object(
                backup,
                "load_state",
                return_value={"nextScheduledAt": "2099-01-01T00:00:00Z"},
            ),
            patch.object(backup.subprocess, "Popen") as spawn,
        ):
            backup.tick()
            spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
