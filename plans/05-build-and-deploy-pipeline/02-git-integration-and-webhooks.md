# 02. Git Integration, Webhooks & Ephemeral PR Previews

Automating the deployment loop from code commit to running container is essential. This document covers GitHub App and Webhook integration, secure payload verification, and automated ephemeral preview environments for Pull Requests.

---

## 1. Webhook Signature Verification

All incoming GitHub webhooks are verified using cryptographic HMAC SHA-256 signatures:

```typescript
// server/webhooks/githubVerify.ts
import crypto from 'node:crypto';

export function verifyGitHubSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const digest = `sha256=${hmac.digest('hex')}`;

  const checksum = Buffer.from(signatureHeader, 'utf8');
  const expected = Buffer.from(digest, 'utf8');

  return checksum.length === expected.length && crypto.timingSafeEqual(checksum, expected);
}
```

---

## 2. Handling Git Events

```typescript
// server/webhooks/githubHandler.ts
export async function handleGitHubEvent(event: string, payload: any) {
  switch (event) {
    case 'push': {
      const branch = payload.ref.replace('refs/heads/', '');
      const commitHash = payload.after;
      const repoUrl = payload.repository.clone_url;

      // Find services watching this repo & branch
      const services = await db.service.findMany({
        where: { repoUrl, branch },
      });

      for (const service of services) {
        await queueDeployment({
          serviceId: service.id,
          commitHash,
          commitMessage: payload.head_commit?.message,
        });
      }
      break;
    }

    case 'pull_request': {
      await handlePullRequestEvent(payload);
      break;
    }
  }
}
```

---

## 3. Ephemeral Pull Request Environments (PR Previews)

When a developer opens a Pull Request:
1. **PR Opened (`action: opened` or `synchronize`)**:
   - The Control Plane clones the project's Production or Staging environment into a new ephemeral environment named `pr-<pr_number>`.
   - Databases can be either empty or cloned using a fast snapshot.
   - The service is built and deployed.
   - Caddy automatically registers a preview URL: `https://pr-42-myapp.paas.yourdomain.com`.
   - A bot posts a comment on the GitHub PR:
     > 🚀 **Preview Deployment Ready!**
     > **URL**: [https://pr-42-myapp.paas.yourdomain.com](https://pr-42-myapp.paas.yourdomain.com)
     > **Commit**: `a1b2c3d` | **Status**: Active ✅
2. **PR Closed (`action: closed`)**:
   - The Control Plane catches the event.
   - All containers associated with `pr-42` are gracefully terminated.
   - Ephemeral volumes and Caddy routes are removed.
   - Host VPS disk space and RAM are immediately freed.
