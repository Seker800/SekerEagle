const DATABASE_NAME = 'sekereagle-browser-capture';
const STORE_NAME = 'captures';

export function createQueueStore(indexedDBImpl = indexedDB) {
  let databasePromise;

  function database() {
    databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDBImpl.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('status', 'status');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }

  async function transaction(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try {
        result = operation(store);
      } catch (error) {
        tx.abort();
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('本地队列事务已中止。'));
    });
  }

  return {
    put(job) {
      return transaction('readwrite', (store) => store.put(job));
    },
    get(id) {
      return transaction('readonly', (store) => store.get(id));
    },
    delete(id) {
      return transaction('readwrite', (store) => store.delete(id));
    },
    list() {
      return transaction('readonly', (store) => store.getAll()).then((jobs) =>
        jobs.sort((left, right) => left.createdAt - right.createdAt),
      );
    },
    async update(id, changes) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        let updated;
        request.onsuccess = () => {
          if (!request.result) return;
          updated = { ...request.result, ...changes, updatedAt: Date.now() };
          store.put(updated);
        };
        tx.oncomplete = () => resolve(updated);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('本地队列事务已中止。'));
      });
    },
    async recoverInterrupted() {
      const jobs = await this.list();
      await Promise.all(
        jobs
          .filter((job) => ['FETCHING', 'UPLOADING', 'COMMITTING'].includes(job.status))
          .map((job) =>
            this.update(job.id, {
              status: 'RETRY',
              nextAttemptAt: Date.now(),
              lastError: '浏览器后台进程曾中断，正在恢复。',
            }),
          ),
      );
    },
  };
}
