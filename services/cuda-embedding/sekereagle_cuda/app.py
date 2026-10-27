from __future__ import annotations

import asyncio
import hmac
import io
import math
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request, Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

MODEL_ID = "Qwen/Qwen3-VL-Embedding-2B"
MODEL_REVISION = "9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda"
DIMENSIONS = 1024
MAX_BODY_BYTES = 20 * 1024 * 1024


class TextInput(BaseModel):
    text: str = Field(min_length=1, max_length=4096)


def create_app(engine, token: str, limit: int = 3) -> FastAPI:
    """Inject an already verified backend; never load CUDA in the HTTP event loop."""
    if len(token) < 16 or type(limit) is not int or not 1 <= limit <= 8:
        raise ValueError("invalid CUDA host configuration")
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cuda-inference")
    active = 0

    @asynccontextmanager
    async def lifespan(_):
        yield
        # Completion, including abandoned requests, retains its slot until GPU work ends.
        await asyncio.to_thread(executor.shutdown, wait=True)

    app = FastAPI(title="SekerEagle CUDA Executor", lifespan=lifespan)

    def authorized(value):
        if not value or not hmac.compare_digest(value, "Bearer " + token):
            raise HTTPException(401, "unauthorized")

    def admit():
        nonlocal active
        if active >= limit:
            raise HTTPException(503, "inference capacity is busy", headers={"Retry-After": "1"})
        active += 1

    def release():
        nonlocal active
        active -= 1

    def contract():
        return {"model": MODEL_ID, "revision": MODEL_REVISION, "dimensions": DIMENSIONS}

    @app.get("/health/live")
    def live(authorization: str | None = Header(default=None)):
        authorized(authorization)
        return {"status": "live"}

    @app.get("/healthz")
    @app.get("/health/ready")
    @app.get("/v1/model")
    async def health(authorization: str | None = Header(default=None)):
        authorized(authorization)
        return {**contract(), "status": "ready", "accelerator": "cuda", "modelState": "loaded",
                "capacity": {"limit": limit, "inFlight": active, "available": limit - active},
                "memory": engine.memory()}

    def check_dimensions(value):
        if value != DIMENSIONS:
            raise HTTPException(409, "embedding dimension contract mismatch")

    def infer(item):
        started = time.monotonic()
        if isinstance(item.get("image"), bytes):
            try:
                with Image.open(io.BytesIO(item["image"]), formats=("JPEG", "PNG", "WEBP")) as probe:
                    probe.verify()
                with Image.open(io.BytesIO(item["image"]), formats=("JPEG", "PNG", "WEBP")) as opened:
                    item = {"image": opened.convert("RGB")}
            except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
                raise HTTPException(422, "invalid image payload") from error
        raw = engine.infer(item)
        if len(raw) != 2048:
            raise ValueError("unexpected model dimension")
        vector = [float(x) for x in raw[:DIMENSIONS]]
        norm = math.sqrt(sum(x*x for x in vector))
        if not math.isfinite(norm) or norm <= 1e-12:
            raise ValueError("invalid model vector")
        return {**contract(), "normalized": True, "embedding": [x/norm for x in vector]}, (time.monotonic()-started)*1000

    async def submit(item, response):
        loop = asyncio.get_running_loop()
        try:
            future = executor.submit(infer, item)
        except BaseException:
            release()
            raise
        future.add_done_callback(lambda _: loop.call_soon_threadsafe(release))
        try:
            result, elapsed = await asyncio.shield(asyncio.wrap_future(future))
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(500, "embedding computation failed") from error
        response.headers["Server-Timing"] = f"infer;dur={elapsed:.3f}"
        return result

    @app.post("/v1/embeddings/text")
    async def text(input: TextInput, response: Response, authorization: str | None = Header(default=None),
                   x_embedding_dimensions: int | None = Header(default=None)):
        authorized(authorization)
        check_dimensions(x_embedding_dimensions)
        admit()
        return await submit({"text": input.text}, response)

    @app.post("/v1/embeddings/image")
    async def image(request: Request, response: Response, authorization: str | None = Header(default=None),
                    x_embedding_dimensions: int | None = Header(default=None)):
        authorized(authorization)
        check_dimensions(x_embedding_dimensions)
        if request.headers.get("content-type", "").split(";")[0] not in ("image/jpeg", "image/png", "image/webp"):
            raise HTTPException(415, "unsupported image type")
        admit()
        try:
            body = bytearray()
            try:
                async with asyncio.timeout(30):
                    async for chunk in request.stream():
                        body.extend(chunk)
                        if len(body) > MAX_BODY_BYTES:
                            raise HTTPException(413, "image payload is too large")
            except TimeoutError as error:
                raise HTTPException(408, "image upload timed out", headers={"Connection": "close"}) from error
            if not body:
                raise HTTPException(413, "image payload is empty")
            # PIL decode runs on the bounded executor too; health stays responsive.
            item = {"image": bytes(body)}
        except BaseException:
            release()
            raise
        return await submit(item, response)

    return app
