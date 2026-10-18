"""Decode a real camera RAW with LibRaw; output is disposable sRGB PPM, never the original."""
import json
import sys
import rawpy


def main():
    source, limit = sys.argv[1], int(sys.argv[2])
    with rawpy.imread(source) as raw:
        sizes = raw.sizes
        if sizes.raw_width * sizes.raw_height > limit or min(sizes.width, sizes.height) <= 0:
            raise ValueError("RAW pixel limit exceeded")
        width, height = sizes.width, sizes.height
        if sizes.flip in (5, 6):
            width, height = height, width
        if len(sys.argv) == 4:
            pixels = raw.postprocess(use_camera_wb=True, output_color=rawpy.ColorSpace.sRGB, output_bps=8)
            height, width = pixels.shape[:2]
            if width * height > limit:
                raise ValueError("RAW output pixel limit exceeded")
            with open(sys.argv[3], "xb") as output:
                output.write(f"P6\n{width} {height}\n255\n".encode("ascii"))
                output.write(pixels.tobytes())
        print(json.dumps({"width": width, "height": height}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Unsupported, damaged or oversized camera RAW", file=sys.stderr)
        sys.exit(1)
