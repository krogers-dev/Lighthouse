# Auth state machine

Implemented as a pure reducer in `src/auth/machine.ts` (states, events,
guards) driven by the effectful `AuthController` in `src/auth/controller.ts`
(side effects, epoch, serialization). Illegal transitions throw in
development and fail closed (state unchanged, diagnostics event) in
production.

## States

| State                 | Meaning                                                             | Context carried                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `booting`             | Reconciling install marker, storage, and any stored session         | —                                                                                                                                                |
| `signed_out`          | No usable session                                                   | `reason?: 'initial' \| 'signed_out' \| 'expired' \| 'scrubbed' \| 'no_access' \| 'offline'`                                                      |
| `first_factor`        | Email entry / OTP entry / OTP verification in flight                | `email`, `otpSent`, `verifying`, `notice?`                                                                                                       |
| `mfa_required`        | First factor passed; TOTP challenge outstanding or verifying        | `verifying`, `notice?`, `enrollment?` (first-time TOTP setup payload — factor id, QR SVG, manual secret; memory-only, never persisted or logged) |
| `select_scope`        | Identity proven; more than one membership; explicit choice required | `actor`, `memberships` (server-confirmed)                                                                                                        |
| `authorized`          | Identity proven, single scope bound                                 | `actor`, `scope` (ScopeKey), `memberships`                                                                                                       |
| `signing_out`         | Exclusive sign-out/reset sequence running                           | `reason`                                                                                                                                         |
| `storage_quarantined` | Secure storage failed verification or deletion; only scrub recovery | `scrubInProgress`, `lastAttemptFailed`                                                                                                           |
| `fatal`               | Unrecoverable configuration or invariant failure                    | `code`                                                                                                                                           |

`storage_quarantined` absorbs every event except the scrub pair and `FATAL`.
`fatal` absorbs everything. No state ever retains protected data after exit:
transitions into `signing_out`, `signed_out`, `storage_quarantined`, and
`fatal` clear actor, scope, and memberships from context.

## Events and transitions

| Event                                  | Legal from                                                | To                                            | Guard / notes                                                                                                   |
| -------------------------------------- | --------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `BOOTED_NO_SESSION`                    | booting                                                   | signed_out(initial)                           |                                                                                                                 |
| `BOOTED_OFFLINE`                       | booting                                                   | signed_out(offline)                           | Session unverifiable offline → no protected content, safe recovery                                              |
| `BOOTED_EXPIRED`                       | booting                                                   | signed_out(expired)                           | Stored session already expired; local cleanup ran first                                                         |
| `SCOPES_LOADED {actor, memberships}`   | booting, first_factor(verifying), mfa_required(verifying) | authorized (1 membership) / select_scope (>1) | Zero memberships is expressed as `NO_ACCESS`, not this event                                                    |
| `NO_ACCESS`                            | booting, first_factor, mfa_required                       | signed_out(no_access)                         | Controller has already signed out server-side                                                                   |
| `MFA_CHALLENGE_REQUIRED`               | booting, first_factor(verifying)                          | mfa_required                                  | Staff roles need AAL2 before scopes load                                                                        |
| `SIGN_IN_STARTED {email}`              | signed_out                                                | first_factor(otpSent=false)                   |                                                                                                                 |
| `OTP_REQUESTED`                        | first_factor                                              | first_factor(otpSent=true)                    |                                                                                                                 |
| `OTP_REQUEST_FAILED {code}`            | first_factor                                              | first_factor(notice)                          | Safe error only                                                                                                 |
| `OTP_SUBMITTED`                        | first_factor(otpSent)                                     | first_factor(verifying)                       |                                                                                                                 |
| `FIRST_FACTOR_FAILED {code}`           | first_factor(verifying)                                   | first_factor(otpSent, notice)                 |                                                                                                                 |
| `MFA_ENROLLMENT_REQUIRED {enrollment}` | mfa_required(not verifying)                               | mfa_required(enrollment)                      | First-time setup: no verified factor exists; carries the QR/secret payload                                      |
| `MFA_SUBMITTED`                        | mfa_required                                              | mfa_required(verifying)                       | Preserves `enrollment` so a wrong code returns to the setup view                                                |
| `MFA_FAILED {code}`                    | mfa_required                                              | mfa_required(notice)                          | Legal outside verification too: factor discovery/enrollment setup failures surface here; preserves `enrollment` |
| `SCOPE_SELECTED {membershipId}`        | select_scope                                              | authorized                                    | Guard: membershipId ∈ memberships, else illegal                                                                 |
| `SCOPE_SWITCH_REQUESTED`               | authorized                                                | select_scope                                  | Controller clears all scoped repositories first                                                                 |
| `SIGN_OUT_REQUESTED {reason}`          | authorized, select_scope, mfa_required, first_factor      | signing_out                                   | Also used for identity switch and expiry                                                                        |
| `RETURN_TO_SIGNED_OUT`                 | first_factor(not verifying)                               | signed_out                                    | Safe back/cancel; illegal while verification is in flight (a session could land after the UI left)              |
| `SIGN_OUT_SUCCEEDED`                   | signing_out                                               | signed_out(reason)                            | Only after storage deletion read-back verification                                                              |
| `SIGN_OUT_STORAGE_FAILED`              | signing_out                                               | storage_quarantined                           | Deletion rejected or read-back found residue                                                                    |
| `STORAGE_FAILURE {code}`               | any except fatal                                          | storage_quarantined                           | Corrupt/partial/unverifiable secure storage                                                                     |
| `QUARANTINE_SCRUB_STARTED`             | storage_quarantined                                       | storage_quarantined(scrubInProgress)          |                                                                                                                 |
| `QUARANTINE_SCRUB_SUCCEEDED`           | storage_quarantined                                       | signed_out(scrubbed)                          | Only exit; requires verified deletion                                                                           |
| `QUARANTINE_SCRUB_FAILED`              | storage_quarantined                                       | storage_quarantined(lastAttemptFailed)        |                                                                                                                 |
| `FATAL {code}`                         | any                                                       | fatal                                         |                                                                                                                 |

