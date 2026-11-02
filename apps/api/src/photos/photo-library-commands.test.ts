import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { LibraryCommandRegistry, type LibraryCommandContext } from '../eagle/eagle-library-command';
import { registerPhotoLibraryCommands } from './photo-library-commands';
import { PhotoManagementService } from './photo-management.service';
const context: LibraryCommandContext = {
  operationId: 'intent',
  ownerId: 'owner',
  libraryMode: 'PHOTO',
  includePrivate: false,
  beforePublish: async () => {},
};
test('people metadata reuses the publication transaction and retains visible-person scope', async () => {
  const calls: unknown[] = [];
  const tx = {
    $executeRaw: async () => 0,
    eaglePhotoPerson: {
      findFirst: async (input: unknown) => {
        calls.push(input);
        return { id: 'person' };
      },
      update: async (input: unknown) => {
        calls.push(input);
        return { id: 'person' };
      },
    },
  };
  const photos = new PhotoManagementService({
    $transaction: () => {
      throw new Error('nested transaction');
    },
  } as never);
  const registry = new LibraryCommandRegistry();
  registerPhotoLibraryCommands(registry, { photos, review: {} as never, agent: {} as never });
  const d = registry.get('PHOTO_PERSON_RENAME');
  assert.equal(d.protocol, 'METADATA');
  if (d.protocol !== 'METADATA') return;
  await d.apply(tx as never, context, { id: 'person', name: '  Name  ' }, []);
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[0]), /owner/);
  assert.match(JSON.stringify(calls[0]), /PHOTO/);
  assert.match(JSON.stringify(calls[1]), /"name":"Name"/);
});
test('photography handlers fail closed in material operations', async () => {
  const registry = new LibraryCommandRegistry();
  registerPhotoLibraryCommands(registry, {
    photos: {} as never,
    review: {} as never,
    agent: {} as never,
  });
  for (const type of [
    'PHOTO_PERSON_RENAME',
    'PHOTO_PEOPLE_SCAN',
    'PHOTO_GROUPS_SCAN',
    'PHOTO_AGENT_MANUAL',
  ]) {
    const d = registry.get(type);
    const c = { ...context, libraryMode: 'MATERIAL' as const };
    await assert.rejects(
      d.protocol === 'METADATA' ? d.apply({} as never, c, {}, []) : d.execute(c, {}, []),
      /仅用于照片/,
    );
  }
});
test('background agent receives original queue authority guard', async () => {
  const calls: unknown[][] = [];
  const registry = new LibraryCommandRegistry();
  registerPhotoLibraryCommands(registry, {
    photos: {} as never,
    review: {} as never,
    agent: {
      review: async (...args: unknown[]) => {
        calls.push(args);
      },
    } as never,
  });
  const d = registry.get('PHOTO_AGENT_REVIEW');
  assert.equal(d.protocol, 'BACKGROUND');
  if (d.protocol !== 'BACKGROUND') return;
  await d.execute(context, { taskId: 'task', suggestionId: 'suggestion', action: 'ACCEPT' }, []);
  assert.equal(calls[0]?.[0], 'owner');
  assert.equal(calls[0]?.[4], false);
  assert.equal(calls[0]?.[5], context.beforePublish);
});

test('admission rejects inaccessible people before durable acceptance without publication locks', async () => {
  const queries: unknown[] = [];
  const photos = new PhotoManagementService({
    eaglePhotoPerson: {
      count: async (query: unknown) => {
        queries.push(query);
        return 0;
      },
    },
    $transaction: () => {
      throw new Error('admission took a transaction');
    },
  } as never);
  const registry = new LibraryCommandRegistry();
  registerPhotoLibraryCommands(registry, { photos, review: {} as never, agent: {} as never });
  await assert.rejects(
    registry.get('PHOTO_PERSON_RENAME').admit!(context, { id: 'foreign', name: 'Name' }, []),
    /人物不存在/,
  );
  assert.match(JSON.stringify(queries), /"ownerId":"owner"/);
  assert.match(JSON.stringify(queries), /"marksAssetsPrivate":false/);
});

test('admission rejects photography commands in material scope before domain access', async () => {
  const registry = new LibraryCommandRegistry();
  registerPhotoLibraryCommands(registry, {
    photos: {} as never,
    review: {} as never,
    agent: {} as never,
  });
  await assert.rejects(
    registry.get('PHOTO_AGENT_REVIEW').admit!({ ...context, libraryMode: 'MATERIAL' }, {}, []),
    /仅用于照片/,
  );
});
