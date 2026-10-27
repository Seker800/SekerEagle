import hashlib
import json

import pytest

from sekereagle_cuda import backend


def test_snapshot_is_offline_pinned_and_fully_checked(tmp_path, monkeypatch):
    names = ["model.safetensors", "config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "chat_template.jinja"]
    digest = hashlib.sha256(b"isolated synthetic fixture").hexdigest()
    monkeypatch.setattr(backend, "WEIGHT_SHA256", digest)
    for name in names:
        (tmp_path / name).write_bytes(b"isolated synthetic fixture")
    manifest = {"revision": backend.MODEL_REVISION, "files": {name: digest for name in names}}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    backend.verify_snapshot(tmp_path)
    (tmp_path / names[1]).write_text("changed")
    with pytest.raises(ValueError, match="integrity"):
        backend.verify_snapshot(tmp_path)
    manifest["revision"] = "unverified"
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="revision"):
        backend.verify_snapshot(tmp_path)


def test_prompt_uses_the_same_fixed_instruction_for_text_and_images():
    for item in [{"text": "汽车"}, {"image": object()}]:
        result = backend.conversation(item)
        assert result[0]["content"][0]["text"] == "Represent the user's input."
        assert result[1]["content"][0]["type"] == next(iter(item))
