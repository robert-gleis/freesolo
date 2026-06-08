import { describe, expect, it } from 'vitest';

import { REPORT_SCHEMA_VERSION } from '../../src/reports/types.js';

describe('REPORT_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(REPORT_SCHEMA_VERSION).toBe(1);
  });
});
