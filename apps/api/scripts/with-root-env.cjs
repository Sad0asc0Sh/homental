const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const dotenv = require('dotenv');

dotenv.config();
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/with-root-env.cjs <command> [...args]');
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
