import importlib.util
from contextlib import ExitStack, redirect_stdout
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock
import numpy as np

spec = importlib.util.spec_from_file_location("face_infer", Path(__file__).with_name("infer.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FaceInputTests(unittest.TestCase):
    def invoke(self, shape):
        image = MagicMock()
        image.shape = shape
        detector = MagicMock()
        detector.detect.return_value = (None, None)
        with patch.object(module, "MODELS", {}), patch.object(module.cv2, "imread", return_value=image), patch.object(module.cv2.FaceDetectorYN, "create", return_value=detector) as create, patch.object(module.cv2.FaceRecognizerSF, "create"):
            result = module.infer("unused", "synthetic.jpg")
        return result, image, detector, create

    def test_panorama_uses_full_resolution(self):
        result, image, detector, create = self.invoke((1280, 3464, 3))
        self.assertEqual(result["faces"], [])
        detector.detect.assert_called_once_with(image)
        self.assertEqual(create.call_args.args[2], (3464, 1280))

    def test_pixel_boundary_keeps_full_input(self):
        self.invoke((5000, 8000, 3))
        with self.assertRaisesRegex(ValueError, "PHOTO_FACE_INPUT_TOO_LARGE"):
            self.invoke((5001, 8000, 3))

    def test_old_valid_input_is_unchanged(self):
        self.invoke((1000, 1000, 3))

    def test_corrupt_input_has_known_input_error(self):
        with patch.object(module, "MODELS", {}), patch.object(module.cv2, "imread", return_value=None):
            with self.assertRaisesRegex(ValueError, "PHOTO_FACE_INPUT_INVALID"):
                module.infer("unused", "corrupt.jpg")

class ServeProtocolTests(unittest.TestCase):
    def run_serve(self, requests, outcomes):
        stdout = io.StringIO()
        stdin = io.StringIO("".join(json.dumps(request) + "\n" for request in requests))
        detector = MagicMock()
        detector.detect.return_value = (None, None)
        with ExitStack() as stack:
            stack.enter_context(patch.object(module, "MODELS", {}))
            stack.enter_context(patch.object(module, "read_image", side_effect=outcomes))
            stack.enter_context(patch.object(module.cv2.FaceRecognizerSF, "create"))
            stack.enter_context(
                patch.object(module.cv2.FaceDetectorYN, "create", return_value=detector)
            )
            stack.enter_context(patch.object(module.sys, "stdin", stdin))
            stack.enter_context(redirect_stdout(stdout))
            module.serve("unused")
        return [json.loads(line) for line in stdout.getvalue().splitlines() if line]

    def test_serve_answers_each_request_and_survives_errors(self):
        replies = self.run_serve(
            [
                {"id": 1, "path": "ok.jpg"},
                {"id": 2, "path": "bad.jpg"},
                {"id": 3, "path": "boom.jpg"},
            ],
            [
                np.zeros((10, 20, 3), dtype=np.uint8),
                module.FaceInputError("PHOTO_FACE_INPUT_INVALID"),
                RuntimeError("inference crashed"),
            ],
        )
        self.assertEqual([reply["id"] for reply in replies], [1, 2, 3])
        self.assertEqual(replies[0]["version"], module.VERSION)
        self.assertEqual(replies[0]["faces"], [])
        self.assertEqual(replies[1]["error"], "PHOTO_FACE_INPUT_INVALID")
        self.assertEqual(replies[2]["error"], "PHOTO_FACE_INFRA_FAILURE")

if __name__ == "__main__":
    unittest.main()
