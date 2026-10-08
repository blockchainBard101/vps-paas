export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== 'undefined') {
    return '/api';
  }
  return 'http://localhost:4000/api';
}

const API_BASE = getApiBase();

export interface S3BackupConfig {
  enabled: boolean;
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  cronSchedule: string;
  retentionDays: number;
  lastBackupAt?: string | null;
  lastBackupStatus?: 'success' | 'failed' | 'in_progress' | null;
}

export interface BackupSnapshot {
  id: string;
  databaseId: string;
  databaseName: string;
  engine: 'postgres' | 'redis';
  filename: string;
  s3Url: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  status: 'completed' | 'in_progress' | 'failed';
}

export interface DatabaseRecord {
  id: string;
  name: string;
  engine?: 'postgres' | 'redis';
  containerId: string;
  containerName: string;
  volumeName: string;
  dbName: string;
  user: string;
  password: string;
  host: string;
  port: number;
  connectionUrl: string;
  status?: 'running' | 'stopped' | 'starting';
  backupConfig?: S3BackupConfig;
}

export interface ColumnSchema {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface TableSummary {
  schema: string;
  name: string;
  estimatedRows: number;
  columns: ColumnSchema[];
}

export async function fetchDatabases(): Promise<DatabaseRecord[]> {
  const res = await fetch(`${API_BASE}/databases`);
  if (!res.ok) throw new Error('Failed to fetch databases');
  return res.json();
}

export async function provisionDatabase(name: string, dbName = 'railway'): Promise<DatabaseRecord> {
  const res = await fetch(`${API_BASE}/databases/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dbName }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to provision database: ${err}`);
  }
  return res.json();
}

export async function provisionRedis(name = 'production-redis'): Promise<DatabaseRecord> {
  const res = await fetch(`${API_BASE}/databases/provision-redis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to provision Redis: ${err}`);
  }
  return res.json();
}

export async function startDatabase(id: string): Promise<DatabaseRecord> {
  const res = await fetch(`${API_BASE}/databases/${id}/start`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start database');
  return res.json();
}

export async function stopDatabase(id: string): Promise<DatabaseRecord> {
  const res = await fetch(`${API_BASE}/databases/${id}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop database');
  return res.json();
}

export async function restartDatabase(id: string): Promise<DatabaseRecord> {
  const res = await fetch(`${API_BASE}/databases/${id}/restart`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to restart database');
  return res.json();
}

export async function fetchDatabaseHealth(id: string): Promise<{ status: 'healthy' | 'unhealthy' | 'stopped'; latencyMs?: number; error?: string }> {
  const res = await fetch(`${API_BASE}/databases/${id}/health`);
  if (!res.ok) throw new Error('Failed to fetch database health');
  return res.json();
}

export function getDatabaseBackupDownloadUrl(databaseId: string, backupId: string): string {
  return `${API_BASE}/databases/${databaseId}/backups/${backupId}/download`;
}

export async function fetchDatabaseBackupConfig(databaseId: string): Promise<S3BackupConfig> {
  const res = await fetch(`${API_BASE}/databases/${databaseId}/backup/config`);
  if (!res.ok) throw new Error('Failed to fetch S3 backup configuration');
  return res.json();
}

export async function updateDatabaseBackupConfig(
  databaseId: string,
  partial: Partial<S3BackupConfig>
): Promise<S3BackupConfig> {
  const res = await fetch(`${API_BASE}/databases/${databaseId}/backup/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  if (!res.ok) throw new Error('Failed to save S3 backup configuration');
  return res.json();
}

export async function testDatabaseBackupS3(
  databaseId: string,
  partial?: Partial<S3BackupConfig>
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/databases/${databaseId}/backup/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || 'Failed to connect to S3 bucket');
  }
  return data;
}

export async function fetchDatabaseBackups(databaseId: string): Promise<BackupSnapshot[]> {
  const res = await fetch(`${API_BASE}/databases/${databaseId}/backups`);
  if (!res.ok) throw new Error('Failed to fetch backup snapshots');
  return res.json();
}

