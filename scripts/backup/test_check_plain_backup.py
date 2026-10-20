import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import plain_nas


class ReadonlyBackupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'owner-marker').write_text(plain_nas.MARKER)
        self.generation = 'a' * 64
        self.path = self.root / 'generations' / self.generation
        self.path.mkdir(parents=True)
        (self.path / '.owner-marker').write_text(plain_nas.MARKER)
        files = {}
        for name in plain_nas.FILES:
            (self.path / name).write_bytes(b'example')
            files[name] = hashlib.sha256(b'example').hexdigest()
        manifest = {'formatVersion': 1, 'files': files, 'objects': []}
        data = json.dumps(manifest).encode()
        (self.path / 'manifest.json').write_bytes(data)
        (self.path / 'verified.json').write_text(json.dumps({
            'generation': self.generation,
            'manifestSha256': hashlib.sha256(data).hexdigest(),
            'objects': 0,
            'bytes': 0,
        }))

    def verify(self):
        from check_plain_backup import verify_readonly
        return verify_readonly(self.root, self.generation)

    def test_success_does_not_change_any_backup_file(self):
        before = {p.name: p.read_bytes() for p in self.path.iterdir()}
        self.assertEqual(self.verify()['objects'], 0)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.path.iterdir()})

    def test_tampered_file_keeps_old_verification_untouched(self):
        evidence = (self.path / 'verified.json').read_bytes()
        (self.path / 'database.dump').write_text('broken')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            self.verify()
        self.assertEqual(evidence, (self.path / 'verified.json').read_bytes())

    def test_changed_manifest_is_rejected(self):
        with (self.path / 'manifest.json').open('a') as file:
            file.write(' ')
        with self.assertRaisesRegex(ValueError, 'manifest'):
            self.verify()

    def test_file_symlink_and_unowned_generation_are_rejected(self):
        (self.path / 'database.dump').unlink()
        (self.path / 'database.dump').symlink_to(self.path / 'globals.sql')
        with self.assertRaisesRegex(ValueError, 'unsafe'):
            self.verify()
        (self.path / '.owner-marker').write_text('other')
        with self.assertRaisesRegex(ValueError, 'generation'):
            self.verify()

    def test_extra_file_is_rejected(self):
        (self.path / 'unexpected').write_text('extra')
        with self.assertRaisesRegex(ValueError, 'Unexpected'):
            self.verify()
