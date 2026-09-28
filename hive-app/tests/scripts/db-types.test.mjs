import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cliDatabaseContainer, renderTypes, tsTypeFor } from '../../scripts/db-types.mjs';

test('maps postgres types to TypeScript', () => {
  assert.equal(tsTypeFor('uuid'), 'string');
  assert.equal(tsTypeFor('timestamptz'), 'string');
  assert.equal(tsTypeFor('jsonb'), 'Json');
  assert.equal(tsTypeFor('int4'), 'number');
  assert.equal(tsTypeFor('bool'), 'boolean');
  // An array argument (WO-004: the cited document ids) is an array type.
  assert.equal(tsTypeFor('_uuid'), 'string[]');
  assert.equal(tsTypeFor('_text'), 'string[]');
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

test('renders public functions as typed RPC entries, with defaulted arguments optional', () => {
  const functions = [
    {
      name: 'begin_document_upload',
      arity: 2,
      args: [
        { name: 'p_request_id', udt: 'uuid', hasDefault: false },
        { name: 'p_byte_size', udt: 'int8', hasDefault: false },
      ],
      returns: 'jsonb',
    },
    {
      name: 'record_document_scan',
      arity: 2,
      args: [
        { name: 'p_verdict', udt: 'text', hasDefault: false },
        { name: 'p_reason', udt: 'text', hasDefault: true },
      ],
      returns: 'jsonb',
    },
    { name: 'expire_stale_document_uploads', arity: 0, args: [], returns: 'int4' },
  ];
  const rendered = renderTypes([], functions);
  assert.ok(rendered.includes('      begin_document_upload: {'));
  assert.ok(rendered.includes('          p_request_id: string;'));
  assert.ok(rendered.includes('          p_byte_size: number;'));
  assert.ok(rendered.includes('        Returns: Json;'));
  assert.ok(rendered.includes('          p_reason?: string;'));
  assert.ok(rendered.includes('        Args: Record<string, never>;'));
  assert.ok(rendered.includes('        Returns: number;'));
  assert.ok(!rendered.includes('Functions: Record<string, never>;'));
  // Without functions the historical shape is unchanged.
  assert.ok(renderTypes([]).includes('Functions: Record<string, never>;'));
  assert.equal(rendered, renderTypes([], functions));
});

test('names the CLI stack database container from the project id', () => {
  assert.equal(cliDatabaseContainer('project_id = "hive-app"\n[api]\n'), 'supabase_db_hive-app');
  assert.equal(cliDatabaseContainer('# project_id = "x"\n'), null);
});
