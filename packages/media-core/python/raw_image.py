"""Decode camera RAW to bounded sRGB TIFF; preserve original dimensions and exposure metadata."""
import json
import sys
from PIL import Image
import rawpy
from raw_color import load_raf_profile, camera_rgb_to_srgb


def decode_raw(raw, input_limit, output_limit, output_path=None, profile=None, thumbnail_path=None):
    sizes = raw.sizes
    width, height = sizes.width, sizes.height
    if (min(sizes.raw_width, sizes.raw_height, width, height) <= 0
            or sizes.raw_width * sizes.raw_height > input_limit
            or width * height > input_limit):
        raise ValueError("RAW pixel limit exceeded")
    # Validate the actual sensor payload even when only probing metadata.
    raw.unpack()
    if profile and raw.rgb_xyz_matrix.any():
        profile = None
    if sizes.flip in (5, 6):
        width, height = height, width
    result = {"width": width, "height": height}
    if output_path:
        # LibRaw's half-size processing reduces demosaic memory for high-resolution
        # originals. The retained original and its catalog dimensions never shrink.
        # Sensor values are not a display exposure. Use LibRaw's per-image
        # brightness normalization, with a conservative 0.1% highlight budget.
        params = dict(use_camera_wb=True, no_auto_bright=False,
                      auto_bright_thr=0.001,
                      half_size=width * height > output_limit)
        if profile:
            # Linear, white-balanced camera RGB; apply the explicit camera
            # characterization before encoding sRGB. No gamma before the matrix.
            pixels = raw.postprocess(**params, output_color=rawpy.ColorSpace.raw,
                                     output_bps=16, gamma=(1, 1))
        else:
            pixels = raw.postprocess(**params, output_color=rawpy.ColorSpace.sRGB,
                                     output_bps=8)
        decoded_height, decoded_width = pixels.shape[:2]
        if decoded_width * decoded_height > output_limit:
            raise ValueError("RAW output pixel limit exceeded")
        if profile:
            pixels = camera_rgb_to_srgb(pixels, profile)
        with open(output_path, "xb") as output:
            Image.fromarray(pixels).save(output, format="TIFF", compression="raw")
        result.update(decodedWidth=decoded_width, decodedHeight=decoded_height)
        if thumbnail_path:
            from raw_thumbnail import write_raw_thumbnail
            result["embeddedThumbnail"] = write_raw_thumbnail(raw, thumbnail_path, output_limit)
    return result


def main():
    source, input_limit, output_limit = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    output_path = sys.argv[4] if len(sys.argv) >= 5 else None
    thumbnail_path = sys.argv[5] if len(sys.argv) == 6 else None
    with rawpy.RawPy() as raw:
        raw.open_file(source)
        # The model header only chooses calibration; LibRaw must still open and
        # unpack the entire sensor payload before any file is accepted.
        with open(source, 'rb') as original:
            profile = load_raf_profile(original.read(108))
        print(json.dumps(decode_raw(raw, input_limit, output_limit, output_path, profile, thumbnail_path)))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Unsupported, damaged or oversized camera RAW", file=sys.stderr)
        sys.exit(1)
