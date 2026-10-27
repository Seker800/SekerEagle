"""Fixed-revision PyTorch backend. It has no business queue or storage credentials."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .app import MODEL_REVISION

WEIGHT_SHA256 = "c73fa9caeddeb3ff831d46c085a7a5708343248ca777e90f2d486964464509c1"


def verify_snapshot(directory: Path):
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("revision") != MODEL_REVISION:
        raise ValueError("model revision mismatch")
    names = manifest.get("files", {})
    required = {"model.safetensors", "config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "chat_template.jinja"}
    if not isinstance(names, dict) or not required.issubset(names):
        raise ValueError("incomplete model manifest")
    if names["model.safetensors"] != WEIGHT_SHA256:
        raise ValueError("unexpected model weights")
    for name, digest in names.items():
        if Path(name).name != name or not isinstance(digest, str) or len(digest) != 64:
            raise ValueError("invalid model manifest")
        with (directory / name).open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                raise ValueError("model snapshot integrity mismatch")


def conversation(item):
    content = [{"type": "image", "image": item["image"]}] if "image" in item else [{"type": "text", "text": item["text"]}]
    return [{"role": "system", "content": [{"type": "text", "text": "Represent the user's input."}]},
            {"role": "user", "content": content}]


class CudaEngine:
    def __init__(self, directory: str):
        verify_snapshot(Path(directory))
        import torch
        from transformers import AutoProcessor, Qwen3VLModel

        if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
            raise RuntimeError("a working BF16 CUDA GPU is required")
        torch.set_num_threads(4)
        self.torch = torch
        self.processor = AutoProcessor.from_pretrained(directory, local_files_only=True, trust_remote_code=False, use_fast=False)
        self.model, loading = Qwen3VLModel.from_pretrained(
            directory, local_files_only=True, trust_remote_code=False, dtype=torch.bfloat16,
            attn_implementation="sdpa", output_loading_info=True,
        )
        if loading.get("missing_keys") or loading.get("unexpected_keys") or loading.get("mismatched_keys"):
            raise RuntimeError("model checkpoint does not match the backend")
        self.model = self.model.eval().to("cuda")

    def infer(self, item):
        return self.infer_batch([item])[0]

    def infer_batch(self, items):
        torch = self.torch
        with torch.inference_mode():
            inputs = self.processor.apply_chat_template(
                [conversation(item) for item in items], tokenize=True, return_dict=True, return_tensors="pt",
                add_generation_prompt=True, padding=True, truncation=True, max_length=8192,
            ).to("cuda")
            output = self.model(**inputs, use_cache=False)
            # Right padding: pool the last real token, then the HTTP layer applies MRL + L2.
            position = inputs["attention_mask"].sum(dim=1) - 1
            vector = output.last_hidden_state[torch.arange(position.shape[0], device="cuda"), position]
            result = vector.float().cpu().tolist()
            torch.cuda.synchronize()
            return result

    def memory(self):
        torch = self.torch
        return {"activeBytes": torch.cuda.memory_allocated(), "cacheBytes": torch.cuda.memory_reserved(),
                "peakBytes": torch.cuda.max_memory_allocated()}