Everything not listed is an **illegal transition**: `assertUnreachable` in
development, state-unchanged + `auth_illegal_transition` diagnostics event in
production.

## Controller side effects

### Boot

1. Validate public environment (failure → config `fatal` before any client
   construction; values never printed).
2. Install-marker reconciliation: if secure-store residue exists and the
   marker file does not, this is a reinstall over a stale iOS Keychain —
   scrub every HIVE session key and verify deletion **before** constructing
   the Supabase client. Scrub failure → `STORAGE_FAILURE`.
3. Ensure the marker exists.
4. Construct the single Supabase client (storage = the versioned adapter).
5. Read the stored session through the adapter. Corrupt/partial/mismatched
   digest → `STORAGE_FAILURE` (quarantine), never signed_out, never
   authorized.
6. No session → `BOOTED_NO_SESSION`. Session expired per clock → run the
   sign-out sequence with reason `expired`.
7. Session present → load memberships. Network failure → `BOOTED_OFFLINE`
   (session retained but nothing protected shown). Zero memberships → server
   sign-out then `NO_ACCESS`. Staff membership without AAL2 →
   `MFA_CHALLENGE_REQUIRED`. Otherwise `SCOPES_LOADED`.

### Sign-in

`requestOtp(email)` calls `signInWithOtp` with `shouldCreateUser: false`
(self-registration disabled). `verifyOtp` upgrades to a session; if any
membership requires AAL2 (staff roles) and current AAL is aal1, the
controller dispatches `MFA_CHALLENGE_REQUIRED` and then prepares the factor
(`prepareMfaInternal`):

- A **verified TOTP factor exists** → its id becomes the pending factor;
  the user is asked for a code (verify mode).
- **No verified factor** (first login) → any stale unverified factors are
  best-effort unenrolled, `mfa.enroll` (documented supabase-js API) creates
  a fresh TOTP factor, and `MFA_ENROLLMENT_REQUIRED` carries the QR SVG and
  manual setup key into view context. The secret exists only in memory and
  in the authenticator the user scans it into: never stored, never logged,
  never in diagnostics, and the QA flows never screenshot the setup screen.
  Setup failure surfaces as `MFA_FAILED` with a retry action
  (`retryMfaSetup()`); storage trouble routes to quarantine as usual.

