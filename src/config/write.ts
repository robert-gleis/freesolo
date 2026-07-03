import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG_TEMPLATE = `# All fields are optional - defaults are shown below.
# Workflow state is persisted locally in ~/.issueflow/state/<owner>/<repo>/<issue-number>

# Autonomous watcher defaults (used by \`issueflow watch\`).
watcher:
  interval_seconds: 60
  source: assigned-to-me
  intake_mode: confirm
  initial_state: triaged
  trigger_label: "triaged"

# Set to true to allow the engine to auto-approve team plans without
# a human review gate.
autonomous_mode: false
`;

export async function initConfigFile(filePath: string): Promise<void> {
  let exists = false;
  try {
    await fs.access(filePath);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (exists) throw new Error(`Config file already exists: ${filePath}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, CONFIG_TEMPLATE, 'utf8');
}

function escapeReplacement(s: string): string {
  return s.replace(/\$/g, '$$$$');
}

function applyKeyToContent(content: string, key: string, value: string): string {
  const parts = key.split('.');

  if (parts.length === 1) {
    const flatKey = parts[0];
    const pattern = new RegExp(`^${flatKey}:.*$`, 'm');
    const replacement = `${flatKey}: ${escapeReplacement(value)}`;
    if (pattern.test(content)) {
      return content.replace(pattern, replacement);
    }
    const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    return `${content}${suffix}${replacement}\n`;
  }

  const [, subKey] = parts;
  const nestedPattern = new RegExp(`^(\\s+)${subKey}:.*$`, 'm');
  const replacement = `  ${subKey}: ${escapeReplacement(value)}`;
  if (nestedPattern.test(content)) {
    return content.replace(nestedPattern, replacement);
  }

  // Check if a watcher: block already exists (even if partial)
  const parentBlockPattern = /^watcher:\s*$/m;
  if (parentBlockPattern.test(content)) {
    return content.replace(parentBlockPattern, `watcher:\n  ${subKey}: ${escapeReplacement(value)}`);
  }

  const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  return `${content}${suffix}watcher:\n  ${subKey}: ${escapeReplacement(value)}\n`;
}

export async function setConfigKey(filePath: string, key: string, value: string): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    content = '';
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const updated = applyKeyToContent(content, key, value);
  await fs.writeFile(filePath, updated, 'utf8');
}
