#!/usr/bin/env python3
"""DSM boot task: start only the existing production services and unfinished cover copy."""
import hashlib
import json
import subprocess
import time
from pathlib import Path

DOCKER = '/usr/local/bin/docker'
PROJECT = 'sekereagle-nas-staging'
CORE = tuple(PROJECT + '-' + service + '-1' for service in
             ('postgres', 'minio', 'api', 'web', 'gateway', 'worker'))
COPY = 'sekereagle-cover-copy-20261023'
STATE = Path('/volume1/homes/seker/sekereagle-staging/maintenance/photo-timeline-repair-20261023')


def docker(*args):
    result = subprocess.run([DOCKER, *args], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError('Docker operation failed: ' + args[0])
    return result.stdout


def wait_for(check, description):
    for attempt in range(120):
        if check():
            return
        time.sleep(5)
    raise RuntimeError('Startup timed out: ' + description)


def ready(name):
    state = json.loads(docker('inspect', '--format', '{{json .State}}', name))
    return state.get('Running') is True and state.get('Health', {}).get('Status', 'healthy') == 'healthy'


def start(name):
    # Starting an already running container is a no-op; never recreate it.
    docker('start', name)


def copy_pending():
    progress = json.loads((STATE / 'cover-state/progress.json').read_text())
    digest = hashlib.sha256((STATE / 'cover-manifest.json').read_bytes()).hexdigest()
    if digest != progress['manifestHash']:
        raise RuntimeError('Cover manifest does not match checkpoint')
    offset, total = progress['offset'], progress['total']
    if not 0 <= offset <= total or sum(progress['counts'].values()) != offset:
        raise RuntimeError('Invalid cover checkpoint counters')
    if progress['complete']:
        if offset != total:
            raise RuntimeError('Incomplete cover checkpoint marked complete')
        return False
    return offset < total


def main():
    def engine_ready():
        try:
            docker('info', '--format', '{{.ServerVersion}}')
            return True
        except (RuntimeError, subprocess.TimeoutExpired):
            return False
    wait_for(engine_ready, 'Docker engine')
    # Validate the complete fixed allowlist before starting anything.
    for name in CORE:
        labels = json.loads(docker('inspect', '--format', '{{json .Config.Labels}}', name)) or {}
        if labels.get('com.docker.compose.project') != PROJECT:
            raise RuntimeError('Unexpected production container identity: ' + name)
    for names in (CORE[:2], CORE[2:4], CORE[4:]):
        for name in names:
            start(name)
        for name in names:
            wait_for(lambda name=name: ready(name), name)
    if copy_pending():
        start(COPY)
        print('Core services ready; unfinished cover copy resumed.', flush=True)
    else:
        print('Core services ready; cover copy already complete.', flush=True)


if __name__ == '__main__':
    main()