export async function triggerDatabaseBackup(databaseId: string): Promise<BackupSnapshot> {
  const res = await fetch(`${API_BASE}/databases/${databaseId}/backup`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to trigger database backup to S3');
  return res.json();
}

export async function restoreDatabaseBackup(
  databaseId: string,
  backupId: string
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/databases/${databaseId}/restore/${backupId}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to restore database from backup');
  return res.json();
}

export interface ContainerMetrics {
  memUsage: string;
  memPercent: string;
  cpuPercent: string;
  pids: number;
}

export async function fetchDatabaseMetrics(databaseId: string): Promise<ContainerMetrics> {
  const res = await fetch(`${API_BASE}/databases/${databaseId}/metrics`);
  if (!res.ok) throw new Error('Failed to fetch database metrics');
  return res.json();
}

export async function deleteDatabaseBackup(
  databaseId: string,
  backupId: string
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/databases/${databaseId}/backups/${backupId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete backup snapshot');
  return res.json();
}

export async function deleteDatabase(serviceId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/databases/${serviceId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete database: ${err}`);
  }
  return res.json();
}

export async function introspectDatabase(serviceId: string): Promise<TableSummary[]> {
  const res = await fetch(`${API_BASE}/databases/${serviceId}/introspect`);
  if (!res.ok) throw new Error('Failed to introspect database schema');
  return res.json();
}

export async function fetchTableData(
  serviceId: string,
  table: string,
  schema = 'public',
  page = 0,
  pageSize = 50
): Promise<{ rows: any[]; totalCount: number }> {
  const params = new URLSearchParams({
    table,
    schema,
    page: String(page),
    pageSize: String(pageSize),
  });
  const res = await fetch(`${API_BASE}/databases/${serviceId}/data?${params}`);
  if (!res.ok) throw new Error('Failed to fetch table data');
  return res.json();
}

export async function updateTableCell(
  serviceId: string,
  schema: string,
  table: string,
  pkColumn: string,
  pkValue: any,
  column: string,
  newValue: any
): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/databases/${serviceId}/cell`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema,
      table,
      pkColumn,
      pkValue,
      column,
      newValue,
    }),
  });
  if (!res.ok) throw new Error('Failed to update cell');
  return res.json();
}

export async function executeSqlQuery(
  serviceId: string,
  sql: string,
  readOnly = false
): Promise<{ rows: any[]; rowCount: number; durationMs: number; error?: string }> {
  const res = await fetch(`${API_BASE}/databases/${serviceId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, readOnly }),
  });
  if (!res.ok) throw new Error('Failed to execute SQL query');
  return res.json();
}

export async function insertTableRow(
  serviceId: string,
  table: string,
  rowData: Record<string, any>,
  schema = 'public'
): Promise<any> {
  const res = await fetch(`${API_BASE}/databases/${serviceId}/row`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, table, rowData }),
  });
  if (!res.ok) throw new Error('Failed to insert table row');
  return res.json();
}

export async function createDatabaseBackup(
  serviceId: string
): Promise<BackupSnapshot> {
  const res = await fetch(`${API_BASE}/databases/${serviceId}/backup`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to create database backup');
  return res.json();
}

export interface ServiceSettingsUpdate {
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
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
}

export interface ServiceRecord {
  id: string;
  name: string;
  image: string;
  containerId: string;
  containerName: string;
  status: 'running' | 'stopped' | 'restarting' | 'building' | 'deploying' | 'failed' | 'error' | string;
  errorMessage?: string;
  port?: number;
  internalPort?: number;
  gitRepo?: string;
  gitBranch?: string;
  subfolder?: string;
  dockerfilePath?: string;
  buildMethod?: 'auto' | 'railpack' | 'dockerfile' | 'slim';
  runtimeMode?: 'web' | 'worker';
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  systemPackages?: string;
  nodeVersion?: string;
  domains?: string[];
  domainStatus?: Record<
    string,
    {
      status: 'pending' | 'verified';
      targetIp?: string;
      verifiedAt?: string;
      lastCheckedAt?: string;
      lastError?: string;
      createdAt: string;
    }
  >;
  env: Record<string, string>;
  createdAt: string;
  startedAt?: string;
}

export async function fetchServices(): Promise<ServiceRecord[]> {
  const res = await fetch(`${API_BASE}/services`);
  if (!res.ok) throw new Error('Failed to fetch services');
  return res.json();
}

export async function deployService(
  name: string,
  image = 'nginx:alpine',
  port = 80,
  env: Record<string, string> = {}
): Promise<ServiceRecord> {
  const res = await fetch(`${API_BASE}/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, image, port, env }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to deploy service: ${err}`);
  }
  return res.json();
}

export async function restartService(id: string): Promise<ServiceRecord> {
  const res = await fetch(`${API_BASE}/services/${id}/restart`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to restart service');
  return res.json();
}

export async function stopService(id: string): Promise<ServiceRecord> {
  const res = await fetch(`${API_BASE}/services/${id}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop service');
  return res.json();
}

