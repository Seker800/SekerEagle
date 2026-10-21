import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleUploadRecoveryService } from './eagle-upload-recovery.service';

test('NAS local copy can pause automatic HTTP upload recovery without starting inspection',()=>{
  const before=process.env.EAGLE_UPLOAD_RECOVERY_ENABLED;
  const service=new EagleUploadRecoveryService({} as never,{} as never,{} as never,{} as never,'PHOTO');
  let calls=0;Object.assign(service,{recoverPendingFinalizations:async()=>{calls++;}});
  try {
    process.env.EAGLE_UPLOAD_RECOVERY_ENABLED='false';service.onModuleInit();assert.equal(calls,0);
  }finally{service.onModuleDestroy();if(before===undefined)delete process.env.EAGLE_UPLOAD_RECOVERY_ENABLED;else process.env.EAGLE_UPLOAD_RECOVERY_ENABLED=before;}
});
test('automatic HTTP recovery retains its existing enabled default',()=>{
  const before=process.env.EAGLE_UPLOAD_RECOVERY_ENABLED;
  const service=new EagleUploadRecoveryService({} as never,{} as never,{} as never,{} as never,'PHOTO');
  let calls=0;Object.assign(service,{recoverPendingFinalizations:async()=>{calls++;}});
  try {
    delete process.env.EAGLE_UPLOAD_RECOVERY_ENABLED;service.onModuleInit();assert.equal(calls,1);
  }finally{service.onModuleDestroy();if(before===undefined)delete process.env.EAGLE_UPLOAD_RECOVERY_ENABLED;else process.env.EAGLE_UPLOAD_RECOVERY_ENABLED=before;}
});
