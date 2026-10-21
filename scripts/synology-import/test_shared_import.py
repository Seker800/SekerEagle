import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

class SharedImportTests(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('shared_import',Path(__file__).with_name('shared_import.py'))
        self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)/'source';self.root.mkdir()

    def test_source_open_rejects_escape_and_symlinks_in_any_component(self):
        (self.root/'safe.jpg').write_bytes(b'original')
        outside=Path(self.tmp.name)/'outside';outside.mkdir();(outside/'secret.jpg').write_bytes(b'secret')
        (self.root/'alias').symlink_to(outside, target_is_directory=True)
        (self.root/'link.jpg').symlink_to(outside/'secret.jpg')
        for rel in ['../outside/secret.jpg','/etc/passwd','alias/secret.jpg','link.jpg','safe.jpg\n-option']:
            with self.subTest(rel=rel),self.assertRaises((ValueError,OSError)):self.m.open_source(self.root,rel)
        fd=self.m.open_source(self.root,'safe.jpg');self.assertEqual(os.read(fd,100),b'original');os.close(fd)

    def test_capture_date_precedes_container_date_and_mtime_is_explicit_fallback(self):
        t,kind=self.m.capture_time({'DateTimeOriginal':'2024:01:02 03:04:05','CreateDate':'2025:01:01 00:00:00'},100)
        self.assertEqual(kind,'DateTimeOriginal');self.assertEqual(t,1704135845)
        self.assertEqual(self.m.capture_time({'DateTimeOriginal':'0000:00:00 00:00:00'},100),(100,'FileModifyTime'))
        self.assertEqual(self.m.capture_time({'DateTimeOriginal':'2024:01:02 03:04:05','OffsetTimeOriginal':'+08:00'},100)[0],t)

    def test_journal_is_private_orders_newest_first_and_keeps_checkpoint(self):
        state=Path(self.tmp.name)/'state';j=self.m.Journal(state)
        for name,t in [('old.jpg',10),('new.jpg',30),('middle.jpg',20)]:
            j.add(name,{'size':10,'mtime_ns':t,'inode':1,'device':1},'image/jpeg','image')
            j.metadata(name,t,'DateTimeOriginal',name)
        self.assertEqual([r['path'] for r in j.next_batch(3)],['new.jpg','middle.jpg','old.jpg'])
        j.update('new.jpg',status='IMPORTED',asset_id='asset',session_id='session')
        j.close();j=self.m.Journal(state)
        self.assertEqual([r['path'] for r in j.next_batch(3)],['middle.jpg','old.jpg'])
        self.assertEqual(os.stat(state).st_mode&0o777,0o700)
        self.assertEqual(os.stat(state/'journal.sqlite').st_mode&0o777,0o600);j.close()

    def test_changed_source_is_not_uploaded(self):
        f=self.root/'photo.jpg';f.write_bytes(b'first');s=f.stat();expected=self.m.fingerprint(s)
        f.write_bytes(b'changed')
        with self.assertRaises(ValueError):self.m.verify_source(self.root,'photo.jpg',expected)

    def test_account_or_deployment_change_rejects_resume(self):
        j=self.m.Journal(Path(self.tmp.name)/'state');j.bind_identity('owner','deployment')
        j.bind_identity('owner','deployment')
        for owner,deployment in [('other','deployment'),('owner','different')]:
            with self.assertRaises(ValueError):j.bind_identity(owner,deployment)
        j.close()

    def test_signed_upload_destination_cannot_escape_bucket_owner_or_public_origin(self):
        origin='https://photos.example:8181';good=origin+'/sekereagle-assets/users/owner/assets/photo.jpg?X-Amz-Signature='+('a'*64)+'&partNumber=1&uploadId=upload'
        self.assertEqual(self.m.validate_upload_url(good,origin,'owner',1)[1],'photos.example:8181')
        for bad in [good.replace('photos.example:8181','evil.example'),good.replace('/users/owner/','/users/other/'),good.replace('sekereagle-assets','unknown-bucket'),good.replace('partNumber=1','partNumber=2')]:
            with self.assertRaises(ValueError):self.m.validate_upload_url(bad,origin,'owner',1)

    def test_policy_comes_from_shared_catalog_and_boundaries_are_inclusive(self):
        policy={'formats':[{'extension':'.jpg','mimeType':'image/jpeg','kind':'image'},{'extension':'.mov','mimeType':'video/quicktime','kind':'video'}],'imageMaxBytes':500000000,'videoMaxBytes':5000000000}
        self.assertEqual(self.m.file_policy('photo.JPG',500000000,policy),('image/jpeg','image'))
        self.assertIsNone(self.m.file_policy('photo.jpg',500000001,policy))
        self.assertEqual(self.m.file_policy('movie.mov',5000000000,policy),('video/quicktime','video'))
        self.assertIsNone(self.m.file_policy('config.exe',10,policy))

