#!/usr/bin/env python3
"""NAS-local plaintext receiver and one-time restic conversion (Python 3.8+)."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
from datetime import datetime, timezone

ROOT = Path("/volume1/homes/seker/sekereagle-backup")
MARKER = "sekereagle-independent-backup-v1"
FILES = {
    "database.dump",
    "globals.sql",
    "deployment.env",
    "deployment.json",
    "source.tar.gz",
}


def stamp():
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def atomic(path, value):
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w") as file:
        os.fchmod(file.fileno(), 0o600)
        json.dump(value, file)
        file.flush()
        os.fsync(file.fileno())
    os.replace(str(temp), str(path))


def guard(root):
    if (
        root.is_symlink()
        or not (root / "owner-marker").is_file()
        or (root / "owner-marker").read_text().strip() != MARKER
    ):
        raise ValueError("Unknown backup root")


def generation_path(root, generation):
    guard(root)
    if not re.fullmatch("[a-f0-9]{32,64}", generation):
        raise ValueError("Invalid generation")
    parent = root / "generations"
    if parent.is_symlink():
        raise ValueError("Unsafe generations directory")
    path = parent / generation
    if path.is_symlink():
        raise ValueError("Unsafe generation directory")
    return path


def object_name(key):
    if (
        not isinstance(key, str)
        or not key
        or "\\" in key
        or "\0" in key
        or any(p in ("", ".", "..") for p in key.split("/"))
    ):
        raise ValueError("Unsafe object key")
    return "objects/" + key


def expected_files(manifest):
    if manifest.get("formatVersion") != 1 or set(manifest.get("files", {})) != FILES:
        raise ValueError("Incomplete manifest")
    expected = {name: (digest, None) for name, digest in manifest["files"].items()}
    objects = manifest.get("objects", [])
    for entry in objects:
        name = object_name(entry["key"])
        if name in expected or not isinstance(entry["size"], int) or entry["size"] < 0:
            raise ValueError("Duplicate or invalid object")
        expected[name] = (entry["sha256"], entry["size"])
    return expected


def progress(root, phase, count=0, size=0):
    atomic(
        root / "operation-status.json",
        {
            "status": "running",
            "phase": phase,
            "objects": count,
            "bytes": size,
            "updatedAt": stamp(),
        },
    )


def receive(root, generation, source):
    path = generation_path(root, generation)
    path.mkdir(parents=True, mode=0o700)
    root.chmod(0o700)
    path.parent.chmod(0o700)
    path.chmod(0o700)
    (path / ".owner-marker").write_text(MARKER)
    (path / ".owner-marker").chmod(0o600)
    actual = {}
    manifest = None
    count = size = 0
    with tarfile.open(fileobj=source, mode="r|") as archive:
        for member in archive:
            name = member.name
            if not member.isfile() or manifest is not None:
                raise ValueError("Unexpected archive entry")
            if name != "manifest.json" and name not in FILES:
                if not name.startswith("objects/") or object_name(name[8:]) != name:
                    raise ValueError("Unexpected archive path")
            if name in actual:
                raise ValueError("Duplicate archive entry")
            file = archive.extractfile(member)
            if name == "manifest.json":
                manifest = json.load(file)
                atomic(path / name, manifest)
                continue
            target = path / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            digest = hashlib.sha256()
            with target.open("xb") as output:
                os.fchmod(output.fileno(), 0o600)
                while True:
                    block = file.read(1024 * 1024)
                    if not block:
                        break
                    output.write(block)
                    digest.update(block)
            actual[name] = (digest.hexdigest(), member.size)
            if name.startswith("objects/"):
                count += 1
                size += member.size
                if count % 1000 == 0:
                    progress(root, "extracting", count, size)
    if manifest is None:
        raise ValueError("Missing final manifest")
    expected = expected_files(manifest)
    if set(actual) != set(expected) or any(
        actual[n][0] != d or (s is not None and actual[n][1] != s)
        for n, (d, s) in expected.items()
    ):
        raise ValueError("Archive integrity mismatch")
    # Receipt is deliberately absent until a separate on-disk verification passes.
    return {"objects": count, "bytes": size}


def verify(root, generation):
    path = generation_path(root, generation)
    if (path / ".owner-marker").read_text() != MARKER:
        raise ValueError("Unknown generation")
    (path / "verified.json").unlink(missing_ok=True)
    manifest = json.loads((path / "manifest.json").read_text())
    expected = expected_files(manifest)
    count = size = 0
    for name, (digest, length) in expected.items():
        file = path / name
        if file.is_symlink() or not file.is_file():
            raise ValueError("Missing or unsafe backup file")
        hashed = hashlib.sha256()
        with file.open("rb") as source:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                hashed.update(block)
        if hashed.hexdigest() != digest or (
            length is not None and file.stat().st_size != length
        ):
            raise ValueError("On-disk integrity mismatch")
        if name.startswith("objects/"):
            count += 1
            size += length
            if count % 1000 == 0:
                progress(root, "verifying", count, size)
    # Reject extra files and symlinks, including directory symlinks.
    for folder, directories, files in os.walk(str(path), followlinks=False):
        for name in directories:
            if (Path(folder) / name).is_symlink():
                raise ValueError("Unsafe directory symlink")
        for name in files:
            relative = (Path(folder) / name).relative_to(path).as_posix()
            if relative not in expected and relative not in (
                ".owner-marker",
                "manifest.json",
            ):
                raise ValueError("Unexpected backup file")
    result = {
        "format": "plain-directory-v1",
        "generation": generation,
        "objects": count,
        "bytes": size,
        "verifiedAt": stamp(),
        "manifestSha256": hashlib.sha256(
            (path / "manifest.json").read_bytes()
        ).hexdigest(),
    }
    atomic(path / "verified.json", result)
    return result


def receipt(root, generation):
    path = generation_path(root, generation)
    value = json.loads((path / "verified.json").read_text())
    if (
        value.get("format") != "plain-directory-v1"
        or value.get("generation") != generation
        or value.get("manifestSha256")
        != hashlib.sha256((path / "manifest.json").read_bytes()).hexdigest()
    ):
        raise ValueError("Unverified generation")
    return value


def current_generation(root):
    guard(root)
    link = root / "current"
    if not link.is_symlink():
        raise ValueError("Missing plaintext current generation")
    target = os.readlink(str(link))
    generation = (
        target[len("generations/") :] if target.startswith("generations/") else ""
    )
    if target != "generations/" + generation:
        raise ValueError("Unsafe current pointer")
    generation_path(root, generation)
    return generation


def publish(root, generation):
    try:
        result = receipt(root, generation)
    except (OSError, KeyError, json.JSONDecodeError) as error:
        raise ValueError("Unverified generation") from error
    current = root / "current"
    if current.exists() or current.is_symlink():
        receipt(root, current_generation(root))
    temporary = root / ".current-next"
    temporary.unlink(missing_ok=True)
    temporary.symlink_to("generations/" + generation)
    os.replace(str(temporary), str(current))
    directory = os.open(str(root), os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return result


def prune(root):
    keep = current_generation(root)
    receipt(root, keep)
    candidates = []
    for path in (root / "generations").iterdir():
        generation_path(root, path.name)
        if (
            not path.is_dir()
            or not (path / ".owner-marker").is_file()
            or (path / ".owner-marker").read_text() != MARKER
        ):
            raise ValueError("Unknown directory; retention refused")
        if path.name != keep:
            candidates.append(path)
    for path in candidates:
        shutil.rmtree(str(path))


def retire(root):
    receipt(root, current_generation(root))
    repository = root / "repository"
    if repository.is_symlink():
        raise ValueError("Unsafe legacy repository")
    retired = root / ".retired-encrypted-repository"
    marker = root / ".encrypted-retirement-owner"
    if repository.exists():
        if not (repository / "config").is_file() or retired.exists():
            raise ValueError("Unknown legacy repository")
        marker.write_text(MARKER)
        os.replace(str(repository), str(retired))
    if retired.exists():
        if retired.is_symlink() or not marker.is_file() or marker.read_text() != MARKER:
            raise ValueError("Unknown retirement directory")
        shutil.rmtree(str(retired))
    marker.unlink(missing_ok=True)
    for name in (".conversion-password",):
        (root / name).unlink(missing_ok=True)
    shutil.rmtree(str(root / ".conversion-cache"), ignore_errors=True)
    binary = root / "tools/restic-linux-amd64"
    binary.unlink(missing_ok=True)


def convert(root, generation):
    guard(root)
    progress(root, "starting-conversion")
    command = [
        str(root / "tools/restic-linux-amd64"),
        "-r",
        str(root / "repository"),
        "--password-file",
        str(root / ".conversion-password"),
        "--cache-dir",
        str(root / ".conversion-cache"),
        "dump",
        generation,
        "/sekereagle.tar",
    ]
    process = subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    try:
        receive(root, generation, process.stdout)
        while process.stdout.read(1024 * 1024):
            pass
        if process.wait(timeout=60) != 0:
            raise ValueError("Legacy decryption failed")
        os.sync()
        result = verify(root, generation)
        atomic(
            root / "operation-status.json",
            {"status": "verified", **result, "phase": "conversion-verified"},
        )
    except BaseException:
        if process.poll() is None:
            process.kill()
            process.wait()
        atomic(
            root / "operation-status.json",
            {"status": "failed", "phase": "conversion-failed", "updatedAt": stamp()},
        )
        raise
    finally:
        process.stdout.close()
        (root / ".conversion-password").unlink(missing_ok=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=[
            "receive",
            "verify",
            "publish",
            "prune",
            "retire",
            "convert",
            "status",
        ],
    )
    parser.add_argument("generation", nargs="?")
    args = parser.parse_args()
    guard(ROOT)
    ROOT.chmod(0o700)
    if args.command == "receive":
        result = receive(ROOT, args.generation, sys.stdin.buffer)
    elif args.command == "verify":
        os.sync()
        result = verify(ROOT, args.generation)
    elif args.command == "publish":
        result = publish(ROOT, args.generation)
    elif args.command == "prune":
        prune(ROOT)
        result = {"retained": current_generation(ROOT)}
    elif args.command == "retire":
        retire(ROOT)
        result = {"encryptedRepositoryRemoved": True}
    elif args.command == "convert":
        convert(ROOT, args.generation)
        result = {"verified": args.generation}
    else:
        result = receipt(ROOT, current_generation(ROOT))
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("NAS backup operation failed: " + type(error).__name__, file=sys.stderr)
        sys.exit(1)
