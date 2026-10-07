import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ServicesService } from './services.service.js';

@Controller('api/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  listServices() {
    return this.servicesService.listServices();
  }

  @Post()
  deployService(
    @Body()
    body: {
      name: string;
      image?: string;
      env?: Record<string, string>;
      port?: number;
      command?: string[];
    },
  ) {
    return this.servicesService.deployService(body);
  }

  @Get(':id')
  getService(@Param('id') id: string) {
    return this.servicesService.getService(id);
  }

  @Post(':id/restart')
  restartService(@Param('id') id: string) {
    return this.servicesService.restartService(id);
  }

  @Post(':id/stop')
  stopService(@Param('id') id: string) {
    return this.servicesService.stopService(id);
  }

  @Delete(':id')
  deleteService(@Param('id') id: string) {
    return this.servicesService.deleteService(id);
  }

  @Post(':id/env')
  updateEnv(
    @Param('id') id: string,
    @Body() body: { env: Record<string, string> },
  ) {
    return this.servicesService.updateEnvironment(id, body.env);
  }

  @Patch(':id/settings')
  updateSettings(
    @Param('id') id: string,
    @Body()
    body: {
      dockerfilePath?: string;
      buildMethod?: 'auto' | 'railpack' | 'dockerfile' | 'slim';
      runtimeMode?: 'web' | 'worker';
      subfolder?: string;
      port?: number;
      installCommand?: string;
      buildCommand?: string;
      startCommand?: string;
      systemPackages?: string;
      nodeVersion?: string;
    },
  ) {
    return this.servicesService.updateSettings(id, body);
  }

  @Post(':id/domains')
  addDomain(@Param('id') id: string, @Body() body: { domain: string }) {
    return this.servicesService.addDomain(id, body.domain);
  }

  @Delete(':id/domains')
  removeDomain(@Param('id') id: string, @Body() body: { domain: string }) {
    return this.servicesService.removeDomain(id, body.domain);
  }

  @Post(':id/domains/verify')
  verifyDomains(@Param('id') id: string) {
    return this.servicesService.verifyServiceDomains(id);
  }

  @Get(':id/logs')
  async getLogs(@Param('id') id: string, @Query('tail') tail = '100') {
    const logs = await this.servicesService.getRecentLogs(id, parseInt(tail, 10));
    return { logs };
  }

  @Get(':id/logs/stream')
  async streamLogs(@Param('id') id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Disable proxy buffering so runtime log lines stream instantly.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    (res as any).socket?.setNoDelay?.(true);

    // Immediate handshake so the client's EventSource flips to "connected" instantly.
    res.write(': connected\n\n');
    (res as any).flush?.();

    // Heartbeat comment every 15s keeps intermediaries from closing idle streams.
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
        (res as any).flush?.();
      } catch {}
    }, 15000);

    const cleanup = await this.servicesService.streamLogs(
      id,
      (chunk) => {
        res.write(`data: ${JSON.stringify({ log: chunk })}\n\n`);
        (res as any).flush?.();
      },
      () => {
        clearInterval(heartbeat);
        res.end();
      },
    );

    res.on('close', () => {
      clearInterval(heartbeat);
      cleanup();
    });
  }
}
