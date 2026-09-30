/** useAddDocument — drives the add-document flow against the ports.
 *
 * The reducer (add-document-flow.ts) owns what the screen shows; this
 * hook owns what the screen must never see: the bytes, the digest, the
 * idempotency key, and the cached copy of the picked file. All of it is
 * memory-only and is discarded on success, on refusal, on reset, and on
 * unmount. A late result from a step the person has moved past is
 * dropped by epoch, the same rule the scoped reads follow (P2-9).
 *
 * Retry semantics: one idempotency key per CHECKED document. A transient
 * failure keeps the key, so "send again" cannot reserve a second path; a
 * refusal or a new choice ends the attempt and the key with it.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { SafeError, toSafeError } from '@/core/errors';
import { type RandomSource, cryptoRandomSource, newUuid } from '@/core/ids';
import { type DocumentUploader, UploadRefusedError } from '@/data/supabase/documents';
import type { ScopeKey } from '@/tenancy/scope-key';

import {
  type AddDocumentState,
  addDocumentReducer,
  canChoose,
  canSend,
  initialAddDocumentState,
} from './add-document-flow';
import { DOCUMENT_LIMITS, checkPickedDocument } from './document-rules';
import type { Digester, DocumentReader, DocumentSource } from './ports';

export interface AddDocumentDeps {
  scope: ScopeKey;
  request: { readonly id: string; readonly version: number };
  uploader: DocumentUploader;
  source: DocumentSource;
  reader: DocumentReader;
  digester: Digester;
  /** Explicit on device (core's web-crypto default throws under Hermes,
   * find 14); the default serves jest and the live bridge. */
  random?: RandomSource;
  /** An expired session met during a send: the caller routes it to the
   * auth controller exactly as a read would. */
  onSessionExpired?: () => void;
}

export interface AddDocumentController {
  readonly state: AddDocumentState;
  choose: () => void;
  send: () => void;
  reset: () => void;
}

interface HeldAttempt {
  uri: string;
  bytes: Uint8Array;
  idempotencyKey: string;
}

export function useAddDocument(deps: AddDocumentDeps): AddDocumentController {
  const {
    scope,
    request,
    uploader,
    source,
    reader,
    digester,
    random = cryptoRandomSource,
    onSessionExpired,
  } = deps;
  const [state, dispatch] = useReducer(addDocumentReducer, initialAddDocumentState);
  const held = useRef<HeldAttempt | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);

  const discardHeld = useCallback(async (): Promise<void> => {
    const attempt = held.current;
    held.current = null;
    if (!attempt) return;
    try {
      await reader.discard(attempt.uri);
    } catch {
      // The cached copy is in the app's own cache directory; a failed
      // delete is not a user-facing event and the OS reclaims the space.
    }
  }, [reader]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
      void discardHeld();
    };
  }, [discardHeld]);

  const stale = (started: number): boolean => started !== epoch.current || !mounted.current;

  const choose = useCallback(() => {
    if (!canChoose(state)) return;
    const started = ++epoch.current;
    void (async () => {
      await discardHeld();
      if (stale(started)) return;
      dispatch({ type: 'PICK_STARTED' });
      let picked;
      try {
        picked = await source.pick();
      } catch (error) {
        if (stale(started)) return;
        dispatch({ type: 'PICK_FAILED', error: toSafeError(error) });
        return;
      }
      if (stale(started)) return;
      if (!picked) {
        dispatch({ type: 'PICK_CANCELED' });
        return;
      }
      dispatch({ type: 'PICKED', picked });
      const check = checkPickedDocument(picked);
      if (!check.ok) {
        try {
          await reader.discard(picked.uri);
        } catch {
          // As above: a cache copy that outlives a refusal is reclaimed.
        }
        if (stale(started)) return;
        dispatch({ type: 'CHECK_REFUSED', refusal: check.refusal });
        return;
      }
      try {
        const bytes = await reader.read(picked.uri);
        if (stale(started)) return;
        // The bytes are the truth about size; the picker's number was a
        // report. Re-apply the two limits to what was actually read.
        if (bytes.byteLength === 0) {
          dispatch({ type: 'CHECK_REFUSED', refusal: 'empty_file' });
          return;
        }
        if (bytes.byteLength > DOCUMENT_LIMITS.maxBytes) {
          dispatch({ type: 'CHECK_REFUSED', refusal: 'file_too_large' });
          return;
        }
        const digest = await digester.sha256Hex(bytes);
        if (stale(started)) return;
        held.current = { uri: picked.uri, bytes, idempotencyKey: newUuid(random) };
        dispatch({
          type: 'CHECKED',
          document: { ...check.document, byteSize: bytes.byteLength },
          digest,
        });
      } catch (error) {
        if (stale(started)) return;
        dispatch({ type: 'CHECK_FAILED', error: toSafeError(error) });
      }
    })();
  }, [digester, discardHeld, random, reader, source, state]);

  const send = useCallback(() => {
    const snapshot = state;
    if (!canSend(snapshot) || !('document' in snapshot) || !snapshot.document) return;
    const document = snapshot.document;
    const digest = 'digest' in snapshot ? snapshot.digest : null;
    const attempt = held.current;
    if (!attempt || digest === null) {
      dispatch({ type: 'SEND_FAILED', error: new SafeError('unknown') });
      return;
    }
    const started = epoch.current;
    dispatch({ type: 'SEND_STARTED' });
    void (async () => {
      try {
        const reservation = await uploader.begin(scope, {
          requestId: request.id,
          requestVersion: request.version,
          idempotencyKey: attempt.idempotencyKey,
          displayName: document.displayName,
          mimeType: document.mimeType,
          byteSize: document.byteSize,
          clientDigest: digest,
        });
        if (stale(started)) return;
        // A replayed reservation that already completed (the previous
        // confirmation was lost on the way back) needs no second transfer.
        if (reservation.status === 'UPLOADING') {
          dispatch({ type: 'SEND_STEP', step: 'transferring' });
          await uploader.transfer(reservation, attempt.bytes, document.mimeType);
          if (stale(started)) return;
        }
        dispatch({ type: 'SEND_STEP', step: 'confirming' });
        const receipt = await uploader.complete(reservation.uploadId);
        if (stale(started)) return;
        await discardHeld();
        if (stale(started)) return;
        dispatch({ type: 'SENT', receivedAt: receipt.receivedAt });
      } catch (error) {
        if (stale(started)) return;
        if (error instanceof UploadRefusedError) {
          await discardHeld();
          if (stale(started)) return;
          dispatch({ type: 'SEND_REFUSED', refusal: error.refusal });
          return;
        }
        const safe = toSafeError(error);
        if (safe.code === 'auth_expired') onSessionExpired?.();
        dispatch({ type: 'SEND_FAILED', error: safe });
      }
    })();
  }, [discardHeld, onSessionExpired, request.id, request.version, scope, state, uploader]);

  const reset = useCallback(() => {
    epoch.current += 1;
    void discardHeld();
    dispatch({ type: 'RESET' });
  }, [discardHeld]);

  return { state, choose, send, reset };
}
