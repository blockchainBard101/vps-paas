import { Injectable, OnModuleInit, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ensureDataDir } from './config/paths.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER';
  avatarInitials: string;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface StoredMember {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'DEVELOPER' | 'VIEWER';
  avatarInitials: string;
  passwordHash?: string;
  salt?: string;
  inviteToken?: string;
  inviteExpiresAt?: string;
  status: 'active' | 'invited';
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface StoredAdmin {
  id: string;
  name: string;
  email: string;
  role: 'OWNER';
  avatarInitials: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface UserSession {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuthStorageData {
  isSetupComplete: boolean;
  instanceName: string;
  admin: StoredAdmin | null;
  members: StoredMember[];
  sessions: UserSession[];
}

@Injectable()
export class AuthService implements OnModuleInit {
  private storagePath: string;
  private data: AuthStorageData = {
    isSetupComplete: false,
    instanceName: 'My Cloud PaaS',
    admin: null,
    members: [],
    sessions: [],
  };

  constructor() {
    const baseDir = ensureDataDir();
    this.storagePath = path.join(baseDir, 'auth-config.json');
  }

  onModuleInit() {
    this.loadFromDisk();

    // Headless / automated setup via environment variables
    const envEmail = process.env.ADMIN_EMAIL;
    const envPassword = process.env.ADMIN_PASSWORD;
    const envInstanceName = process.env.INSTANCE_NAME;

    if (!this.data.isSetupComplete && envEmail && envPassword) {
      console.log(`🔑 Automatically bootstrapping Admin account from environment variables for ${envEmail}...`);
      this.setup({
        email: envEmail,
        password: envPassword,
        name: process.env.ADMIN_NAME || 'Administrator',
        instanceName: envInstanceName || 'Production Cloud',
      });
    }
  }

  private loginAttempts = new Map<string, { count: number; resetAt: number }>();

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          isSetupComplete: Boolean(parsed.isSetupComplete),
          instanceName: parsed.instanceName || 'My Cloud PaaS',
          admin: parsed.admin || null,
          members: Array.isArray(parsed.members) ? parsed.members : [],
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        };
        // Clean up expired sessions
        const now = new Date().toISOString();
        this.data.sessions = this.data.sessions.filter((s) => s.expiresAt > now);
      }
    } catch (err) {
      console.error('Failed to load auth config from disk:', err);
    }
  }

  private saveToDisk() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), {
        encoding: 'utf8',
        mode: 0o600, // Restrictive permissions: read/write only by file owner
      });
      try {
        fs.chmodSync(this.storagePath, 0o600);
      } catch {}
    } catch (err) {
      console.error('Failed to save auth config to disk:', err);
    }
  }

  private checkRateLimit(key: string, maxAttempts = 5, windowMs = 60000) {
    const now = Date.now();
    const bucket = this.loginAttempts.get(key);
    if (bucket) {
      if (now < bucket.resetAt) {
        if (bucket.count >= maxAttempts) {
          const remainingSec = Math.ceil((bucket.resetAt - now) / 1000);
          throw new BadRequestException(
            `Too many failed attempts. Rate limit exceeded. Please wait ${remainingSec} seconds before trying again.`
          );
        }
        bucket.count++;
      } else {
        this.loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
      }
    } else {
      this.loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
    }
  }

  private clearRateLimit(key: string) {
    this.loginAttempts.delete(key);
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  private getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2) || 'AD';
  }

  private createSession(userId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
    this.data.sessions.push({
      token,
      userId,
      createdAt: new Date().toISOString(),
      expiresAt,
    });
    this.saveToDisk();
    return token;
  }

  getStatus() {
    return {
      isSetupComplete: this.data.isSetupComplete && !!this.data.admin,
      instanceName: this.data.instanceName,
      adminEmailPreview: this.data.admin ? this.data.admin.email : null,
    };
  }

  setup(dto: { email: string; password: string; name?: string; instanceName?: string }) {
    if (this.data.isSetupComplete && this.data.admin) {
      throw new BadRequestException('Server is already initialized. Please sign in instead.');
    }

    const email = dto.email.trim().toLowerCase();
    const password = dto.password;
    const name = dto.name?.trim() || 'Admin';
    const instanceName = dto.instanceName?.trim() || 'Production Cloud';

    if (!email || !email.includes('@')) {
      throw new BadRequestException('Please provide a valid email address.');
    }
    if (!password || password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long.');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword(password, salt);
    const createdAt = new Date().toISOString();

    const admin: StoredAdmin = {
      id: 'usr-admin-primary',
      name,
      email,
      role: 'OWNER',
      avatarInitials: this.getInitials(name),
      passwordHash,
      salt,
      createdAt,
      lastLoginAt: createdAt,
    };

    this.data.isSetupComplete = true;
    this.data.instanceName = instanceName;
    this.data.admin = admin;
    this.data.sessions = [];

    const token = this.createSession(admin.id);
    this.saveToDisk();

    return {
      token,
      instanceName: this.data.instanceName,
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        avatarInitials: admin.avatarInitials,
        createdAt: admin.createdAt,
      },
    };
  }

  login(dto: { email: string; password: string }) {
    if (!this.data.isSetupComplete || !this.data.admin) {
      throw new BadRequestException('Server has not been initialized. Please complete initial setup first.');
    }

    const email = dto.email.trim().toLowerCase();
    const password = dto.password;

    // Throttle login attempts to defend against brute force
    this.checkRateLimit(`login:${email}`);

    // Check primary admin
    if (email === this.data.admin.email.toLowerCase()) {
      const computedHash = this.hashPassword(password, this.data.admin.salt);
      const storedBuf = Buffer.from(this.data.admin.passwordHash, 'hex');
      const computedBuf = Buffer.from(computedHash, 'hex');

      if (storedBuf.length !== computedBuf.length || !crypto.timingSafeEqual(storedBuf, computedBuf)) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      this.clearRateLimit(`login:${email}`);
      this.data.admin.lastLoginAt = new Date().toISOString();
      const token = this.createSession(this.data.admin.id);
      this.saveToDisk();

      return {
        token,
        instanceName: this.data.instanceName,
        user: {
          id: this.data.admin.id,
          name: this.data.admin.name,
          email: this.data.admin.email,
          role: this.data.admin.role,
          avatarInitials: this.data.admin.avatarInitials,
          createdAt: this.data.admin.createdAt,
        },
      };
    }

    // Check team members
    const member = this.data.members.find((m) => m.email.toLowerCase() === email);
    if (member) {
      if (member.status === 'invited') {
        throw new UnauthorizedException('This account invitation has not been accepted yet. Please use your invitation link.');
      }
      if (!member.passwordHash || !member.salt) {
        throw new UnauthorizedException('Account credentials not configured. Please use your invitation link to set a password.');
      }

      const computedHash = this.hashPassword(password, member.salt);
      const storedBuf = Buffer.from(member.passwordHash, 'hex');
      const computedBuf = Buffer.from(computedHash, 'hex');

      if (storedBuf.length !== computedBuf.length || !crypto.timingSafeEqual(storedBuf, computedBuf)) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      this.clearRateLimit(`login:${email}`);
      member.lastLoginAt = new Date().toISOString();
      const token = this.createSession(member.id);
      this.saveToDisk();

      return {
        token,
        instanceName: this.data.instanceName,
        user: {
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          avatarInitials: member.avatarInitials,
          createdAt: member.createdAt,
        },
      };
    }

    throw new UnauthorizedException('Invalid email or password.');
  }

  validateToken(token: string): UserProfile | null {
    if (!token) return null;
    const now = new Date().toISOString();
    const session = this.data.sessions.find((s) => s.token === token && s.expiresAt > now);
    if (!session) return null;

    if (this.data.admin && session.userId === this.data.admin.id) {
      return {
        id: this.data.admin.id,
        name: this.data.admin.name,
        email: this.data.admin.email,
        role: this.data.admin.role,
        avatarInitials: this.data.admin.avatarInitials,
        createdAt: this.data.admin.createdAt,
        lastLoginAt: this.data.admin.lastLoginAt,
      };
    }

    const member = this.data.members.find((m) => m.id === session.userId && m.status === 'active');
    if (member) {
      return {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        avatarInitials: member.avatarInitials,
        createdAt: member.createdAt,
        lastLoginAt: member.lastLoginAt,
      };
    }

    return null;
  }

  logout(token: string) {
    if (!token) return { success: true };
    this.data.sessions = this.data.sessions.filter((s) => s.token !== token);
    this.saveToDisk();
    return { success: true };
  }

  changePassword(token: string, dto: { currentPassword: string; newPassword: string }) {
    const user = this.validateToken(token);
    if (!user) {
      throw new UnauthorizedException('Unauthorized.');
    }

    if (!dto.newPassword || dto.newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters long.');
    }

    if (this.data.admin && user.id === this.data.admin.id) {
      const computedHash = this.hashPassword(dto.currentPassword, this.data.admin.salt);
      const storedBuf = Buffer.from(this.data.admin.passwordHash, 'hex');
      const computedBuf = Buffer.from(computedHash, 'hex');

      if (storedBuf.length !== computedBuf.length || !crypto.timingSafeEqual(storedBuf, computedBuf)) {
        throw new BadRequestException('Current password is incorrect.');
      }

      const newSalt = crypto.randomBytes(16).toString('hex');
      this.data.admin.salt = newSalt;
      this.data.admin.passwordHash = this.hashPassword(dto.newPassword, newSalt);

      this.data.sessions = this.data.sessions.filter((s) => s.token === token);
      this.saveToDisk();
      return { success: true, message: 'Password updated successfully.' };
    }

    const member = this.data.members.find((m) => m.id === user.id && m.status === 'active');
    if (member && member.passwordHash && member.salt) {
      const computedHash = this.hashPassword(dto.currentPassword, member.salt);
      const storedBuf = Buffer.from(member.passwordHash, 'hex');
      const computedBuf = Buffer.from(computedHash, 'hex');

      if (storedBuf.length !== computedBuf.length || !crypto.timingSafeEqual(storedBuf, computedBuf)) {
        throw new BadRequestException('Current password is incorrect.');
      }

      const newSalt = crypto.randomBytes(16).toString('hex');
      member.salt = newSalt;
      member.passwordHash = this.hashPassword(dto.newPassword, newSalt);

      this.data.sessions = this.data.sessions.filter((s) => s.token === token);
      this.saveToDisk();
      return { success: true, message: 'Password updated successfully.' };
    }

    throw new BadRequestException('Account not found.');
  }

  // ── Team Members & Access Control ──────────────────────────────────────────

  getMembers(currentUserId?: string) {
    const list: any[] = [];

    if (this.data.admin) {
      list.push({
        id: this.data.admin.id,
        name: this.data.admin.name,
        email: this.data.admin.email,
        role: this.data.admin.role,
        avatarInitials: this.data.admin.avatarInitials,
        status: 'active',
        isOwner: true,
        isYou: currentUserId === this.data.admin.id,
        createdAt: this.data.admin.createdAt,
        lastLoginAt: this.data.admin.lastLoginAt,
      });
    }

    for (const m of this.data.members) {
      list.push({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        avatarInitials: m.avatarInitials,
        status: m.status,
        isOwner: false,
        isYou: currentUserId === m.id,
        inviteToken: m.inviteToken,
        inviteExpiresAt: m.inviteExpiresAt,
        createdAt: m.createdAt,
        lastLoginAt: m.lastLoginAt,
      });
    }

    return list;
  }

  inviteMember(dto: { email: string; role: 'ADMIN' | 'DEVELOPER' | 'VIEWER'; name?: string }) {
    const email = dto.email?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Please provide a valid email address.');
    }

    if (!['ADMIN', 'DEVELOPER', 'VIEWER'].includes(dto.role)) {
      throw new BadRequestException('Invalid role. Role must be ADMIN, DEVELOPER, or VIEWER.');
    }

    if (this.data.admin && email === this.data.admin.email.toLowerCase()) {
      throw new BadRequestException('The primary owner already has this email address.');
    }

    const existing = this.data.members.find((m) => m.email.toLowerCase() === email);
    if (existing) {
      if (existing.status === 'active') {
        throw new BadRequestException('A team member with this email already exists.');
      }
      // Re-issue / refresh invite
      existing.role = dto.role;
      if (dto.name && dto.name.trim()) {
        existing.name = dto.name.trim();
        existing.avatarInitials = this.getInitials(existing.name);
      }
      existing.inviteToken = crypto.randomBytes(24).toString('hex');
      existing.inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      this.saveToDisk();

      return {
        member: {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          role: existing.role,
          avatarInitials: existing.avatarInitials,
          status: existing.status,
          isOwner: false,
          isYou: false,
          inviteToken: existing.inviteToken,
          inviteExpiresAt: existing.inviteExpiresAt,
          createdAt: existing.createdAt,
        },
        inviteToken: existing.inviteToken,
        message: 'Existing invitation refreshed successfully.',
      };
    }

    const name = dto.name?.trim() || email.split('@')[0];
    const inviteToken = crypto.randomBytes(24).toString('hex');
    const newMember: StoredMember = {
      id: `usr-m-${crypto.randomBytes(6).toString('hex')}`,
      name,
      email,
      role: dto.role,
      avatarInitials: this.getInitials(name),
      status: 'invited',
      inviteToken,
      inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };

    this.data.members.push(newMember);
    this.saveToDisk();

    return {
      member: {
        id: newMember.id,
        name: newMember.name,
        email: newMember.email,
        role: newMember.role,
        avatarInitials: newMember.avatarInitials,
        status: newMember.status,
        isOwner: false,
        isYou: false,
        inviteToken: newMember.inviteToken,
        inviteExpiresAt: newMember.inviteExpiresAt,
        createdAt: newMember.createdAt,
      },
      inviteToken: newMember.inviteToken,
      message: 'Invitation sent successfully.',
    };
  }

  updateMemberRole(memberId: string, role: 'ADMIN' | 'DEVELOPER' | 'VIEWER') {
    if (!['ADMIN', 'DEVELOPER', 'VIEWER'].includes(role)) {
      throw new BadRequestException('Invalid role specified.');
    }

    if (memberId === this.data.admin?.id || memberId === 'usr-admin-primary') {
      throw new BadRequestException('Cannot modify the role of the primary workspace owner.');
    }

    const member = this.data.members.find((m) => m.id === memberId);
    if (!member) {
      throw new BadRequestException('Member not found.');
    }

    member.role = role;
    this.saveToDisk();

    return {
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      avatarInitials: member.avatarInitials,
      status: member.status,
      isOwner: false,
      isYou: false,
      createdAt: member.createdAt,
    };
  }

  removeMember(memberId: string) {
    if (memberId === this.data.admin?.id || memberId === 'usr-admin-primary') {
      throw new BadRequestException('Cannot remove the primary workspace owner.');
    }

    const index = this.data.members.findIndex((m) => m.id === memberId);
    if (index === -1) {
      throw new BadRequestException('Member not found.');
    }

    const removed = this.data.members.splice(index, 1)[0];
    this.data.sessions = this.data.sessions.filter((s) => s.userId !== memberId);
    this.saveToDisk();

    return { success: true, message: `Removed ${removed.name} from team.` };
  }

  getInviteInfo(token: string) {
    if (!token) throw new BadRequestException('Invalid invitation token.');
    const member = this.data.members.find((m) => m.inviteToken === token);
    if (!member) {
      throw new BadRequestException('Invitation link is invalid or has expired.');
    }

    if (member.inviteExpiresAt && new Date(member.inviteExpiresAt) < new Date()) {
      throw new BadRequestException('Invitation link has expired. Please ask an administrator to send a new invitation.');
    }

    return {
      valid: true,
      email: member.email,
      name: member.name,
      role: member.role,
      instanceName: this.data.instanceName,
    };
  }

  acceptInvite(dto: { token: string; password: string; name?: string }) {
    if (!dto.token) throw new BadRequestException('Invalid invitation token.');
    this.checkRateLimit(`invite:${dto.token}`);

    const member = this.data.members.find((m) => m.inviteToken === dto.token);
    if (!member) {
      throw new BadRequestException('Invitation link is invalid or has expired.');
    }

    if (member.inviteExpiresAt && new Date(member.inviteExpiresAt) < new Date()) {
      throw new BadRequestException('Invitation link has expired. Please ask an administrator to send a new invitation.');
    }

    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long.');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword(dto.password, salt);

    if (dto.name && dto.name.trim()) {
      member.name = dto.name.trim();
      member.avatarInitials = this.getInitials(member.name);
    }

    member.passwordHash = passwordHash;
    member.salt = salt;
    member.status = 'active';
    member.inviteToken = undefined;
    member.inviteExpiresAt = undefined;
    member.lastLoginAt = new Date().toISOString();

    const sessionToken = this.createSession(member.id);
    this.saveToDisk();

    return {
      token: sessionToken,
      instanceName: this.data.instanceName,
      user: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        avatarInitials: member.avatarInitials,
        createdAt: member.createdAt,
      },
    };
  }
}
