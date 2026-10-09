import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { SystemSettingsService, SystemSettingsData } from './system-settings.service.js';
import { ServicesService } from './services.service.js';
import { CaddyService } from './caddy.service.js';
import { Roles } from './roles.decorator.js';

@Roles('OWNER', 'ADMIN')
@Controller('api/system')
export class SystemSettingsController {
  constructor(
    private readonly settingsService: SystemSettingsService,
    private readonly servicesService: ServicesService,
    private readonly caddyService: CaddyService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Put('settings')
  async updateSettings(@Body() body: Partial<SystemSettingsData>) {
    const result = await this.settingsService.updateSettings(body);
    // Re-verify the dashboard domain whenever it's (re)configured.
    if (body.domains && body.domains.serverDomain !== undefined) {
      this.servicesService.verifyServerDomain().catch(() => {});
    }
    return result;
  }

  @Post('prune')
  dockerPrune() {
    return this.settingsService.dockerPrune();
  }

  @Get('domains/status')
  async domainsStatus() {
    const caddy = await this.caddyService.status();
    return {
      caddyAvailable: caddy.adminReachable,
      caddyRunning: caddy.running,
      caddyContainerId: caddy.containerId,
      adminUrl: process.env.CADDY_ADMIN_URL || 'http://localhost:2019',
      serverDomain: this.settingsService.getServerDomain(),
      wildcardDomain: this.settingsService.getWildcardDomain(),
      serverIp: this.settingsService.getServerIp(),
      routes: this.servicesService.getRoutes(),
    };
  }

  @Post('domains/verify-all')
  async verifyAllDomains() {
    return this.servicesService.verifyAllDomains();
  }

  @Post('domains/verify-host')
  async verifyHost(@Body() body: { host: string }) {
    return this.servicesService.checkHost(body.host);
  }

  @Post('domains/verify-base')
  verifyBaseDomain() {
    return this.servicesService.verifyServerDomain();
  }

  @Post('domains/sync')
  async syncDomains() {
    const result = await this.servicesService.syncCaddy();
    return { ...result, routes: this.servicesService.getRoutes() };
  }

  @Post('caddy/start')
  async startCaddy() {
    const result = await this.caddyService.ensureRunning();
    const ready = result.running ? await this.caddyService.waitForAdmin(15000) : false;
    const sync = ready
      ? await this.servicesService.syncCaddy()
      : { applied: false, error: result.error || 'Caddy admin API not reachable yet' };
    return { ...result, ready, ...sync };
  }

  @Post('caddy/stop')
  async stopCaddy() {
    return this.caddyService.stop();
  }

  @Post('tokens')
  createApiToken(
    @Body() body: { name: string; role: 'admin' | 'deploy' | 'readonly' },
  ) {
    return this.settingsService.createApiToken(body.name || 'API Token', body.role || 'deploy');
  }

  @Delete('tokens/:id')
  revokeApiToken(@Param('id') id: string) {
    return this.settingsService.revokeApiToken(id);
  }

  @Get('updates/check')
  checkUpdates() {
    return this.settingsService.checkUpdates();
  }

  @Post('updates/apply')
  applyUpdate() {
    return this.settingsService.applyUpdate();
  }
}
