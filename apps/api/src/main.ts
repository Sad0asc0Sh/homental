import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Logger } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import { bootstrap } from './bootstrap/bootstrap';

dotenv.config();
dotenv.config({ path: resolve(__dirname, '../../../.env') });

async function main(): Promise<void> {
  const app = await bootstrap();
  const config = app.get(AppConfigService);
  await app.listen(config.port);
  new Logger('Bootstrap').log(
    `🚀 Homental API ready on http://localhost:${config.port} — docs: http://localhost:${config.port}/docs`,
  );
}

main().catch((error: unknown) => {
  console.error('Fatal bootstrap error:', error);
  process.exit(1);
});
