#!/usr/bin/env python3
"""Host-owned plaintext Eagle backup; credentials never enter public status."""

import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shutil
import signal
import subprocess
import tempfile
import sys
import tarfile
import time
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/backup"
PUBLIC = ROOT / ".runtime/backup-status"
STATE = PRIVATE / "state.json"
INPUT = PRIVATE / "input"
REMOTE = "/volume1/homes/seker/sekereagle-backup"
EXPORT_CONTAINER = "sekereagle-backup-export"
RESTORE_CONTAINER = "sekereagle-backup-restore-postgres"
RESTORE_LABEL = "com.sekereagle.backup.role"
SSH_OPTIONS = [
    "-o",
    "Hostname=192.168.31.146",
    "-o",
    "User=seker",
    "-o",
    "Port=22",
    "-o",
    "HostKeyAlias=192.168.31.146",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ProxyCommand=none",
    "-o",
    "ProxyJump=none",
]
UTC = timezone.utc
SHANGHAI = ZoneInfo("Asia/Shanghai")
PERIOD = timedelta(days=14)
MAX_PAUSE = 24 * 3600


def utcnow():
    return datetime.now(UTC)


def stamp(value=None):
    return (value or utcnow()).isoformat(timespec="seconds").replace("+00:00", "Z")


def parsed(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def first_slot(now):
    local = now.astimezone(SHANGHAI)
    slot = local.replace(hour=1, minute=0, second=0, microsecond=0)
    slot += timedelta(days=(5 - slot.weekday()) % 7)
    if slot <= local:
        slot += timedelta(days=7)
    return slot.astimezone(UTC)


def following_slot(scheduled, now):
    slot = parsed(scheduled)
    while slot <= now:
        slot += PERIOD
    return stamp(slot)


def assert_ssh_target(config):
    fields = dict(line.split(None, 1) for line in config.splitlines() if " " in line)
    if (fields.get("hostname"), fields.get("user"), fields.get("port")) != (
        "192.168.31.146",
        "seker",
        "22",
    ):
        raise ValueError("SekerDesign SSH target changed; refusing backup")
    if (
        fields.get("stricthostkeychecking") not in ("yes", "true")
        or fields.get("proxycommand", "none") != "none"
        or fields.get("proxyjump", "none") != "none"
    ):
        raise ValueError("SSH must verify known host keys and connect directly")


def object_path(key):
    if not isinstance(key, str) or not key or "\\" in key or "\x00" in key:
        raise ValueError("Invalid object key")
    if key.startswith("/") or any(p in ("", ".", "..") for p in key.split("/")):
        raise ValueError("Unsafe object key")
    return "objects/" + key


def attempt_state(state, status, at):
    return {**state, "status": status, "lastAttemptAt": at}


def run(args, *, capture=True, timeout=120, check=True, **kwargs):
    output = kwargs.pop("stdout", subprocess.PIPE if capture else None)
    result = subprocess.run(
        [str(a) for a in args],
        cwd=ROOT,
        check=False,
        stdout=output,
        stderr=subprocess.PIPE,
        timeout=timeout,
        **kwargs,
    )
    if check and result.returncode:
        raise RuntimeError(
            f"{Path(str(args[0])).name} operation failed (exit {result.returncode})"
        )
    return result


def text(args, **kwargs):
    return run(args, **kwargs).stdout.decode()


def atomic_json(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w") as file:
        json.dump(data, file, indent=2)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())
    os.chmod(temp, mode)
    os.replace(temp, path)


def load_state():
    return json.loads(STATE.read_text())


def save_state(state):
    atomic_json(STATE, state)
    keys = (
        "configured",
        "target",
        "status",
        "lastAttemptAt",
        "lastSuccessAt",
        "nextScheduledAt",
        "cleanupPending",
        "quarantinePending",
    )
    atomic_json(PUBLIC / "status.json", {k: state.get(k) for k in keys}, 0o644)


def ssh(command):
    return text(
        [
            "ssh",
            *SSH_OPTIONS,
            "SekerDesign",
            command,
        ]
    )


def upload_receiver():
    for source, name in [
        (Path(__file__).with_name("plain_nas.py"), "plain_nas.py"),
        (Path(__file__), "host_backup.py"),
    ]:
        run(
            [
                "ssh",
                *SSH_OPTIONS,
                "SekerDesign",
                f"umask 077; chmod 700 {REMOTE}; mkdir -p {REMOTE}/tools; chmod 700 {REMOTE}/tools; cat > {REMOTE}/tools/{name}.tmp && chmod 600 {REMOTE}/tools/{name}.tmp && mv {REMOTE}/tools/{name}.tmp {REMOTE}/tools/{name}",
            ],
            input=source.read_bytes(),
        )


def remote(command, generation=None):
    if command not in (
        "receive",
        "verify",
        "publish",
        "prune",
        "status",
        "discard",
        "retire",
        "convert",
    ):
        raise ValueError("Unsupported NAS operation")
    if generation is not None and not re.fullmatch("[a-f0-9]{32,64}", generation):
        raise ValueError("Invalid generation")
    return run(
        [
            "ssh",
            *SSH_OPTIONS,
            "SekerDesign",
            f"python3 {REMOTE}/tools/plain_nas.py {command}"
            + (f" {generation}" if generation else ""),
        ],
        timeout=MAX_PAUSE,
    ).stdout


def transfer_archive(generation):
    if not re.fullmatch("[a-f0-9]{32}", generation):
        raise ValueError("Invalid backup generation")
    producer = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "--archive"],
        stdout=subprocess.PIPE,
    )
    receiver = None
    successful = False
    try:
        receiver = subprocess.Popen(
            [
                "ssh",
                *SSH_OPTIONS,
                "SekerDesign",
                f"python3 {REMOTE}/tools/plain_nas.py receive {generation}",
            ],
            stdin=producer.stdout,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        producer.stdout.close()
        receiver.communicate(timeout=MAX_PAUSE)
        if producer.wait(timeout=60) != 0 or receiver.returncode != 0:
            raise RuntimeError("Plaintext source or NAS receiver failed")
        successful = True
    finally:
        for process in (producer, receiver):
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
        if not successful:
            run(["docker", "rm", "-f", EXPORT_CONTAINER], check=False)


def inspect(name):
    return json.loads(text(["docker", "inspect", name]))[0]


def required_remote_space(state):
    # Plain staging needs a complete copy, unlike an incremental encrypted repository.
    previous = state.get("integrity", {}).get("bytes", 0)
    return int(previous * 1.25) + 20 * 1024**3


def preflight(state=None):
    state = load_state() if state is None else state
    assert_ssh_target(text(["ssh", *SSH_OPTIONS, "-G", "SekerDesign"]))
    if ssh("hostname").strip() != "SEKER_DESIGN":
        raise ValueError("Remote machine identity mismatch")
    marker = ssh(f"cat {REMOTE}/owner-marker").strip()
    if marker != "sekereagle-independent-backup-v1":
        raise ValueError("Remote backup ownership marker mismatch")
    if state.get("lastGenerationId"):
        cleanup_published(state)  # Reclaim old owned partials BEFORE capacity checks.
        save_state(state)
    available = int(ssh(f"df -Pk {REMOTE} | tail -1").split()[3]) * 1024
    if (
        available < required_remote_space(state)
        or shutil.disk_usage(PRIVATE).free < 16 * 1024**3
    ):
        raise ValueError("Insufficient backup workspace")
    upload_receiver()
    containers = {}
    for service in ("gateway", "api", "worker", "postgres", "minio"):
        info = inspect("sekereagle-" + service + "-1")
        labels = info["Config"]["Labels"]
        if (
            labels.get("com.docker.compose.project") != "sekereagle"
            or labels.get("com.docker.compose.service") != service
        ):
            raise ValueError("Unexpected deployment container")
        if not info["State"]["Running"]:
            raise ValueError("Eagle services must be healthy before backup")
        containers[service] = info
    env = dict(v.split("=", 1) for v in containers["api"]["Config"]["Env"] if "=" in v)
    if (
        not env.get("DATABASE_URL", "")
        .split("@")[-1]
        .startswith("postgres:5432/sekereagle?")
        or env.get("S3_ENDPOINT") != "http://minio:9000"
        or env.get("S3_BUCKET") != "sekereagle-assets"
    ):
        raise ValueError("Unsafe runtime target")
    run(
        ["docker", "exec", "sekereagle-api-1", "node", "scripts/assert-safe-target.mjs"]
    )
    if state.get("backupFormat") != "plain-directory-v1":
        raise ValueError("Plaintext backup migration must finish before backup")
    return containers


def restore_services(state):
    for service in ("api", "worker", "gateway"):
        if service in state.get("pausedServices", []):
            run(["docker", "start", "sekereagle-" + service + "-1"])
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(
                "http://127.0.0.1:8180/api/health/ready", timeout=3
            ) as response:
                if response.status == 200:
                    state["pausedServices"] = []
                    return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError("Eagle service recovery needs attention")


def prepare_input(containers):
    INPUT.mkdir(parents=True, exist_ok=True, mode=0o700)
    env = containers["api"]["Config"]["Env"]
    if any("\n" in v or "\r" in v for v in env):
        raise ValueError("Multiline container environment is unsupported")
    (INPUT / "runtime.env").write_text("\n".join(env) + "\n")
    os.chmod(INPUT / "runtime.env", 0o600)
    shutil.copyfile(ROOT / ".env", INPUT / "deployment.env")
    os.chmod(INPUT / "deployment.env", 0o600)
    metadata = {
        "formatVersion": 1,
        "database": "sekereagle",
        "bucket": "sekereagle-assets",
        "frozenAt": stamp(),
        "images": {
            s: {"id": c["Image"], "name": c["Config"]["Image"]}
            for s, c in containers.items()
        },
    }
    counts_sql = """SELECT json_build_object('assets', (SELECT count(*) FROM "EagleAsset"), 'renditions', (SELECT count(*) FROM "EagleAssetRendition"), 'users', (SELECT count(*) FROM "User"))"""
    counts = run(
        [
            "docker",
            "exec",
            "-i",
            "sekereagle-postgres-1",
            "sh",
            "-c",
            'psql -U "$POSTGRES_USER" -d sekereagle -At',
        ],
        input=counts_sql.encode(),
    ).stdout
    metadata["referenceCounts"] = json.loads(counts)
    atomic_json(INPUT / "deployment.json", metadata)
    for filename, command in (
        ("database.dump", 'pg_dump -U "$POSTGRES_USER" -d sekereagle -Fc'),
        ("globals.sql", 'pg_dumpall -U "$POSTGRES_USER" --globals-only'),
    ):
        with (INPUT / filename).open("wb") as file:
            run(
                ["docker", "exec", "sekereagle-postgres-1", "sh", "-c", command],
                capture=False,
                stdout=file,
                timeout=3600,
            )
        os.chmod(INPUT / filename, 0o600)
    files = text(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]
    ).split("\0")
    with tarfile.open(INPUT / "source.tar.gz", "w:gz") as archive:
        for filename in files:
            if (
                filename
                and (ROOT / filename).is_file()
                and not (ROOT / filename).is_symlink()
            ):
                archive.add(ROOT / filename, arcname=filename, recursive=False)
    return metadata


