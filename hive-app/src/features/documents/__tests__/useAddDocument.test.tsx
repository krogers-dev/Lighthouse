/** The add-document hook against fakes for every port: the picker, the
 * reader, the digester, the uploader. Driven through a probe component
 * the way the other hooks are tested here, so state changes flow through
 * React's own scheduling rather than a hook harness. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { SafeError } from '@/core/errors';
import { sha256Hex } from '@/core/sha256';
import {
  type BeginUploadInput,
  type DocumentUploader,
  UploadRefusedError,
  type UploadReservation,
} from '@/data/supabase/documents';
import type { ScopeKey } from '@/tenancy/scope-key';

import type { PickedDocument } from '../document-rules';
import type { Digester, DocumentReader, DocumentSource } from '../ports';
import { type AddDocumentDeps, useAddDocument } from '../useAddDocument';

const scope = {
  environmentId: '11111111-0000-4000-8000-000000000001',
  clientId: 'aaaaaaaa-0000-4000-8000-000000000001',
  entityId: 'aaaaaaaa-1111-4000-8000-000000000001',
  membershipId: 'mmmmmmmm-0000-4000-8000-000000000001',
} as unknown as ScopeKey;

const request = { id: 'dddddddd-0000-4000-8000-0000000000a1', version: 1 };

const picked: PickedDocument = {
  uri: 'file:///cache/statement.pdf',
  name: 'statement (Synthetic).pdf',
  byteSize: 4,
  mimeType: 'application/pdf',
};

const BYTES = new Uint8Array([1, 2, 3, 4]);

class FakeSource implements DocumentSource {
  next: PickedDocument | null | Error = picked;
  async pick(): Promise<PickedDocument | null> {
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

class FakeReader implements DocumentReader {
  bytes: Uint8Array = BYTES;
  discarded: string[] = [];
  async read(): Promise<Uint8Array> {
    return this.bytes;
  }
  async discard(uri: string): Promise<void> {
    this.discarded.push(uri);
  }
}

const digester: Digester = { sha256Hex: async (bytes) => sha256Hex(bytes) };

class FakeUploader implements DocumentUploader {
  begins: BeginUploadInput[] = [];
  transfers: { path: string; bytes: Uint8Array; mimeType: string }[] = [];
  completes: string[] = [];
  beginError: unknown = null;
  transferError: unknown = null;
  completeError: unknown = null;
  reservationStatus = 'UPLOADING';
  async begin(_scope: ScopeKey, input: BeginUploadInput): Promise<UploadReservation> {
    this.begins.push(input);
    if (this.beginError) throw this.beginError;
    return {
      uploadId: 'upload-1',
      storageBucket: 'hive-quarantine',
      storagePath: `env/client/entity/${input.requestId}/upload-1`,
      status: this.reservationStatus,
    };
  }
  async transfer(reservation: UploadReservation, bytes: Uint8Array, mimeType: string) {
    this.transfers.push({ path: reservation.storagePath, bytes, mimeType });
    if (this.transferError) throw this.transferError;
  }
  async complete(uploadId: string) {
    this.completes.push(uploadId);
    if (this.completeError) throw this.completeError;
    return { uploadId, status: 'QUARANTINED', receivedAt: '2026-09-28T15:00:00Z' };
  }
}

const fixedRandom = { fill: (bytes: Uint8Array) => bytes.fill(0x11) };

/** Renders every observable fact of the flow as text, and the three
 * actions as pressable text. */
