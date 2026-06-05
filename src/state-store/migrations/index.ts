import type { Migration } from '../types.js';

import init from './001-init.js';
import { eventsMigration } from '../../event-log/migration.js';

/**
 * Canonical, ordered list of state-store migrations. Consumer tickets append
 * their `Migration` exports to this array; the migration runner sorts by
 * `version` before applying, so order in the source is for review clarity.
 */
export const BASE_MIGRATIONS: readonly Migration[] = Object.freeze([init, eventsMigration]);
