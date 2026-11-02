import { BadRequestException, Injectable } from '@nestjs/common';
import type { LibraryMode, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export interface LibraryCommandContext {
  ownerId: string;
  operationId: string;
  libraryMode: LibraryMode;
  includePrivate: boolean;
  /** Call inside the original publication transaction, including journal publication. */
  beforePublish: (tx: Prisma.TransactionClient) => Promise<void>;
}
export interface LibraryCommandInput {
  operationId?: string;
  type: string;
  payload: Prisma.InputJsonObject;
  assetIds?: string[];
}
export interface LibraryCommandSnapshot {
  version: 1;
  type: string;
  payload: Prisma.InputJsonObject;
  sharedPayload?: boolean;
  resources?: Array<{ id: string; mediaRevision: number }>;
}
type CommandBase = {
  /** Capture immutable admission facts without taking domain publication locks. */
  prepare?: (
    context: LibraryCommandContext,
    payload: Prisma.InputJsonObject,
    assetIds: string[],
    tx: Prisma.TransactionClient,
  ) => Promise<Prisma.InputJsonObject>;
  admit?: (
    context: LibraryCommandContext,
    payload: Prisma.InputJsonObject,
    assetIds: string[],
  ) => void | Promise<void>;
  partition?: (
    payload: Prisma.InputJsonObject,
    assetIds: string[],
  ) => Array<{ payload: Prisma.InputJsonObject; assetIds: string[] }>;
};
export type LibraryCommandDefinition = CommandBase &
  (
    | {
        protocol: 'METADATA';
        apply: (
          tx: Prisma.TransactionClient,
          context: LibraryCommandContext,
          payload: Prisma.InputJsonObject,
          assetIds: string[],
        ) => Promise<void>;
      }
    | {
        protocol: 'BACKGROUND';
        execute: (
          context: LibraryCommandContext,
          payload: Prisma.InputJsonObject,
          assetIds: string[],
        ) => Promise<void>;
      }
  );

/** Explicit domain extension boundary; shared orchestration has no PHOTO imports. */
@Injectable()
export class LibraryCommandRegistry {
  private readonly definitions = new Map<string, LibraryCommandDefinition>();
  register(type: string, definition: LibraryCommandDefinition): void {
    if (this.definitions.has(type)) throw new Error(`Duplicate library command: ${type}`);
    this.definitions.set(type, definition);
  }
  get(type: string): LibraryCommandDefinition {
    const definition = this.definitions.get(type);
    if (!definition) throw new BadRequestException('不支持此后台操作。');
    return definition;
  }
}

/** Reuse an existing publication transaction instead of nesting domain transactions. */
export function runLibraryTransaction<T>(
  db: PrismaService | Prisma.TransactionClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    timeout?: number;
    maxWait?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  },
): Promise<T> {
  return '$transaction' in db ? db.$transaction(run, options) : run(db);
}
export function libraryCommandPayload(input: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonObject;
}
/** Canonical intent equality is independent of object key insertion order. */
export function canonicalLibraryCommand(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalLibraryCommand).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalLibraryCommand(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
