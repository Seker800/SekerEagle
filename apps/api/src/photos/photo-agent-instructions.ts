import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { UpdatePhotoAgentInstructionsDto } from './photo-agent.dto';

export async function readPhotoInstructions(db: PrismaService, ownerId: string) {
  const row = await db.eaglePhotoAgentPreference.findUnique({
    where: { ownerId_libraryMode: { ownerId, libraryMode: 'PHOTO' } },
    select: { instructions: true, revision: true, updatedAt: true },
  });
  return row ?? { instructions: '', revision: 0, updatedAt: null };
}

export async function savePhotoInstructions(db: PrismaService, ownerId: string, input: UpdatePhotoAgentInstructionsDto) {
  try {
    return await db.$transaction(async tx => {
      const where = { ownerId, libraryMode: 'PHOTO' as const };
      if (input.revision === 0) {
        await tx.eaglePhotoAgentPreference.create({data:{...where,instructions:input.instructions}});
      } else {
        const result = await tx.eaglePhotoAgentPreference.updateMany({
          where:{...where,revision:input.revision},
          data:{instructions:input.instructions,revision:{increment:1}},
        });
        if (result.count !== 1) throw new ConflictException('整理要求已在其他页面修改，请重新加载后保存。');
      }
      return tx.eaglePhotoAgentPreference.findUniqueOrThrow({
        where:{ownerId_libraryMode:where},select:{instructions:true,revision:true,updatedAt:true},
      });
    });
  } catch(error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException('整理要求已在其他页面修改，请重新加载后保存。');
    throw error;
  }
}
