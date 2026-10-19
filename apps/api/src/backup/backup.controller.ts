import { Controller, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { readFile } from 'node:fs/promises';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { publicBackupStatus, type BackupStatus } from './backup-status';

@ApiTags('backup')
@Controller('backup')
@UseGuards(AccessAuthGuard, AdminGuard)
export class BackupController {
  @Get('status')
  async status(): Promise<BackupStatus> {
    try {
      const path = process.env.SEKEREAGLE_BACKUP_STATUS_FILE;
      if (!path) return publicBackupStatus(null);
      const content = await readFile(path, 'utf8');
      if (content.length > 16_384) throw new Error('Invalid backup status');
      return publicBackupStatus(JSON.parse(content) as unknown);
    } catch {
      throw new ServiceUnavailableException('Backup status is temporarily unavailable');
    }
  }
}
