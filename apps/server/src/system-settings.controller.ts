import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { SystemSettingsService, SystemSettingsData } from './system-settings.service.js';

@Controller('api/system')
export class SystemSettingsController {
  constructor(private readonly settingsService: SystemSettingsService) {}

  @Get('settings')
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Put('settings')
  updateSettings(@Body() body: Partial<SystemSettingsData>) {
    return this.settingsService.updateSettings(body);
  }

  @Post('prune')
  dockerPrune() {
    return this.settingsService.dockerPrune();
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
}
