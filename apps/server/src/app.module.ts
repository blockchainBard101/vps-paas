import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DockerService } from './docker.service.js';
import { DatabaseService } from './database.service.js';
import { DatabaseController } from './database.controller.js';
import { ServicesService } from './services.service.js';
import { ServicesController } from './services.controller.js';
import { GitHubService } from './github.service.js';
import { GitHubController } from './github.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { SystemSettingsService } from './system-settings.service.js';
import { SystemSettingsController } from './system-settings.controller.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { CaddyService } from './caddy.service.js';

@Module({
  imports: [],
  controllers: [
    AppController,
    AuthController,
    DatabaseController,
    ServicesController,
    GitHubController,
    ProjectsController,
    SystemSettingsController,
  ],
  providers: [
    AppService,
    AuthService,
    DockerService,
    DatabaseService,
    ServicesService,
    GitHubService,
    ProjectsService,
    SystemSettingsService,
    CaddyService,
  ],
})
export class AppModule {}
