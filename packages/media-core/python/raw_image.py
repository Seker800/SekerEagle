"""Decode camera RAW to bounded sRGB TIFF; preserve original dimensions and exposure."""
import json
import sys
from PIL import Image
import rawpy


def decode_raw(raw, input_limit, output_limit, output_path=None):
    sizes = raw.sizes
    width, height = sizes.width, sizes.height
    if (min(sizes.raw_width, sizes.raw_height, width, height) <= 0
            or sizes.raw_width * sizes.raw_height > input_limit
            or width * height > input_limit):
        raise ValueError("RAW pixel limit exceeded")
    # Validate the actual sensor payload even when only probing metadata.
    raw.unpack()
    if sizes.flip in (5, 6):
        width, height = height, width
    result = {"width": width, "height": height}
    if output_path:
        # LibRaw's half-size processing reduces demosaic memory for high-resolution
        # originals. The retained original and its catalog dimensions never shrink.
        pixels = raw.postprocess(
            use_camera_wb=True, output_color=rawpy.ColorSpace.sRGB, output_bps=8,
            no_auto_bright=True, half_size=width * height > output_limit,
        )
        decoded_height, decoded_width = pixels.shape[:2]
        if decoded_width * decoded_height > output_limit:
            raise ValueError("RAW output pixel limit exceeded")
        with open(output_path, "xb") as output:
            Image.fromarray(pixels).save(output, format="TIFF", compression="raw")
        result.update(decodedWidth=decoded_width, decodedHeight=decoded_height)
    return result


def main():
    source, input_limit, output_limit = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    output_path = sys.argv[4] if len(sys.argv) == 5 else None
    with rawpy.RawPy() as raw:
        raw.open_file(source)
        print(json.dumps(decode_raw(raw, input_limit, output_limit, output_path)))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Unsupported, damaged or oversized camera RAW", file=sys.stderr)
        sys.exit(1)