export async function deleteService(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/services/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete service');
  return res.json();
}

export async function fetchServiceLogs(id: string, tail = 100): Promise<{ logs: string }> {
  const res = await fetch(`${API_BASE}/services/${id}/logs?tail=${tail}`);
  if (!res.ok) throw new Error('Failed to fetch service logs');
  return res.json();
}

export async function updateServiceEnv(
  id: string,
  env: Record<string, string>
): Promise<ServiceRecord> {
  const res = await fetch(`${API_BASE}/services/${id}/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ env }),
  });
  if (!res.ok) throw new Error('Failed to update service env');
  return res.json();
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  language: string | null;
  stars: number;
  updatedAt: string;
  htmlUrl: string;
  cloneUrl: string;
}

export interface GitHubStatus {
  connected: boolean;
  method: 'oauth' | 'token' | 'none';
  oauthConfigured?: boolean;
  appConfigured?: boolean;
  appName?: string;
  appSlug?: string;
  appInstallUrl?: string;
  appSettingsUrl?: string;
  appPublicSettingsUrl?: string;
  clientId?: string;
  user?: {
    login: string;
    avatarUrl: string;
    name: string | null;
    htmlUrl?: string;
  };
  organizations?: Array<{
    login: string;
    avatarUrl?: string;
    description?: string;
  }>;
  repoCount?: number;
  webhookUrl?: string;
  webhookSecret?: string;
}

export async function fetchGitHubStatus(): Promise<GitHubStatus> {
  const res = await fetch(`${API_BASE}/github/status`);
  if (!res.ok) throw new Error('Failed to fetch GitHub status');
  return res.json();
}

export async function fetchGitHubOAuthUrl(redirectUri?: string): Promise<{
  configured: boolean;
  url: string;
  callbackUrl: string;
  manifestStartUrl?: string;
  manifest?: any;
  postUrl?: string;
}> {
  const query = redirectUri ? `?redirectUri=${encodeURIComponent(redirectUri)}` : '';
  const res = await fetch(`${API_BASE}/github/oauth/authorize${query}`);
  if (!res.ok) throw new Error('Failed to get GitHub authorization URL');
  return res.json();
}

export async function saveGitHubOAuthConfig(clientId: string, clientSecret: string): Promise<GitHubStatus> {
  const res = await fetch(`${API_BASE}/github/oauth/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to save GitHub OAuth config: ${err}`);
  }
  return res.json();
}

export async function saveGitHubToken(token: string): Promise<GitHubStatus> {
  const res = await fetch(`${API_BASE}/github/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to verify GitHub token: ${err}`);
  }
  return res.json();
}

export async function disconnectGitHub(): Promise<GitHubStatus> {
  const res = await fetch(`${API_BASE}/github/disconnect`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to disconnect GitHub account');
  return res.json();
}

export async function resetGitHubAppConfig(): Promise<GitHubStatus> {
  const res = await fetch(`${API_BASE}/github/oauth/config`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to reset GitHub App configuration');
  return res.json();
}

export async function fetchGitHubRepos(): Promise<GitHubRepo[]> {
  const res = await fetch(`${API_BASE}/github/repos`);
  if (!res.ok) throw new Error('Failed to fetch GitHub repositories');
  return res.json();
}

export async function fetchPublicGitHubRepo(owner: string, repo: string): Promise<GitHubRepo> {
  const res = await fetch(`${API_BASE}/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Repository not found: ${err}`);
  }
  return res.json();
}

export async function fetchGitHubBranches(owner: string, repo: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/github/repos/${owner}/${repo}/branches`);
  if (!res.ok) throw new Error('Failed to fetch branches');
  return res.json();
}

export interface DetectedSubfolder {
  path: string;
  name: string;
  framework?: string;
  hasDockerfile: boolean;
  suggestedPort: number;
}

