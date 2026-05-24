/**
 * Side-effect import: enables devmock automatically.
 *
 * @example
 * // In your test setup file or dev entry:
 * import 'devmock/register';
 *
 * // Or in Jest/Vitest config:
 * // setupFiles: ['devmock/register']
 */

import { DevMock } from './index.js';

DevMock.enable();
