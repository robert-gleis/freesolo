import os from 'node:os';
import path from 'node:path';

export function freesoloHome(): string {
  return process.env.FREESOLO_HOME ?? path.join(os.homedir(), '.freesolo');
}
