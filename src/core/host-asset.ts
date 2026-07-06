import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { HostTool } from './types.js';

export type HostAssetStatus = 'missing' | 'outdated' | 'current';

export interface HostAssetSpec {
  tool: HostTool;
  source: string;
  target: string;
  isDirectory: boolean;
  label: string;
}

export function getHostAssetSpec(tool: HostTool, worktreePath: string): HostAssetSpec {
  const integrationsRoot = resolveIntegrationsRoot();

  switch (tool) {
    case 'codex':
      return {
        tool,
        source: path.join(integrationsRoot, 'skills/freesolo-workflow'),
        target: path.join(os.homedir(), '.codex/skills/freesolo-workflow'),
        isDirectory: true,
        label: 'Codex skill (freesolo-workflow)'
      };
    case 'claude':
      return {
        tool,
        source: path.join(integrationsRoot, 'claude/commands/freesolo.md'),
        target: path.join(worktreePath, '.claude/commands/freesolo.md'),
        isDirectory: false,
        label: 'Claude command (.claude/commands/freesolo.md)'
      };
    case 'cursor':
      return {
        tool,
        source: path.join(integrationsRoot, 'cursor/commands/freesolo.md'),
        target: path.join(worktreePath, '.cursor/commands/freesolo.md'),
        isDirectory: false,
        label: 'Cursor command (.cursor/commands/freesolo.md)'
      };
  }
}

export async function checkHostAsset(spec: HostAssetSpec): Promise<HostAssetStatus> {
  if (!(await pathExists(spec.target))) {
    return 'missing';
  }

  const equal = spec.isDirectory
    ? await directoriesEqual(spec.source, spec.target)
    : await filesEqual(spec.source, spec.target);

  return equal ? 'current' : 'outdated';
}

export async function installHostAsset(spec: HostAssetSpec): Promise<void> {
  await fs.mkdir(path.dirname(spec.target), { recursive: true });

  if (spec.isDirectory) {
    await fs.rm(spec.target, { recursive: true, force: true });
    await fs.cp(spec.source, spec.target, { recursive: true });
  } else {
    await fs.copyFile(spec.source, spec.target);
  }
}

function resolveIntegrationsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(findPackageRoot(here), 'integrations');
}

function findPackageRoot(start: string): string {
  let dir = start;

  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');

    try {
      const pkg = JSON.parse(fsSync.readFileSync(pkgPath, 'utf8'));

      if (pkg.name === 'freesolo') {
        return dir;
      }
    } catch {
      // keep walking
    }

    dir = path.dirname(dir);
  }

  throw new Error('freesolo package root not found');
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function filesEqual(a: string, b: string): Promise<boolean> {
  const [bufA, bufB] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
  return bufA.equals(bufB);
}

async function directoriesEqual(a: string, b: string): Promise<boolean> {
  const [aFiles, bFiles] = await Promise.all([listFilesRecursive(a), listFilesRecursive(b)]);

  if (aFiles.length !== bFiles.length) {
    return false;
  }

  const aSet = new Set(aFiles);

  for (const rel of bFiles) {
    if (!aSet.has(rel)) {
      return false;
    }
  }

  for (const rel of aFiles) {
    if (!(await filesEqual(path.join(a, rel), path.join(b, rel)))) {
      return false;
    }
  }

  return true;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(full);

      for (const rel of nested) {
        files.push(path.join(entry.name, rel));
      }
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
  }

  return files;
}
