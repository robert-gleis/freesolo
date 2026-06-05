import type { Migration } from '../types.js';

/**
 * Reserves version 1 for the state-store module itself. The migration runner
 * creates the `schema_migrations` table on its own, so this migration has no
 * schema work to do; it exists so consumer tickets (#23, #28, #36) can start
 * their migration numbering at 2 on a clean integer line.
 */
const init: Migration = {
  version: 1,
  name: 'init',
  up: () => {
    // no-op: schema_migrations is bootstrapped by the migration runner
  }
};

export default init;