if __name__=='__main__':unittest.main()

class UploadRecoveryTests(unittest.TestCase):
    setUp = SharedImportTests.setUp
    def test_upload_resume_reuses_remote_parts_and_original_hash_without_owner_dto(self):
        import hashlib
        source=self.root/'camera.jpg';original=b'camera original bytes';source.write_bytes(original)
        j=self.m.Journal(Path(self.tmp.name)/'upload-state')
        j.add('camera.jpg',self.m.fingerprint(source.stat()),'image/jpeg','image');j.metadata('camera.jpg',10,'DateTimeOriginal','camera.jpg')
        session='11111111-1111-4111-8111-111111111111'
        class FakeApi:
            def __init__(self):self.parts={};self.sent=[];self.failed=False;self.declaration=None;self.done=False
            def request(self,method,path,body=None):
                if method=='POST' and path=='/photos/uploads':
                    self.declaration=body;return {'id':session,'partSize':4}
                if method=='GET' and path.endswith('/parts'):return {'parts':list(self.parts.values())}
                if method=='GET':return {'status':'COMPLETED' if self.done else 'INITIATED','eagleAssetId':'asset','assetStatus':'READY'}
                if path.endswith('/complete'):
                    self.done=True;return {'assetId':'asset','duplicate':False}
                return {'uploadUrl':path}
            def part(self,url,number,fd,offset,length):
                if number==2 and not self.failed:self.failed=True;raise OSError('interrupted')
                self.sent.append(number);self.parts[number]={'partNumber':number,'etag':'part'+str(number),'size':length}
                assert os.pread(fd,length,offset)==original[offset:offset+length]
                return self.parts[number]['etag']
        api=FakeApi()
        with self.assertRaises(OSError):self.m.upload_one(self.root,j,j.next_batch(1)[0],api)
        self.m.upload_one(self.root,j,j.next_batch(1)[0],api)
        self.assertEqual(api.sent.count(1),1)
        self.assertEqual(api.declaration['contentSha256'],hashlib.sha256(original).hexdigest())
        self.assertNotIn('ownerId',api.declaration)
        self.assertEqual(source.read_bytes(),original)
        self.assertEqual(j.summary(),{'IMPORTED':1});j.close()

