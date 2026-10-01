// Barrel only — no dispatch. Both capture channels (iOS Shortcut SMS, Android
// accessibility screen dump) arrive over the same deep link and are handled by
// parseAnySms, which covers both message shapes. The bank is an *attribute* of a
// message (detectBankHint in sms.ts), not a parser: dispatching on it would mean
// matching the same shapes twice. parseGpay stays exported for the Android screen
// capture, but nothing routes to it.
import { parseAnySms } from './sms';
import { parseGpay } from './gpay';

export { parseAnySms, parseGpay };
export * from './types';
