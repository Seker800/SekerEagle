import io

import mlx.core as mx
from fastapi.testclient import TestClient
from PIL import Image

from sekereagle_mlx import app as service


class FakeModel:
    def process(self, inputs, processor):
        assert len(inputs) == 1
        if "image" in inputs[0]:
            assert inputs[0]["image"].mode == "RGB"
        else:
            assert inputs[0]["text"] == "汽车"
        assert processor is not None
        return mx.array([[3.0, 4.0] + [0.0] * 2046])


def image_bytes(format: str = "JPEG") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(output, format=format)
    return output.getvalue()


def test_embedding_endpoint_is_authenticated_and_enforces_contract(monkeypatch):
    monkeypatch.setattr(service, "TOKEN", "test-secret")
    monkeypatch.setattr(service, "DIMENSIONS", 1024)
    service.runtime.model = FakeModel()
    service.runtime.processor = object()
    client = TestClient(service.app)

    unauthorized = client.post(
        "/v1/embeddings/image", content=image_bytes(), headers={"content-type": "image/jpeg"}
    )
    assert unauthorized.status_code == 401

    response = client.post(
        "/v1/embeddings/image",
        content=image_bytes(),
        headers={
            "authorization": "Bearer test-secret",
            "content-type": "image/jpeg",
            "x-embedding-dimensions": "1024",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["dimensions"] == 1024
    assert payload["embedding"][:2] == [0.6, 0.8]
    assert len(payload["embedding"]) == 1024


def test_embedding_endpoint_rejects_urls_and_dimension_drift(monkeypatch):
    monkeypatch.setattr(service, "TOKEN", "test-secret")
    service.runtime.model = FakeModel()
    service.runtime.processor = object()
    client = TestClient(service.app)
    headers = {"authorization": "Bearer test-secret", "x-embedding-dimensions": "2048"}

    response = client.post(
        "/v1/embeddings/image",
        content=b"https://example.invalid/image.jpg",
        headers={**headers, "content-type": "text/plain"},
    )
    assert response.status_code == 409


def test_health_model_and_text_endpoints_share_the_frozen_contract(monkeypatch):
    monkeypatch.setattr(service, "TOKEN", "test-secret")
    monkeypatch.setattr(service, "DIMENSIONS", 1024)
    service.runtime.model = FakeModel()
    service.runtime.processor = object()
    client = TestClient(service.app)
    headers = {
        "authorization": "Bearer test-secret",
        "x-embedding-dimensions": "1024",
    }

    assert client.get("/health/live", headers=headers).json() == {"status": "live"}
    assert client.get("/health/ready", headers=headers).json()["dimensions"] == 1024
    assert client.get("/v1/model", headers=headers).json()["model"] == service.MODEL_ID
    payload = client.post("/v1/embeddings/text", json={"text": "汽车"}, headers=headers).json()
    assert payload["embedding"][:2] == [0.6, 0.8]


def test_idle_health_does_not_load_the_model(monkeypatch):
    monkeypatch.setattr(service, "TOKEN", "test-secret")
    service.runtime.model = None
    service.runtime.processor = None
    loaded = []
    monkeypatch.setattr(service, "load_runtime", lambda: loaded.append(True))
    client = TestClient(service.app)

    payload = client.get(
        "/health/ready", headers={"authorization": "Bearer test-secret"}
    ).json()

    assert payload["status"] == "ready"
    assert payload["modelState"] == "idle"
    assert loaded == []


def test_first_embedding_request_lazy_loads_once(monkeypatch):
    monkeypatch.setattr(service, "TOKEN", "test-secret")
    monkeypatch.setattr(service, "DIMENSIONS", 1024)
    service.runtime.model = None
    service.runtime.processor = None
    loads = []

    def fake_load():
        loads.append(True)
        service.runtime.model = FakeModel()
        service.runtime.processor = object()

    monkeypatch.setattr(service, "load_runtime", fake_load)
    monkeypatch.setattr(service, "schedule_idle_unload", lambda: None)
    client = TestClient(service.app)
    headers = {
        "authorization": "Bearer test-secret",
        "x-embedding-dimensions": "1024",
    }

    first = client.post("/v1/embeddings/text", json={"text": "汽车"}, headers=headers)
    second = client.post("/v1/embeddings/text", json={"text": "汽车"}, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert len(loads) == 1


def test_idle_model_can_be_unloaded_without_stopping_the_service(monkeypatch):
    service.runtime.model = FakeModel()
    service.runtime.processor = object()
    service.runtime.last_used_at = 100.0
    monkeypatch.setattr(service, "IDLE_UNLOAD_SECONDS", 900)
    monkeypatch.setattr(service.time, "monotonic", lambda: 1000.0)
    cleared = []
    monkeypatch.setattr(service.mx, "clear_cache", lambda: cleared.append(True))

    assert service.unload_runtime_if_idle() is True
    assert service.runtime.model is None
    assert service.runtime.processor is None
    assert cleared == [True]


def test_streaming_image_limit_fails_before_accepting_an_oversized_body(monkeypatch):
    monkeypatch.setattr(service, "TOKEN", "test-secret")
    monkeypatch.setattr(service, "MAX_BODY_BYTES", 4)
    client = TestClient(service.app)
    response = client.post(
        "/v1/embeddings/image",
        content=b"12345",
        headers={
            "authorization": "Bearer test-secret",
            "content-type": "image/jpeg",
            "x-embedding-dimensions": "1024",
        },
    )
    assert response.status_code == 413


def test_embedding_endpoint_rejects_non_allowlisted_image_content(monkeypatch):
    monkeypatch.setattr(service, "TOKEN", "test-secret")
    monkeypatch.setattr(service, "DIMENSIONS", 1024)
    service.runtime.model = FakeModel()
    service.runtime.processor = object()
    client = TestClient(service.app)

    response = client.post(
        "/v1/embeddings/image",
        content=image_bytes("BMP"),
        headers={
            "authorization": "Bearer test-secret",
            "content-type": "image/jpeg",
            "x-embedding-dimensions": "1024",
        },
    )

    assert response.status_code == 422


def test_inference_keeps_event_loop_responsive_and_bounds_admission(monkeypatch):
    import asyncio
    import threading
    import time
    import httpx2

    monkeypatch.setattr(service, "TOKEN", "test-secret")
    monkeypatch.setattr(service, "schedule_idle_unload", lambda: None)
    active = 0
    maximum = 0
    threads = []

    class SlowModel(FakeModel):
        def process(self, inputs, processor):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            threads.append(threading.get_ident())
            time.sleep(0.15)
            active -= 1
            return super().process(inputs, processor)

    service.runtime.model = SlowModel()
    service.runtime.processor = object()

    async def exercise():
        transport = httpx2.ASGITransport(app=service.app)
        headers = {"authorization": "Bearer test-secret", "x-embedding-dimensions": "1024"}
        async with httpx2.AsyncClient(transport=transport, base_url="http://test") as client:
            started = time.monotonic()
            tasks = [asyncio.create_task(client.post("/v1/embeddings/image", content=image_bytes(), headers={**headers, "content-type": "image/jpeg"})) for _ in range(3)]
            await asyncio.sleep(0.03)
            assert time.monotonic() - started < 0.12, "inference must not block the HTTP event loop"
            health = await client.get("/health/live", headers=headers)
            assert health.status_code == 200
            busy = await client.post("/v1/embeddings/text", json={"text": "汽车"}, headers=headers)
            assert busy.status_code == 503
            assert busy.headers["retry-after"] == "1"
            assert all(r.status_code == 200 for r in await asyncio.gather(*tasks))
            recovered = await client.post("/v1/embeddings/text", json={"text": "汽车"}, headers=headers)
            assert recovered.status_code == 200

    asyncio.run(exercise())
    assert maximum == 1
    assert len(set(threads)) == 1
    assert threads[0] != threading.get_ident()


def test_cancelled_http_request_holds_capacity_until_compute_finishes(monkeypatch):
    import asyncio
    import threading
    import httpx2

    monkeypatch.setattr(service, "TOKEN", "test-secret")
    monkeypatch.setattr(service, "schedule_idle_unload", lambda: None)
    started = threading.Event()
    finish = threading.Event()

    class HeldModel(FakeModel):
        def process(self, inputs, processor):
            started.set()
            assert finish.wait(3)
            return super().process(inputs, processor)

    service.runtime.model = HeldModel()
    service.runtime.processor = object()

    async def exercise():
        headers = {"authorization": "Bearer test-secret", "x-embedding-dimensions": "1024"}
        async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=service.app), base_url="http://test") as client:
            tasks = [asyncio.create_task(client.post("/v1/embeddings/text", json={"text": "汽车"}, headers=headers)) for _ in range(3)]
            try:
                for _ in range(100):
                    if started.is_set():
                        break
                    await asyncio.sleep(0.005)
                assert started.is_set()
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                busy = await client.post("/v1/embeddings/text", json={"text": "汽车"}, headers=headers)
                assert busy.status_code == 503
            finally:
                finish.set()
            # All three callbacks must return their slot even though their callers left.
            for _ in range(100):
                if service.inference_slots._value == 3:
                    break
                await asyncio.sleep(0.01)
            assert service.inference_slots._value == 3
            assert (await client.post("/v1/embeddings/text", json={"text": "汽车"}, headers=headers)).status_code == 200

    asyncio.run(exercise())


def test_stalled_uploads_have_a_total_deadline_and_return_all_admission(monkeypatch):
    import asyncio
    import httpx2
    monkeypatch.setattr(service, "TOKEN", "test-secret")
    monkeypatch.setattr(service, "BODY_READ_TIMEOUT_SECONDS", 0.03, raising=False)
    class StalledBody(httpx2.AsyncByteStream):
        async def __aiter__(self):
            yield b"incomplete"
            await asyncio.Event().wait()
    async def exercise():
        headers = {"authorization": "Bearer test-secret", "content-type": "image/jpeg", "x-embedding-dimensions": "1024"}
        async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=service.app), base_url="http://test") as client:
            tasks = [asyncio.create_task(client.post("/v1/embeddings/image", content=StalledBody(), headers=headers)) for _ in range(2)]
            try:
                done, pending = await asyncio.wait(tasks, timeout=0.4)
                assert not pending, "an interrupted upload must not hold model admission indefinitely"
                assert [task.result().status_code for task in tasks] == [408, 408]
                assert (await client.get("/healthz", headers=headers)).json()["capacity"] == {"limit": 3, "inFlight": 0, "available": 3}
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    asyncio.run(exercise())


def test_health_reports_receiving_capacity_and_cancellation_returns_it(monkeypatch):
    import asyncio
    import httpx2
    monkeypatch.setattr(service, "TOKEN", "test-secret")
    class StalledBody(httpx2.AsyncByteStream):
        async def __aiter__(self):
            yield b"incomplete"
            await asyncio.Event().wait()
    async def exercise():
        headers = {"authorization": "Bearer test-secret", "content-type": "image/jpeg", "x-embedding-dimensions": "1024"}
        async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=service.app), base_url="http://test") as client:
            task = asyncio.create_task(client.post("/v1/embeddings/image", content=StalledBody(), headers=headers))
            try:
                await asyncio.sleep(.01)
                health = await client.get("/healthz", headers=headers)
                assert health.json().get("capacity") == {"limit": 3, "inFlight": 1, "available": 2}
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            assert (await client.get("/healthz", headers=headers)).json()["capacity"] == {"limit": 3, "inFlight": 0, "available": 3}
    asyncio.run(exercise())
