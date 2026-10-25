"""The persistent preview must survive a temporarily busy Android accessibility tree."""
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('lab_preview', Path(__file__).with_name('android-lab-preview.py'))
preview = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preview)


class PreviewUiTest(unittest.TestCase):
    def test_retries_when_uiautomator_reports_success_without_a_dump(self):
        reads, cleanups, delays = [], [], []

        def invoke(args):
            if 'cat' in args:
                reads.append(args)
                if len(reads) == 1:
                    raise RuntimeError('dump not yet available')
                return b'<hierarchy><node text="Login" /></hierarchy>'
            if 'rm' in args:
                cleanups.append(args)
            return b''

        tree = preview.read_ui(['adb', '-s', 'emulator-test'], invoke, delays.append)
        self.assertEqual(tree.tag, 'hierarchy')
        self.assertEqual(len(reads), 2)
        self.assertEqual(len(cleanups), 2)
        self.assertEqual(len(delays), 1)

    def test_bounds_retries_and_cleans_up_malformed_dumps(self):
        cleanups, reads = [], []

        def invoke(args):
            if 'cat' in args:
                reads.append(args)
                return b'not an XML dump'
            if 'rm' in args:
                cleanups.append(args)
            return b''

        with self.assertRaises(RuntimeError):
            preview.read_ui(['adb'], invoke, lambda _: None)
        self.assertEqual(len(reads), 3)
        self.assertEqual(len(cleanups), 3)


if __name__ == '__main__':
    unittest.main()
