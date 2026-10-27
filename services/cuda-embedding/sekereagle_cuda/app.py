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
from pydantic import BaseModel, Field, ValidationError

MODEL_ID = "Qwen/Qwen3-VL-Embedding-2B"
MODEL_REVISION = "9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda"
DIMENSIONS = 1024
MAX_BODY_BYTES = 20 * 1024 * 1024


class TextInput(BaseModel):
    text: str = Field(min_length=1, max_length=4096)


def create_app(engine, token: str, limit: int = 3, batch_size: int = 4) -> FastAPI:
    """Inject an already verified backend; never load CUDA in the HTTP event loop."""
    if len(token) < 16 or type(limit) is not int or not 1 <= limit <= 8 or type(batch_size) is not int or not 1 <= batch_size <= 4:
        raise ValueError("invalid CUDA host configuration")
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cuda-inference")
    active = 0
    pending = asyncio.Queue()

    @asynccontextmanager
    async def lifespan(_):
        worker = asyncio.create_task(run_batches())
        try:
            yield
        finally:
            await pending.join()
            worker.cancel()
            try:
                await worker
            except asyncio.CancelledError:
                pass
            await asyncio.to_thread(executor.shutdown, wait=True)

    app = FastAPI(title="SekerEagle CUDA Executor", lifespan=lifespan)

    def authorized(value):
        if not value or not hmac.compare_digest(value.encode("utf-8"), ("Bearer " + token).encode("utf-8")):
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
                "memory": engine.memory(), "batchSize": batch_size}

    def check_dimensions(value):
        if value != DIMENSIONS:
            raise HTTPException(409, "embedding dimension contract mismatch")

    async def read_body(request, maximum):
        body = bytearray()
        try:
            async with asyncio.timeout(30):
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > maximum:
                        raise HTTPException(413, "payload is too large")
        except TimeoutError as error:
            raise HTTPException(408, "upload timed out", headers={"Connection": "close"}) from error
        if not body:
            raise HTTPException(413, "payload is empty")
        return bytes(body)

    def decode(item):
        if isinstance(item.get("image"), bytes):
            try:
                with Image.open(io.BytesIO(item["image"]), formats=("JPEG", "PNG", "WEBP")) as probe:
                    probe.verify()
                with Image.open(io.BytesIO(item["image"]), formats=("JPEG", "PNG", "WEBP")) as opened:
                    return {"image": opened.convert("RGB")}
            except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
                raise HTTPException(422, "invalid image payload") from error
        return item

    def project(raw):
        if len(raw) != 2048:
            raise ValueError("unexpected model dimension")
        vector = [float(x) for x in raw[:DIMENSIONS]]
        norm = math.sqrt(sum(x*x for x in vector))
        if not math.isfinite(norm) or norm <= 1e-12:
            raise ValueError("invalid model vector")
        return {**contract(), "normalized": True, "embedding": [x/norm for x in vector]}

    def infer_many(items):
        started = time.monotonic()
        results = [None] * len(items)
        valid, positions = [], []
        for index, item in enumerate(items):
            try:
                valid.append(decode(item))
                positions.append(index)
            except Exception as error:
                results[index] = error
        try:
            if valid:
                vectors = engine.infer_batch(valid) if hasattr(engine, "infer_batch") else [engine.infer(item) for item in valid]
                if len(vectors) != len(valid):
                    raise ValueError("model batch dimension mismatch")
                for index, vector in zip(positions, vectors, strict=True):
                    results[index] = project(vector)
        except Exception as error:
            for index in positions:
                results[index] = error
        return results, (time.monotonic()-started)*1000/max(1,len(valid))

    async def run_batches():
        loop = asyncio.get_running_loop()
        while True:
            batch = [await pending.get()]
            if batch_size > 1:
                await asyncio.sleep(0.01)
                while len(batch) < batch_size and not pending.empty():
                    batch.append(pending.get_nowait())
            try:
                results, elapsed = await loop.run_in_executor(executor, infer_many, [item for item, _ in batch])
                for (_, future), result in zip(batch, results, strict=True):
                    if not future.cancelled():
                        if isinstance(result, Exception):
                            future.set_exception(result)
                        else:
                            future.set_result((result, elapsed))
            except Exception as error:
                for _, future in batch:
                    if not future.done():
                        future.set_exception(error)
            finally:
                for _ in batch:
                    release()
                    pending.task_done()

    async def submit(item, response):
        future = asyncio.get_running_loop().create_future()
        # Retrieve exceptions even if the client abandons the shielded result.
        future.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        pending.put_nowait((item, future))
        try:
            result, elapsed = await asyncio.shield(future)
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(500, "embedding computation failed") from error
        response.headers["Server-Timing"] = f"infer;dur={elapsed:.3f}"
        return result

    @app.post("/v1/embeddings/text")
    async def text(request: Request, response: Response, authorization: str | None = Header(default=None),
                   x_embedding_dimensions: int | None = Header(default=None)):
        authorized(authorization)
        check_dimensions(x_embedding_dimensions)
        admit()
        try:
            try:
                input = TextInput.model_validate_json(await read_body(request, 16384))
            except ValidationError as error:
                raise HTTPException(422, "invalid text payload") from error
        except BaseException:
            release()
            raise
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
            body = await read_body(request, MAX_BODY_BYTES)
            # PIL decode runs on the bounded executor too; health stays responsive.
            item = {"image": bytes(body)}
        except BaseException:
            release()
            raise
        return await submit(item, response)

    return app
