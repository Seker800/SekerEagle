"""Exercise the real image dependencies without downloading model weights."""

import io

import numpy as np
import pytest
from PIL import Image
from torchvision.transforms import functional as transforms
from transformers import Qwen2VLImageProcessor


@pytest.mark.parametrize(
    ("format", "mode"),
    [
        ("JPEG", "RGB"),
        ("PNG", "RGB"),
        ("WEBP", "RGB"),
        ("PNG", "RGBA"),
        ("WEBP", "RGBA"),
        ("PNG", "L"),
        ("PNG", "P"),
    ],
)
def test_allowed_images_remain_compatible_with_model_preprocessing(format, mode):
    image = Image.new(mode, (96, 64), 127)
    encoded = io.BytesIO()
    image.save(encoded, format=format)

    with Image.open(io.BytesIO(encoded.getvalue()), formats=(format,)) as probe:
        probe.verify()
    with Image.open(io.BytesIO(encoded.getvalue()), formats=(format,)) as opened:
        rgb = opened.convert("RGB")

    tensor = transforms.to_tensor(transforms.resize(rgb, [32, 32]))
    assert tuple(tensor.shape) == (3, 32, 32)
    assert tensor.isfinite().all()

    # Qwen3-VL's MLX adapter uses the Qwen2-VL image processor with 16px patches.
    processor = Qwen2VLImageProcessor(
        patch_size=16, temporal_patch_size=2, merge_size=2
    )
    result = processor(images=[rgb], return_tensors="np")
    assert result["image_grid_thw"].tolist() == [[1, 4, 6]]
    assert result["pixel_values"].shape == (24, 1536)
    assert np.isfinite(result["pixel_values"]).all()
