import { describe, expect, it } from 'vitest';

import * as memory from '../../src/memory/index.js';

describe('memory barrel', () => {
  it('re-exports ADR helpers', () => {
    expect(typeof memory.isNumberedAdrFilename).toBe('function');
    expect(typeof memory.parseAdrFilename).toBe('function');
    expect(typeof memory.listAdrs).toBe('function');
    expect(typeof memory.nextAdrNumber).toBe('function');
  });
});
