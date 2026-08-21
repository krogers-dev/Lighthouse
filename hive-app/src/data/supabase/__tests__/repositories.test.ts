import { SafeError } from '@/core/errors';

import { mapDbError } from '../repositories';

describe('mapDbError', () => {
  it('maps expired-JWT signals to auth_expired', () => {
    expect(mapDbError({ code: 'PGRST301', message: 'JWT expired' }).code).toBe('auth_expired');
    expect(mapDbError({ status: 401, message: 'Unauthorized' }).code).toBe('auth_expired');
  });

  it('maps privilege denials to denied', () => {
    expect(mapDbError({ code: '42501', message: 'permission denied for table cases' }).code).toBe(
      'denied',
    );
    expect(mapDbError({ status: 403 }).code).toBe('denied');
  });

  it('maps transport failures to network', () => {
    expect(mapDbError(new TypeError('Network request failed')).code).toBe('network');
  });

  it('never leaks database internals into user messages', () => {
    const mapped = mapDbError({ code: 'XX000', message: 'relation secret_internal_table broke' });
    expect(mapped.code).toBe('unknown');
    expect(mapped.userMessage).not.toContain('secret_internal_table');
  });

  it('passes SafeError through', () => {
    const original = new SafeError('offline');
    expect(mapDbError(original)).toBe(original);
  });
});
