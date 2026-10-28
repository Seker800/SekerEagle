import importlib.util
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

if __name__ == "__main__":
    unittest.main()
