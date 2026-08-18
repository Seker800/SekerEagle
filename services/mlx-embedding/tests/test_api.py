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


def image_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(output, format="JPEG")
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
