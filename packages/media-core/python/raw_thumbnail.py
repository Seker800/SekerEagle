"""Use the camera-rendered JPEG for catalog thumbnails, never for RAW editing."""
import io
from PIL import Image, ImageOps

MAX_PREVIEW_BYTES = 64 * 1024 * 1024
THUMBNAIL_SIZE = 512


def write_raw_thumbnail(raw, output_path, pixel_limit):
    try:
        thumbnail = raw.extract_thumb()
    except Exception:
        # An embedded preview is optional; sensor decoding remains authoritative.
        return False
    if thumbnail.format.name != 'JPEG' or not 0 < len(thumbnail.data) <= MAX_PREVIEW_BYTES:
        return False
    try:
        with Image.open(io.BytesIO(thumbnail.data)) as image:
            if (image.format != 'JPEG' or min(image.size) <= 0
                    or image.width * image.height > pixel_limit
                    or max(image.size) < THUMBNAIL_SIZE):
                return False
            image.load()
            orientation = image.getexif().get(274)
            icc_profile = image.info.get('icc_profile')
            normalized = ImageOps.exif_transpose(image).convert('RGB')
            if orientation not in range(1, 9):
                rotation = {3: Image.Transpose.ROTATE_180,
                            5: Image.Transpose.ROTATE_90,
                            6: Image.Transpose.ROTATE_270}.get(raw.sizes.flip)
                if rotation is not None:
                    normalized = normalized.transpose(rotation)
            normalized.thumbnail((THUMBNAIL_SIZE, THUMBNAIL_SIZE), Image.Resampling.LANCZOS)
    except (OSError, ValueError, Image.DecompressionBombError):
        return False
    # Keep the camera's color profile. The shared image encoder converts to sRGB.
    with open(output_path, 'xb') as output:
        normalized.save(output, format='PNG', icc_profile=icc_profile)
    return True
