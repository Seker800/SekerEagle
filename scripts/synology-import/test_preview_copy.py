import importlib.util,pathlib,tempfile,unittest,json,subprocess
from unittest.mock import patch
class PreviewCopyTests(unittest.TestCase):
 def module(self):
  spec=importlib.util.spec_from_file_location('preview_copy',pathlib.Path(__file__).with_name('preview_copy.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
 def test_database_boot_race_retries_same_batch(self):
  m=self.module();failed=subprocess.CompletedProcess([],1,'',"Can't reach database server at `postgres:5432`");ok=subprocess.CompletedProcess([],0,'{"report": []}','')
  with patch.object(m.subprocess,'run',side_effect=[failed,ok]) as run,patch('time.sleep') as sleep:
   self.assertEqual(m.run_batch(['node','batch']),{'report':[]});self.assertEqual(run.call_count,2);self.assertEqual(sleep.call_count,30)
 def test_permanent_error_does_not_retry(self):
  m=self.module()
  with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','OWNER_MISMATCH')) as run:
   with self.assertRaisesRegex(RuntimeError,'PREVIEW_BATCH_FAILED'):m.run_batch(['node','batch'])
   self.assertEqual(run.call_count,1)
 def test_dependency_retry_is_bounded_and_stop_interrupts(self):
  m=self.module();failed=subprocess.CompletedProcess([],1,'',"Can't reach database server at `postgres:5432`")
  with patch.object(m.subprocess,'run',return_value=failed) as run,patch('time.sleep'):
   with self.assertRaisesRegex(RuntimeError,'UNAVAILABLE'):m.run_batch(['node','batch'])
   self.assertEqual(run.call_count,21)
  m.STOP=True
  with patch.object(m.subprocess,'run',return_value=failed) as run:
   with self.assertRaisesRegex(RuntimeError,'STOPPED'):m.run_batch(['node','batch'])
   run.assert_not_called()
 def test_checkpoint_freezes_manifest_and_resumes_after_complete_batches(self):
  path=pathlib.Path(__file__).with_name('preview_copy.py');spec=importlib.util.spec_from_file_location('preview_copy',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  with tempfile.TemporaryDirectory() as directory:
   p=pathlib.Path(directory)/'progress.json'
   self.assertEqual(m.load_checkpoint(p,'hash',200)['offset'],0)
   m.save_checkpoint(p,{'manifestHash':'hash','total':200,'offset':100,'counts':{'COPIED':90,'SKIPPED':10}})
   self.assertEqual(m.load_checkpoint(p,'hash',200)['offset'],100)
   with self.assertRaises(ValueError):m.load_checkpoint(p,'other',200)
   with self.assertRaises(ValueError):m.load_checkpoint(p,'hash',201)
