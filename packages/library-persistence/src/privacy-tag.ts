import type { Prisma, LibraryMode } from '@prisma/client';
/** Explicit private label for derived/replaced content without copying biometric analysis. */
export async function inheritedPrivacyTag(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
) {
  for (let suffix = 0; suffix < 100; suffix++) {
    const name = suffix ? `继承私密 ${suffix + 1}` : '继承私密';
    const tag = await transaction.eagleManualTag.upsert({
      where: { ownerId_libraryMode_normalizedName: { ownerId, libraryMode, normalizedName: name } },
      update: {},
      create: { ownerId, libraryMode, name, normalizedName: name, marksAssetsPrivate: true },
    });
    if (tag.marksAssetsPrivate) return tag.id;
  }
  throw new Error('无法创建继承私密标签，请调整同名标签后重试。');
}
