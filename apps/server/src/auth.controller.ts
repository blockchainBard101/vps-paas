import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { Public } from './public.decorator.js';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('status')
  getStatus() {
    return this.authService.getStatus();
  }

  @Public()
  @Post('setup')
  setup(
    @Body()
    body: {
      email: string;
      password: string;
      name?: string;
      instanceName?: string;
    },
  ) {
    return this.authService.setup(body);
  }

  @Public()
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body);
  }

  @Get('me')
  getMe(@Headers('authorization') authHeader?: string) {
    const token = this.extractToken(authHeader);
    const user = this.authService.validateToken(token);
    if (!user) {
      throw new UnauthorizedException('Session expired or invalid.');
    }
    const status = this.authService.getStatus();
    return {
      user,
      instanceName: status.instanceName,
    };
  }

  @Post('logout')
  logout(@Headers('authorization') authHeader?: string) {
    const token = this.extractToken(authHeader);
    return this.authService.logout(token);
  }

  @Post('change-password')
  changePassword(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    const token = this.extractToken(authHeader);
    return this.authService.changePassword(token, body);
  }

  // ── Team Members ─────────────────────────────────────────────────────────

  @Get('members')
  getMembers(@Headers('authorization') authHeader?: string) {
    const token = this.extractToken(authHeader);
    const user = this.authService.validateToken(token);
    if (!user) {
      throw new UnauthorizedException('Session expired or invalid.');
    }
    return this.authService.getMembers(user.id);
  }

  @Post('members/invite')
  inviteMember(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: { email: string; role: 'ADMIN' | 'DEVELOPER' | 'VIEWER'; name?: string },
  ) {
    const token = this.extractToken(authHeader);
    const user = this.authService.validateToken(token);
    if (!user) {
      throw new UnauthorizedException('Session expired or invalid.');
    }
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new UnauthorizedException('Only owners and admins can invite team members.');
    }
    return this.authService.inviteMember(body);
  }

  @Post('members/:id/role')
  updateMemberRole(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: { role: 'ADMIN' | 'DEVELOPER' | 'VIEWER' },
    @Param('id') id: string,
  ) {
    const token = this.extractToken(authHeader);
    const user = this.authService.validateToken(token);
    if (!user) {
      throw new UnauthorizedException('Session expired or invalid.');
    }
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new UnauthorizedException('Only owners and admins can update member roles.');
    }
    return this.authService.updateMemberRole(id, body.role);
  }

  @Delete('members/:id')
  removeMember(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const token = this.extractToken(authHeader);
    const user = this.authService.validateToken(token);
    if (!user) {
      throw new UnauthorizedException('Session expired or invalid.');
    }
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new UnauthorizedException('Only owners and admins can remove team members.');
    }
    return this.authService.removeMember(id);
  }

  // ── Public Invite Verification & Acceptance ──────────────────────────────

  @Public()
  @Get('invite/:token')
  getInviteInfo(@Param('token') token: string) {
    return this.authService.getInviteInfo(token);
  }

  @Public()
  @Post('accept-invite')
  acceptInvite(
    @Body() body: { token: string; password: string; name?: string },
  ) {
    return this.authService.acceptInvite(body);
  }

  private extractToken(authHeader?: string): string {
    if (!authHeader) return '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    return authHeader.trim();
  }
}
