import os from 'node:os';
import path from 'node:path';

export function issueflowHome(): string {
  return process.env.ISSUEFLOW_HOME ?? path.join(os.homedir(), '.issueflow');
}
