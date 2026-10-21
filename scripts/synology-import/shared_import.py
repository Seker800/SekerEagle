"""One-shot managed PHOTO import; source files are read-only and never a live library."""
import argparse
import contextlib
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import sqlite3
import stat
import subprocess
import time
import threading
import unicodedata
from urllib.parse import urlsplit, parse_qs

STOP = False
CHUNK = 1024 * 1024
LOCAL_ZONE = dt.timezone(dt.timedelta(hours=8))


def fingerprint(s):
    return {'size': s.st_size, 'mtime_ns': str(s.st_mtime_ns), 'inode': str(s.st_ino), 'device': str(s.st_dev)}


def open_source(root, relative):
    p = PurePosixPath(relative)
    if (not relative or p.is_absolute() or '..' in p.parts or str(p) != relative
            or any(ord(c) < 32 for c in relative)):
        raise ValueError('SOURCE_PATH_INVALID')
    directory = os.open(str(root), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in p.parts[:-1]:
            next_directory = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = next_directory
        fd = os.open(p.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            os.close(fd)
            raise ValueError('SOURCE_NOT_REGULAR')
        return fd
    finally:
        os.close(directory)


def verify_source(root, relative, expected):
    fd = open_source(root, relative)
    if fingerprint(os.fstat(fd)) != {k: expected[k] if k == 'size' else str(expected[k]) for k in fingerprint(os.fstat(fd))}:
        os.close(fd)
        raise ValueError('SOURCE_CHANGED')
    return fd


def capture_time(tags, fallback):
    for name in ('DateTimeOriginal', 'CreateDate', 'MediaCreateDate', 'TrackCreateDate'):
        value = str(tags.get(name, ''))
        value = re.sub(r'^(\d{4}):(\d{2}):(\d{2})', r'\1-\2-\3', value)
        offset = tags.get('OffsetTimeOriginal' if name == 'DateTimeOriginal' else 'OffsetTimeDigitized')
        if offset and not re.search(r'(Z|[+-]\d\d:\d\d)$', value):
            value += str(offset)
        try:
            date = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
            if date.year < 1900:
                continue
            return (date.replace(tzinfo=LOCAL_ZONE) if date.tzinfo is None else date).timestamp(), name
        except (ValueError, OverflowError):
            continue
    return fallback, 'FileModifyTime'


def file_policy(name, size, policy):
    extension = Path(unicodedata.normalize('NFKC', name)).suffix.lower()
    row = next((x for x in policy['formats'] if x['extension'] == extension), None)
    if not row or size <= 0 or size > policy['videoMaxBytes' if row['kind'] == 'video' else 'imageMaxBytes']:
        return None
    return row['mimeType'], row['kind']


class Journal:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if directory.is_symlink() or directory.stat().st_mode & 0o077:
            raise ValueError('STATE_DIRECTORY_MUST_BE_PRIVATE')
        self.path = directory / 'journal.sqlite'
        if self.path.is_symlink():
            raise ValueError('STATE_SYMLINK_REJECTED')
        self._lock = threading.RLock()
        self.db = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        os.chmod(self.path, 0o600)
        self.db.row_factory = sqlite3.Row
        self._batch = False
        self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS items(path TEXT PRIMARY KEY,size INTEGER,mtime_ns TEXT,inode TEXT,device TEXT,
          mime TEXT,kind TEXT,capture REAL,date_source TEXT,upload_name TEXT,status TEXT DEFAULT 'DISCOVERED',
          sha256 TEXT,session_id TEXT,part_size INTEGER,asset_id TEXT,media_status TEXT,attempts INTEGER DEFAULT 0,error TEXT);
        CREATE INDEX IF NOT EXISTS queue_order ON items(status,capture DESC,path);
        ''')
        self.fixed('schema_version', '2')

    @contextlib.contextmanager
    def write(self):
        with self._lock:
            if self._batch:
                yield
            else:
                with self.db:
                    yield

    @contextlib.contextmanager
    def batch(self):
        with self._lock:
            if self._batch:
                raise ValueError('NESTED_BATCH_REJECTED')
            with self.db:
                self._batch = True
                try:
                    yield
                finally:
                    self._batch = False

    def close(self):
        with self._lock:
            self.db.close()

    def query(self, sql, parameters=()):
        with self._lock:
            return self.db.execute(sql, parameters).fetchall()

    def meta(self, key):
        rows = self.query('SELECT value FROM meta WHERE key=?', (key,))
        row = rows[0] if rows else None
        return row[0] if row else None

    def set_meta(self, key, value):
        with self.write():
            self.db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', (key, str(value)))

    def fixed(self, key, value):
        with self._lock:
            previous = self.meta(key)
            if previous is not None and previous != str(value):
                raise ValueError('IMPORT_IDENTITY_CHANGED')
            self.set_meta(key, value)

    def bind_identity(self, owner, deployment):
        with self._lock:
            for key, value in [('authenticated_user', owner), ('deployment', deployment)]:
                if self.meta(key) not in (None, value):
                    raise ValueError('IMPORT_IDENTITY_CHANGED')
            self.fixed('authenticated_user', owner)
            self.fixed('deployment', deployment)

    def add(self, path, facts, mime, kind):
        with self._lock:
            facts = {**facts, **{k: str(facts[k]) for k in ('mtime_ns', 'inode', 'device')}}
            rows = self.query('SELECT * FROM items WHERE path=?', (path,))
            row = rows[0] if rows else None
            if row:
                if any(row[k] != facts[k] for k in facts):
                    self.update(path, status='SOURCE_CHANGED', error='SOURCE_CHANGED')
                return
            with self.write():
                self.db.execute('INSERT INTO items(path,size,mtime_ns,inode,device,mime,kind) VALUES(?,?,?,?,?,?,?)',
                                (path, facts['size'], facts['mtime_ns'], facts['inode'], facts['device'], mime, kind))

    def metadata(self, path, capture, source, name):
        with self.write():
            self.db.execute("UPDATE items SET capture=?,date_source=?,upload_name=?,status='PENDING' WHERE path=? AND status='DISCOVERED'",
                            (capture, source, name, path))

    def update(self, path, **fields):
        allowed = {'status', 'sha256', 'session_id', 'part_size', 'asset_id', 'media_status', 'attempts', 'error', 'mime'}
        if not fields or not set(fields) <= allowed:
            raise ValueError('INVALID_CHECKPOINT_FIELD')
        with self.write():
            self.db.execute('UPDATE items SET '+','.join(k+'=?' for k in fields)+' WHERE path=?', (*fields.values(), path))

    def next_batch(self, size):
        return self.query("SELECT * FROM items WHERE status IN ('PENDING','UPLOADING') ORDER BY capture DESC,path LIMIT ?", (size,))

    def summary(self):
        return {r[0]: r[1] for r in self.query('SELECT status,count(*) FROM items GROUP BY status')}


def log(event, **values):
    print(json.dumps({'event': event, 'at': dt.datetime.now(dt.timezone.utc).isoformat(), **values}), flush=True)


def inventory(root, journal, policy):
    journal.fixed('source', str(root))
    journal.fixed('policy', hashlib.sha256(json.dumps(policy, sort_keys=True).encode()).hexdigest())
    if journal.meta('inventory_complete') == '1':
        return
    log('inventory_started')
    if journal.meta('discovery_complete') != '1':
        count = 0
        pending = []
        def save_discovery():
            with journal.batch():
                for args in pending:
                    journal.add(*args)
            pending.clear()
        for folder, directories, files in os.walk(root, followlinks=False):
            directories[:] = sorted(x for x in directories if not x.startswith(('@', '#', '.')) and not Path(folder, x).is_symlink())
            for name in sorted(files):
                if STOP:
                    save_discovery()
                    return
                relative = Path(folder, name).relative_to(root).as_posix()
                try:
                    fd = open_source(root, relative)
                    with contextlib.closing(os.fdopen(fd, 'rb')) as source:
                        facts = fingerprint(os.fstat(source.fileno()))
                    rule = file_policy(name, facts['size'], policy)
                    if rule:
                        pending.append((relative, facts, *rule))
                        count += 1
                        if len(pending) >= 100:
                            save_discovery()
                        if count % 1000 == 0:
                            log('inventory_discovered', count=count)
                except (OSError, ValueError):
                    continue
        save_discovery()
        journal.set_meta('discovery_complete', '1')
    while not STOP:
        batch = journal.query("SELECT * FROM items WHERE status='DISCOVERED' ORDER BY path LIMIT 100")
        if not batch:
            journal.set_meta('inventory_complete', '1')
            log('inventory_complete', counts=journal.summary())
            return
        descriptors = []
        selected = []
        try:
            for row in batch:
                try:
                    fd = verify_source(root, row['path'], row)
                except (OSError, ValueError):
                    journal.update(row['path'], status='SOURCE_CHANGED', error='SOURCE_CHANGED')
                    continue
                descriptors.append(fd)
                selected.append(row)
            if not descriptors:
                continue
            paths = ['/proc/self/fd/'+str(fd) for fd in descriptors]
            process = subprocess.run(['exiftool', '-json', '-n', '-DateTimeOriginal', '-OffsetTimeOriginal', '-CreateDate',
                                      '-OffsetTimeDigitized', '-MediaCreateDate', '-TrackCreateDate', '-MIMEType', *paths],
                                     capture_output=True, timeout=120, check=False, pass_fds=tuple(descriptors),
                                     env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C.UTF-8', 'TZ': 'Asia/Shanghai'})
            if len(process.stdout) > 4*1024*1024 or process.returncode not in (0, 1):
                raise ValueError('METADATA_READER_FAILED')
            tags = {x['SourceFile']: x for x in json.loads(process.stdout)}
            with journal.batch():
                for row, fd, input_path in zip(selected, descriptors, paths):
                    if fingerprint(os.fstat(fd)) != {k: row[k] if k == 'size' else str(row[k]) for k in fingerprint(os.fstat(fd))}:
                        journal.update(row['path'], status='SOURCE_CHANGED', error='SOURCE_CHANGED')
                        continue
                    data = tags.get(input_path, {})
                    timestamp, source = capture_time(data, int(row['mtime_ns'])/1e9)
                    name = Path(row['path']).name
                    # Correct a demonstrable extension mismatch, never the source name or bytes.
                    actual = data.get('MIMEType')
                    if actual in ('image/jpeg', 'image/png', 'image/webp', 'image/gif') and actual != row['mime']:
                        match = next((x for x in policy['formats'] if x['mimeType'] == actual), None)
                        if match:
                            name = Path(name).stem + match['extension']
                            journal.update(row['path'], mime=actual)
                    journal.metadata(row['path'], timestamp, source, name)
        finally:
            for fd in descriptors:
                os.close(fd)
        done = journal.query("SELECT count(*) FROM items WHERE status!='DISCOVERED'")[0][0]
        log('metadata_indexed', count=done)


def validate_upload_url(value, origin, owner, number):
    url = urlsplit(value)
    public = urlsplit(origin)
    query = parse_qs(url.query)
    if (url.scheme != 'https' or (url.scheme, url.netloc) != (public.scheme, public.netloc)
            or url.username or url.password or url.fragment
            or not url.path.startswith('/sekereagle-assets/users/'+owner+'/')
            or '..' in url.path or '%2f' in url.path.lower() or '%2e' in url.path.lower()
            or query.get('partNumber') != [str(number)] or not query.get('uploadId')
            or not re.fullmatch('[a-fA-F0-9]{64}', query.get('X-Amz-Signature', [''])[0])):
        raise ValueError('UNTRUSTED_UPLOAD_DESTINATION')
    return url.path+'?'+url.query, url.netloc


class ApiError(Exception):
    def __init__(self, status, code=None):
        self.status = status
        safe_code = code if isinstance(code, str) and re.fullmatch(r'[A-Z][A-Z_0-9]{0,80}', code) else None
        super().__init__('API_HTTP_'+str(status)+(('_'+safe_code) if safe_code else ''))


class Api:
    def __init__(self, token_file, origin):
        token_file = Path(token_file)
        s = token_file.lstat()
        if not stat.S_ISREG(s.st_mode) or s.st_mode & 0o077 or s.st_size > 4096:
            raise ValueError('TOKEN_FILE_MUST_BE_PRIVATE')
        self.token = token_file.read_text().strip()
        if not re.fullmatch(r'sea_pat_[A-Za-z0-9_-]{40,100}', self.token):
            raise ValueError('TOKEN_FORMAT_INVALID')
        url = urlsplit(origin)
        if url.scheme != 'https' or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
            raise ValueError('INVALID_PUBLIC_ORIGIN')
        self.origin = origin.rstrip('/')
        self.owner = None

    def request(self, method, path, body=None):
        if path != '/auth/me' and not re.fullmatch(r'/photos/uploads(?:/[a-f0-9-]+(?:/parts(?:/\d+)?|/complete)?)?', path):
            raise ValueError('PHOTO_ENDPOINT_REQUIRED')
        connection = http.client.HTTPConnection('api', 3000, timeout=180)
        try:
            data = json.dumps(body).encode() if body is not None else None
            connection.request(method, '/api'+path, body=data,
                               headers={'Authorization': 'Bearer '+self.token, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            raw = response.read(1024*1024+1)
            if not 200 <= response.status < 300:
                try:
                    code = json.loads(raw).get('code')
                except (ValueError, AttributeError):
                    code = None
                raise ApiError(response.status, code)
            if len(raw) > 1024*1024:
                raise ValueError('API_RESPONSE_TOO_LARGE')
            return json.loads(raw)
        finally:
            connection.close()

    def authenticate(self, journal):
        info = self.request('GET', '/auth/me')
        self.owner = info['user']['id']
        journal.bind_identity(self.owner, info['desktopCache']['deploymentId'])

    def part(self, url, number, fd, offset, length):
        path, host = validate_upload_url(url, self.origin, self.owner, number)
        # Preserve the signed Host while sending directly over this project's private Docker network.
        connection = http.client.HTTPConnection('minio', 9000, timeout=180)
        try:
            connection.putrequest('PUT', path, skip_host=True)
            connection.putheader('Host', host)
            connection.putheader('Content-Length', str(length))
            connection.endheaders()
            remaining = length
            while remaining:
                data = os.pread(fd, min(CHUNK, remaining), offset)
                if not data:
                    raise ValueError('SOURCE_TRUNCATED')
                connection.send(data)
                offset += len(data)
                remaining -= len(data)
            response = connection.getresponse()
            response.read(64*1024)
            etag = response.getheader('ETag')
            if not 200 <= response.status < 300 or not etag or len(etag) > 200:
                raise ApiError(response.status)
            return etag
        finally:
            connection.close()


def upload_one(root, journal, row, api):
    started = time.monotonic()
    path = row['path']
    fd = verify_source(root, path, row)
    try:
        sha = row['sha256']
        if not sha:
            digest = hashlib.sha256()
            offset = 0
            while True:
                block = os.pread(fd, CHUNK, offset)
                if not block:
                    break
                digest.update(block)
                offset += len(block)
            sha = digest.hexdigest()
            journal.update(path, sha256=sha)
        if fingerprint(os.fstat(fd)) != {k: row[k] if k == 'size' else str(row[k]) for k in fingerprint(os.fstat(fd))}:
            raise ValueError('SOURCE_CHANGED')
        hashed = time.monotonic()
        session_id, part_size = row['session_id'], row['part_size']
        if session_id:
            session = api.request('GET', '/photos/uploads/'+session_id)
            if session['status'] == 'COMPLETED':
                journal.update(path, status='IMPORTED', asset_id=session['eagleAssetId'], media_status=session.get('assetStatus'))
                return
            if session['status'] in ('ASSEMBLED', 'FAILED'):
                parts = api.request('GET', '/photos/uploads/'+session_id+'/parts')['parts']
                if not parts:
                    raise ValueError('ASSEMBLED_PARTS_MISSING')
                result = api.request('POST', '/photos/uploads/'+session_id+'/complete', {'parts': [{'partNumber': p['partNumber'], 'etag': p['etag']} for p in parts]})
                journal.update(path, status='IMPORTED', asset_id=result['assetId'], media_status='PROCESSING', error=None)
                return
            if session['status'] == 'ABORTED':
                session_id = None
            elif session['status'] != 'INITIATED':
                raise ApiError(409)
        if not session_id:
            session = api.request('POST', '/photos/uploads', {'originalName': row['upload_name'], 'size': row['size'],
                                  'mimeType': row['mime'], 'contentSha256': sha, 'duplicatePolicy': 'SKIP'})
            session_id, part_size = session['id'], session['partSize']
            if not re.fullmatch(r'[a-f0-9-]{36}', session_id) or not 0 < part_size <= 64*1024*1024:
                raise ValueError('UPLOAD_SESSION_INVALID')
            journal.update(path, status='UPLOADING', session_id=session_id, part_size=part_size)
        existing = {x['partNumber']: x for x in api.request('GET', '/photos/uploads/'+session_id+'/parts')['parts']}
        parts = []
        for index, offset in enumerate(range(0, row['size'], part_size), 1):
            if STOP:
                return
            size = min(part_size, row['size']-offset)
            part = existing.get(index)
            if part and part.get('size') == size:
                etag = part['etag']
            else:
                signed = api.request('POST', '/photos/uploads/'+session_id+'/parts/'+str(index), {})
                etag = api.part(signed['uploadUrl'], index, fd, offset, size)
            parts.append({'partNumber': index, 'etag': etag})
        if fingerprint(os.fstat(fd)) != {k: row[k] if k == 'size' else str(row[k]) for k in fingerprint(os.fstat(fd))}:
            raise ValueError('SOURCE_CHANGED')
        transferred = time.monotonic()
        result = api.request('POST', '/photos/uploads/'+session_id+'/complete', {'parts': parts})
        journal.update(path, status='IMPORTED', asset_id=result['assetId'], media_status='PROCESSING', error=None)
        log('original_ingest_timing', mime=row['mime'], sourceBytes=row['size'],
            hashSeconds=round(hashed-started, 3), transferSeconds=round(transferred-hashed, 3),
            finalizeSeconds=round(time.monotonic()-transferred, 3))
    finally:
        os.close(fd)


def await_processing(journal, api):
    while not STOP:
        rows = journal.query("SELECT * FROM items WHERE status='IMPORTED' AND (media_status IS NULL OR media_status NOT IN ('READY','FAILED'))")
        if not rows:
            return
        for row in rows:
            try:
                result = api.request('GET', '/photos/uploads/'+row['session_id'])
            except ApiError as error:
                if error.status in (401, 403) or error.status < 500:
                    raise
                log('processing_api_retry', httpStatus=error.status)
                time.sleep(10)
                break
            except (OSError, http.client.HTTPException):
                log('processing_api_retry')
                time.sleep(10)
                break
            media = result.get('assetStatus')
            if media not in ('PROCESSING', 'READY', 'FAILED'):
                raise ValueError('PROCESSING_PROGRESS_UNAVAILABLE')
            journal.update(row['path'], media_status=media, error='MEDIA_PROCESSING_FAILED' if media == 'FAILED' else None)
        pending = journal.query("SELECT count(*) FROM items WHERE status='IMPORTED' AND (media_status IS NULL OR media_status NOT IN ('READY','FAILED'))")[0][0]
        if not pending:
            return
        log('processing_batch', pending=pending)
        for _ in range(10):
            if STOP:
                return
            time.sleep(1)


def import_one_with_retry(root, journal, row, api):
    if STOP:
        return 0
    try:
        upload_one(root, journal, row, api)
        return 1
    except ApiError as error:
        if error.status in (401, 403):
            raise
        attempts = row['attempts']+1
        permanent = error.status in (400, 404, 413, 415)
        journal.update(row['path'], attempts=attempts, error=str(error), **({'status':'FAILED'} if permanent else {}))
        if not permanent:
            log('api_retry', httpStatus=error.status)
            for _ in range(min(60, attempts*10)):
                if STOP:
                    break
                time.sleep(1)
    except (OSError, TimeoutError, http.client.HTTPException):
        journal.update(row['path'], error='NETWORK_OR_SOURCE_IO_FAILED')
        log('io_retry')
        for _ in range(30):
            if STOP:
                break
            time.sleep(1)
    except ValueError as error:
        code = str(error)
        if code == 'ASSEMBLED_PARTS_MISSING':
            journal.update(row['path'], status='FAILED', error=code)
            return 1
        if code not in ('SOURCE_CHANGED', 'SOURCE_PATH_INVALID', 'SOURCE_NOT_REGULAR', 'SOURCE_TRUNCATED'):
            raise
        journal.update(row['path'], status='SOURCE_CHANGED', error=code)
    return 1


def import_batch(root, journal, api, rows, concurrency):
    if concurrency == 1:
        return sum(import_one_with_retry(root, journal, row, api) for row in rows)
    # Only the coordinator dispatches rows from the frozen newest-first queue.
    # At most two files are in flight; fatal failures never enqueue another row.
    pending = set()
    remaining = iter(rows)
    count = 0
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        def dispatch():
            if not STOP:
                row = next(remaining, None)
                if row is not None:
                    pending.add(executor.submit(import_one_with_retry, root, journal, row, api))
        for _ in range(concurrency):
            dispatch()
        while pending:
            done, pending = wait(pending, return_when=FIRST_COMPLETED)
            # Resolve all completed results before dispatching replacements.
            count += sum(future.result() for future in done)
            for _ in done:
                dispatch()
    return count


def run_import(root, journal, api, limit=None, wait_for_processing=False, concurrency=1):
    if concurrency not in (1, 2):
        raise ValueError('IMPORT_CONCURRENCY_MUST_BE_ONE_OR_TWO')
    api.authenticate(journal)
    if wait_for_processing:
        await_processing(journal, api)
    count = 0
    while not STOP:
        batch = journal.next_batch(min(25, limit-count) if limit else 25)
        if not batch or (limit and count >= limit):
            break
        count += import_batch(root, journal, api, batch, concurrency)
        log('import_progress', counts=journal.summary(), concurrency=concurrency)
        if wait_for_processing:
            await_processing(journal, api)
    log('import_paused' if STOP or limit else 'import_complete', counts=journal.summary())


def acquire_lock(lock, wait=False):
    announced = False
    while not STOP:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            if not wait:
                raise
            if not announced:
                log('waiting_for_inventory')
                announced = True
            time.sleep(1)
    return False


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['inventory', 'run', 'status'])
    parser.add_argument('--state', required=True)
    parser.add_argument('--policy')
    parser.add_argument('--source', default='/source', choices=['/source'])
    parser.add_argument('--public-origin')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--wait-for-inventory', action='store_true')
    parser.add_argument('--wait-for-processing', action='store_true')
    parser.add_argument('--concurrency', type=int, choices=(1, 2), default=1)
    args = parser.parse_args()
    if args.limit is not None and not 1 <= args.limit <= 100:
        parser.error('Pilot limit must be between 1 and 100')
    if args.command == 'status':
        database = sqlite3.connect('file:'+str(Path(args.state)/'journal.sqlite')+'?mode=ro', uri=True)
        print(json.dumps({'counts': dict(database.execute('SELECT status,count(*) FROM items GROUP BY status')),
                          'media': dict(database.execute("SELECT media_status,count(*) FROM items WHERE status='IMPORTED' GROUP BY media_status")),
                          'phase': dict(database.execute('SELECT key,value FROM meta WHERE key IN (\'inventory_complete\',\'discovery_complete\')'))}))
        database.close()
        return
    if not args.policy:
        parser.error('A shared format policy is required')
    root = Path(args.source)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('SHARED_SOURCE_MOUNT_REQUIRED')
    state = Path(args.state)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(state/'import.lock', 'a') as lock:
        if not acquire_lock(lock, args.wait_for_inventory):
            return
        journal = Journal(state)
        try:
            inventory(root, journal, json.loads(Path(args.policy).read_text()))
            if args.command == 'run' and not STOP:
                if not args.public_origin:
                    parser.error('A public origin is required')
                run_import(root, journal, Api(state/'token', args.public_origin), args.limit, args.wait_for_processing, args.concurrency)
        finally:
            journal.close()


def stop(_signal, _frame):
    global STOP
    STOP = True


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        main()
    except Exception as error:
        # Never log exception payloads, requests, signed URLs, or credentials.
        code = str(error)
        log('import_stopped', reason=type(error).__name__, code=code if re.fullmatch(r'[A-Z][A-Z_0-9]{0,80}', code) else 'DETAILS_REDACTED')
        raise SystemExit(1) from None
