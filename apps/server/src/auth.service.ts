import { Injectable, OnModuleInit, BadRequestException, UnauthorizedException } from '@nestjs/common';
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
  sessions: UserSession[];
}

@Injectable()
export class AuthService implements OnModuleInit {
  private storagePath: string;
  private data: AuthStorageData = {
    isSetupComplete: false,
    instanceName: 'My Cloud PaaS',
    admin: null,
    sessions: [],
  };

  constructor() {
    const baseDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(baseDir)) {
      try {
        fs.mkdirSync(baseDir, { recursive: true });
      } catch (err) {
        console.warn('Could not create data dir, fallback to current dir:', err);
      }
    }
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

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          isSetupComplete: Boolean(parsed.isSetupComplete),
          instanceName: parsed.instanceName || 'My Cloud PaaS',
          admin: parsed.admin || null,
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
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save auth config to disk:', err);
    }
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

    if (email !== this.data.admin.email.toLowerCase()) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const computedHash = this.hashPassword(password, this.data.admin.salt);
    const storedBuf = Buffer.from(this.data.admin.passwordHash, 'hex');
    const computedBuf = Buffer.from(computedHash, 'hex');

    if (storedBuf.length !== computedBuf.length || !crypto.timingSafeEqual(storedBuf, computedBuf)) {
      throw new UnauthorizedException('Invalid email or password.');
    }

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

  validateToken(token: string): UserProfile | null {
    if (!token) return null;
    const now = new Date().toISOString();
    const session = this.data.sessions.find((s) => s.token === token && s.expiresAt > now);
    if (!session || !this.data.admin || session.userId !== this.data.admin.id) {
      return null;
    }
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

  logout(token: string) {
    if (!token) return { success: true };
    this.data.sessions = this.data.sessions.filter((s) => s.token !== token);
    this.saveToDisk();
    return { success: true };
  }

  changePassword(token: string, dto: { currentPassword: string; newPassword: string }) {
    const user = this.validateToken(token);
    if (!user || !this.data.admin) {
      throw new UnauthorizedException('Unauthorized.');
    }

    if (!dto.newPassword || dto.newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters long.');
    }

    // Verify current password
    const computedHash = this.hashPassword(dto.currentPassword, this.data.admin.salt);
    const storedBuf = Buffer.from(this.data.admin.passwordHash, 'hex');
    const computedBuf = Buffer.from(computedHash, 'hex');

    if (storedBuf.length !== computedBuf.length || !crypto.timingSafeEqual(storedBuf, computedBuf)) {
      throw new BadRequestException('Current password is incorrect.');
    }

    // Hash new password with fresh salt
    const newSalt = crypto.randomBytes(16).toString('hex');
    this.data.admin.salt = newSalt;
    this.data.admin.passwordHash = this.hashPassword(dto.newPassword, newSalt);

    // Keep current session, purge others for security
    this.data.sessions = this.data.sessions.filter((s) => s.token === token);
    this.saveToDisk();

    return { success: true, message: 'Password updated successfully.' };
  }
}
