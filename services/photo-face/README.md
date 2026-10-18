# Local photo face inference

The worker invokes `infer.py` as a bounded subprocess against its generated preview,
never the original file or a URL. The subprocess receives no database, S3 or session
credentials. It has no network calls. CPU threads, image size, response size and run
time are bounded. Each result identifies the exact detector/recognizer version.

Install a Python 3.11 environment using `requirements.txt`, then run
`node scripts/download-photo-face-models.mjs`. This downloads pinned OpenCV Zoo
weights and their license files into ignored `.runtime/photo-face/models`, checking
the published Git LFS SHA-256 for each model. Set `PHOTO_FACE_PYTHON` to the Python
executable and `PHOTO_FACE_MODEL_DIR` to that directory in both API and worker.
`PHOTO_FACE_SCRIPT` can override the worker's repository-relative inference script.

Container users can include `deploy/mac/docker-compose.photo-face.yml` alongside
the existing compose file. It builds the optional Python environment and mounts the
already downloaded weights read-only. It does not download models during startup.
No production deployment is performed by these instructions.

The YuNet 2023 March model is distributed by OpenCV Zoo under MIT; SFace 2021
December under Apache-2.0. OpenCV and NumPy retain their own licenses. Weight hashes
and upstream revision are in the download script; weights are not committed.
Sources:

- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface

Automatic clustering uses a conservative cosine threshold of 0.45 and does not
assign two detections from the same photo to the same person. Names, merges and
manual corrections survive replay of the same model version. Recognition is a
suggestion; the UI supports renaming, merging and splitting mistaken matches.
The small public sample smoke test is not an accuracy benchmark.
