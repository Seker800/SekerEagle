import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';

const READINESS_CACHE_MS = 5_000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readiness?: { at: number; result: Promise<{ status: 'ready' }> };

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  @Get()
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  getReadiness(): Promise<{ status: 'ready' }> {
    const now = Date.now();
    if (!this.readiness || now - this.readiness.at >= READINESS_CACHE_MS) {
      const result = (async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        await this.storage.assertReady();
        return { status: 'ready' as const };
      })();
      this.readiness = { at: now, result };
      result.catch(() => {
        if (this.readiness?.result === result) this.readiness = undefined;
      });
    }
    return this.readiness.result;
  }
}