class HashReader:
    def __init__(self, source):
        self.source = source
        self.digest = hashlib.sha256()

    def read(self, count):
        data = self.source.read(count)
        self.digest.update(data)
        return data


def tar_info(name, size):
    info = tarfile.TarInfo(name)
    info.size = size
    info.mode = 0o600
    info.mtime = 0
    return info


def archive_stream():
    """Plaintext transport validates both producer exit and the complete manifest."""
    metadata = json.loads((INPUT / "deployment.json").read_text())
    image = metadata["images"]["api"]["id"]
    producer = subprocess.Popen(
        [
            "docker",
            "run",
            "--rm",
            # Binary stdout is the transport, never a persistent container log.
            "--log-driver=none",
            "--read-only",
            "--name",
            EXPORT_CONTAINER,
            "--network",
            "sekereagle_default",
            "--env-file",
            str(INPUT / "runtime.env"),
            "--entrypoint",
            "node",
            image,
            "/sekereagle/scripts/backup/export-objects.mjs",
        ],
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
    )
    manifest = {"formatVersion": 1, "objects": [], "files": {}}
    total = 0
    try:
        with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
            for name in (
                "database.dump",
                "globals.sql",
                "deployment.env",
                "deployment.json",
                "source.tar.gz",
            ):
                with (INPUT / name).open("rb") as file:
                    hashed = HashReader(file)
                    archive.addfile(
                        tar_info(name, (INPUT / name).stat().st_size), hashed
                    )
                    manifest["files"][name] = hashed.digest.hexdigest()
            while True:
                header = producer.stdout.readline(65537)
                if not header or len(header) > 65536:
                    raise ValueError("Truncated object export")
                entry = json.loads(header)
                if entry.get("complete"):
                    if (
                        entry["count"] != len(manifest["objects"])
                        or entry["bytes"] != total
                    ):
                        raise ValueError("Incomplete bucket export")
                    break
                path = object_path(entry["key"])
                if not isinstance(entry["size"], int) or entry["size"] < 0:
                    raise ValueError("Invalid object size")
                hashed = HashReader(producer.stdout)
                archive.addfile(tar_info(path, entry["size"]), hashed)
                manifest["objects"].append(
                    {**entry, "sha256": hashed.digest.hexdigest()}
                )
                total += entry["size"]
                if len(manifest["objects"]) % 1000 == 0:
                    atomic_json(
                        PRIVATE / "progress.json",
                        {
                            "phase": "exporting",
                            "objects": len(manifest["objects"]),
                            "bytes": total,
                            "updatedAt": stamp(),
                        },
                    )
            if producer.wait(timeout=60) != 0:
                raise ValueError("Object export process failed")
            raw = json.dumps(manifest, separators=(",", ":")).encode()
            archive.addfile(tar_info("manifest.json", len(raw)), io.BytesIO(raw))
            atomic_json(
                PRIVATE / "progress.json",
                {
                    "phase": "exported",
                    "objects": len(manifest["objects"]),
                    "bytes": total,
                    "updatedAt": stamp(),
                },
            )
        sys.stdout.buffer.flush()
    finally:
        if producer.poll() is None:
            producer.kill()
            producer.wait()


