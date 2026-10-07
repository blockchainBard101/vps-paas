import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Central resolver for ALL runtime state produced by the control plane:
 * build workspaces, deployment logs, database backups and the JSON config
 * stores (auth / github / projects).
 *
 * These files are runtime data — NOT source code — so they must never be
 * written inside the git working tree. Historically the server used
 * `process.cwd()/data` which, because the workspace is launched from
 * `apps/server`, dropped build checkouts and logs straight into the repo.
 *
 * The default now lives OUTSIDE the repository, in the server user's home
 * directory. On a real VPS set `DATA_DIR` to a persistent volume, e.g.
 * `/var/lib/railway-neon-paas` or a mounted Docker volume.
 */
export function getDataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(os.homedir(), '.railway-neon-paas');
}

/** Returns the data dir, creating it (and parents) if necessary. */
export function ensureDataDir(): string {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getBuildsDir(): string {
  return path.join(ensureDataDir(), 'builds');
}

export function getDeploymentsDir(): string {
  return path.join(ensureDataDir(), 'deployments');
}

export function getBackupsDir(): string {
  return path.join(ensureDataDir(), 'backups');
}

/**
 * One-time migration: if the app was previously writing its config stores into
 * the repo (`<cwd>/data`) but the new external data dir is empty, copy the JSON
 * stores across so existing projects / auth / github config are preserved.
 */
export function migrateLegacyData(): void {
  try {
    const target = ensureDataDir();
    const legacy = path.join(process.cwd(), 'data');
    if (path.resolve(legacy) === path.resolve(target)) return;
    if (!fs.existsSync(legacy)) return;

    for (const name of ['auth-config.json', 'github-config.json', 'projects.json']) {
      const src = path.join(legacy, name);
      const dest = path.join(target, name);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        console.log(`[DataDir] Migrated legacy ${name} -> ${target}`);
      }
    }
  } catch (err: any) {
    console.warn('[DataDir] Legacy data migration skipped:', err?.message);
  }
}
