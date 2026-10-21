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
