from __future__ import annotations

import hmac
import io
import os
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import mlx.core as mx
from fastapi import FastAPI, Header, HTTPException, Request
from huggingface_hub import snapshot_download
from mlx_embeddings import load
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from .core import project_mrl

MODEL_ID = os.getenv("MLX_EMBEDDING_MODEL", "Qwen/Qwen3-VL-Embedding-2B")
MODEL_REVISION = os.getenv(
    "MLX_EMBEDDING_REVISION", "9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda"
)
DIMENSIONS = int(os.getenv("MLX_EMBEDDING_DIMENSIONS", "1024"))
MAX_BODY_BYTES = int(os.getenv("MLX_EMBEDDING_MAX_PAYLOAD_BYTES", str(20 * 1024 * 1024)))
TOKEN = os.getenv("MLX_EMBEDDING_TOKEN", "")
ALLOWED_IMAGE_FORMATS = ("JPEG", "PNG", "WEBP")


@dataclass
class Runtime:
    model: object | None = None
    processor: object | None = None
    model_path: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


runtime = Runtime()


def load_runtime() -> None:
    if not TOKEN:
        raise RuntimeError("MLX_EMBEDDING_TOKEN is required")
    path = snapshot_download(repo_id=MODEL_ID, revision=MODEL_REVISION)
    runtime.model, runtime.processor = load(path)
    runtime.model_path = path


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_runtime()
    yield


app = FastAPI(title="SekerEagle MLX Embedding Host", version="1", lifespan=lifespan)


class TextEmbeddingInput(BaseModel):
    text: str = Field(min_length=1, max_length=4096)


def require_token(authorization: str | None) -> None:
    expected = f"Bearer {TOKEN}"
    if not TOKEN or not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health/live")
def live(authorization: str | None = Header(default=None)) -> dict[str, str]:
    require_token(authorization)
    return {"status": "live"}


@app.get("/healthz")
@app.get("/health/ready")
def healthz(authorization: str | None = Header(default=None)) -> dict[str, object]:
    require_token(authorization)
    return {
        "status": "ready" if runtime.model is not None else "loading",
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "dimensions": DIMENSIONS,
        "metal": mx.default_device() == mx.gpu,
    }


@app.get("/v1/model")
def model_contract(authorization: str | None = Header(default=None)) -> dict[str, object]:
    return healthz(authorization)


async def read_bounded_body(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="image payload is too large")
    if not body:
        raise HTTPException(status_code=413, detail="image payload is empty")
    return bytes(body)


@app.post("/v1/embeddings/image")
async def embed_image(
    request: Request,
    authorization: str | None = Header(default=None),
    x_embedding_dimensions: int | None = Header(default=None),
) -> dict[str, object]:
    require_token(authorization)
    if x_embedding_dimensions != DIMENSIONS:
        raise HTTPException(status_code=409, detail="embedding dimension contract mismatch")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="unsupported image content type")
    body = await read_bounded_body(request)
    try:
        with Image.open(io.BytesIO(body), formats=ALLOWED_IMAGE_FORMATS) as probe:
            probe.verify()
        with Image.open(io.BytesIO(body), formats=ALLOWED_IMAGE_FORMATS) as opened:
            image = opened.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise HTTPException(status_code=422, detail="invalid image payload") from error
    if runtime.model is None or runtime.processor is None:
        raise HTTPException(status_code=503, detail="model is not ready")
    with runtime.lock:
        output = runtime.model.process([{"image": image}], processor=runtime.processor)
        mx.eval(output)
        vector = project_mrl(output[0].tolist(), DIMENSIONS)
    return {
        "embedding": vector,
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "dimensions": DIMENSIONS,
        "normalized": True,
    }


@app.post("/v1/embeddings/text")
async def embed_text(
    input: TextEmbeddingInput,
    authorization: str | None = Header(default=None),
    x_embedding_dimensions: int | None = Header(default=None),
) -> dict[str, object]:
    require_token(authorization)
    if x_embedding_dimensions != DIMENSIONS:
        raise HTTPException(status_code=409, detail="embedding dimension contract mismatch")
    if runtime.model is None or runtime.processor is None:
        raise HTTPException(status_code=503, detail="model is not ready")
    with runtime.lock:
        output = runtime.model.process([{"text": input.text}], processor=runtime.processor)
        mx.eval(output)
        vector = project_mrl(output[0].tolist(), DIMENSIONS)
    return {
        "embedding": vector,
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "dimensions": DIMENSIONS,
        "normalized": True,
    }
