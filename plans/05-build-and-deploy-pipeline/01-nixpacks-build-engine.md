# 01. Nixpacks Build Engine & Automated Containerization

Developers do not want to hand-craft Dockerfiles for every microservice. Railway solves this with **Nixpacks**—an open-source tool that inspects a repository, detects languages and dependencies, and produces reproducible, lightweight container images. This document outlines our build engine integration.

---

## 1. The Build Pipeline Architecture

```
Git Push Event (or Dashboard Trigger)
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│ Build Worker (BullMQ Job Queue)                        │
│ 1. Clone repository to `/var/lib/paas/builds/:buildId` │
│ 2. Check for custom `Dockerfile`                       │
│    ├── Found: Build with `docker build`                │
│    └── Not Found: Execute Nixpacks Detection           │
│ 3. Run `nixpacks build` with real-time log pipe        │
│ 4. Stream stdout/stderr line-by-line over WebSocket    │
│ 5. Tag generated image: `paas-app-:serviceId-:commit`  │
│ 6. Clean up temporary checkout workspace               │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
             Docker Image Cache (Host)
```

---

## 2. Nixpacks CLI Integration

Nixpacks supports Node.js, Python, Go, Rust, Ruby, PHP, Java, Deno, and more out of the box.

### 2.1 Invoking Nixpacks CLI Programmatically

```typescript
// server/builder/NixpacksBuilder.ts
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

export interface BuildOptions {
  buildId: string;
  sourceDir: string;
  imageTag: string;
  envVars?: Record<string, string>;
  onLog: (line: string) => void;
}

export class NixpacksBuilder {
  /**
   * Builds an OCI container image using Nixpacks CLI
   */
  static async build(options: BuildOptions): Promise<{ success: boolean; imageTag: string }> {
    const { sourceDir, imageTag, envVars, onLog } = options;

    // Check if repository contains a custom Dockerfile first
    const hasDockerfile = await fs
      .access(path.join(sourceDir, 'Dockerfile'))
      .then(() => true)
      .catch(() => false);

    if (hasDockerfile) {
      onLog('\x1b[36m[Builder] Found Dockerfile. Using standard Docker build...\x1b[0m\r\n');
      return this.executeCommand('docker', ['build', '-t', imageTag, sourceDir], onLog, imageTag);
    }

    onLog('\x1b[35m[Builder] No Dockerfile detected. Engaging Nixpacks auto-builder...\x1b[0m\r\n');

    // Prepare Nixpacks CLI arguments
    const args = ['build', sourceDir, '--name', imageTag];

    // Inject build-time environment variables (e.g. NODE_ENV, NEXT_PUBLIC_*)
    if (envVars) {
      for (const [key, val] of Object.entries(envVars)) {
        args.push('--env', `${key}=${val}`);
      }
    }

    return this.executeCommand('nixpacks', args, onLog, imageTag);
  }

  private static executeCommand(
    command: string,
    args: string[],
    onLog: (chunk: string) => void,
    imageTag: string
  ): Promise<{ success: boolean; imageTag: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args);

      proc.stdout.on('data', (data) => {
        onLog(data.toString());
      });

      proc.stderr.on('data', (data) => {
        onLog(data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          onLog(`\r\n\x1b[32m✔ Build completed successfully: ${imageTag}\x1b[0m\r\n`);
          resolve({ success: true, imageTag });
        } else {
          onLog(`\r\n\x1b[31m✖ Build failed with exit code ${code}\x1b[0m\r\n`);
          resolve({ success: false, imageTag });
        }
      });

      proc.on('error', (err) => {
        onLog(`\r\n\x1b[31mBuild error: ${err.message}\x1b[0m\r\n`);
        reject(err);
      });
    });
  }
}
```

---

## 3. Build Log Streaming Protocol

1. The frontend terminal connects via WebSocket:
   `ws://paas.domain/ws/logs/:deploymentId?type=build`.
2. As Nixpacks outputs lines like:
   ```
   ===> Planning
   ===> Building
   [1/5] COPY package.json package-lock.json ./
   [2/5] RUN npm ci
   ...
   ```
3. Chunks are broadcast in real-time to the WebSocket client and appended to the deployment's persistent log file on disk: `/var/lib/paas/logs/:deploymentId.log`.
4. If a user disconnects and reconnects, the backend streams the stored log backlog before tailing live output.
