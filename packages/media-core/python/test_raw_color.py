"""Native numerical checks run with CAMERA_RAW_PYTHON in camera-media smoke."""
import importlib.util
from pathlib import Path
import sys
import unittest


@unittest.skipUnless(importlib.util.find_spec('numpy'), 'native camera runtime required')
class RawColorTests(unittest.TestCase):
    def test_profile_preserves_neutral_and_converts_camera_primaries(self):
        import numpy as np
        from raw_color import camera_rgb_to_srgb, load_raf_profile
        profile = load_raf_profile(b'FUJIFILMCCD-RAW 0201FF179504X-E5' + bytes(80))
        rgb_to_xyz = np.array([[.4124564, .3575761, .1804375], [.2126729, .7151522, .0721750], [.0193339, .1191920, .9503041]])
        xyz_to_camera = np.array(profile['xyzToCamera']) / 10000
        camera_from_rgb = xyz_to_camera @ rgb_to_xyz
        camera_from_rgb /= camera_from_rgb.sum(axis=1, keepdims=True)
        # Generate camera-domain pixels from known linear sRGB. Includes neutrals,
        # black, white and chromatic colors inside the camera gamut.
        linear = np.array([[[0,0,0], [.18,.18,.18], [1,1,1], [.4,.2,.3], [.2,.4,.3]]])
        camera = np.clip(linear @ camera_from_rgb.T, 0, 1)
        pixels = np.round(camera * 65535).astype('uint16')
        result = camera_rgb_to_srgb(pixels, profile)
        expected = np.where(linear <= .0031308, linear * 12.92, 1.055 * linear ** (1/2.4) - .055)
        np.testing.assert_allclose(result, np.round(expected * 255), atol=1)
        self.assertEqual(result.dtype, np.uint8)

    def test_profiles_match_only_real_raf_model_headers(self):
        from raw_color import load_raf_profile
        self.assertIsNone(load_raf_profile(b'not a RAF' + bytes(100)))
        self.assertIsNone(load_raf_profile(b'FUJIFILMCCD-RAW 0201FF179504X-Pro3' + bytes(80)))


if __name__ == '__main__':
    unittest.main()