`submitTotp(code)` challenges and verifies against the pending factor id;
success loads memberships → `SCOPES_LOADED` (AAL now aal2). An incorrect
code returns to the same mode (enrollment preserved) with a safe notice.
Cancelling MFA runs the full sign-out sequence — enrollment-in-progress
does not linger. On the next launch the verified factor exists, so the same
user gets verify mode, never a second QR.

### Scope selection and switching

`selectScope(membershipId)` binds an immutable ScopeKey built only from the
server-confirmed membership list — never from route params, deep links,
AsyncStorage, or form input. Identity switch and scope switch first clear
every actor-bound state (repositories, caches, context) via the scoped
registry; entity B can never observe entity A's content.

### Sign-out / reset (exclusive, actor-bound)

Runs on the serialized operation queue, mutually exclusive with refresh and
expiry handling:

1. Dispatch `SIGN_OUT_REQUESTED` → `signing_out`.
2. Freeze client acquisition (`lifecycle.freeze()`); new work cannot obtain
   the client.
3. Increment the auth epoch: late callbacks and refresh completions carrying
   an older epoch are ignored.
4. Stop token auto-refresh; unsubscribe the auth listener.
5. Clear all in-memory identity/scope state and scoped repositories.
6. Perform the current documented Supabase sign-out. A network revocation
   failure is recorded and **does not** preserve local access — the sequence
   continues.
7. Delete every SecureStore session key; read back and verify absence.
8. Only then dispose the client and dispatch `SIGN_OUT_SUCCEEDED`.

Storage deletion failure or read-back residue → `SIGN_OUT_STORAGE_FAILED` →
`storage_quarantined`: no protected UI, no session evaluation, no generic
Retry that could reuse a retained session; the client stays frozen-disposed.
The client is never nulled or recreated early.

### Quarantine recovery

The only exit is `scrubQuarantine()`: delete every HIVE key (manifest, both
chunk slots, legacy key), read back and verify absence, then
`QUARANTINE_SCRUB_SUCCEEDED` → `signed_out(scrubbed)`. Any residue →
`QUARANTINE_SCRUB_FAILED` and the state remains.

### Foreground/background and refresh

Token refresh is a synchronized function of **two** inputs — foreground
state and auth state — re-evaluated on every change of either
(`syncRefresh`): run exactly when the app is foregrounded AND the state is
`authorized` or `select_scope` (states holding a fully bound session) AND
the client lifecycle is active. Foreground initializes from
`AppState.currentState` at construction, so a cold boot that lands directly
in `authorized` while the app is already active starts refresh without
waiting for a change event; equally, refresh starts the moment a sign-in
completes in the foreground, and stops on background, sign-out, quarantine,
and client disposal. A user idling on
the OTP or TOTP screen past expiry fails closed into a fresh sign-in.
Refresh, sign-out, and expiry run on the same serialized queue using the
Supabase-supported process lock. Late work from a previous identity is
stopped twice over: listener events carry the auth epoch and are discarded
when stale, and each client bundle's storage bridge carries a write gate
that closes permanently the moment sign-out, quarantine, or fatal begins —
so a refresh completing late can neither dispatch state nor re-persist or
re-read the session, regardless of library internals.

### Expiry

Detected at boot (clock), from the auth listener, or from a 401 during a
query: the controller runs the standard sign-out sequence with reason
`expired`; the UI lands on signed_out with an "expired" notice. Expiry
during an in-flight sign-out is absorbed by the queue (no double run).

## Sequences (summary)

- **Cold boot, no session:** booting → signed_out(initial).
- **Cold boot, session, 1 membership:** booting → authorized.
- **Cold boot, session, 2+ memberships:** booting → select_scope → authorized.
- **Sign-in with MFA:** signed_out → first_factor (email → OTP sent → verify)
  → mfa_required → select_scope/authorized.
- **Identity switch:** authorized → signing_out → signed_out → first_factor…
  (all actor-bound state cleared at step 5 of sign-out).
- **Reinstall with Keychain remnant:** booting (purge+verify) → signed_out;
  purge failure → storage_quarantined.
- **Storage failure anywhere:** → storage_quarantined → scrub → signed_out.
- **Suspension during sign-out:** AppState events queue behind the exclusive
  sign-out; refresh cannot interleave; late completions fail the epoch check.
