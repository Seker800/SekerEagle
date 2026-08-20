import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DeploymentIdentityService {
  private identity: Promise<string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  get(): Promise<string> {
    this.identity ??= this.loadOrCreate();
    return this.identity;
  }

  private async loadOrCreate(): Promise<string> {
    const identity = await this.prisma.appDeploymentIdentity.upsert({
      where: { id: 'primary' },
      create: { id: 'primary', value: randomBytes(32).toString('hex') },
      update: {},
      select: { value: true },
    });
    return identity.value;
  }
}
