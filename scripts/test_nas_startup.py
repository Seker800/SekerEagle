import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('nas_startup', Path(__file__).with_name('nas-startup.py'))
startup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(startup)


class NasStartupTest(unittest.TestCase):
    def test_health_probe_tolerates_engine_restoration_errors(self):
        with patch.object(startup, 'docker', side_effect=RuntimeError('Docker operation failed: inspect')):
            self.assertFalse(startup.ready(startup.CORE[0]))

    def test_fixed_start_order_and_completed_copy_skip(self):
        for pending in (True, False):
            with self.subTest(pending=pending):
                calls = []

                def docker(*args):
                    calls.append(args)
                    if args[0] == 'inspect':
                        if 'Labels' in args[2]:
                            return json.dumps({'com.docker.compose.project': startup.PROJECT})
                        return json.dumps({'Running': True, 'Health': {'Status': 'healthy'}})
                    return ''

                with patch.object(startup, 'docker', docker), patch.object(startup, 'copy_pending', return_value=pending):
                    startup.main()
                expected = list(startup.CORE) + ([startup.COPY] if pending else [])
                self.assertEqual([c[1] for c in calls if c[0] == 'start'], expected)

    def test_wrong_project_starts_nothing(self):
        calls = []

        def docker(*args):
            calls.append(args)
            return '{}'

        with patch.object(startup, 'docker', docker):
            with self.assertRaisesRegex(RuntimeError, 'identity'):
                startup.main()
        self.assertFalse(any(c[0] == 'start' for c in calls))

    def test_checkpoint_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(startup, 'STATE', Path(directory)):
            root = Path(directory)
            (root / 'cover-state').mkdir()
            manifest = b'[]'
            (root / 'cover-manifest.json').write_bytes(manifest)
            progress = {'manifestHash': hashlib.sha256(manifest).hexdigest(), 'offset': 1,
                        'total': 2, 'counts': {'COPIED': 1}, 'complete': False}
            path = root / 'cover-state/progress.json'
            path.write_text(json.dumps(progress))
            self.assertTrue(startup.copy_pending())
            progress.update(offset=2, counts={'COPIED': 2}, complete=True)
            path.write_text(json.dumps(progress))
            self.assertFalse(startup.copy_pending())
            progress.update(offset=1, counts={'COPIED': 1})
            path.write_text(json.dumps(progress))
            with self.assertRaisesRegex(RuntimeError, 'marked complete'):
                startup.copy_pending()
            (root / 'cover-manifest.json').write_bytes(b'changed')
            with self.assertRaisesRegex(RuntimeError, 'manifest'):
                startup.copy_pending()

    def test_unhealthy_dependencies_block_downstream(self):
        calls = []

        def docker(*args):
            calls.append(args)
            return json.dumps({'com.docker.compose.project': startup.PROJECT})

        def wait_for(check, description):
            if description != 'Docker engine':
                raise RuntimeError('Startup timed out')

        with patch.object(startup, 'docker', docker), patch.object(startup, 'wait_for', wait_for):
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                startup.main()
        self.assertEqual([c[1] for c in calls if c[0] == 'start'], list(startup.CORE[:2]))


if __name__ == '__main__':
    unittest.main()