export interface BuildDetectionResult {
  hasDockerfile: boolean;
  dockerfilePaths?: string[];
  language: string | null;
  framework: string | null;
  suggestedPort: number;
  subfolders: DetectedSubfolder[];
}

export async function detectGitHubRepoBuild(
  owner: string,
  repo: string,
  branch?: string,
  subfolder?: string,
  dockerfilePath?: string
): Promise<BuildDetectionResult> {
  try {
    const params = new URLSearchParams();
    if (branch) params.set('branch', branch);
    if (subfolder && subfolder !== '.') params.set('subfolder', subfolder);
    if (dockerfilePath) params.set('dockerfilePath', dockerfilePath);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/github/repos/${owner}/${repo}/detect${qs}`);
    if (!res.ok) {
      return {
        hasDockerfile: false,
        language: null,
        framework: null,
        suggestedPort: 3000,
        subfolders: [{ path: '.', name: 'Root (/)', hasDockerfile: false, suggestedPort: 3000 }],
      };
    }
    return res.json();
  } catch {
    return {
      hasDockerfile: false,
      language: null,
      framework: null,
      suggestedPort: 3000,
      subfolders: [{ path: '.', name: 'Root (/)', hasDockerfile: false, suggestedPort: 3000 }],
    };
  }
}

export interface EnvSuggestion {
  key: string;
  client: boolean;
  sources: string[];
  sample?: string;
}

export async function fetchEnvSuggestions(
  owner: string,
  repo: string,
  branch?: string,
  subfolder?: string
): Promise<EnvSuggestion[]> {
  try {
    const params = new URLSearchParams();
    if (branch) params.set('branch', branch);
    if (subfolder && subfolder !== '.') params.set('subfolder', subfolder);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/github/repos/${owner}/${repo}/env-suggestions${qs}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function deployGitHubRepo(
  repoName: string,
  branch: string,
  cloneUrl: string,
  port = 3000,
  env: Record<string, string> = {},
  subfolder?: string,
  dockerfilePath?: string,
  buildMethod?: 'auto' | 'railpack' | 'dockerfile' | 'slim',
  runtimeMode?: 'web' | 'worker',
  installCommand?: string,
  buildCommand?: string,
  startCommand?: string,
  tempId?: string,
  systemPackages?: string,
  nodeVersion?: string,
  serviceName?: string
): Promise<{ service: ServiceRecord; git: any }> {
  const res = await fetch(`${API_BASE}/github/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tempId,
      serviceName,
      repoName,
      branch,
      cloneUrl,
      port,
      env,
      subfolder,
      dockerfilePath,
      buildMethod,
      runtimeMode,
      installCommand,
      buildCommand,
      startCommand,
      systemPackages,
      nodeVersion,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to deploy GitHub project: ${err}`);
  }
  return res.json();
}

export async function fetchBuildLogs(id: string): Promise<{ logs: string[]; status: string; phase?: string }> {
  const res = await fetch(`${API_BASE}/github/build-logs/${encodeURIComponent(id)}`);
  if (!res.ok) return { logs: [], status: 'not_found' };
  return res.json();
}

export async function fetchBuildStatus(id: string): Promise<{ status: string; phase?: string }> {
  const res = await fetch(`${API_BASE}/github/build-status/${encodeURIComponent(id)}`);
  if (!res.ok) return { status: 'not_found' };
  return res.json();
}

export async function updateServiceSettings(
  id: string,
  settings: ServiceSettingsUpdate
): Promise<ServiceRecord> {
  const res = await fetch(`${API_BASE}/services/${id}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update service settings: ${err}`);
  }
  return res.json();
}

export async function addServiceDomain(id: string, domain: string): Promise<ServiceRecord> {
  const res = await fetch(`${API_BASE}/services/${id}/domains`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to add domain: ${err}`);
  }
  return res.json();
}

