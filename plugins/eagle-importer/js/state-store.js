'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { HashCacheStore } = require('./hash-cache-store');
const { ScanWorkspace } = require('./scan-workspace');

const EMPTY_STATE = Object.freeze({
  serverUrl: '',
  email: '',
  rememberPassword: true,
  password: '',
  accessToken: '',
  refreshToken: '',
  autoReconnect: true,
  autoSyncEnabled: false,
  autoSyncTime: '03:00',
  lastAutoSyncDate: '',
  lastAutoSyncPausedDate: '',
  lastAutoSyncAttemptAt: '',
  lastAutoSyncStatus: '',
  lastAutoSyncError: '',
  libraryBindings: {},
  hashCache: {},
  activeRun: null,
});

class StateStore {
  constructor(userDataPath) {
    this.directory = path.join(userDataPath, 'SekerEagleImporter');
    this.filePath = path.join(this.directory, 'state.json');
    this.legacyStateBackupPath = path.join(this.directory, 'state.v1-backup.json');
    this.hashCache = new HashCacheStore(this.directory);
    this.state = { ...EMPTY_STATE, libraryBindings: {}, hashCache: {} };
    this.saveTail = Promise.resolve();
    this.loadWarning = '';
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new SyntaxError('状态文件根节点必须是对象。');
      }
      this.state = {
        ...EMPTY_STATE,
        ...withoutSecrets(parsed),
        libraryBindings: isRecord(parsed.libraryBindings) ? parsed.libraryBindings : {},
        hashCache: {},
      };
      const legacyHashCache = isRecord(parsed.hashCache) ? parsed.hashCache : {};
      if (Object.keys(legacyHashCache).length > 0) {
        await this.persistLegacyBackup(withoutSecrets(parsed));
        await this.hashCache.migrateLegacy(legacyHashCache);
      }
      if (containsSecrets(parsed) || Object.hasOwn(parsed, 'hashCache')) {
        await this.persist(persistentState(this.state));
      }
    } catch (error) {
      if (error.code === 'ENOENT') return this.state;
      if (!(error instanceof SyntaxError)) throw error;
      const backupPath = path.join(this.directory, `state.corrupt-${Date.now()}.json`);
      await fs.rename(this.filePath, backupPath);
      this.loadWarning = `本地状态文件已损坏，已备份为 ${path.basename(backupPath)} 并使用默认设置。`;
    }
    return this.state;
  }

  async save(patch = {}) {
    this.state = { ...this.state, ...patch };
    const snapshot = persistentState(this.state);
    const operation = this.saveTail.then(() => this.persist(snapshot));
    this.saveTail = operation.catch(() => undefined);
    await operation;
    return this.state;
  }

  async persist(state) {
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporary, this.filePath);
  }

  async persistLegacyBackup(state) {
    try {
      await fs.access(this.legacyStateBackupPath);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const temporary = `${this.legacyStateBackupPath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporary, this.legacyStateBackupPath);
  }

  async clearSession() {
    return this.save({ accessToken: '', refreshToken: '' });
  }

  async createScanWorkspace() {
    const root = path.join(this.directory, 'scan-spool-v1');
    await fs.rm(root, { recursive: true, force: true });
    const workspace = new ScanWorkspace(path.join(root, `${Date.now()}-${process.pid}`));
    return workspace.open();
  }
}

const SECRET_KEYS = new Set(['password', 'accessToken', 'refreshToken']);

function isRecord(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object';
}

function containsSecrets(state) {
  return [...SECRET_KEYS].some((key) => Object.prototype.hasOwnProperty.call(state, key));
}

function withoutSecrets(state) {
  return Object.fromEntries(Object.entries(state).filter(([key]) => !SECRET_KEYS.has(key)));
}

function persistentState(state) {
  return Object.fromEntries(
    Object.entries(withoutSecrets(state)).filter(([key]) => key !== 'hashCache'),
  );
}

module.exports = { StateStore };
