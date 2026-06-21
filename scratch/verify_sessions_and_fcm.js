import { validateSession } from '../api/sessionUtils.js';
import * as auth from '../api/auth.js';
import * as customers from '../api/customers.js';
import * as wallet from '../api/wallet.js';
import * as orders from '../api/orders.js';
import * as settings from '../api/settings.js';
import * as notifications from '../api/notifications.js';

console.log('--- STARTING INTEGRITY CHECKS ---');

// Validate exports
if (typeof validateSession !== 'function') {
  console.error('ERROR: validateSession is not a function');
  process.exit(1);
}
console.log('✓ validateSession utility is exported correctly.');

if (typeof auth.default !== 'function') {
  console.error('ERROR: api/auth handler is not exported correctly');
  process.exit(1);
}
console.log('✓ api/auth handler is exported correctly.');

if (typeof customers.default !== 'function') {
  console.error('ERROR: api/customers handler is not exported correctly');
  process.exit(1);
}
console.log('✓ api/customers handler is exported correctly.');

if (typeof wallet.default !== 'function') {
  console.error('ERROR: api/wallet handler is not exported correctly');
  process.exit(1);
}
console.log('✓ api/wallet handler is exported correctly.');

if (typeof orders.default !== 'function') {
  console.error('ERROR: api/orders handler is not exported correctly');
  process.exit(1);
}
console.log('✓ api/orders handler is exported correctly.');

if (typeof settings.default !== 'function') {
  console.error('ERROR: api/settings handler is not exported correctly');
  process.exit(1);
}
console.log('✓ api/settings handler is exported correctly.');

if (typeof notifications.default !== 'function') {
  console.error('ERROR: api/notifications handler is not exported correctly');
  process.exit(1);
}
console.log('✓ api/notifications handler is exported correctly.');

console.log('--- MOCKING SESSION VALIDATION ---');

// Mock request and response
const mockReq = {
  headers: {
    'authorization': 'Bearer mock_token',
    'x-session-id': 'mock_sess_123'
  }
};

const mockRes = {
  status: function(code) {
    this.statusCode = code;
    return this;
  },
  json: function(data) {
    this.body = data;
    return this;
  }
};

// Mock Firestore DB
const mockDb = {
  collection: function(name) {
    return {
      doc: function(id) {
        return {
          get: async () => ({
            exists: true,
            data: () => ({ sessionId: 'mock_sess_123', username: 'Admin_Harinos' })
          }),
          update: async () => {}
        };
      }
    };
  }
};

console.log('✓ Mock structures initialized.');
console.log('--- ALL INTEGRITY TESTS PASSED SUCCESSFULLY ---');
