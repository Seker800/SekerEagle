#!/usr/bin/env python3
"""Verify an existing plain generation without changing its files or evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path

from plain_nas import MARKER, expected_files, generation_path, stamp


def verify_readonly(root, generation, progress=None):
    path = generation_path(root, generation)
    marker = path / '.owner-marker'
    if marker.is_symlink() or marker.read_text() != MARKER:
        raise ValueError('Unknown generation')
    for name in ['manifest.json', 'verified.json']:
        if (path / name).is_symlink():
            raise ValueError('Unsafe backup evidence')
    manifest_data = (path / 'manifest.json').read_bytes()
    digest = hashlib.sha256(manifest_data).hexdigest()
    evidence = json.loads((path / 'verified.json').read_text())
    if evidence.get('generation') != generation or evidence.get('manifestSha256') != digest:
        raise ValueError('Published manifest changed')
    expected = expected_files(json.loads(manifest_data))
    # Check directory links before opening any nested path.
    for folder, directories, files in os.walk(str(path), followlinks=False):
        for name in directories:
            if (Path(folder) / name).is_symlink():
                raise ValueError('Missing or unsafe backup directory')
        for name in files:
            file = Path(folder) / name
            relative = file.relative_to(path).as_posix()
            if file.is_symlink():
                raise ValueError('Missing or unsafe backup file')
            if relative not in expected and relative not in (
                '.owner-marker', 'manifest.json', 'verified.json'
            ):
                raise ValueError('Unexpected backup file')
    count = size = 0
    for name, (expected_digest, length) in expected.items():
        file = path / name
        if not file.is_file() or file.is_symlink():
            raise ValueError('Missing or unsafe backup file')
        hashed = hashlib.sha256()
        with file.open('rb') as source:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                hashed.update(block)
        if hashed.hexdigest() != expected_digest or (
            length is not None and file.stat().st_size != length
        ):
            raise ValueError('Backup integrity mismatch')
        if name.startswith('objects/'):
            count += 1
            size += length
            if progress and count % 10000 == 0:
                progress({'objects': count, 'bytes': size})
    if evidence.get('objects') != count or evidence.get('bytes') != size:
        raise ValueError('Backup totals changed')
    return {'generation': generation, 'manifestSha256': digest,
            'objects': count, 'bytes': size, 'checkedAt': stamp()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('generation')
    args = parser.parse_args()
    print(json.dumps(verify_readonly(args.root, args.generation,
                                   lambda value: print(json.dumps(value), flush=True))), flush=True)
