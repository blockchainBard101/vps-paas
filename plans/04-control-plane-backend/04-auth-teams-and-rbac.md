# 04. Authentication, Team Workspaces & Role-Based Access Control (RBAC)

This document specifies the authentication system for browser logins, organization multi-tenancy, team member invitations, and role-based permissions (including safeguards for the Neon Database Studio).

---

## 1. Authentication Architecture

The dashboard is secured behind an enterprise-grade authentication layer using **Auth.js (NextAuth.js v5)** or **Better-Auth**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BROWSER LOGIN INTERFACE                         │
│  ┌──────────────────────────────┐    ┌──────────────────────────────┐  │
│  │   GitHub OAuth (1-Click)     │    │   Email & Secure Password    │  │
│  │   - Auto-syncs GitHub repos  │    │   - Argon2id hash verification   │  │
│  │   - Sets up webhooks         │    │   - Optional TOTP / 2FA          │  │
│  └──────────────────────────────┘    └──────────────────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP-Only Secure Cookie (JWT)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      ORGANIZATION / TEAM CONTEXT                       │
│ - Users can belong to multiple Organizations (Personal, Acme Corp)    │
│ - Current Workspace switcher in top navigation bar                     │
│ - Every Project belongs to an Organization                             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Role Enforcement
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        ROLE-BASED ACCESS CONTROL                       │
│   Owner         ──►  Full control, billing, destroy cluster            │
│   Admin         ──►  Invite/remove members, manage production envs     │
│   Developer     ──►  Deploy services, provision DBs, edit tables       │
│   Viewer        ──►  Read-only canvas, live logs, no DB write/drop     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Tenant Prisma Schema (Users, Orgs & Invites)

```prisma
enum Role {
  OWNER
  ADMIN
  DEVELOPER
  VIEWER
}

model User {
  id            String               @id @default(cuid())
  name          String?
  email         String               @unique
  emailVerified DateTime?
  image         String?
  passwordHash  String?              // Nullable if user signs in with GitHub OAuth
  createdAt     DateTime             @default(now())
  updatedAt     DateTime             @updatedAt

  accounts      Account[]
  sessions      Session[]
  memberships   OrganizationMember[]
  invitesSent   OrganizationInvite[] @relation("InvitedBy")
}

model Organization {
  id          String               @id @default(cuid())
  name        String               // e.g. "Acme Engineering"
  slug        String               @unique // e.g. "acme-eng"
  avatarUrl   String?
  createdAt   DateTime             @default(now())

  members     OrganizationMember[]
  projects    Project[]
  invites     OrganizationInvite[]
}

model OrganizationMember {
  id             String       @id @default(cuid())
  role           Role         @default(DEVELOPER)
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())

  @@unique([userId, organizationId])
}

model OrganizationInvite {
  id             String       @id @default(cuid())
  email          String
  role           Role         @default(DEVELOPER)
  token          String       @unique // Cryptographic random string
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invitedById    String
  invitedBy      User         @relation("InvitedBy", fields: [invitedById], references: [id])
  expiresAt      DateTime     // Default: 7 days from creation
  createdAt      DateTime     @default(now())

  @@unique([organizationId, email])
}
```

---

## 3. Permissions Matrix (RBAC)

| Action | Owner | Admin | Developer | Viewer |
| :--- | :---: | :---: | :---: | :---: |
| **Invite & Remove Team Members** | ✅ | ✅ | ❌ | ❌ |
| **Change Member Roles** | ✅ | ✅ | ❌ | ❌ |
| **Delete Project / Cluster** | ✅ | ❌ | ❌ | ❌ |
| **Provision Databases (Postgres, Redis)** | ✅ | ✅ | ✅ | ❌ |
| **Deploy Services / Trigger Builds** | ✅ | ✅ | ✅ | ❌ |
| **View Live Canvas & Logs** | ✅ | ✅ | ✅ | ✅ |
| **Neon Studio: View Tables & Query** | ✅ | ✅ | ✅ | ✅ |
| **Neon Studio: Edit Cells & Run DDL (`DROP`)** | ✅ | ✅ | ✅ | ❌ *(Read-only)* |
| **Manage Production Secrets (`.env`)** | ✅ | ✅ | ❌ | ❌ |

---

## 4. Team Member Invitation Workflow

### 4.1 Inviting a New Colleague
An Admin or Owner goes to **Project Settings ➔ Team Members** and enters their colleague's email address and role:

```typescript
// server/actions/invitations.ts
'use server';

import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { sendEmail } from '@/lib/mailer';

export async function inviteTeamMember({
  organizationId,
  email,
  role,
  currentUserId,
}: {
  organizationId: string;
  email: string;
  role: 'ADMIN' | 'DEVELOPER' | 'VIEWER';
  currentUserId: string;
}) {
  // 1. Verify caller has OWNER or ADMIN role
  const caller = await db.organizationMember.findUnique({
    where: { userId_organizationId: { userId: currentUserId, organizationId } },
  });

  if (!caller || (caller.role !== 'OWNER' && caller.role !== 'ADMIN')) {
    throw new Error('Unauthorized: Only Owners and Admins can invite team members.');
  }

  // 2. Generate secure token with 7-day expiration
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invite = await db.organizationInvite.create({
    data: {
      organizationId,
      email: email.toLowerCase(),
      role,
      token,
      invitedById: currentUserId,
      expiresAt,
    },
    include: { organization: true },
  });

  // 3. Send email with invitation link
  const inviteUrl = `https://${process.env.DOMAIN}/invite/${token}`;
  await sendEmail({
    to: email,
    subject: `You've been invited to join ${invite.organization.name}`,
    html: `
      <h2>Join ${invite.organization.name} on Railway PaaS</h2>
      <p>You have been invited as a <strong>${role}</strong>.</p>
      <a href="${inviteUrl}" style="padding: 10px 20px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 6px;">Accept Invitation</a>
      <p>This invite link will expire in 7 days.</p>
    `,
  });

  return { success: true, inviteId: invite.id };
}
```

### 4.2 Accepting the Invitation
When the colleague opens `https://paas.yourdomain.com/invite/:token`:
1. If not logged in, they are prompted to create an account or sign in with GitHub.
2. The Control Plane verifies the token:
   - Validates that `expiresAt > NOW()`.
   - Links the user's `userId` to `OrganizationMember` with the assigned role.
   - Deletes the `OrganizationInvite` record.
3. The user is redirected straight into the shared organization's visual canvas!

---

## 5. First-Time Server Admin Setup

When you first deploy the server and access `https://paas.yourdomain.com`:
1. If no users exist in the database, the dashboard automatically enters **"Initial Setup Mode"**.
2. You create the primary **Root Admin / Owner Account** (`name`, `email`, `password`).
3. The platform creates your default **Primary Workspace** and signs you in.
4. From that moment forward, public registration is locked, and new users can **only** join if explicitly invited by you or your team admins.
