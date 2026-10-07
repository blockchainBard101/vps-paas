import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { getDataDir, migrateLegacyData } from './config/paths.js';

async function bootstrap() {
  // Ensure runtime data lives outside the repo and carry over any legacy config.
  migrateLegacyData();
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`🚀 Control Plane Backend running on http://localhost:${port}`);
  console.log(`📂 Runtime data directory: ${getDataDir()}`);
}
await bootstrap();
