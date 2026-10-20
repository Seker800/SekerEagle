import type { LibraryMode } from '@prisma/client';
import { LIBRARY_MODE } from './library-mode';
import { Injectable, NotFoundException, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface EaglePrivacySettings {
  tagIds: string[];
}

export { lockOwnerPrivacyProjection, syncAssetPrivacy } from '@sekereagle/library-persistence';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from '@sekereagle/library-persistence';

@Injectable()
export class EaglePrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
  ) {}

  async getSettings(ownerId: string): Promise<EaglePrivacySettings> {
    const tags = await this.prisma.eagleManualTag.findMany({
      where: { ownerId, marksAssetsPrivate: true, libraryMode: this.libraryMode },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return { tagIds: tags.map(({ id }) => id) };
  }

  async updateSettings(
    ownerId: string,
    input: EaglePrivacySettings,
  ): Promise<EaglePrivacySettings> {
    const tagIds = [...new Set(input.tagIds)];
    await this.prisma.$transaction(async (transaction) => {
      await lockOwnerPrivacyProjection(transaction, ownerId, this.libraryMode);
      const ownedTagCount = await transaction.eagleManualTag.count({
        where: { ownerId, id: { in: tagIds }, libraryMode: this.libraryMode },
      });
      if (ownedTagCount !== tagIds.length) {
        throw new NotFoundException('一个或多个标签不存在。');
      }
      await transaction.eagleManualTag.updateMany({
        where: {
          ownerId,
          marksAssetsPrivate: true,
          ...(tagIds.length ? { id: { notIn: tagIds } } : {}),
          libraryMode: this.libraryMode,
        },
        data: { marksAssetsPrivate: false },
      });
      if (tagIds.length) {
        const marked = await transaction.eagleManualTag.updateMany({
          where: { ownerId, id: { in: tagIds }, libraryMode: this.libraryMode },
          data: { marksAssetsPrivate: true },
        });
        if (marked.count !== tagIds.length) {
          throw new NotFoundException('一个或多个标签不存在。');
        }
      }
      await syncAssetPrivacy(transaction, ownerId, undefined, this.libraryMode);
    });
    return { tagIds };
  }
}
