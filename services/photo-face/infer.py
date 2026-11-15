"""Local-only YuNet/SFace inference. No network, database or object-store access."""
import hashlib
import json
from pathlib import Path
import sys
import cv2
import numpy as np

MODELS = {
    "yunet.onnx": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    "sface.onnx": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
}

MAX_IMAGE_PIXELS = 40_000_000
VERSION = "yunet-2023mar-sface-2021dec-v1"


class FaceInputError(ValueError):
    """A permanent input error, never a model or execution failure."""


def verify_models(directory):
    directory = Path(directory)
    for name, expected in MODELS.items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != expected:
            raise ValueError("PHOTO_FACE_MODEL_CHECKSUM_MISMATCH")
    return directory


def read_image(image_path):
    try:
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    except cv2.error as error:
        if "CV_IO_MAX_IMAGE_PIXELS" in str(error):
            raise FaceInputError("PHOTO_FACE_INPUT_TOO_LARGE") from error
        raise
    if image is None:
        raise FaceInputError("PHOTO_FACE_INPUT_INVALID")
    height, width = image.shape[:2]
    if height * width > MAX_IMAGE_PIXELS:
        raise FaceInputError("PHOTO_FACE_INPUT_TOO_LARGE")
    return image


def detect_faces(detector, recognizer, image):
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, detections = detector.detect(image)
    faces = []
    if detections is not None:
        for row in detections[:128]:
            aligned = recognizer.alignCrop(image, row)
            vector = recognizer.feature(aligned).flatten().astype(float)
            norm = np.linalg.norm(vector)
            if norm <= 0 or not np.isfinite(vector).all():
                continue
            x, y, w, h = row[:4].astype(float)
            faces.append({
                "box": [
                    max(0, x / width),
                    max(0, y / height),
                    min(1, w / width),
                    min(1, h / height),
                ],
                "confidence": float(row[-1]),
                "embedding": (vector / norm).tolist(),
            })
    return faces


def infer(directory, image_path):
    """One-shot compatibility path used by the Python unit tests."""
    directory = verify_models(directory)
    cv2.setNumThreads(1)
    image = read_image(image_path)
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(
        str(directory / "yunet.onnx"), "", (width, height), 0.9, 0.3, 128
    )
    recognizer = cv2.FaceRecognizerSF.create(str(directory / "sface.onnx"), "")
    return {"version": VERSION, "faces": detect_faces(detector, recognizer, image)}


def serve(directory):
    """Long-lived worker: verify/load models once and answer one JSON request per line."""
    directory = verify_models(directory)
    cv2.setNumThreads(1)
    recognizer = cv2.FaceRecognizerSF.create(str(directory / "sface.onnx"), "")
    detector = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            image = read_image(request["path"])
            if detector is None:
                height, width = image.shape[:2]
                detector = cv2.FaceDetectorYN.create(
                    str(directory / "yunet.onnx"), "", (width, height), 0.9, 0.3, 128
                )
            faces = detect_faces(detector, recognizer, image)
            print(
                json.dumps({"id": request_id, "version": VERSION, "faces": faces}, allow_nan=False),
                flush=True,
            )
        except FaceInputError as error:
            print(json.dumps({"id": request_id, "error": str(error)}), flush=True)
        except Exception:
            print(json.dumps({"id": request_id, "error": "PHOTO_FACE_INFRA_FAILURE"}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 2:
        try:
            serve(sys.argv[1])
        except ValueError as error:
            print(str(error), file=sys.stderr)
            sys.exit(1)
    elif len(sys.argv) == 3:
        try:
            print(json.dumps(infer(sys.argv[1], sys.argv[2]), allow_nan=False))
        except FaceInputError as error:
            print(str(error), file=sys.stderr)
            sys.exit(2)
    else:
        print("usage: infer.py <model-dir> [image]", file=sys.stderr)
        sys.exit(64)
