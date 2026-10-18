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

def infer(directory, image_path):
    directory = Path(directory)
    for name, expected in MODELS.items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != expected:
            raise ValueError("PHOTO_FACE_MODEL_CHECKSUM_MISMATCH")
    cv2.setNumThreads(1)
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None or image.shape[0] * image.shape[1] > 4_000_000:
        raise ValueError("PHOTO_FACE_INPUT_INVALID")
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(str(directory / "yunet.onnx"), "", (width, height), 0.9, 0.3, 128)
    recognizer = cv2.FaceRecognizerSF.create(str(directory / "sface.onnx"), "")
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
            faces.append({"box": [max(0, x / width), max(0, y / height), min(1, w / width), min(1, h / height)], "confidence": float(row[-1]), "embedding": (vector / norm).tolist()})
    return {"version": "yunet-2023mar-sface-2021dec-v1", "faces": faces}

if __name__ == "__main__":
    print(json.dumps(infer(sys.argv[1], sys.argv[2]), allow_nan=False))