def verify_archive(source, extract_database=None):
    files = {}
    objects = {}
    manifest = None
    with tarfile.open(fileobj=source, mode="r|") as archive:
        for member in archive:
            if not member.isfile():
                raise ValueError("Unexpected archive entry")
            file = archive.extractfile(member)
            if member.name == "manifest.json":
                manifest = json.load(file)
                continue
            if manifest is not None:
                raise ValueError("Entries after final manifest")
            digest = hashlib.sha256()
            output = (
                (extract_database / member.name).open("wb")
                if extract_database
                and member.name in ("database.dump", "deployment.json")
                else None
            )
            try:
                while True:
                    block = file.read(1024 * 1024)
                    if not block:
                        break
                    digest.update(block)
                    if output:
                        output.write(block)
            finally:
                if output:
                    output.close()
            if member.name.startswith("objects/"):
                key = member.name[len("objects/") :]
                object_path(key)
                if key in objects:
                    raise ValueError("Duplicate archive object")
                objects[key] = (digest.hexdigest(), member.size)
            else:
                if (
                    member.name
                    not in (
                        "database.dump",
                        "globals.sql",
                        "deployment.env",
                        "deployment.json",
                        "source.tar.gz",
                    )
                    or member.name in files
                ):
                    raise ValueError("Unexpected archive file")
                files[member.name] = digest.hexdigest()
    if (
        not manifest
        or manifest.get("formatVersion") != 1
        or manifest["files"] != files
        or len(files) != 5
    ):
        raise ValueError("Incomplete archive manifest")
    expected = {o["key"]: (o["sha256"], o["size"]) for o in manifest["objects"]}
    if len(expected) != len(manifest["objects"]) or expected != objects:
        raise ValueError("Object integrity check failed")
    return {"objects": len(objects), "bytes": sum(size for _, size in objects.values())}


