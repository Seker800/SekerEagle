import { Buffer } from 'node:buffer';
import { open, mkdir, rename, lstat, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
export const OPERATIONS = ['embedding', 'image', 'faces', 'pyramid', 'video'];
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
export function validateEnrollment(value) {
  if (
    !value ||
    !idPattern.test(value.id) ||
    typeof value.name !== 'string' ||
    value.name.length < 1 ||
    value.name.length > 80
  )
    throw new Error('INVALID_NODE');
  let url;
  try {
    url = new URL(value.url);
  } catch (cause) {
    throw new Error('INVALID_NODE_TARGET', { cause });
  }
  const ip = url.hostname;
  const privateIp =
    isIP(ip) === 4 &&
    (ip.startsWith('127.') ||
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
  if (
    !privateIp ||
    ip === '192.168.31.89' ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !url.port
  )
    throw new Error('INVALID_NODE_TARGET');
  if (
    typeof value.token !== 'string' ||
    value.token.length < 8 ||
    value.token.length > 1024 ||
    /[\r\n]/.test(value.token)
  )
    throw new Error('INVALID_NODE_CREDENTIAL');
  if (
    !Number.isInteger(value.maxConcurrent) ||
    value.maxConcurrent < 1 ||
    value.maxConcurrent > 8 ||
    !Number.isInteger(value.reserveInteractive) ||
    value.reserveInteractive < 0 ||
    value.reserveInteractive >= value.maxConcurrent
  )
    throw new Error('INVALID_CAPACITY');
  if (
    !Array.isArray(value.operations) ||
    !value.operations.length ||
    new Set(value.operations).size !== value.operations.length ||
    !value.operations.every((x) => OPERATIONS.includes(x)) ||
    !['metal', 'cuda', 'cpu'].includes(value.accelerator) ||
    typeof value.enabled !== 'boolean'
  )
    throw new Error('INVALID_CAPABILITY');
  const verified = value.verified === true;
  if (value.verified !== undefined && typeof value.verified !== 'boolean')
    throw new Error('INVALID_NODE_VERIFICATION');
  if (value.enabled && !verified) throw new Error('INVALID_NODE_UNVERIFIED');
  const hostId = value.hostId ?? value.id,
    hostMaxConcurrent = value.hostMaxConcurrent ?? value.maxConcurrent;
  if (
    !idPattern.test(hostId) ||
    !Number.isInteger(hostMaxConcurrent) ||
    hostMaxConcurrent < value.maxConcurrent ||
    hostMaxConcurrent > 16
  )
    throw new Error('INVALID_HOST_CAPACITY');
  return {
    hostId,
    hostMaxConcurrent,
    verified,
    id: value.id,
    name: value.name,
    url: url.origin,
    token: value.token,
    accelerator: value.accelerator,
    operations: [...value.operations],
    maxConcurrent: value.maxConcurrent,
    reserveInteractive: value.reserveInteractive,
    enabled: value.enabled,
  };
}
function validateGroups(nodes) {
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length) throw new Error('DUPLICATE_NODE');
  if (new Set(nodes.map((n) => n.url)).size !== nodes.length) throw new Error('DUPLICATE_ENDPOINT');
  for (const node of nodes)
    for (const other of nodes) {
      if (node.id === other.id) continue;
      if (node.hostId === other.hostId && node.hostMaxConcurrent !== other.hostMaxConcurrent)
        throw new Error('INVALID_HOST_CAPACITY');
      if (
        new URL(node.url).hostname === new URL(other.url).hostname &&
        node.hostId !== other.hostId
      )
        throw new Error('INVALID_HOST_GROUP');
    }
}
function validPolicy(node, p) {
  return (
    p &&
    typeof p.enabled === 'boolean' &&
    (!p.enabled || node.verified) &&
    Number.isInteger(p.concurrency) &&
    p.concurrency >= 1 &&
    p.concurrency <= node.maxConcurrent &&
    Array.isArray(p.operations) &&
    p.operations.length > 0 &&
    new Set(p.operations).size === p.operations.length &&
    p.operations.every((op) => node.operations.includes(op)) &&
    typeof p.reason === 'string' &&
    p.reason.trim().length > 0 &&
    p.reason.length <= 200
  );
}
export async function readPrivateJson(path) {
  const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await h.stat();
    if (
      !stat.isFile() ||
      stat.size > 1024 * 1024 ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('PRIVATE_STATE_REQUIRED');
    const bytes = Buffer.alloc(1024 * 1024 + 1);
    const { bytesRead } = await h.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 1024 * 1024) throw new Error('PRIVATE_STATE_TOO_LARGE');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await h.close();
  }
}
export class Fleet {
  constructor({ directory, contract, now = Date.now }) {
    this.directory = directory;
    this.contract = contract;
    this.now = now;
    this.state = { revision: 0, nodes: [], policies: {}, audit: [] };
    this.runtime = new Map();
    this.dispatchSequence = 0;
    this.writing = Promise.resolve();
  }
  async initialize(nodes) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(this.directory);
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      directoryStat.mode & 0o077 ||
      (process.getuid && directoryStat.uid !== process.getuid())
    )
      throw new Error('PRIVATE_STATE_DIRECTORY_REQUIRED');
    try {
      this.state = await readPrivateJson(join(this.directory, 'state.json'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (!nodes) throw new Error('FLEET_NOT_ENROLLED', { cause: e });
      if (!Array.isArray(nodes) || nodes.length > 16)
        throw new Error('INVALID_STATE', { cause: e });
      this.state.nodes = nodes.map(validateEnrollment);
      validateGroups(this.state.nodes);
      await this.persist(this.state);
    }
    if (
      !Number.isSafeInteger(this.state.revision) ||
      this.state.revision < 0 ||
      !Array.isArray(this.state.nodes) ||
      this.state.nodes.length > 16 ||
      !this.state.policies ||
      !Array.isArray(this.state.audit)
    )
      throw new Error('INVALID_STATE');
    this.state.nodes = this.state.nodes.map(validateEnrollment);
    validateGroups(this.state.nodes);
    if (
      Array.isArray(this.state.policies) ||
      !Object.entries(this.state.policies).every(([id, p]) => {
        const node = this.state.nodes.find((n) => n.id === id);
        return node && validPolicy(node, p) && Number.isSafeInteger(p.expiresAt) && p.expiresAt > 0;
      }) ||
      this.state.audit.length > 200 ||
      !this.state.audit.every(
        (e) =>
          e &&
          Number.isSafeInteger(e.revision) &&
          e.revision >= 0 &&
          Number.isFinite(e.at) &&
          typeof e.reason === 'string' &&
          e.reason.length <= 200,
      )
    )
      throw new Error('INVALID_STATE');
    if (new Set(this.state.nodes.map((n) => n.id)).size !== this.state.nodes.length)
      throw new Error('DUPLICATE_NODE');
    for (const node of this.state.nodes)
      this.runtime.set(node.id, {
        health: 'OFFLINE',
        starting: true,
        seenAt: 0,
        inFlight: 0,
        background: 0,
        ewma: 1000,
        operationEwma: new Map(),
        lastAssigned: 0,
        completed: 0,
      });
  }
  async persist(state) {
    const path = join(this.directory, `state-${randomUUID()}.tmp`);
    const h = await open(path, 'wx', 0o600);
    try {
      await h.writeFile(JSON.stringify(state));
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(path, join(this.directory, 'state.json'));
    const directory = await open(this.directory, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  policy(node) {
    const p = this.state.policies[node.id];
    return p && p.expiresAt > this.now()
      ? p
      : {
          enabled: node.enabled,
          concurrency: node.maxConcurrent,
          operations: node.operations,
          expiresAt: null,
          reason: '登记基线',
        };
  }
  enroll(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return Promise.reject(new Error('INVALID_ENROLLMENT'));
    const operation = this.writing.then(async () => {
      if (input.expectedRevision !== this.state.revision) throw new Error('REVISION_CONFLICT');
      const node = validateEnrollment(input.node),
        existing = this.state.nodes.find((n) => n.id === node.id);
      if (existing && (this.policy(existing).enabled || this.runtime.get(node.id).inFlight > 0))
        throw new Error('INVALID_ENROLLMENT_DRAIN_FIRST');
      if (!existing && this.state.nodes.length >= 16) throw new Error('INVALID_FLEET_CAPACITY');
      const next = globalThis.structuredClone(this.state);
      next.revision++;
      next.nodes = next.nodes.filter((n) => n.id !== node.id);
      next.nodes.push(node);
      validateGroups(next.nodes);
      delete next.policies[node.id];
      next.audit = [
        ...next.audit,
        { revision: next.revision, at: this.now(), nodeId: node.id, reason: '运维登记节点' },
      ].slice(-200);
      await this.persist(next);
      this.state = next;
      this.runtime.set(node.id, {
        health: 'OFFLINE',
        starting: true,
        seenAt: 0,
        inFlight: 0,
        background: 0,
        ewma: 1000,
        operationEwma: new Map(),
        lastAssigned: 0,
        completed: 0,
      });
      return this.snapshot();
    });
    this.writing = operation.catch(() => {});
    return operation;
  }
  update(input) {
    const operation = this.writing.then(async () => {
      if (input.expectedRevision !== this.state.revision) throw new Error('REVISION_CONFLICT');
      const node = this.state.nodes.find((n) => n.id === input.nodeId);
      if (!node) throw new Error('NODE_NOT_FOUND');
      if (input.enabled && !node.verified) throw new Error('INVALID_NODE_UNVERIFIED');
      if (
        typeof input.enabled !== 'boolean' ||
        !Number.isInteger(input.concurrency) ||
        input.concurrency < 1 ||
        input.concurrency > node.maxConcurrent
      )
        throw new Error('INVALID_CAPACITY');
      if (
        !Array.isArray(input.operations) ||
        !input.operations.length ||
        new Set(input.operations).size !== input.operations.length ||
        !input.operations.every((op) => node.operations.includes(op))
      )
        throw new Error('INVALID_CAPABILITY');
      if (
        !Number.isInteger(input.durationSeconds) ||
        input.durationSeconds < 60 ||
        input.durationSeconds > 604800 ||
        typeof input.reason !== 'string' ||
        !input.reason.trim() ||
        input.reason.length > 200
      )
        throw new Error('INVALID_POLICY');
      const next = globalThis.structuredClone(this.state);
      next.revision++;
      next.policies[node.id] = {
        enabled: input.enabled,
        concurrency: input.concurrency,
        operations: [...input.operations],
        expiresAt: this.now() + input.durationSeconds * 1000,
        reason: input.reason,
      };
      next.audit = [
        ...next.audit,
        { revision: next.revision, at: this.now(), nodeId: node.id, ...next.policies[node.id] },
      ].slice(-200);
      await this.persist(next);
      this.state = next;
      return this.snapshot();
    });
    this.writing = operation.catch(() => {});
    return operation;
  }
  quarantine(id) {
    const r = this.runtime.get(id);
    if (r) {
      r.quarantined = true;
      r.health = 'OFFLINE';
    }
  }
  markHealth(id, payload) {
    const node = this.state.nodes.find((n) => n.id === id),
      r = this.runtime.get(id);
    if (!node || !r) return;
    if (Number.isInteger(payload?.capacity?.inFlight) && payload.capacity.inFlight >= 0)
      r.external = Math.max(0, payload.capacity.inFlight - r.inFlight);
    if (
      (r.quarantined && payload?.capacity?.inFlight !== 0) ||
      (r.starting && payload?.capacity?.inFlight !== 0)
    ) {
      r.health = 'OFFLINE';
      return;
    }
    if (r.quarantined) r.quarantined = false;
    r.starting = false;
    if (
      Number.isFinite(payload?.capacity?.limit) &&
      payload.capacity.limit < this.policy(node).concurrency
    ) {
      r.health = 'DRIFTED';
      r.seenAt = this.now();
      return;
    }
    const embedding =
      !node.operations.includes('embedding') ||
      (payload?.model === this.contract.model &&
        payload?.revision === this.contract.revision &&
        payload?.dimensions === this.contract.dimensions &&
        (node.accelerator === 'metal'
          ? payload.metal === true
          : payload.accelerator === node.accelerator));
    const faceCompatible =
      !node.operations.includes('faces') ||
      payload?.faceVersion === 'yunet-2023mar-sface-2021dec-v1';
    const media = node.operations.every(
      (op) =>
        op === 'embedding' ||
        (payload?.protocol === 'sekereagle-media-v1' &&
          Array.isArray(payload.operations) &&
          payload.operations.includes(op) &&
          (op !== 'image' || payload.imageEncoding === 'SEI1') &&
          (!['pyramid', 'video'].includes(op) || payload.artifactEncoding === 'SEA1')),
    );
    r.health =
      payload?.status === 'ready' && embedding && media && faceCompatible
        ? 'READY'
        : payload
          ? 'DRIFTED'
          : 'OFFLINE';
    r.seenAt = this.now();
    r.memory = Object.fromEntries(
      ['activeBytes', 'cacheBytes', 'peakBytes', 'cacheLimitBytes']
        .filter(
          (k) =>
            Number.isFinite(payload?.memory?.[k]) &&
            payload.memory[k] >= 0 &&
            payload.memory[k] <= 1024 ** 5,
        )
        .map((k) => [k, payload.memory[k]]),
    );
    r.system = Object.fromEntries(
      ['freeMemoryBytes', 'totalMemoryBytes', 'processRssBytes', 'loadAverage']
        .filter(
          (k) =>
            Number.isFinite(payload?.system?.[k]) &&
            payload.system[k] >= 0 &&
            payload.system[k] <= 1024 ** 5,
        )
        .map((k) => [k, payload.system[k]]),
    );
  }
  hostState(node) {
    const peers = this.state.nodes.filter((n) => n.hostId === node.hostId);
    return {
      inFlight: peers.reduce(
        (sum, n) =>
          sum + (this.runtime.get(n.id)?.inFlight ?? 0) + (this.runtime.get(n.id)?.external ?? 0),
        0,
      ),
      background: peers.reduce(
        (sum, n) =>
          sum + (this.runtime.get(n.id)?.background ?? 0) + (this.runtime.get(n.id)?.external ?? 0),
        0,
      ),
      reserve: Math.max(
        ...peers.map((n) =>
          this.policy(n).enabled && this.policy(n).operations.includes('embedding')
            ? n.reserveInteractive
            : 0,
        ),
      ),
    };
  }
  available(node) {
    const r = this.runtime.get(node.id);
    return r && r.health === 'READY' && this.now() - r.seenAt <= 15000;
  }
  backgroundCapacity(nodes) {
    const hosts = new Map();
    for (const n of nodes.filter(
      (n) => n.enabled && n.health === 'READY' && n.operations.includes('embedding'),
    )) {
      const h = hosts.get(n.hostId) ?? {
        sum: 0,
        limit: Math.max(0, n.hostMaxConcurrent - this.hostState(n).reserve),
      };
      h.sum += Math.max(0, n.concurrency - n.reserveInteractive);
      hosts.set(n.hostId, h);
    }
    return Math.min(
      32,
      [...hosts.values()].reduce((sum, h) => sum + Math.min(h.sum, h.limit), 0),
    );
  }
  snapshot() {
    const nodes = this.state.nodes.map((node) => {
      const p = this.policy(node),
        r = this.runtime.get(node.id);
      return {
        id: node.id,
        hostId: node.hostId,
        hostMaxConcurrent: node.hostMaxConcurrent,
        hostInFlight: this.hostState(node).inFlight,
        name: node.name,
        accelerator: node.accelerator,
        enabled: p.enabled,
        verified: node.verified,
        concurrency: p.concurrency,
        maxConcurrent: node.maxConcurrent,
        reserveInteractive: node.reserveInteractive,
        operations: p.operations,
        expiresAt: p.expiresAt,
        reason: p.reason,
        health: this.available(node) ? 'READY' : r?.health === 'DRIFTED' ? 'DRIFTED' : 'OFFLINE',
        inFlight: r?.inFlight ?? 0,
        completed: r?.completed ?? 0,
        memory: r?.memory ?? {},
        system: r?.system ?? {},
        averageMs: Math.round(r?.ewma ?? 0),
        operationAverageMs: Object.fromEntries(
          [...(r?.operationEwma ?? [])].map(([operation, milliseconds]) => [
            operation,
            Math.round(milliseconds),
          ]),
        ),
      };
    });
    return {
      revision: this.state.revision,
      nodes,
      audit: this.state.audit,
      backgroundLimit: this.backgroundCapacity(nodes),
    };
  }
  acquire(operation, interactive) {
    const candidates = this.state.nodes.filter((node) => {
      const p = this.policy(node),
        r = this.runtime.get(node.id);
      const host = this.hostState(node);
      return (
        host.inFlight < node.hostMaxConcurrent &&
        (interactive || host.background < Math.max(0, node.hostMaxConcurrent - host.reserve)) &&
        this.available(node) &&
        p.enabled &&
        node.verified &&
        p.operations.includes(operation) &&
        r.inFlight + r.external < p.concurrency &&
        (interactive ||
          r.background + r.external <
            Math.max(
              0,
              p.concurrency - (p.operations.includes('embedding') ? node.reserveInteractive : 0),
            ))
      );
    });
    candidates.sort((a, b) => {
      const x = this.runtime.get(a.id),
        y = this.runtime.get(b.id);
      const xLoad = x.inFlight + (x.external ?? 0),
        yLoad = y.inFlight + (y.external ?? 0);
      // Use idle capacity before queueing more work on a busy host. Rotate idle
      // peers so one long video never prevents its host receiving quick image work.
      const idle = Number(xLoad > 0) - Number(yLoad > 0);
      if (idle) return idle;
      if (!xLoad && !yLoad) return x.lastAssigned - y.lastAssigned || a.id.localeCompare(b.id);
      return (
        (xLoad + 1) * (x.operationEwma.get(operation) ?? 1000) -
          (yLoad + 1) * (y.operationEwma.get(operation) ?? 1000) ||
        x.lastAssigned - y.lastAssigned ||
        a.id.localeCompare(b.id)
      );
    });
    const node = candidates[0];
    if (!node) return null;
    const r = this.runtime.get(node.id);
    r.inFlight++;
    r.lastAssigned = ++this.dispatchSequence;
    if (!interactive) r.background++;
    let released = false;
    return {
      node,
      release: (elapsed, successful = true) => {
        if (released) throw new Error('ALREADY_RELEASED');
        released = true;
        r.inFlight--;
        if (!interactive) r.background--;
        if (!successful) return;
        r.completed++;
        const duration = Math.max(1, elapsed);
        r.ewma = r.ewma * 0.8 + duration * 0.2;
        const previous = r.operationEwma.get(operation);
        r.operationEwma.set(
          operation,
          previous === undefined ? duration : previous * 0.8 + duration * 0.2,
        );
      },
    };
  }
}
