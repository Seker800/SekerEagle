import { performance } from 'node:perf_hooks';
import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';

/** Trace the public driver boundary: Prisma 7's client log omits BEGIN. */
export function observePrismaAdapter(observe, connectionString) {
  const factory = createPrismaAdapter(connectionString);
  const record = (query, args, started) =>
    observe({
      query,
      params: JSON.stringify(args, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
      duration: performance.now() - started,
    });
  async function execute(connection, method, query) {
    const started = performance.now();
    try {
      return await connection[method](query);
    } finally {
      record(query.sql, query.args, started);
    }
  }
  function trace(connection) {
    const queries = {
      provider: connection.provider,
      adapterName: connection.adapterName,
      queryRaw: (query) => execute(connection, 'queryRaw', query),
      executeRaw: (query) => execute(connection, 'executeRaw', query),
    };
    if (connection.options) {
      const savepoint = async (method, sql, name) => {
        const started = performance.now();
        try {
          return await connection[method](name);
        } finally {
          record(`${sql} ${name}`, [], started);
        }
      };
      return {
        ...queries,
        options: connection.options,
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
        createSavepoint: (name) => savepoint('createSavepoint', 'SAVEPOINT', name),
        rollbackToSavepoint: (name) =>
          savepoint('rollbackToSavepoint', 'ROLLBACK TO SAVEPOINT', name),
        releaseSavepoint: (name) => savepoint('releaseSavepoint', 'RELEASE SAVEPOINT', name),
      };
    }
    return {
      ...queries,
      async startTransaction(isolationLevel) {
        const started = performance.now();
        const transaction = await connection.startTransaction(isolationLevel);
        // PrismaPg begins the transaction inside this public lifecycle call,
        // while COMMIT/ROLLBACK pass through executeRaw and are recorded there.
        record('BEGIN', [], started);
        if (isolationLevel)
          record(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`, [], started);
        return trace(transaction);
      },
      executeScript: (script) => connection.executeScript(script),
      getConnectionInfo: () => connection.getConnectionInfo(),
      dispose: () => connection.dispose(),
    };
  }
  return {
    provider: factory.provider,
    adapterName: factory.adapterName,
    connect: async () => trace(await factory.connect()),
    connectToShadowDb: async () => trace(await factory.connectToShadowDb()),
  };
}
