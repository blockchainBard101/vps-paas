import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  Headers,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { GitHubService } from './github.service.js';
import { Public } from './public.decorator.js';

@Controller('api/github')
export class GitHubController {
  constructor(private readonly githubService: GitHubService) {}

  @Get('status')
  getStatus() {
    return this.githubService.getStatus();
  }

  @Post('token')
  setToken(@Body() body: { token: string }) {
    return this.githubService.setToken(body.token);
  }

  @Get('oauth/authorize')
  getOAuthUrl(@Query('redirectUri') redirectUri?: string) {
    return this.githubService.getOAuthUrl(redirectUri);
  }

  @Public()
  @Get('manifest/start')
  startManifestFlow(@Res() res: Response) {
    const data = this.githubService.getManifestData();
    const manifestJson = JSON.stringify(data.manifest);
    const escapedJson = manifestJson.replace(/"/g, '&quot;');

    return res.type('html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Connecting to GitHub...</title>
        <style>
          * { box-sizing: border-box; }
          body {
            background: #09090b;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
          }
          .card {
            background: #141416;
            border: 1px solid #27272a;
            border-radius: 16px;
            padding: 36px 32px;
            text-align: center;
            max-width: 440px;
            width: 100%;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
          }
          .spinner {
            border: 3px solid rgba(255,255,255,0.08);
            border-top: 3px solid #6366f1;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          h3 { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #f4f4f5; }
          p { margin: 0 0 20px; color: #a1a1aa; font-size: 13px; line-height: 1.5; }
          .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            background: #4f46e5;
            color: #ffffff;
            font-weight: 600;
            font-size: 14px;
            padding: 12px 20px;
            border-radius: 10px;
            border: none;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.15s ease-in-out;
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
          }
          .btn:hover {
            background: #4338ca;
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(79, 70, 229, 0.4);
          }
          .hint {
            font-size: 12px;
            color: #71717a;
            margin-top: 14px;
            margin-bottom: 0;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="spinner" id="spinner"></div>
          <h3>Connecting to GitHub</h3>
          <p>Redirecting to GitHub to authorize your PaaS instance...</p>
          <form id="manifestForm" method="post" action="${data.postUrl}">
            <input type="hidden" name="manifest" value="${escapedJson}" />
            <button type="submit" id="submitBtn" class="btn" autofocus>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
              Continue to GitHub &rarr;
            </button>
          </form>
          <p class="hint">Click the button above if you are not redirected automatically.</p>
        </div>
        <script>
          window.addEventListener('load', function() {
            setTimeout(function() {
              try {
                document.getElementById('manifestForm').submit();
              } catch(e) {
                console.warn('Auto-submit prevented by browser:', e);
              }
            }, 100);
          });
        </script>
      </body>
      </html>
    `);
  }

  @Public()
  @Get('manifest/callback')
  async handleManifestCallback(@Query('code') code: string, @Res() res: Response) {
    try {
      const result = await this.githubService.handleManifestCallback(code);
      // Immediately redirect to user authorization
      return res.redirect(result.authorizeUrl);
    } catch (err: any) {
      return res.type('html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>GitHub App Setup Failed</title>
          <style>
            body { background: #09090b; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { text-align: center; background: #18181b; padding: 32px; border-radius: 16px; border: 1px solid #ef4444; max-width: 420px; }
            h2 { margin: 0 0 8px; font-size: 18px; color: #ef4444; }
            p { color: #a1a1aa; font-size: 13px; margin: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>GitHub App Creation Error</h2>
            <p>${err.message || 'Failed to convert manifest code'}</p>
          </div>
        </body>
        </html>
      `);
    }
  }

  @Public()
  @Get('oauth/callback')
  async handleOAuthCallback(@Query('code') code: string, @Res() res: Response) {
    try {
      await this.githubService.handleOAuthCallback(code);
      const appSlug = this.githubService.appSlug;
      if (appSlug) {
        return res.redirect(`https://github.com/apps/${appSlug}/installations/select_target`);
      }
      return res.type('html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>GitHub Connected</title>
          <style>
            body { background: #09090b; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { text-align: center; background: #18181b; padding: 32px 40px; border-radius: 16px; border: 1px solid #27272a; max-width: 400px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
            h2 { margin: 0 0 8px; font-size: 20px; color: #4ade80; }
            p { color: #a1a1aa; font-size: 14px; margin: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>✓ Connected to GitHub!</h2>
            <p>Your GitHub account has been linked. You can close this window now.</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS' }, '*');
              setTimeout(() => window.close(), 1200);
            } else {
              setTimeout(() => { window.location.href = 'http://localhost:3000'; }, 1500);
            }
          </script>
        </body>
        </html>
      `);
    } catch (err: any) {
      return res.type('html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>GitHub Connection Failed</title>
          <style>
            body { background: #09090b; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { text-align: center; background: #18181b; padding: 32px; border-radius: 16px; border: 1px solid #ef4444; max-width: 400px; }
            h2 { margin: 0 0 8px; font-size: 20px; color: #ef4444; }
            p { color: #a1a1aa; font-size: 14px; margin: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Authentication Failed</h2>
            <p>${err.message || 'Failed to exchange authorization code with GitHub'}</p>
          </div>
        </body>
        </html>
      `);
    }
  }

  @Get('setup/callback')
  async handleSetupCallback(@Query('installation_id') installationId: string, @Res() res: Response) {
    return res.type('html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GitHub App Configured</title>
        <style>
          body { background: #09090b; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { text-align: center; background: #18181b; padding: 32px 40px; border-radius: 16px; border: 1px solid #27272a; max-width: 400px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
          h2 { margin: 0 0 8px; font-size: 20px; color: #4ade80; }
          p { color: #a1a1aa; font-size: 14px; margin: 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>✓ Access Updated!</h2>
          <p>Your repository and organization permissions have been updated. Closing...</p>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS' }, '*');
            setTimeout(() => window.close(), 1000);
          } else {
            setTimeout(() => { window.location.href = 'http://localhost:3000'; }, 1200);
          }
        </script>
      </body>
      </html>
    `);
  }

  @Post('oauth/config')
  setOAuthConfig(@Body() body: { clientId: string; clientSecret: string }) {
    return this.githubService.setOAuthConfig(body.clientId, body.clientSecret);
  }

  @Delete('oauth/config')
  resetAppConfig() {
    return this.githubService.resetAppConfig();
  }

  @Post('disconnect')
  disconnect() {
    return this.githubService.disconnect();
  }

  @Delete('token')
  disconnectDelete() {
    return this.githubService.disconnect();
  }

  @Get('repos')
  listRepos() {
    return this.githubService.listRepos();
  }

  @Get('repos/:owner/:repo')
  getRepo(@Param('owner') owner: string, @Param('repo') repo: string) {
    return this.githubService.getPublicRepo(owner, repo);
  }

  @Get('repos/:owner/:repo/branches')
  listBranches(@Param('owner') owner: string, @Param('repo') repo: string) {
    return this.githubService.listBranches(owner, repo);
  }

  @Get('repos/:owner/:repo/detect')
  detectBuild(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('branch') branch?: string,
    @Query('subfolder') subfolder?: string,
    @Query('dockerfilePath') dockerfilePath?: string,
  ) {
    return this.githubService.detectRepoBuild(owner, repo, branch, subfolder, dockerfilePath);
  }

  @Get('repos/:owner/:repo/env-suggestions')
  envSuggestions(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('branch') branch?: string,
    @Query('subfolder') subfolder?: string,
  ) {
    return this.githubService.suggestEnvVars(owner, repo, branch, subfolder);
  }

  @Post('deploy')
  deployFromGitHub(
    @Body()
    body: {
      tempId?: string;
      serviceName?: string;
      repoName: string;
      branch: string;
      cloneUrl: string;
      subfolder?: string;
      dockerfilePath?: string;
      buildMethod?: 'auto' | 'railpack' | 'dockerfile' | 'slim';
      runtimeMode?: 'web' | 'worker';
      installCommand?: string;
      buildCommand?: string;
      startCommand?: string;
      systemPackages?: string;
      nodeVersion?: string;
      port?: number;
      env?: Record<string, string>;
    },
  ) {
    return this.githubService.deployFromGitHub(body);
  }

  @Get('build-logs/stream/:id')
  async streamBuildLogs(@Param('id') id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Disable proxy buffering (nginx, Caddy, etc.) so SSE lines stream instantly.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    (res as any).socket?.setNoDelay?.(true);

    // Immediate handshake so the client's EventSource flips to "connected" instantly.
    res.write(': connected\n\n');
    (res as any).flush?.();

    // Heartbeat comment every 15s keeps intermediaries from closing idle streams.
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
        (res as any).flush?.();
      } catch {}
    }, 15000);

    const cleanup = this.githubService.streamBuildLogs(
      id,
      (chunk) => {
        res.write(`data: ${JSON.stringify({ log: chunk })}\n\n`);
        (res as any).flush?.();
      },
      () => {
        clearInterval(heartbeat);
        res.end();
      },
    );

    res.on('close', () => {
      clearInterval(heartbeat);
      cleanup();
    });
  }

  @Get('build-logs/:id')
  getBuildLogs(@Param('id') id: string) {
    return this.githubService.getBuildLogs(id);
  }

  @Get('build-status/:id')
  getBuildStatus(@Param('id') id: string) {
    return this.githubService.getBuildStatus(id);
  }

  @Get('deployments/history/:serviceId')
  getDeployHistory(@Param('serviceId') serviceId: string) {
    return this.githubService.getDeployHistory(serviceId);
  }

  @Post('redeploy/:serviceId')
  redeployService(
    @Param('serviceId') serviceId: string,
    @Body()
    body?: {
      repoName?: string;
      branch?: string;
      cloneUrl?: string;
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
      env?: Record<string, string>;
    },
  ) {
    return this.githubService.redeployService(serviceId, body);
  }

  @Public()
  @Post('webhook')
  @HttpCode(200)
  handleWebhook(
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') event: string,
    @Body() payload: any,
  ) {
    return this.githubService.handleWebhook(event, payload, signature);
  }
}
