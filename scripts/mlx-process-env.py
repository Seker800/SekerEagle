"""Launch MLX with a literal, minimal environment; never source application secrets."""
import os
from pathlib import Path
import sys

MLX_KEYS = {'MLX_EMBEDDING_TOKEN', 'MLX_EMBEDDING_MODEL', 'MLX_EMBEDDING_REVISION',
            'MLX_EMBEDDING_DIMENSIONS', 'MLX_EMBEDDING_MAX_PAYLOAD_BYTES',
            'MLX_EMBEDDING_IDLE_UNLOAD_SECONDS', 'MLX_EMBEDDING_CACHE_LIMIT_BYTES'}
SYSTEM_KEYS = {'HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'HF_HOME', 'HF_HUB_OFFLINE', 'UV_CACHE_DIR'}


def process_environment(root, inherited):
    result = {key: value for key, value in inherited.items() if key in SYSTEM_KEYS}
    config = root / '.env'
    if config.is_file():
        for line in config.read_text().splitlines():
            key, separator, value = line.partition('=')
            key = key.strip()
            if separator and key in MLX_KEYS:
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                result[key] = value
    result.update({key: value for key, value in inherited.items() if key in MLX_KEYS})
    token_file = inherited.get('MLX_EMBEDDING_TOKEN_FILE')
    if token_file:
        path = Path(token_file)
        # Backward compatibility with the former plist: read only the literal token above.
        if path.resolve() != config.resolve():
            if path.is_symlink() or path.stat().st_mode & 0o077:
                raise ValueError('MLX token file must be private and not a symlink')
            result['MLX_EMBEDDING_TOKEN'] = path.read_text().strip()
    return result


def main():
    root, uv, action = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    arguments = {'setup': ['sync', '--frozen'], 'test': ['run', '--frozen', 'pytest'],
                 'run': ['run', '--frozen', 'uvicorn', 'sekereagle_mlx.app:app', '--host', '0.0.0.0', '--port', '11435']}[action]
    os.chdir(root / 'services/mlx-embedding')
    os.execve(uv, [uv, *arguments], process_environment(root, os.environ))


if __name__ == '__main__':
    main()
