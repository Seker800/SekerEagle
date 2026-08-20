import type { CacheRpcMessage } from '../shared/cache-rpc';
import { CacheRpcDispatcher } from '../shared/cache-rpc';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('缓存 utility process 缺少父进程端口。');

const dispatcher = new CacheRpcDispatcher();
parentPort.on('message', (event) => {
  const message = event.data as CacheRpcMessage;
  void dispatcher.dispatch(message).then((response) => parentPort.postMessage(response));
});
