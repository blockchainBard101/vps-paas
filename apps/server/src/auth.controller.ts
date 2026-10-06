import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('status')
  getStatus() {
    return this.authService.getStatus();
  }

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

  private extractToken(authHeader?: string): string {
    if (!authHeader) return '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    return authHeader.trim();
  }
}
