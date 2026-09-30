-- ---------------------------------------------------------------------------
-- The malware scanner's receipts (WO-015, 2026-09-30).
--
-- Kody chose ClamAV as the approved scanner ("use your recommendation",
-- 2026-09-30). A verdict's receipt now names the engine that gave it and
-- the signature database it judged with, so the permanent record answers
-- "checked by what, as of when" for every document. The interface is
-- otherwise unchanged: the server role alone records verdicts, and a
-- caller that names no scanner (the loopback synthetic lane's older
-- calls) still records one.
-- ---------------------------------------------------------------------------

/** A scanner's name or version as a receipt stores it: printable, one
 * line, up to 120 characters; null when not given. Null on anything
 * else, which the caller turns into a refusal. */
create function app_private.clean_scanner_label(p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_label text;
begin
  if p_label is null then
    return null;
  end if;
  if p_label ~ E'[\\x01-\\x1F\\x7F]' then
    raise exception 'invalid_scanner';
  end if;
  v_label := btrim(regexp_replace(p_label, ' +', ' ', 'g'));
  if char_length(v_label) < 1 or char_length(v_label) > 120 then
    raise exception 'invalid_scanner';
  end if;
  return v_label;
end;
$$;
revoke execute on function app_private.clean_scanner_label(text) from public, anon, authenticated;
grant execute on function app_private.clean_scanner_label(text) to service_role;

drop function public.record_document_scan(uuid, text, text);

create function public.record_document_scan(
  p_upload_id uuid,
  p_verdict text,
  p_reason text default null,
  p_scanner text default null,
  p_scanner_version text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.document_uploads%rowtype;
  v_now timestamptz := now();
  v_kind text;
  v_status text;
  v_scanner text;
  v_scanner_version text;
begin
  perform app_private.require_server_role();
  if p_verdict is null or p_verdict not in ('accepted', 'rejected') then
    raise exception 'invalid_verdict';
  end if;
  if p_verdict = 'rejected' and (
       p_reason is null
       or p_reason not in (
         'digest_mismatch', 'size_mismatch', 'unsupported_content', 'malware_detected', 'scan_failed'
       )
     ) then
    raise exception 'invalid_reason';
  end if;
  if p_verdict = 'accepted' and p_reason is not null then
    raise exception 'invalid_reason';
  end if;
  v_scanner := app_private.clean_scanner_label(p_scanner);
  v_scanner_version := app_private.clean_scanner_label(p_scanner_version);
  if v_scanner is null and v_scanner_version is not null then
    raise exception 'invalid_scanner';
  end if;
  select * into v_row from public.document_uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception 'upload_not_found';
  end if;
  if v_row.status <> 'VALIDATING' then
    raise exception 'not_validating';
  end if;

  if p_verdict = 'accepted' then
    update public.document_uploads
       set status = 'ACCEPTED', checked_at = v_now
     where id = p_upload_id;
    v_kind := 'document.checked';
    v_status := 'ACCEPTED';
  else
    update public.document_uploads
       set status = 'REJECTED', checked_at = v_now, rejection_reason = p_reason
     where id = p_upload_id;
    v_kind := 'document.not_accepted';
    v_status := 'REJECTED';
  end if;

  insert into public.activity_events (
    environment_id, client_id, entity_id, case_id, event_kind, actor_role, occurred_at
  ) values (
    v_row.environment_id, v_row.client_id, v_row.entity_id, v_row.case_id, v_kind, 'system', v_now
  );
  perform app_private.append_audit(
    null, v_row.environment_id, v_row.client_id, v_row.entity_id,
    v_kind, 'upload:' || v_row.id::text,
    jsonb_build_object(
      'request_id', v_row.request_id, 'verdict', p_verdict, 'reason', p_reason,
      'scanner', v_scanner, 'scanner_version', v_scanner_version)
  );
  return jsonb_build_object('upload_id', v_row.id, 'status', v_status, 'checked_at', v_now);
end;
$$;
revoke execute on function public.record_document_scan(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_document_scan(uuid, text, text, text, text) to service_role;
