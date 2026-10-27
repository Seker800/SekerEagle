import io
import math
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from sekereagle_cuda.app import create_app


class Engine:
    def infer(self, item):
        assert set(item) in ({"image"}, {"text"})
        if "image" in item:
            assert item["image"].mode == "RGB"
        return [3.0, 4.0] + [0.0] * 2046

    def memory(self):
        return {"activeBytes": 100}


HEADERS = {"authorization": "Bearer isolated-test-token", "x-embedding-dimensions": "1024"}


def image():
    out = io.BytesIO()
    Image.new("RGBA", (32, 48), "red").save(out, "PNG")
    return out.getvalue()


def test_contract_authentication_and_projection():
    with TestClient(create_app(Engine(), "isolated-test-token", 2)) as client:
        assert client.get("/healthz").status_code == 401
        health = client.get("/healthz", headers=HEADERS).json()
        assert health["accelerator"] == "cuda"
        assert "metal" not in health
        assert health["revision"] == "9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda"
        assert health["capacity"] == {"limit": 2, "inFlight": 0, "available": 2}
        for path in ["/health/live", "/health/ready", "/v1/model"]:
            assert client.get(path, headers=HEADERS).status_code == 200
        result = client.post("/v1/embeddings/image", content=image(), headers={**HEADERS, "content-type": "image/png"})
        assert result.status_code == 200
        vector = result.json()["embedding"]
        assert len(vector) == 1024 and vector[:2] == [0.6, 0.8]
        assert math.isclose(sum(x*x for x in vector), 1)
        assert "infer;dur=" in result.headers["server-timing"]
        assert client.post("/v1/embeddings/text", json={"text": "汽车"}, headers=HEADERS).status_code == 200


@pytest.mark.parametrize("headers,body,status", [
    ({"x-embedding-dimensions": "2048", "content-type": "image/png"}, image(), 409),
    ({"content-type": "text/plain"}, b"https://example.invalid/a", 415),
    ({"content-type": "image/png"}, b"bad image", 422),
    ({"content-type": "image/png"}, b"", 413),
])
def test_invalid_requests_release_admission(headers, body, status):
    with TestClient(create_app(Engine(), "isolated-test-token", 1)) as client:
        assert client.post("/v1/embeddings/image", content=body, headers={**HEADERS, **headers}).status_code == status
        assert client.get("/healthz", headers=HEADERS).json()["capacity"]["inFlight"] == 0


@pytest.mark.parametrize("vector", [[0.0]*2048, [float("nan")]*2048, [1.0]*12])
def test_invalid_model_vectors_fail_closed(vector):
    engine = Engine()
    engine.infer = lambda _: vector
    with TestClient(create_app(engine, "isolated-test-token", 1), raise_server_exceptions=False) as client:
        assert client.post("/v1/embeddings/text", json={"text": "car"}, headers=HEADERS).status_code == 500
        assert client.get("/healthz", headers=HEADERS).json()["capacity"]["inFlight"] == 0


def test_busy_model_does_not_block_health_and_releases_only_when_done():
    started, finish = threading.Event(), threading.Event()
    engine = Engine()
    def infer(_):
        started.set()
        assert finish.wait(5)
        return [1.0]*2048
    engine.infer = infer
    with TestClient(create_app(engine, "isolated-test-token", 1)) as client, ThreadPoolExecutor(1) as pool:
        pending = pool.submit(client.post, "/v1/embeddings/text", json={"text": "car"}, headers=HEADERS)
        try:
            assert started.wait(2)
            assert client.get("/healthz", headers=HEADERS).json()["capacity"]["inFlight"] == 1
            response = client.post("/v1/embeddings/text", json={"text": "car"}, headers=HEADERS)
            assert response.status_code == 503 and response.headers["retry-after"] == "1"
        finally:
            finish.set()
        assert pending.result().status_code == 200


@pytest.mark.parametrize("limit", [0, 9, True])
def test_capacity_configuration_is_bounded(limit):
    with pytest.raises(ValueError):
        create_app(Engine(), "isolated-test-token", limit)
