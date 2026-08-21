import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderTypes, tsTypeFor } from '../../scripts/db-types.mjs';

test('maps postgres types to TypeScript', () => {
  assert.equal(tsTypeFor('uuid'), 'string');
  assert.equal(tsTypeFor('timestamptz'), 'string');
  assert.equal(tsTypeFor('jsonb'), 'Json');
  assert.equal(tsTypeFor('int4'), 'number');
  assert.equal(tsTypeFor('bool'), 'boolean');
});

test('renders a deterministic Database interface with nullability and defaults', () => {
  const tables = [
    {
      table_name: 'cases',
      columns: [
        { name: 'id', udt: 'uuid', nullable: false, hasDefault: true },
        { name: 'title', udt: 'text', nullable: false, hasDefault: false },
        { name: 'details', udt: 'jsonb', nullable: true, hasDefault: false },
      ],
    },
  ];
  const rendered = renderTypes(tables);
  assert.ok(rendered.includes('id: string;'));
  assert.ok(rendered.includes('title: string;'));
  assert.ok(rendered.includes('details: Json | null;'));
  // Insert: default → optional; nullable → optional and | null.
  assert.ok(rendered.includes('id?: string;'));
  assert.ok(rendered.includes('details?: Json | null;'));
  // Deterministic output.
  assert.equal(rendered, renderTypes(tables));
});
