import { chmod, stat } from 'node:fs/promises';

const targetPaths = process.argv.slice(2);

if (targetPaths.length === 0) {
  console.error('Usage: node scripts/ensure-bin-executable.mjs <path> [path...]');
  process.exit(1);
}

for (const targetPath of targetPaths) {
  const currentMode = (await stat(targetPath)).mode & 0o777;
  const executeBits = (currentMode & 0o444) >> 2;
  const nextMode = currentMode | executeBits;

  if (nextMode !== currentMode) {
    await chmod(targetPath, nextMode);
  }
}