class InventoryTests(unittest.TestCase):
    setUp = SharedImportTests.setUp
    def test_inventory_uses_verified_descriptors_and_freezes_discovery(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        (self.root/'photo.jpg').write_bytes(b'camera')
        (self.root/'@eaDir').mkdir();(self.root/'@eaDir'/'thumb.jpg').write_bytes(b'thumbnail')
        (self.root/'link.jpg').symlink_to(self.root/'photo.jpg')
        policy={'formats':[{'extension':'.jpg','mimeType':'image/jpeg','kind':'image'}],'imageMaxBytes':500000000,'videoMaxBytes':5000000000}
        j=self.m.Journal(Path(self.tmp.name)/'state')
        def exif(args,**kwargs):
            self.assertTrue(kwargs['pass_fds'])
            self.assertTrue(all('/source/' not in a for a in args))
            result=[]
            for fd in kwargs['pass_fds']:
                self.assertEqual(os.pread(fd,100,0),b'camera')
                result.append({'SourceFile':'/proc/self/fd/'+str(fd),'DateTimeOriginal':'2026:10:01 12:00:00','MIMEType':'image/jpeg'})
            return SimpleNamespace(returncode=0,stdout=json.dumps(result).encode())
        with patch.object(self.m.subprocess,'run',side_effect=exif):self.m.inventory(self.root,j,policy)
        self.assertEqual(j.summary(),{'PENDING':1})
        (self.root/'new.jpg').write_bytes(b'newer')
        self.m.inventory(self.root,j,policy)
        self.assertEqual(j.summary(),{'PENDING':1});j.close()

class JournalBatchTests(unittest.TestCase):
    setUp = SharedImportTests.setUp
    def test_inventory_batch_commits_together_and_rolls_back_on_failure(self):
        j=self.m.Journal(Path(self.tmp.name)/'state')
        with self.assertRaises(RuntimeError):
            with j.batch():
                j.add('photo.jpg',{'size':1,'mtime_ns':1,'inode':1,'device':1},'image/jpeg','image')
                raise RuntimeError('interrupted batch')
        self.assertEqual(j.summary(),{})
        with j.batch():
            j.add('photo.jpg',{'size':1,'mtime_ns':1,'inode':1,'device':1},'image/jpeg','image')
            j.metadata('photo.jpg',1,'FileModifyTime','photo.jpg')
        j.close();j=self.m.Journal(Path(self.tmp.name)/'state');self.assertEqual(j.summary(),{'PENDING':1});j.close()

    def test_special_source_files_do_not_block_discovery(self):
        from unittest.mock import patch
        os.mkfifo(self.root/'pipe.jpg')
        original=os.open
        def checked(path,flags,*args,**kwargs):
            if path=='pipe.jpg':self.assertTrue(flags&os.O_NONBLOCK)
            return original(path,flags,*args,**kwargs)
        with patch.object(self.m.os,'open',side_effect=checked),self.assertRaises(ValueError):self.m.open_source(self.root,'pipe.jpg')

class WideFilesystemFactsTests(unittest.TestCase):
    setUp = SharedImportTests.setUp
    def test_preserves_unsigned_inode_and_legacy_nanosecond_times_exactly(self):
        j=self.m.Journal(Path(self.tmp.name)/'state')
        j.add('photo.jpg',{'size':1,'mtime_ns':-(1<<64),'inode':(1<<64)-1,'device':1},'image/jpeg','image')
        j.metadata('photo.jpg',1,'FileModifyTime','photo.jpg')
        row=j.next_batch(1)[0]
        self.assertEqual(row['inode'],str((1<<64)-1))
        self.assertEqual(row['mtime_ns'],str(-(1<<64)));j.close()

class CoordinationTests(unittest.TestCase):
    setUp = SharedImportTests.setUp

    def test_waiting_importer_waits_for_inventory_lock(self):
        from unittest.mock import patch
        with open(Path(self.tmp.name)/'lock','a') as lock:
            with patch.object(self.m.fcntl,'flock',side_effect=[BlockingIOError(),None]) as flock, patch.object(self.m.time,'sleep') as sleep:
                self.assertTrue(self.m.acquire_lock(lock,wait=True))
                self.assertEqual(flock.call_count,2)
                sleep.assert_called_once_with(1)

    def test_processing_retry_does_not_treat_unknown_status_as_complete(self):
        from unittest.mock import patch
        j=self.m.Journal(Path(self.tmp.name)/'state')
        j.add('photo.jpg',{'size':1,'mtime_ns':'1','inode':'1','device':'1'},'image/jpeg','image')
        j.update('photo.jpg',status='IMPORTED',session_id='session')
        class Api:
            def __init__(self):self.calls=0
            def request(self,*args):
                self.calls+=1
                if self.calls==1:raise OSError('temporary')
                return {'assetStatus':'READY'}
        api=Api()
        with patch.object(self.m.time,'sleep'):self.m.await_processing(j,api)
        self.assertEqual(api.calls,2)
        self.assertEqual(j.db.execute('SELECT media_status FROM items').fetchone()[0],'READY')
        j.close()

class IngestPriorityTests(unittest.TestCase):
    setUp = SharedImportTests.setUp
    def test_original_ingest_does_not_wait_for_preview_batches(self):
        from unittest.mock import Mock,patch
        journal=Mock();journal.next_batch.side_effect=[[{'path':'photo.jpg'}],[]];journal.summary.return_value={'IMPORTED':1}
        api=Mock()
        with patch.object(self.m,'upload_one') as upload,patch.object(self.m,'await_processing') as processing:
            self.m.run_import(self.root,journal,api)
            upload.assert_called_once();processing.assert_not_called()

class AssembledUploadTests(unittest.TestCase):
    setUp = SharedImportTests.setUp
    def test_transient_inspection_failure_reuses_assembled_original_without_reupload(self):
        source=self.root/'camera.jpg';source.write_bytes(b'original')
        j=self.m.Journal(Path(self.tmp.name)/'state');j.add('camera.jpg',self.m.fingerprint(source.stat()),'image/jpeg','image');j.metadata('camera.jpg',10,'DateTimeOriginal','camera.jpg')
        session='11111111-1111-4111-8111-111111111111';j.update('camera.jpg',status='UPLOADING',session_id=session,part_size=100)
        class Api:
            def request(self,method,path,body=None):
                if path.endswith('/parts'):return {'parts':[{'partNumber':1,'etag':'existing'}]}
                if path.endswith('/complete'):
                    assert body=={'parts':[{'partNumber':1,'etag':'existing'}]};return {'assetId':'asset'}
                return {'status':'FAILED'}
            def part(self,*args):raise AssertionError('must not retransmit assembled file')
        self.m.upload_one(self.root,j,j.next_batch(1)[0],Api())
        self.assertEqual(j.summary(),{'IMPORTED':1});j.close()


class ConcurrentIngestTests(unittest.TestCase):
    setUp = SharedImportTests.setUp

    def make_journal(self, count=6):
        j=self.m.Journal(Path(self.tmp.name)/'concurrent-state')
        for i in range(count):
            name=f'{i}.jpg';j.add(name,{'size':10,'mtime_ns':i,'inode':i,'device':1},'image/jpeg','image')
            j.metadata(name,100-i,'DateTimeOriginal',name)
        return j

    def test_two_uploads_overlap_and_checkpoints_survive_resume(self):
        from unittest.mock import Mock,patch
        import threading
        j=self.make_journal();self.addCleanup(j.close)
        barrier=threading.Barrier(2);seen=[];lock=threading.Lock()
        def upload(root,journal,row,api):
            barrier.wait(timeout=3)
            with lock:seen.append(row['path'])
            journal.update(row['path'],status='IMPORTED',asset_id=row['path'])
        with patch.object(self.m,'upload_one',side_effect=upload):
            self.m.run_import(self.root,j,Mock(),concurrency=2)
        self.assertEqual(len(seen),6);self.assertEqual(len(set(seen)),6)
        self.assertEqual(set(seen[:2]),{'0.jpg','1.jpg'})
        self.assertEqual(j.summary(),{'IMPORTED':6})
        with patch.object(self.m,'upload_one') as repeated:
            self.m.run_import(self.root,j,Mock(),concurrency=2)
            repeated.assert_not_called()

    def test_auth_failure_does_not_dispatch_the_remaining_batch(self):
        from unittest.mock import Mock,patch
        import threading
        j=self.make_journal(10);self.addCleanup(j.close)
        barrier=threading.Barrier(2);seen=[]
        def upload(root,journal,row,api):
            seen.append(row['path']);barrier.wait(timeout=3)
            raise self.m.ApiError(401)
        with patch.object(self.m,'upload_one',side_effect=upload):
            with self.assertRaises(self.m.ApiError):self.m.run_import(self.root,j,Mock(),concurrency=2)
        self.assertEqual(len(seen),2)
        self.assertEqual(j.summary(),{'PENDING':10})

    def test_parallel_pilot_obeys_limit_and_permanent_failure_is_checkpointed(self):
        from unittest.mock import Mock,patch
        j=self.make_journal();self.addCleanup(j.close)
        def upload(root,journal,row,api):
            if row['path']=='0.jpg':raise self.m.ApiError(413)
            journal.update(row['path'],status='IMPORTED')
        with patch.object(self.m,'upload_one',side_effect=upload):
            self.m.run_import(self.root,j,Mock(),limit=2,concurrency=2)
        self.assertEqual(j.summary(),{'FAILED':1,'IMPORTED':1,'PENDING':4})

    def test_invalid_concurrency_is_rejected_before_authentication(self):
        from unittest.mock import Mock
        api=Mock()
        with self.assertRaises(ValueError):self.m.run_import(self.root,Mock(),api,concurrency=3)
        api.authenticate.assert_not_called()


    def test_stop_signal_leaves_unstarted_rows_pending(self):
        from unittest.mock import Mock,patch
        import threading
        j=self.make_journal();self.addCleanup(j.close)
        barrier=threading.Barrier(2)
        def upload(root,journal,row,api):
            barrier.wait(timeout=3);self.m.STOP=True
            journal.update(row['path'],status='IMPORTED')
        with patch.object(self.m,'upload_one',side_effect=upload):
            self.m.run_import(self.root,j,Mock(),concurrency=2)
        self.assertEqual(j.summary(),{'IMPORTED':2,'PENDING':4})

    def test_failed_checkpoint_transaction_cannot_rollback_other_thread(self):
        from concurrent.futures import ThreadPoolExecutor
        import sqlite3,threading
        j=self.make_journal(2);self.addCleanup(j.close)
        barrier=threading.Barrier(2)
        def failed():
            barrier.wait(timeout=3)
            with self.assertRaises(sqlite3.IntegrityError),j.write():
                j.db.execute("UPDATE items SET status='IMPORTED' WHERE path='0.jpg'")
                j.db.execute("INSERT INTO meta VALUES('schema_version','duplicate')")
        def success():
            barrier.wait(timeout=3);j.update('1.jpg',status='IMPORTED')
        with ThreadPoolExecutor(max_workers=2) as pool:
            a=pool.submit(failed);b=pool.submit(success);a.result();b.result()
        self.assertEqual(j.summary(),{'IMPORTED':1,'PENDING':1})
        self.assertEqual(j.db.execute("SELECT status FROM items WHERE path='1.jpg'").fetchone()[0],'IMPORTED')