def legacy_restore_container(container):
    """Adopt pre-label leftovers only with independent image, mount and DB evidence."""
    metadata = INPUT / "deployment.json"
    if not metadata.is_file():
        return False
    image = json.loads(metadata.read_text())["images"]["postgres"]["id"]
    env = container.get("Config", {}).get("Env", [])
    mounts = container.get("Mounts", [])
    return (
        container.get("Name") == "/" + RESTORE_CONTAINER
        and container.get("Image") == image
        and container.get("HostConfig", {}).get("NetworkMode") == "none"
        and "POSTGRES_DB=sekereagle_test" in env
        and "POSTGRES_USER=sekereagle" in env
        and any(
            m.get("Type") == "bind"
            and m.get("Destination") == "/restore.dump"
            and m.get("Source") == str(INPUT / "database.dump")
            and m.get("RW") is False
            for m in mounts
        )
        and all(
            m.get("Type") == "volume"
            or (m.get("Destination") == "/restore.dump" and m.get("RW") is False)
            for m in mounts
        )
    )


def cleanup_restore_container():
    """Remove only our labelled temporary database, using its immutable Docker ID."""
    result = run(["docker", "inspect", RESTORE_CONTAINER], check=False)
    if result.returncode:
        # Distinguish absence from a disconnected daemon; never assume inspection failed safely.
        run(["docker", "info", "--format", "{{.ID}}"])
        return
    container = json.loads(result.stdout)[0]
    labels = container.get("Config", {}).get("Labels") or {}
    if labels.get(RESTORE_LABEL) != "restore":
        if labels.get(RESTORE_LABEL) or not legacy_restore_container(container):
            raise ValueError(
                "Unlabelled restore container requires manual identity verification"
            )
    run(["docker", "rm", "-f", "-v", container["Id"]])


