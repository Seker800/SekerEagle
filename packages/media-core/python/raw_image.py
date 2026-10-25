"""Decode camera RAW to bounded sRGB TIFF; preserve original dimensions and exposure metadata."""
import json
import sys
from PIL import Image
import rawpy
from raw_color import load_raf_profile, camera_rgb_to_srgb


def decode_raw(raw, input_limit, output_limit, output_path=None, profile=None, thumbnail_path=None, browse=False):
    sizes = raw.sizes
    width, height = sizes.width, sizes.height
    if (min(sizes.raw_width, sizes.raw_height, width, height) <= 0
            or sizes.raw_width * sizes.raw_height > input_limit
            or width * height > input_limit):
        raise ValueError("RAW pixel limit exceeded")
    if profile and raw.rgb_xyz_matrix.any():
        profile = None
    if sizes.flip in (5, 6):
        width, height = height, width
    result = {"width": width, "height": height}
    if output_path and browse:
        from raw_thumbnail import write_raw_thumbnail
        if write_raw_thumbnail(raw, output_path, output_limit, max_size=1600,
                               minimum_size=min(1600, max(width, height)),
                               expected_dimensions=(width, height)):
            with Image.open(output_path) as preview:
                result.update(decodedWidth=preview.width, decodedHeight=preview.height,
                              embeddedPreview=True)
            return result
    # Probe/upload validation and development still validate the sensor payload.
    # Browsing an already validated, hash-checked RAW may reuse its camera JPEG.
    raw.unpack()
    if output_path:
        # LibRaw's half-size processing reduces demosaic memory for high-resolution
        # originals. The retained original and its catalog dimensions never shrink.
        # Retain the decoder's documented rendering defaults; camera thumbnails
        # come from its embedded JPEG rather than a custom exposure threshold.
        params = dict(use_camera_wb=True, no_auto_bright=False,
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
    browse = sys.argv[-1] == '--browse'
    args = sys.argv[1:-1] if browse else sys.argv[1:]
    if len(args) not in (3, 4, 5):
        raise ValueError("Invalid RAW arguments")
    source, input_limit, output_limit = args[0], int(args[1]), int(args[2])
    output_path = args[3] if len(args) >= 4 else None
    thumbnail_path = args[4] if len(args) == 5 else None
    with rawpy.RawPy() as raw:
        raw.open_file(source)
        # The model header only chooses calibration; LibRaw must still open and
        # unpack the entire sensor payload before any file is accepted.
        with open(source, 'rb') as original:
            profile = load_raf_profile(original.read(108))
        print(json.dumps(decode_raw(raw, input_limit, output_limit, output_path, profile, thumbnail_path, browse=browse)))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Unsupported, damaged or oversized camera RAW", file=sys.stderr)
        sys.exit(1)