export async function removeServiceDomain(id: string, domain: string): Promise<ServiceRecord> {
  const res = await fetch(`${API_BASE}/services/${id}/domains`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to remove domain: ${err}`);
  }
  return res.json();
}

export async function verifyServiceDomains(id: string): Promise<ServiceRecord> {
  const res = await fetch(`${API_BASE}/services/${id}/domains/verify`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to verify domains');
  return res.json();
}

export async function verifyAllDomains(): Promise<{ verified: number; pending: number; checked: number }> {
  const res = await fetch(`${API_BASE}/system/domains/verify-all`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to verify domains');
  return res.json();
}

export async function verifyHost(
  host: string
): Promise<{ host: string; targetIp: string; ips: string[]; verified: boolean }> {
  const res = await fetch(`${API_BASE}/system/domains/verify-host`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host }),
  });
  if (!res.ok) throw new Error('Failed to verify host');
  return res.json();
}

export async function verifyBaseDomain(): Promise<{
  host: string;
  targetIp: string;
  ips: string[];
  verified: boolean;
}> {
  const res = await fetch(`${API_BASE}/system/domains/verify-base`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to verify domain');
  return res.json();
}

export interface DomainStatus {
  caddyAvailable: boolean;
  caddyRunning: boolean;
  caddyContainerId?: string;
  adminUrl: string;
  serverDomain: string;
  wildcardDomain: string;
  serverIp: string;
  routes: Array<{ host: string; target: string }>;
}

export async function fetchDomainStatus(): Promise<DomainStatus> {
  const res = await fetch(`${API_BASE}/system/domains/status`);
  if (!res.ok) throw new Error('Failed to fetch domain status');
  return res.json();
}

export async function syncDomains(): Promise<{ applied: boolean; error?: string; routes: Array<{ host: string; target: string }> }> {
  const res = await fetch(`${API_BASE}/system/domains/sync`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to sync domains');
  return res.json();
}

export async function startCaddy(): Promise<{ running: boolean; started: boolean; ready: boolean; applied: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/system/caddy/start`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start Caddy');
  return res.json();
}

export async function stopCaddy(): Promise<{ stopped: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/system/caddy/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop Caddy');
  return res.json();
}

export async function fetchDeployHistory(serviceId: string): Promise<Array<{
  id: string;
  status: 'building' | 'success' | 'failed';
  phase?: string;
  createdAt: string;
  branch: string;
  repoName: string;
  logsCount: number;
}>> {
  const res = await fetch(`${API_BASE}/github/deployments/history/${encodeURIComponent(serviceId)}`);
  if (!res.ok) return [];
  return res.json();
}

export async function redeployGitHubService(
  id: string,
  overrides?: ServiceSettingsUpdate
): Promise<{ service: ServiceRecord; git: any }> {
  const res = await fetch(`${API_BASE}/github/redeploy/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides || {}),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to redeploy service: ${err}`);
  }
  return res.json();
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  environment: string;
  serviceCount: number;
  databaseCount: number;
  servicesSummary?: Array<{
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

export async function fetchProjects(): Promise<ProjectRecord[]> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

export async function fetchProject(id: string): Promise<ProjectRecord> {
  const res = await fetch(`${API_BASE}/projects/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch project ${id}`);
  return res.json();
}

export async function createProject(
  name: string,
  description?: string,
  environment = 'production'
): Promise<ProjectRecord> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, environment }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create project: ${err}`);
  }
  return res.json();
}

export async function saveProjectCanvas(
  id: string,
  nodes: any[],
  edges: any[]
): Promise<ProjectRecord> {
  const res = await fetch(`${API_BASE}/projects/${id}/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes, edges }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to save canvas: ${err}`);
  }
  return res.json();
}

export async function deleteProject(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete project');
  return res.json();
}

export interface SystemSettingsPayload {
  domains: {
    serverDomain: string;
    wildcardDomain: string;
    serverIp: string;
    proxyType: 'caddy' | 'traefik' | 'nginx';
    customDomains: Array<{
      domain: string;
      targetService: string;
      status: 'active' | 'pending' | 'error';
      sslValidUntil: string;
    }>;
    domainStatus?: 'pending' | 'verified';
    domainStatusCheckedAt?: string;
    domainStatusVerifiedAt?: string;
    domainStatusError?: string;
  };
  dns: {
    provider: 'cloudflare' | 'route53' | 'digitalocean' | 'manual';
    apiToken: string;
    zoneId: string;
    autoSyncRecords: boolean;
    lastValidated: string | null;
  };
  github: {
    connected: boolean;
    username: string;
    appInstalled: boolean;
    webhookUrl: string;
    webhookSecret: string;
  };
  ai: {
    enabled: boolean;
    provider: 'anthropic' | 'openai' | 'gemini' | 'ollama';
    model: string;
    apiKey: string;
    autoFixDeployErrors: boolean;
    autonomousOptimization: boolean;
  };
  apiAccess: {
    tokens: Array<{
      id: string;
      name: string;
      tokenPreview: string;
      role: 'admin' | 'deploy' | 'readonly';
      createdAt: string;
      lastUsed: string | null;
    }>;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER';
    avatarInitials: string;
    twoFactorEnabled: boolean;
  }>;
  storage: {
    driver: string;
    volumesPath: string;
    s3BackupEnabled: boolean;
    s3Endpoint: string;
    s3Bucket: string;
    s3Region: string;
    backupScheduleCron: string;
  };
  maintenance: {
    autoPruneDays: number;
    metrics: {
      cpuCores: number;
      totalMemoryGb: number;
      freeMemoryGb: number;
      uptimeHours: number;
      dockerContainersCount: number;
      dockerImagesCount: number;
    };
  };
  deployments: {
    maxConcurrency: number;
    buildTimeoutMinutes: number;
    autoCancelOutdatedBuilds: boolean;
    retentionDays: number;
  };
  updates: {
    currentVersion: string;
    latestVersion: string;
    channel: 'stable' | 'beta' | 'nightly';
    lastChecked: string;
    autoUpdateControlPlane: boolean;
  };
}

export async function fetchSystemSettings(): Promise<SystemSettingsPayload> {
  const res = await fetch(`${API_BASE}/system/settings`);
  if (!res.ok) throw new Error('Failed to fetch system settings');
  return res.json();
}

export async function updateSystemSettings(
  partial: Partial<SystemSettingsPayload>
): Promise<SystemSettingsPayload> {
  const res = await fetch(`${API_BASE}/system/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  if (!res.ok) throw new Error('Failed to update system settings');
  return res.json();
}

