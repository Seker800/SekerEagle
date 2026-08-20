import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DeploymentIdentityService {
  readonly id: string;

  constructor(config: ConfigService) {
    this.id = createHmac('sha256', config.getOrThrow<string>('JWT_ACCESS_SECRET'))
      .update('sekereagle:desktop-cache:deployment:v1', 'utf8')
      .digest('hex');
  }
}
