import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveDefaultPath, resolveTrashDir } from '../../src/state-store/paths.js';

describe('state-store/paths', () => {
  const originalEnv = process.env.ISSUEFLOW_HOME;

  beforeEach(() => {
    delete process.env.ISSUEFLOW_HOME;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ISSUEFLOW_HOME;
    } else {
      process.env.ISSUEFLOW_HOME = originalEnv;
    }
  });

  it('resolveDefaultPath defaults to <homedir>/.issueflow/state.db', () => {
    expect(resolveDefaultPath()).toBe(path.join(os.homedir(), '.issueflow', 'state.db'));
  });

  it('resolveDefaultPath honours ISSUEFLOW_HOME', () => {
    process.env.ISSUEFLOW_HOME = '/var/issueflow';

    expect(resolveDefaultPath()).toBe('/var/issueflow/state.db');
  });

  it('resolveTrashDir defaults under <homedir>/.issueflow/trash/<timestamp>', () => {
    const dir = resolveTrashDir(new Date('2026-06-04T17:23:18.499Z'));

    expect(dir).toBe(
      path.join(os.homedir(), '.issueflow', 'trash', '2026-06-04T17-23-18-499Z')
    );
  });

  it('resolveTrashDir honours ISSUEFLOW_HOME', () => {
    process.env.ISSUEFLOW_HOME = '/var/issueflow';

    expect(resolveTrashDir(new Date('2026-06-04T17:23:18.499Z'))).toBe(
      '/var/issueflow/trash/2026-06-04T17-23-18-499Z'
    );
  });
});