def cleanup_attempt(state):
    """A durable generation intent makes failed receives recoverable before space checks."""
    pending = state.get("pendingPublication")
    if pending:
        try:
            current = json.loads(remote("status"))
        except Exception:
            state["cleanupPending"] = True
            return False
        if current.get("generation") == pending["lastGenerationId"]:
            state.update(pending)
            state.pop("attemptGeneration", None)
            state.pop("retryAfter", None)
        state.pop("pendingPublication", None)
    generation = state.get("attemptGeneration")
    if generation:
        try:
            remote("discard", generation)
        except Exception:
            state["cleanupPending"] = True
            return False
        state.pop("attemptGeneration", None)
    return True


def cleanup_published(state):
    try:
        result = json.loads(remote("prune"))
        state["cleanupPending"] = False
        state["quarantinePending"] = bool(result.get("quarantined"))
    except Exception:
        state["cleanupPending"] = True


def restore_database_check(directory):
    """Restore the complete database into a disposable, network-isolated test instance."""
    metadata = json.loads((directory / "deployment.json").read_text())
    # Enforce the repository's test target policy before creating any restore target.
    run(
        [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "-e",
            "DATABASE_URL=postgresql://restore:restore@postgres-test:5432/sekereagle_test",
            "-e",
            "S3_ENDPOINT=http://minio-test:9000",
            "-e",
            "S3_BUCKET=sekereagle-test-assets",
            "--entrypoint",
            "node",
            metadata["images"]["api"]["id"],
            "scripts/assert-safe-target.mjs",
        ]
    )
    cleanup_restore_container()
    envfile = directory / "postgres.env"
    envfile.write_text(
        "POSTGRES_USER=sekereagle\nPOSTGRES_DB=sekereagle_test\nPOSTGRES_PASSWORD="
        + secrets.token_urlsafe(32)
        + "\n"
    )
    envfile.chmod(0o600)
    try:
        run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                RESTORE_CONTAINER,
                "--label",
                RESTORE_LABEL + "=restore",
                "--network",
                "none",
                "--env-file",
                envfile,
                "--mount",
                f"type=bind,source={directory / 'database.dump'},target=/restore.dump,readonly",
                metadata["images"]["postgres"]["id"],
            ]
        )
        ready = False
        for _ in range(60):
            result = run(
                [
                    "docker",
                    "exec",
                    RESTORE_CONTAINER,
                    "pg_isready",
                    "-U",
                    "sekereagle",
                    "-d",
                    "sekereagle_test",
                ],
                check=False,
            )
            if result.returncode == 0:
                ready = True
                break
            time.sleep(1)
        if not ready:
            raise RuntimeError("Isolated restore database did not start")
        run(
            [
                "docker",
                "exec",
                RESTORE_CONTAINER,
                "pg_restore",
                "-U",
                "sekereagle",
                "-d",
                "sekereagle_test",
                "--no-owner",
                "--no-acl",
                "--exit-on-error",
                "/restore.dump",
            ],
            timeout=3600,
        )
        sql = """SELECT json_build_object('assets', (SELECT count(*) FROM "EagleAsset"), 'renditions', (SELECT count(*) FROM "EagleAssetRendition"), 'users', (SELECT count(*) FROM "User"))"""
        restored = run(
            [
                "docker",
                "exec",
                "-i",
                RESTORE_CONTAINER,
                "psql",
                "-U",
                "sekereagle",
                "-d",
                "sekereagle_test",
                "-At",
            ],
            input=sql.encode(),
        )
        if json.loads(restored.stdout) != metadata["referenceCounts"]:
            raise ValueError("Restored database counts differ from source")
        return metadata["referenceCounts"]
    finally:
        try:
            cleanup_restore_container()
        finally:
            envfile.unlink(missing_ok=True)


