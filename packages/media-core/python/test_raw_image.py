"""RAW policy regression tests, independent of optional native decoder installation."""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


class RawPolicyTests(unittest.TestCase):
    def setUp(self):
        self.rawpy = MagicMock()
        self.image = MagicMock()
        with patch.dict(sys.modules, {"rawpy": self.rawpy, "PIL": SimpleNamespace(Image=self.image)}):
            spec = importlib.util.spec_from_file_location("raw_image", Path(__file__).with_name("raw_image.py"))
            self.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.module)
        self.raw = MagicMock()
        self.raw.sizes = SimpleNamespace(raw_width=11664, raw_height=8750, width=11648, height=8736, flip=6)
        self.raw.postprocess.return_value = SimpleNamespace(shape=(5824, 4368, 3))

    def test_high_resolution_original_keeps_dimensions_and_decodes_half_size(self):
        with patch("builtins.open", MagicMock()):
            result = self.module.decode_raw(self.raw, 120_000_000, 50_000_000, "preview.tiff")
        self.assertEqual((result["width"], result["height"]), (8736, 11648))
        self.assertEqual((result["decodedWidth"], result["decodedHeight"]), (4368, 5824))
        self.assertTrue(self.raw.postprocess.call_args.kwargs["half_size"])
        self.assertFalse(self.raw.postprocess.call_args.kwargs["no_auto_bright"])
        self.assertNotIn("auto_bright_thr", self.raw.postprocess.call_args.kwargs)

    def test_missing_native_calibration_uses_profile_after_unpack(self):
        self.raw.rgb_xyz_matrix.any.return_value = False
        with patch("builtins.open", MagicMock()), patch.object(self.module, "camera_rgb_to_srgb") as convert:
            convert.return_value = SimpleNamespace(shape=(5824, 4368, 3))
            self.module.decode_raw(self.raw, 120_000_000, 50_000_000, "preview.tiff", {"xyzToCamera": []})
            convert.assert_called_once()
            self.assertEqual(self.raw.postprocess.call_args.kwargs["output_bps"], 16)
            self.assertEqual(self.raw.postprocess.call_args.kwargs["gamma"], (1, 1))
        self.raw.unpack.assert_called_once()

    def test_native_calibration_takes_precedence_over_profile(self):
        self.raw.rgb_xyz_matrix.any.return_value = True
        with patch("builtins.open", MagicMock()), patch.object(self.module, "camera_rgb_to_srgb") as convert:
            self.module.decode_raw(self.raw, 120_000_000, 50_000_000, "preview.tiff", {"xyzToCamera": []})
            convert.assert_not_called()
            self.assertEqual(self.raw.postprocess.call_args.kwargs["output_bps"], 8)
        self.raw.unpack.assert_called_once()

    def test_regular_raw_retains_full_decode_resolution(self):
        self.raw.sizes = SimpleNamespace(raw_width=4100, raw_height=3100, width=4096, height=3072, flip=0)
        self.raw.postprocess.return_value = SimpleNamespace(shape=(3072, 4096, 3))
        with patch("builtins.open", MagicMock()):
            self.module.decode_raw(self.raw, 120_000_000, 50_000_000, "preview.tiff")
        self.assertFalse(self.raw.postprocess.call_args.kwargs["half_size"])

    def test_oversize_and_invalid_raw_rejected_before_unpack(self):
        for w, h in [(16000, 12000), (0, 1000), (-1, 1000)]:
            self.raw.sizes.raw_width, self.raw.sizes.raw_height = w, h
            with self.assertRaises(ValueError):
                self.module.decode_raw(self.raw, 120_000_000, 50_000_000)
        self.raw.unpack.assert_not_called()

    def test_display_brightness_preserves_camera_white_balance_and_protects_highlights(self):
        self.raw.sizes = SimpleNamespace(raw_width=4100, raw_height=3100, width=4096, height=3072, flip=0)
        self.raw.postprocess.return_value = SimpleNamespace(shape=(3072,4096,3))
        with patch("builtins.open", MagicMock()):
            self.module.decode_raw(self.raw,120_000_000,50_000_000,"preview.tiff")
        options=self.raw.postprocess.call_args.kwargs
        self.assertTrue(options["use_camera_wb"])
        self.assertFalse(options["no_auto_bright"])
        self.assertNotIn("auto_bright_thr",options)
        self.assertNotIn("bright",options)

    def test_probe_unpacks_without_rendering(self):
        result = self.module.decode_raw(self.raw, 120_000_000, 50_000_000)
        self.assertEqual(result, {"width": 8736, "height": 11648})
        self.raw.unpack.assert_called_once()
        self.raw.postprocess.assert_not_called()

    def test_oversized_decoded_output_is_not_saved(self):
        self.raw.postprocess.return_value = SimpleNamespace(shape=(12000, 12000, 3))
        with self.assertRaises(ValueError):
            self.module.decode_raw(self.raw, 120_000_000, 50_000_000, "preview.tiff")
        self.image.fromarray.assert_not_called()


if __name__ == "__main__":
    unittest.main()
