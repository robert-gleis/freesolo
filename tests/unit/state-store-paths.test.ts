import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveDefaultPath, resolveTrashDir } from '../../src/state-store/paths.js';

describe('state-store/paths', () => {
  const originalEnv = process.env.FREESOLO_HOME;

  beforeEach(() => {
    delete process.env.FREESOLO_HOME;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FREESOLO_HOME;
    } else {
      process.env.FREESOLO_HOME = originalEnv;
    }
  });

  it('resolveDefaultPath defaults to <homedir>/.freesolo/state.db', () => {
    expect(resolveDefaultPath()).toBe(path.join(os.homedir(), '.freesolo', 'state.db'));
  });

  it('resolveDefaultPath honours FREESOLO_HOME', () => {
    process.env.FREESOLO_HOME = '/var/freesolo';

    expect(resolveDefaultPath()).toBe('/var/freesolo/state.db');
  });

  it('resolveTrashDir defaults under <homedir>/.freesolo/trash/<timestamp>', () => {
    const dir = resolveTrashDir(new Date('2026-06-04T17:23:18.499Z'));

    expect(dir).toBe(
      path.join(os.homedir(), '.freesolo', 'trash', '2026-06-04T17-23-18-499Z')
    );
  });

  it('resolveTrashDir honours FREESOLO_HOME', () => {
    process.env.FREESOLO_HOME = '/var/freesolo';

    expect(resolveTrashDir(new Date('2026-06-04T17:23:18.499Z'))).toBe(
      '/var/freesolo/trash/2026-06-04T17-23-18-499Z'
    );
  });
});
