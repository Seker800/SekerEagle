import type { LibraryCommandRegistry } from './eagle-library-command';
import type { EagleDuplicateService } from './eagle-duplicates.service';
import type { DuplicateIgnoreDto } from './eagle-duplicates.dto';
export function registerDuplicateCommands(
  registry: LibraryCommandRegistry,
  duplicates: EagleDuplicateService,
) {
  registry.register('DUPLICATE_IGNORE', {
    protocol: 'METADATA',
    apply: async (tx, context, payload) => {
      await duplicates.ignore(
        context.ownerId,
        context.includePrivate,
        payload as unknown as DuplicateIgnoreDto,
        tx,
      );
    },
  });
}
