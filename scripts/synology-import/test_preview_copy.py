import importlib.util,pathlib,tempfile,unittest,json
class PreviewCopyTests(unittest.TestCase):
 def test_checkpoint_freezes_manifest_and_resumes_after_complete_batches(self):
  path=pathlib.Path(__file__).with_name('preview_copy.py');spec=importlib.util.spec_from_file_location('preview_copy',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  with tempfile.TemporaryDirectory() as directory:
   p=pathlib.Path(directory)/'progress.json'
   self.assertEqual(m.load_checkpoint(p,'hash',200)['offset'],0)
   m.save_checkpoint(p,{'manifestHash':'hash','total':200,'offset':100,'counts':{'COPIED':90,'SKIPPED':10}})
   self.assertEqual(m.load_checkpoint(p,'hash',200)['offset'],100)
   with self.assertRaises(ValueError):m.load_checkpoint(p,'other',200)
   with self.assertRaises(ValueError):m.load_checkpoint(p,'hash',201)
