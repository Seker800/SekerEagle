"""One independent NAS process; media writes remain in the scoped worker adapter."""
import argparse,hashlib,json,os,pathlib,signal,subprocess,sys,time
STOP=False

def run_batch(command):
 # Retry only dependency outages, never identity, manifest or validation failures.
 for attempt in range(21):
  if STOP:raise RuntimeError('PREVIEW_COPY_STOPPED')
  process=subprocess.run(command,capture_output=True,text=True,timeout=900)
  if not process.returncode:return json.loads(process.stdout)
  temporary=any(marker in process.stderr for marker in (
   "Can't reach database server at `postgres:5432`",'ECONNREFUSED','EAI_AGAIN','ECONNRESET'))
  if not temporary:raise RuntimeError('PREVIEW_BATCH_FAILED')
  if attempt==20:raise RuntimeError('PREVIEW_DEPENDENCY_UNAVAILABLE')
  print('Preview dependency unavailable; checkpoint retained; retrying in 30 seconds.',flush=True)
  # One-second intervals allow SIGTERM to stop promptly without advancing state.
  for _ in range(30):
   if STOP:raise RuntimeError('PREVIEW_COPY_STOPPED')
   time.sleep(1)

def load_checkpoint(path,digest,total):
 if not path.exists():return {'manifestHash':digest,'total':total,'offset':0,'counts':{}}
 state=json.loads(path.read_text())
 if state.get('manifestHash')!=digest or state.get('total')!=total or not isinstance(state.get('offset'),int) or not 0<=state['offset']<=total:raise ValueError('PREVIEW_MANIFEST_CHANGED')
 return state

def save_checkpoint(path,state):
 temp=path.with_suffix('.tmp');temp.write_text(json.dumps(state));os.chmod(temp,0o600);temp.replace(path)

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);parser.add_argument('--state',required=True);parser.add_argument('--source',required=True);args=parser.parse_args()
 raw=pathlib.Path(args.manifest).read_bytes();manifest=json.loads(raw);directory=pathlib.Path(args.state);directory.mkdir(exist_ok=True)
 progress=directory/'progress.json';state=load_checkpoint(progress,hashlib.sha256(raw).hexdigest(),len(manifest['items']))
 while state['offset']<state['total'] and not STOP:
  batch={'ownerId':manifest['ownerId'],'items':manifest['items'][state['offset']:state['offset']+100]};path=directory/'batch.json';path.write_text(json.dumps(batch));os.chmod(path,0o600)
  result=run_batch(['node','/sekereagle/apps/worker/dist/synology-preview-pilot.js',str(path),args.source,'--apply'])
  if len(result['report'])!=len(batch['items']):raise RuntimeError('PREVIEW_BATCH_INCOMPLETE')
  with (directory/'results.jsonl').open('a') as log:
   for row in result['report']:
    status=row['status'];state['counts'][status]=state['counts'].get(status,0)+1;log.write(json.dumps(row)+'\n')
  state['offset']+=len(batch['items']);state['complete']=state['offset']==state['total'];save_checkpoint(progress,state);print(json.dumps(state),flush=True)
 return 0

def stop(_signal,_frame):
 global STOP
 STOP=True

if __name__=='__main__':
 signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
 try:sys.exit(main())
 except Exception as error:print(str(error),file=sys.stderr,flush=True);sys.exit(1)
