import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';

@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  listProjects() {
    return this.projectsService.listProjects();
  }

  @Get(':id')
  getProject(@Param('id') id: string) {
    return this.projectsService.getProject(id);
  }

  @Post()
  createProject(
    @Body() body: { name: string; description?: string; environment?: string },
  ) {
    return this.projectsService.createProject(body);
  }

  @Put(':id/canvas')
  saveCanvas(
    @Param('id') id: string,
    @Body() body: { nodes: any[]; edges: any[] },
  ) {
    return this.projectsService.saveProjectCanvas(id, body.nodes, body.edges);
  }

  @Delete(':id')
  deleteProject(@Param('id') id: string) {
    return this.projectsService.deleteProject(id);
  }
}