export async function runDockerPrune(): Promise<{ spaceReclaimed: string; success: boolean }> {
  const res = await fetch(`${API_BASE}/system/prune`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to prune Docker');
  return res.json();
}

export async function createSystemApiToken(
  name: string,
  role: 'admin' | 'deploy' | 'readonly' = 'deploy'
): Promise<{ tokenRecord: any; rawSecret: string }> {
  const res = await fetch(`${API_BASE}/system/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, role }),
  });
  if (!res.ok) throw new Error('Failed to create API token');
  return res.json();
}

export async function revokeSystemApiToken(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/system/tokens/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to revoke API token');
  return res.json();
}

// ─── Auth token helper ────────────────────────────────────────────────────────
const TOKEN_KEY = 'paas_auth_token';
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setAuthToken(token: string) {
  if (typeof window !== 'undefined') localStorage.setItem(TOKEN_KEY, token);
}
export function clearAuthToken() {
  if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ─── Auth endpoints ───────────────────────────────────────────────────────────
export interface AuthStatus {
  isSetupComplete: boolean;
  instanceName: string;
  adminEmailPreview: string | null;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER';
  avatarInitials: string;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface AuthSession {
  token: string;
  instanceName: string;
  user: AuthUser;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE}/auth/status`);
  if (!res.ok) throw new Error('Could not reach server');
  return res.json();
}

export async function setupServer(dto: {
  email: string;
  password: string;
  name?: string;
  instanceName?: string;
}): Promise<AuthSession> {
  const res = await fetch(`${API_BASE}/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message || 'Setup failed');
  }
  return res.json();
}

export async function loginToServer(dto: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message || 'Login failed');
  }
  return res.json();
}

export async function fetchMe(): Promise<{ user: AuthUser; instanceName: string }> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Unauthorized');
  return res.json();
}

export async function logoutFromServer(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: authHeaders(),
  });
}

export async function changePassword(dto: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/auth/change-password`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message || 'Failed to change password');
  }
  return res.json();
}

export interface SystemUpdateInfo {
  currentCommit: string;
  remoteCommit?: string;
  branch: string;
  isUpToDate: boolean;
  pendingCount: number;
  pendingCommits: Array<{ hash: string; message: string }>;
  error?: string;
}

export async function checkSystemUpdates(): Promise<SystemUpdateInfo> {
  const res = await fetch(`${API_BASE}/system/updates/check`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to check for system updates');
  return res.json();
}

export async function applySystemUpdate(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/system/updates/apply`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to initiate system update');
  return res.json();
}

