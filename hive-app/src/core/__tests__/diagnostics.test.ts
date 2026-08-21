import {
  createDiagnostics,
  sanitizeFieldValue,
  type DiagnosticEventName,
} from '../diagnostics';

function capture() {
  const events: { name: string; fields: Record<string, unknown> }[] = [];
  const diagnostics = createDiagnostics({
    write: (name, fields) => events.push({ name, fields }),
  });
  return { events, diagnostics };
}

describe('diagnostics allowlist', () => {
  it('passes allowed fields through', () => {
    const { events, diagnostics } = capture();
    diagnostics.record('auth_transition', { fromState: 'booting', toState: 'signed_out' });
    expect(events).toEqual([
      { name: 'auth_transition', fields: { fromState: 'booting', toState: 'signed_out' } },
    ]);
  });

  it('drops field names outside the allowlist', () => {
    const { events, diagnostics } = capture();
    diagnostics.record('auth_transition', {
      fromState: 'booting',
      // Excluded-by-design fields must vanish even if a caller tries.
      ...({ email: 'person@example.invalid', clientId: 'abc' } as object),
    });
    expect(events[0]?.fields).toEqual({ fromState: 'booting' });
  });

  it('drops event names outside the allowlist', () => {
    const { events, diagnostics } = capture();
    diagnostics.record('made_up_event' as DiagnosticEventName);
    expect(events).toHaveLength(0);
  });
});

describe('diagnostics redaction', () => {
  const secrets = [
    'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln', // JWT-shaped
    'sb_secret_syntheticsyntheticsynthetic',
    'sb_publishable_syntheticsynthetic',
    'contains service_role within',
    '4c0ffee0-1234-4abc-8def-0123456789ab', // identifier
    'person@example.invalid', // email
    'https://example-project.supabase.co', // URL
    '-----BEGIN PRIVATE KEY-----',
  ];

  it.each(secrets)('redacts %s', (value) => {
    expect(sanitizeFieldValue(value)).toBe('[redacted]');
  });

  it('redacts inside recorded fields', () => {
    const { events, diagnostics } = capture();
    diagnostics.record('storage_scrub_result', { reason: secrets[0] as string });
    expect(events[0]?.fields['reason']).toBe('[redacted]');
  });

  it('truncates oversized strings', () => {
    const long = 'x'.repeat(500);
    const sanitized = sanitizeFieldValue(long) as string;
    expect(sanitized.length).toBeLessThan(70);
  });

  it('passes plain short values', () => {
    expect(sanitizeFieldValue('signed_out')).toBe('signed_out');
    expect(sanitizeFieldValue(42)).toBe(42);
    expect(sanitizeFieldValue(true)).toBe(true);
  });
});
