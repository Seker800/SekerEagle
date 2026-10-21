"""Embedded JPEG selection; real image decoding when Pillow is installed."""
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock
import tempfile
try:
    from PIL import Image
except ImportError:
    Image = None


@unittest.skipIf(Image is None, 'Pillow native test environment required')
class EmbeddedThumbnailTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('raw_thumbnail', Path(__file__).with_name('raw_thumbnail.py'))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = str(Path(self.directory.name) / 'thumbnail.png')
        self.raw = MagicMock()
        self.raw.sizes.flip = 0

    def jpeg(self, size=(1200, 800), orientation=None):
        output = io.BytesIO()
        exif = Image.Exif()
        if orientation is not None:
            exif[274] = orientation
        Image.new('RGB', size, (180, 120, 80)).save(output, format='JPEG', exif=exif)
        self.raw.extract_thumb.return_value = SimpleNamespace(format=SimpleNamespace(name='JPEG'), data=output.getvalue())

    def test_preserves_camera_rendering_and_bounds_thumbnail(self):
        self.jpeg()
        self.assertTrue(self.module.write_raw_thumbnail(self.raw, self.path, 50_000_000))
        with Image.open(self.path) as result:
            self.assertEqual(result.size, (512, 341))
            self.assertLess(max(abs(a-b) for a,b in zip(result.getpixel((50,50)), (180,120,80))), 3)
        self.raw.postprocess.assert_not_called()

    def test_uses_exif_orientation_once_and_raw_orientation_when_absent(self):
        for orientation in (None, 6):
            with self.subTest(orientation=orientation):
                Path(self.path).unlink(missing_ok=True)
                self.jpeg(orientation=orientation)
                self.raw.sizes.flip = 6
                self.assertTrue(self.module.write_raw_thumbnail(self.raw, self.path, 50_000_000))
                with Image.open(self.path) as result:
                    self.assertEqual(result.size, (341, 512))

    def test_invalid_missing_small_or_oversize_previews_fall_back(self):
        for kind in ('missing', 'broken', 'small', 'oversize', 'bitmap', 'not-jpeg'):
            with self.subTest(kind=kind):
                self.raw.extract_thumb.side_effect = None
                self.jpeg(size=(160,120) if kind=='small' else (1200,800))
                if kind == 'missing': self.raw.extract_thumb.side_effect = ValueError('no preview')
                if kind == 'broken': self.raw.extract_thumb.return_value.data = b'broken jpeg'
                if kind == 'bitmap': self.raw.extract_thumb.return_value.format.name = 'BITMAP'
                if kind == 'not-jpeg':
                    data=io.BytesIO(); Image.new('RGB',(800,600)).save(data,format='PNG')
                    self.raw.extract_thumb.return_value.data=data.getvalue()
                self.assertFalse(self.module.write_raw_thumbnail(self.raw, self.path, 10 if kind=='oversize' else 50_000_000))
                self.assertFalse(Path(self.path).exists())
