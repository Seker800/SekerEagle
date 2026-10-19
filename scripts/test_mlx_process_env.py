import importlib.util
from pathlib import Path
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('mlx_env', Path(__file__).with_name('mlx-process-env.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class MinimalEnvironmentTests(unittest.TestCase):
    def test_never_executes_dotenv_or_inherits_database_storage_or_jwt_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.env').write_text('DATABASE_URL=private\nJWT_SECRET=private\nS3_SECRET_ACCESS_KEY=private\nMLX_EMBEDDING_TOKEN="literal-$(do-not-run)"\n')
            result = module.process_environment(root, {'HOME': directory, 'DATABASE_URL':'inherited', 'JWT_SECRET':'inherited', 'S3_ACCESS_KEY_ID':'inherited'})
            self.assertEqual(result, {'HOME': directory, 'MLX_EMBEDDING_TOKEN':'literal-$(do-not-run)'})
    def test_token_file_is_private_and_overrides_the_legacy_dotenv_token(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            token = root / 'token'
            token.write_text('test-only')
            token.chmod(0o644)
            with self.assertRaises(ValueError):
                module.process_environment(root, {'MLX_EMBEDDING_TOKEN_FILE':str(token)})
            token.chmod(0o600)
            self.assertEqual(module.process_environment(root, {'MLX_EMBEDDING_TOKEN_FILE':str(token)})['MLX_EMBEDDING_TOKEN'], 'test-only')