function Probe({ deps }: { deps: AddDocumentDeps }): React.JSX.Element {
  const flow = useAddDocument(deps);
  const state = flow.state;
  const document = 'document' in state ? state.document : null;
  return (
    <>
      <Text testID="state">{state.name}</Text>
      <Text testID="document">
        {document ? `${document.displayName}|${document.byteSize}|${document.mimeType}` : ''}
      </Text>
      <Text testID="digest">{'digest' in state && state.digest ? state.digest : ''}</Text>
      <Text testID="refusal">{state.name === 'refused' ? state.refusal : ''}</Text>
      <Text testID="error">{state.name === 'failed' ? state.error.code : ''}</Text>
      <Text testID="received">{state.name === 'received' ? (state.receivedAt ?? 'null') : ''}</Text>
      <Text testID="choose" onPress={flow.choose}>
        choose
      </Text>
      <Text testID="send" onPress={flow.send}>
        send
      </Text>
      <Text testID="reset" onPress={flow.reset}>
        reset
      </Text>
    </>
  );
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

/** Wait until the flow reaches `name`; fails after the findBy timeout. */
async function reaches(name: string): Promise<void> {
  await screen.findByText(name, {}, { timeout: 5000 });
}

async function setup(
  overrides: { source?: FakeSource; reader?: FakeReader; uploader?: FakeUploader } = {},
) {
  const source = overrides.source ?? new FakeSource();
  const reader = overrides.reader ?? new FakeReader();
  const uploader = overrides.uploader ?? new FakeUploader();
  const onSessionExpired = jest.fn();
  const deps: AddDocumentDeps = {
    scope,
    request,
    uploader,
    source,
    reader,
    digester,
    random: fixedRandom,
    onSessionExpired,
  };
  const view = await render(<Probe deps={deps} />);
  return { view, source, reader, uploader, onSessionExpired };
}

describe('useAddDocument', () => {
  it('picks, checks, digests on the phone, then reserves, transfers, and confirms', async () => {
    const { uploader, reader } = await setup();
    await press('choose');
    await reaches('checked');
    expect(screen.getByTestId('document')).toHaveTextContent(`${picked.name}|4|application/pdf`);
    expect(screen.getByTestId('digest')).toHaveTextContent(sha256Hex(BYTES));

    await press('send');
    await reaches('received');
    expect(uploader.begins).toEqual([
      {
        requestId: request.id,
        requestVersion: 1,
        idempotencyKey: '11111111-1111-4111-9111-111111111111',
        displayName: picked.name,
        mimeType: 'application/pdf',
        byteSize: 4,
        clientDigest: sha256Hex(BYTES),
      },
    ]);
    expect(uploader.transfers).toEqual([
      {
        path: `env/client/entity/${request.id}/upload-1`,
        bytes: BYTES,
        mimeType: 'application/pdf',
      },
    ]);
    expect(uploader.completes).toEqual(['upload-1']);
    expect(screen.getByTestId('received')).toHaveTextContent('2026-09-28T15:00:00Z');
    // The cached copy is gone once the document is in quarantine.
    expect(reader.discarded).toEqual([picked.uri]);
  });

  it('returns to idle on a canceled picker and keeps nothing', async () => {
    const source = new FakeSource();
    source.next = null;
    const { reader } = await setup({ source });
    await press('choose');
    await reaches('idle');
    expect(reader.discarded).toEqual([]);
  });

  it('refuses locally before any byte is read or sent, and discards the cache copy', async () => {
    const source = new FakeSource();
    source.next = { ...picked, name: 'archive.zip', mimeType: 'application/zip' };
    const { uploader, reader } = await setup({ source });
    await press('choose');
    await reaches('refused');
    expect(screen.getByTestId('refusal')).toHaveTextContent('unsupported_type');
    expect(screen.getByTestId('document')).toHaveTextContent('');
    expect(uploader.begins).toEqual([]);
    expect(reader.discarded).toEqual([picked.uri]);
  });

  it('trusts the bytes over the picker: an oversize read is refused', async () => {
    const reader = new FakeReader();
    reader.bytes = new Uint8Array(20 * 1024 * 1024 + 1);
    await setup({ reader });
    await press('choose');
    await reaches('refused');
    expect(screen.getByTestId('refusal')).toHaveTextContent('file_too_large');
  });

  it('turns a server refusal into the refused state with the document beside it', async () => {
    const uploader = new FakeUploader();
    uploader.beginError = new UploadRefusedError('request_closed');
    const { reader } = await setup({ uploader });
    await press('choose');
    await reaches('checked');
    await press('send');
    await reaches('refused');
    expect(screen.getByTestId('refusal')).toHaveTextContent('request_closed');
    expect(screen.getByTestId('document')).toHaveTextContent(`${picked.name}|4|application/pdf`);
    expect(uploader.transfers).toEqual([]);
    expect(reader.discarded).toEqual([picked.uri]);
  });

  it('keeps the same idempotency key across a transient failure and the retry', async () => {
    const uploader = new FakeUploader();
    uploader.transferError = new SafeError('network');
    const { reader } = await setup({ uploader });
    await press('choose');
    await reaches('checked');
    await press('send');
    await reaches('failed');
    expect(screen.getByTestId('error')).toHaveTextContent('network');
    expect(screen.getByTestId('document')).toHaveTextContent(`${picked.name}|4|application/pdf`);
    // Nothing discarded: the same bytes are sent again.
    expect(reader.discarded).toEqual([]);

    uploader.transferError = null;
    await press('send');
    await reaches('received');
    expect(uploader.begins).toHaveLength(2);
    expect(uploader.begins[0]?.idempotencyKey).toBe(uploader.begins[1]?.idempotencyKey);
  });

  it('skips the transfer when the replayed reservation already completed', async () => {
    const uploader = new FakeUploader();
    uploader.reservationStatus = 'QUARANTINED';
    await setup({ uploader });
    await press('choose');
    await reaches('checked');
    await press('send');
    await reaches('received');
    expect(uploader.transfers).toEqual([]);
    expect(uploader.completes).toEqual(['upload-1']);
  });

  it('routes an expired session to the controller path and shows the failure', async () => {
    const uploader = new FakeUploader();
    uploader.beginError = new SafeError('auth_expired');
    const { onSessionExpired } = await setup({ uploader });
    await press('choose');
    await reaches('checked');
    await press('send');
    await reaches('failed');
    expect(screen.getByTestId('error')).toHaveTextContent('auth_expired');
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('reset discards the held copy and returns to idle', async () => {
    const { reader } = await setup();
    await press('choose');
    await reaches('checked');
    await press('reset');
    await reaches('idle');
    expect(reader.discarded).toEqual([picked.uri]);
  });

  it('discards the held copy on unmount', async () => {
    const { view, reader } = await setup();
    await press('choose');
    await reaches('checked');
    await act(async () => {
      await view.unmount();
    });
    expect(reader.discarded).toEqual([picked.uri]);
  });

  it('a picker failure is a failure state with a new choice, never a crash', async () => {
    const source = new FakeSource();
    source.next = new Error('picker unavailable');
    await setup({ source });
    await press('choose');
    await reaches('failed');
    expect(screen.getByTestId('error')).toHaveTextContent('unknown');
    expect(screen.getByTestId('document')).toHaveTextContent('');
  });
});