def backup():
    if os.getpgrp() != os.getpid():
        os.setsid()
    with (PRIVATE / "run.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        state = load_state()
        if state.get("pausedServices"):
            raise RuntimeError("Previous interrupted backup needs recovery")
        state = attempt_state(state, "running", stamp())
        state.update(pid=os.getpid(), deadline=time.time() + MAX_PAUSE)
        state["processIdentity"] = text(
            ["ps", "-p", str(os.getpid()), "-o", "lstart="]
        ).strip()
        save_state(state)
        awake = (
            subprocess.Popen(["/usr/bin/caffeinate", "-i", "-w", str(os.getpid())])
            if sys.platform == "darwin"
            else None
        )
        try:
            cleanup_restore_container()
            if not cleanup_attempt(state):
                raise RuntimeError(
                    "Unfinished generation cleanup must complete before backup"
                )
            state["status"] = "running"
            save_state(state)
            containers = preflight(state)
            state["pausedServices"] = ["gateway", "api", "worker"]
            save_state(state)  # Recovery intent must be durable BEFORE any stop.
            run(
                ["docker", "stop", "--time", "120", "sekereagle-gateway-1"], timeout=150
            )
            run(
                [
                    "docker",
                    "stop",
                    "--time",
                    "180",
                    "sekereagle-api-1",
                    "sekereagle-worker-1",
                ],
                timeout=400,
            )
            # Every writer is now stopped; DB and object storage remain live.
            metadata = prepare_input(containers)
            generation = uuid.uuid4().hex
            state["attemptGeneration"] = generation
            save_state(state)  # Intent precedes the first remote byte.
            transfer_archive(generation)
            # Source reads are complete; NAS disk verification can run with Eagle online.
            restore_services(state)
            save_state(state)
            verified = json.loads(remote("verify", generation))
            integrity = {"objects": verified["objects"], "bytes": verified["bytes"]}
            integrity["databaseCounts"] = restore_database_check(INPUT)
            success = dict(
                status="succeeded",
                lastSuccessAt=stamp(),
                backupFormat="plain-directory-v1",
                lastGenerationId=generation,
                frozenAt=metadata["frozenAt"],
                integrity=integrity,
                lastRestoreTestAt=stamp(),
                nextScheduledAt=following_slot(state["nextScheduledAt"], utcnow()),
            )
            state["pendingPublication"] = success
            save_state(state)
            remote("publish", generation)
            state.update(success)
            state.pop("retryAfter", None)
            state.pop("lastSnapshotId", None)
            state.pop("failureReason", None)
            state.pop("attemptGeneration", None)
            state["cleanupPending"] = True
            save_state(state)  # Publication succeeds independently of retention.
            state.pop("pendingPublication", None)
            cleanup_published(state)
        except BaseException:
            state["status"] = "failed"
            state["retryAfter"] = stamp(utcnow() + timedelta(hours=6))
            cleanup_attempt(state)
            if state.get("status") != "succeeded":
                raise
        finally:
            try:
                if state.get("pausedServices"):
                    restore_services(state)
            finally:
                if not state.get("pausedServices"):
                    state.pop("pid", None)
                    state.pop("deadline", None)
                    state.pop("processIdentity", None)
                    shutil.rmtree(INPUT, ignore_errors=True)
                save_state(state)
                if awake:
                    awake.terminate()
                    awake.wait()


def recover(state):
    pid = state.get("pid")
    alive = False
    if pid:
        try:
            os.kill(pid, 0)
            command = text(["ps", "-p", str(pid), "-o", "command="]).strip()
            started = text(["ps", "-p", str(pid), "-o", "lstart="]).strip()
            alive = (
                "backup.py" in command
                and "--run" in command
                and started == state.get("processIdentity")
            )
        except ProcessLookupError:
            pass
    if alive and time.time() < state.get("deadline", 0):
        return False
    if alive:
        # All export/backup processes inherit the dedicated session from tick.
        os.killpg(pid, signal.SIGKILL)
    with (PRIVATE / "run.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        run(["docker", "rm", "-f", EXPORT_CONTAINER], check=False)
        # The run lock is owned; secret cleanup must not depend on restart or NAS availability.
        if INPUT.exists():
            shutil.rmtree(INPUT)
        if state.get("pausedServices"):
            restore_services(state)
        cleanup_restore_container()
        cleanup_attempt(state)
        # A crash after durable publication must not turn success into failure.
        if state.get("status") != "succeeded":
            state.update(
                status="failed", retryAfter=stamp(utcnow() + timedelta(hours=6))
            )
        state.pop("pid", None)
        state.pop("deadline", None)
        state.pop("processIdentity", None)
        save_state(state)
        return True


def tick():
    state = load_state()
    if state.get("pid") or state.get("pausedServices"):
        recover(state)
        return
    if state.get("cleanupPending") and (
        not state.get("cleanupRetryAfter")
        or utcnow() >= parsed(state["cleanupRetryAfter"])
    ):
        with (PRIVATE / "run.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            if cleanup_attempt(state) and state.get("lastGenerationId"):
                cleanup_published(state)
            state["cleanupRetryAfter"] = stamp(utcnow() + timedelta(hours=6))
            save_state(state)
    if utcnow() < parsed(state["nextScheduledAt"]):
        return
    if state.get("retryAfter") and utcnow() < parsed(state["retryAfter"]):
        return
    with (PRIVATE / "backup.log").open("ab") as log:
        subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "--run"],
            cwd=ROOT,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )


def migrate():
    """Finalize documented NAS-local conversion without claiming a new backup date."""
    with (PRIVATE / "run.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = load_state()
        if state.get("pid") or state.get("pausedServices"):
            raise ValueError("Recover the interrupted backup before migration")
        if state.get("backupFormat") == "plain-directory-v1":
            if state.get("retirementPending"):
                assert_ssh_target(text(["ssh", *SSH_OPTIONS, "-G", "SekerDesign"]))
                if ssh("hostname").strip() != "SEKER_DESIGN":
                    raise ValueError("Unexpected NAS")
            finish_retirement(state)
            return
        generation = state.get("lastSnapshotId", "")
        if not re.fullmatch("[a-f0-9]{64}", generation) or not state.get(
            "lastSuccessAt"
        ):
            raise ValueError(
                "Migration needs the full successful legacy snapshot ID and timestamp"
            )
        assert_ssh_target(text(["ssh", *SSH_OPTIONS, "-G", "SekerDesign"]))
        if ssh("hostname").strip() != "SEKER_DESIGN":
            raise ValueError("Unexpected NAS")
        upload_receiver()
        current = json.loads(remote("status"))
        if current.get("generation") != generation:
            raise ValueError(
                "Convert, verify and publish the exact legacy snapshot before --migrate"
            )
        verified = json.loads(remote("verify", generation))
        if verified.get("manifestSha256") != current.get("manifestSha256"):
            raise ValueError("Published migration manifest changed")
        # Download only the dump and its metadata to an isolated temporary directory.
        with tempfile.TemporaryDirectory(dir=PRIVATE) as temporary:
            directory = Path(temporary)
            for name in ("database.dump", "deployment.json"):
                with (directory / name).open("wb") as output:
                    run(
                        [
                            "ssh",
                            *SSH_OPTIONS,
                            "SekerDesign",
                            f"cat {REMOTE}/generations/{generation}/{name}",
                        ],
                        stdout=output,
                        timeout=MAX_PAUSE,
                    )
            # Hash the downloaded files against the verified remote manifest.
            manifest_data = ssh(f"cat {REMOTE}/generations/{generation}/manifest.json")
            if (
                hashlib.sha256(manifest_data.encode()).hexdigest()
                != current["manifestSha256"]
            ):
                raise ValueError("Migration manifest integrity mismatch")
            manifest = json.loads(manifest_data)
            for name in ("database.dump", "deployment.json"):
                digest = hashlib.sha256()
                with (directory / name).open("rb") as source:
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(block)
                if digest.hexdigest() != manifest["files"][name]:
                    raise ValueError("Migration download integrity mismatch")
            counts = restore_database_check(directory)
        state.update(
            backupFormat="plain-directory-v1",
            lastGenerationId=generation,
            integrity={
                "objects": verified["objects"],
                "bytes": verified["bytes"],
                "databaseCounts": counts,
            },
            lastRestoreTestAt=stamp(),
            retirementPending=True,
        )
        state.pop("lastSnapshotId", None)
        save_state(state)  # Keep the original lastSuccessAt, frozenAt and schedule.
        finish_retirement(state)


def finish_retirement(state):
    # Retirement is deliberately opt-in via --migrate, never an install side effect.
    if not state.get("retirementPending"):
        return
    remote("retire")
    for name in (
        "repository-password",
        "restic",
        "restic-darwin-arm64",
        "restic-linux-amd64",
    ):
        (PRIVATE / name).unlink(missing_ok=True)
    state.pop("retirementPending", None)
    save_state(state)


def install():
    if STATE.exists() and load_state().get("backupFormat") != "plain-directory-v1":
        raise ValueError(
            "Legacy backup state: follow docs/backup-and-restore.md migration steps, then run --migrate before --install"
        )
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    PRIVATE.chmod(0o700)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    PUBLIC.chmod(0o755)
    assert_ssh_target(text(["ssh", *SSH_OPTIONS, "-G", "SekerDesign"]))
    if ssh("hostname").strip() != "SEKER_DESIGN":
        raise ValueError("Unexpected NAS")
    # A pre-existing, unmarked directory must never be adopted or cleaned.
    ssh(
        f'if test -e {REMOTE}; then test "$(cat {REMOTE}/owner-marker 2>/dev/null)" = sekereagle-independent-backup-v1; else umask 077; mkdir {REMOTE}; printf "%s\\n" sekereagle-independent-backup-v1 > {REMOTE}/owner-marker; fi'
    )
    upload_receiver()
    if not STATE.exists():
        save_state(
            {
                "configured": True,
                "backupFormat": "plain-directory-v1",
                "target": "SekerDesign",
                "status": "never",
                "lastAttemptAt": None,
                "lastSuccessAt": None,
                "nextScheduledAt": stamp(first_slot(utcnow())),
            }
        )
    launch = Path.home() / "Library/LaunchAgents/com.sekereagle.backup.plist"
    launch.parent.mkdir(parents=True, exist_ok=True)
    path = os.environ.get("PATH", "")
    spec = {
        "Label": "com.sekereagle.backup",
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), "--tick"],
        "WorkingDirectory": str(ROOT),
        "RunAtLoad": True,
        "StartInterval": 60,
        "EnvironmentVariables": {"PATH": path, "TZ": "Asia/Shanghai"},
        "StandardOutPath": str(PRIVATE / "scheduler.log"),
        "StandardErrorPath": str(PRIVATE / "scheduler.log"),
    }
    launch.write_bytes(plistlib.dumps(spec))
    launch.chmod(0o600)
    domain = f"gui/{os.getuid()}"
    run(["launchctl", "bootout", domain, launch], check=False)
    run(["launchctl", "bootstrap", domain, launch])
    run(["launchctl", "enable", domain + "/com.sekereagle.backup"])
    print(
        "Installed biweekly Saturday 01:00 Asia/Shanghai backup and recovery watchdog."
    )


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    for option in ("install", "migrate", "run", "tick", "archive", "verify-archive"):
        group.add_argument("--" + option, action="store_true")
    args = parser.parse_args()
    if args.archive:
        archive_stream()
    elif args.verify_archive:
        print(json.dumps(verify_archive(sys.stdin.buffer)))
    elif args.install:
        install()
    elif args.migrate:
        migrate()
    elif args.tick:
        tick()
    else:
        backup()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Deliberately omit stderr payloads, environment values and credentials.
        print(
            f"Backup operation failed: {type(error).__name__}: {error}", file=sys.stderr
        )
        sys.exit(1)
