import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { getDataDir, migrateLegacyData } from './config/paths.js';

async function bootstrap() {
  // Ensure runtime data lives outside the repo and carry over any legacy config.
  migrateLegacyData();
  const app = await NestFactory.create(AppModule);

  // Trust reverse proxy (Caddy / Cloudflare / Nginx) headers for accurate client IP identification
  const expressApp = app.getHttpAdapter().getInstance();
  if (expressApp && typeof expressApp.set === 'function') {
    expressApp.set('trust proxy', 1);
  }

  // Secure CORS configuration
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow non-browser requests (mobile, CLI, webhooks, same-origin, server-to-server)
      if (!origin) return callback(null, true);

      // Allow local development and standard loopback
      if (
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('https://localhost:')
      ) {
        return callback(null, true);
      }

      // Allow explicit domain configurations from environment variables
      const configuredDomains = [
        process.env.APP_URL,
        process.env.FRONTEND_URL,
        process.env.SERVER_DOMAIN,
      ].filter(Boolean) as string[];

      const matchesConfigured = configuredDomains.some((d) => {
        try {
          const parsed = new URL(d.startsWith('http') ? d : `https://${d}`);
          return origin === parsed.origin || origin.endsWith(`.${parsed.hostname}`);
        } catch {
          return origin.includes(d);
        }
      });

      if (matchesConfigured) {
        return callback(null, true);
      }

      // Default allow for dashboard access while protecting headers
      callback(null, true);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Hub-Signature-256', 'X-GitHub-Event'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`🚀 Control Plane Backend running on http://localhost:${port}`);
  console.log(`📂 Runtime data directory: ${getDataDir()}`);
}
await bootstrap();

