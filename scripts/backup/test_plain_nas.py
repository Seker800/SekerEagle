import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

import test_backup

spec = importlib.util.spec_from_file_location(
    "plain_nas", Path(__file__).with_name("plain_nas.py")
)
nas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nas)


class PlainNasTests(unittest.TestCase):
    generation = "a" * 64

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "owner-marker").write_text("sekereagle-independent-backup-v1\n")

    def fixture(self, **kwargs):
        return test_backup.ArchiveIntegrityTests().fixture(**kwargs)

    def test_extract_verify_and_publish_plain_files_without_password(self):
        nas.receive(self.root, self.generation, self.fixture())
        result = nas.verify(self.root, self.generation)
        self.assertEqual(result["objects"], 1)
        nas.publish(self.root, self.generation)
        self.assertEqual(
            (self.root / "current/objects/users/asset/original").read_bytes(),
            b"example data",
        )
        self.assertFalse((self.root / "repository-password").exists())

    def test_corrupt_or_truncated_archive_never_replaces_current(self):
        nas.receive(self.root, self.generation, self.fixture())
        nas.verify(self.root, self.generation)
        nas.publish(self.root, self.generation)
        for key, stream in [
            ("b" * 64, self.fixture(damage=True)),
            ("c" * 64, self.fixture(missing=True)),
        ]:
            with self.assertRaises(ValueError):
                nas.receive(self.root, key, stream)
            with self.assertRaises(ValueError):
                nas.publish(self.root, key)
        self.assertEqual((self.root / "current").resolve().name, self.generation)

    def test_changed_file_after_extraction_fails_disk_verification(self):
        nas.receive(self.root, self.generation, self.fixture())
        (
            self.root / "generations" / self.generation / "objects/users/asset/original"
        ).write_bytes(b"changed data")
        with self.assertRaises(ValueError):
            nas.verify(self.root, self.generation)
        with self.assertRaises(ValueError):
            nas.publish(self.root, self.generation)

    def test_unknown_root_and_traversal_fail_closed(self):
        (self.root / "owner-marker").unlink()
        with self.assertRaises(ValueError):
            nas.receive(self.root, self.generation, self.fixture())
        (self.root / "owner-marker").write_text("sekereagle-independent-backup-v1\n")
        for key in ["../outside", "/tmp/outside", "invalid"]:
            with self.assertRaises(ValueError):
                nas.receive(self.root, key, self.fixture())

    def test_encrypted_retirement_requires_published_verified_plaintext(self):
        repository = self.root / "repository"
        repository.mkdir()
        (repository / "config").write_text("old encrypted configuration")
        with self.assertRaises(ValueError):
            nas.retire(self.root)
        self.assertTrue(repository.exists())
        nas.receive(self.root, self.generation, self.fixture())
        nas.verify(self.root, self.generation)
        nas.publish(self.root, self.generation)
        nas.retire(self.root)
        self.assertFalse(repository.exists())
        self.assertTrue((self.root / "current/objects/users/asset/original").exists())

    def test_retention_preserves_current_and_refuses_unknown_directories(self):
        for key in [self.generation, "b" * 64]:
            nas.receive(self.root, key, self.fixture())
            nas.verify(self.root, key)
            nas.publish(self.root, key)
        nas.prune(self.root)
        self.assertFalse((self.root / "generations" / self.generation).exists())
        self.assertTrue((self.root / "current/manifest.json").exists())
        (self.root / "generations" / ("c" * 64)).mkdir()
        with self.assertRaises(ValueError):
            nas.prune(self.root)


if __name__ == "__main__":
    unittest.main()
