"""Camera calibration for models LibRaw can unpack but cannot yet color-convert.

Uses explicit XYZ-to-camera characterization data, never a renamed camera model
or mutations of LibRaw internals. Prefer LibRaw when its own calibration exists.
"""
import json
from pathlib import Path


def load_raf_profile(header):
    if len(header) < 52 or not header.startswith(b'FUJIFILMCCD-RAW '):
        return None
    model = header[28:60].split(b'\0', 1)[0].decode('ascii', errors='replace').strip()
    profiles = json.loads(Path(__file__).with_name('camera-profiles.json').read_text())
    return profiles['profiles'].get(model)


def camera_rgb_to_srgb(pixels, profile):
    import numpy as np
    rgb_to_xyz = np.array([
        [.4124564, .3575761, .1804375],
        [.2126729, .7151522, .0721750],
        [.0193339, .1191920, .9503041],
    ], dtype=np.float64)
    xyz_to_camera = np.array(profile['xyzToCamera'], dtype=np.float64) / 10000
    camera_from_rgb = xyz_to_camera @ rgb_to_xyz
    # White balance is already applied by LibRaw. Normalize camera rows so a
    # neutral camera pixel remains neutral; invert into linear sRGB.
    camera_from_rgb /= camera_from_rgb.sum(axis=1, keepdims=True)
    camera_to_rgb = np.linalg.inv(camera_from_rgb).astype(np.float32)
    output = np.empty(pixels.shape, dtype=np.uint8)
    # Bound conversion scratch memory independently of the source image size.
    for start in range(0, pixels.shape[0], 128):
        chunk = pixels[start:start + 128].astype(np.float32) / 65535
        linear = np.clip(chunk @ camera_to_rgb.T, 0, 1)
        encoded = np.where(linear <= .0031308, linear * 12.92,
                           1.055 * np.power(linear, 1 / 2.4) - .055)
        output[start:start + 128] = np.round(encoded * 255).astype(np.uint8)
    return output
