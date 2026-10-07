import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ensureDataDir } from './config/paths.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  environment: string;
  serviceCount: number;
  databaseCount: number;
  servicesSummary: Array<{
    name: string;
    type: 'service' | 'postgres' | 'redis' | 'github';
    status: string;
    port?: number;
  }>;
  nodes?: any[];
  edges?: any[];
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ProjectsService {
  private projects: Map<string, ProjectRecord> = new Map();
  private storagePath: string;

  constructor() {
    const baseDir = ensureDataDir();
    this.storagePath = path.join(baseDir, 'projects.json');
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const list: ProjectRecord[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const p of list) {
            this.projects.set(p.id, p);
          }
        }
      }
    } catch (err: any) {
      console.warn('[ProjectsService] Failed to load projects from disk:', err.message);
    }
  }

  private saveToDisk() {
    try {
      const list = Array.from(this.projects.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (err: any) {
      console.warn('[ProjectsService] Failed to save projects to disk:', err.message);
    }
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return Array.from(this.projects.values());
  }

  async getProject(id: string): Promise<ProjectRecord> {
    const proj = this.projects.get(id) || Array.from(this.projects.values()).find((p) => p.name === id);
    if (!proj) {
      throw new NotFoundException(`Project '${id}' not found`);
    }
    return proj;
  }

  async createProject(data: { name: string; description?: string; environment?: string }): Promise<ProjectRecord> {
    const safeName = data.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!safeName) {
      throw new BadRequestException('Invalid project name');
    }

    const id = `proj-${safeName}`;
    if (this.projects.has(id)) {
      throw new BadRequestException(`Project '${safeName}' already exists`);
    }

    const newProject: ProjectRecord = {
      id,
      name: safeName,
      description: data.description || 'Modern cloud service and database environment',
      environment: data.environment || 'production',
      serviceCount: 0,
      databaseCount: 0,
      servicesSummary: [],
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.projects.set(id, newProject);
    this.saveToDisk();
    return newProject;
  }

  async saveProjectCanvas(id: string, nodes: any[], edges: any[]): Promise<ProjectRecord> {
    const proj = await this.getProject(id);
    proj.nodes = nodes;
    proj.edges = edges;

    const dbNodes = nodes.filter((n) => n.type === 'databaseNode');
    const svcNodes = nodes.filter((n) => n.type === 'serviceNode');

    proj.databaseCount = dbNodes.length;
    proj.serviceCount = svcNodes.length;

    proj.servicesSummary = [
      ...dbNodes.map((n) => ({
        name: n.data?.name || n.id,
        type: (n.data?.engine === 'redis' ? 'redis' : 'postgres') as any,
        status: n.data?.status || 'healthy',
        port: n.data?.engine === 'redis' ? 6379 : 5432,
      })),
      ...svcNodes.map((n) => ({
        name: n.data?.name || n.id,
        type: 'service' as any,
        status: n.data?.status || 'running',
        port: n.data?.port || 3000,
      })),
    ];

    proj.updatedAt = new Date().toISOString();
    this.projects.set(proj.id, proj);
    this.saveToDisk();
    return proj;
  }

  async deleteProject(id: string): Promise<{ success: boolean }> {
    const proj = await this.getProject(id);
    this.projects.delete(proj.id);
    this.saveToDisk();
    return { success: true };
  }
}
