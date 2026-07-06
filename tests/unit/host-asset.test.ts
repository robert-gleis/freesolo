import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkHostAsset,
  getHostAssetSpec,
  installHostAsset,
  type HostAssetSpec
} from '../../src/core/host-asset.js';

describe('getHostAssetSpec', () => {
  it('points codex at the user-global skills directory', () => {
    const spec = getHostAssetSpec('codex', '/wt/example');

    expect(spec.tool).toBe('codex');
    expect(spec.isDirectory).toBe(true);
    expect(spec.target).toMatch(/\.codex\/skills\/freesolo-workflow$/);
    expect(spec.source).toMatch(/integrations\/skills\/freesolo-workflow$/);
  });

  it('points claude at the worktree command file', () => {
    const spec = getHostAssetSpec('claude', '/wt/example');

    expect(spec.tool).toBe('claude');
    expect(spec.isDirectory).toBe(false);
    expect(spec.target).toBe('/wt/example/.claude/commands/freesolo.md');
    expect(spec.source).toMatch(/integrations\/claude\/commands\/freesolo\.md$/);
  });

  it('points cursor at the worktree command file', () => {
    const spec = getHostAssetSpec('cursor', '/wt/example');

    expect(spec.tool).toBe('cursor');
    expect(spec.isDirectory).toBe(false);
    expect(spec.target).toBe('/wt/example/.cursor/commands/freesolo.md');
    expect(spec.source).toMatch(/integrations\/cursor\/commands\/freesolo\.md$/);
  });
});

describe('checkHostAsset and installHostAsset (file)', () => {
  let workspace: string;
  let source: string;
  let target: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'freesolo-host-asset-'));
    source = path.join(workspace, 'src.md');
    target = path.join(workspace, 'nested/dir/dest.md');
    await writeFile(source, 'hello\n');
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  function spec(): HostAssetSpec {
    return { tool: 'claude', source, target, isDirectory: false, label: 'test file' };
  }

  it('reports missing when target does not exist', async () => {
    expect(await checkHostAsset(spec())).toBe('missing');
  });

  it('reports current when contents match', async () => {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'hello\n');

    expect(await checkHostAsset(spec())).toBe('current');
  });

  it('reports outdated when contents diverge', async () => {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'stale\n');

    expect(await checkHostAsset(spec())).toBe('outdated');
  });

  it('creates parent directories and copies the source file on install', async () => {
    await installHostAsset(spec());

    expect(await readFile(target, 'utf8')).toBe('hello\n');
  });

  it('overwrites a stale target on install', async () => {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'stale\n');

    await installHostAsset(spec());

    expect(await readFile(target, 'utf8')).toBe('hello\n');
    expect(await checkHostAsset(spec())).toBe('current');
  });
});

describe('checkHostAsset and installHostAsset (directory)', () => {
  let workspace: string;
  let source: string;
  let target: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'freesolo-host-asset-dir-'));
    source = path.join(workspace, 'source-skill');
    target = path.join(workspace, 'install/.codex/skills/freesolo-workflow');
    await mkdir(path.join(source, 'scripts'), { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), 'skill\n');
    await writeFile(path.join(source, 'scripts', 'review-loop.mjs'), 'console.log(1);\n');
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  function spec(): HostAssetSpec {
    return { tool: 'codex', source, target, isDirectory: true, label: 'test skill' };
  }

  it('reports missing when target directory does not exist', async () => {
    expect(await checkHostAsset(spec())).toBe('missing');
  });

  it('copies the entire skill bundle on install and then reports current', async () => {
    await installHostAsset(spec());

    expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('skill\n');
    expect(await readFile(path.join(target, 'scripts', 'review-loop.mjs'), 'utf8')).toBe('console.log(1);\n');
    expect(await checkHostAsset(spec())).toBe('current');
  });

  it('reports outdated when a nested file diverges', async () => {
    await installHostAsset(spec());
    await writeFile(path.join(target, 'scripts', 'review-loop.mjs'), 'console.log(2);\n');

    expect(await checkHostAsset(spec())).toBe('outdated');
  });

  it('replaces stale nested files on reinstall', async () => {
    await installHostAsset(spec());
    await writeFile(path.join(target, 'scripts', 'review-loop.mjs'), 'console.log(2);\n');
    await writeFile(path.join(target, 'extra.md'), 'leftover\n');

    await installHostAsset(spec());

    expect(await readFile(path.join(target, 'scripts', 'review-loop.mjs'), 'utf8')).toBe('console.log(1);\n');
    expect(await checkHostAsset(spec())).toBe('current');
  });
});
