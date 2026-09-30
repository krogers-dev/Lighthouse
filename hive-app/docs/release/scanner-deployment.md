# The quarantine scanner on a host (WO-015)

**Status: the ClamAV lane is built and proven on the loopback stack
(2026-09-30). Running it against a hosted project needs a host, which is
Kody's door: a small always-on machine in the `hive` Cloud project, which
needs billing, and the project's secret key placed in that project's
secret store. Until the host runs, documents on a hosted project stay
"Received, being checked" and nothing is accepted by default.**

## 1. What runs

Two containers on one private network, from
`deploy/scanner/docker-compose.yml`:

- **clamd**, the ClamAV daemon, `clamav/clamav:1.4` pinned by digest,
  with `freshclam` inside it keeping the signatures current. It listens
  only on the compose network.
- **the runner**, `deploy/scanner/Dockerfile`, built from the
  repository's own scripts (no dependency, the node the app pins). It
  pulls: every 30 seconds it lists the documents waiting in quarantine
  through the server-role scan interface, streams each object's bytes to
  clamd, and records the verdict through the same interface, naming
  `ClamAV` and the signature version on every receipt. It listens on
  nothing; no inbound port exists on the host.

The runner reaches exactly one project: a loopback stack, or one of the
two projects in `security/hosted-targets.json` by its exact origin over
https, with the project's secret key (`sb_secret_…`) and never a legacy
service-role token. Anything else is refused before a byte moves. A
clamd that does not answer holds documents in quarantine (nothing is
begun; exit 3 in one-pass mode); a clamd that fails mid-pass leaves the
document `VALIDATING` for the next pass; a document that cannot be
fetched or that clamd cannot judge is `scan_failed` — never accepted.

## 2. The proof, on the operator's machine

```bash
docker compose -f deploy/scanner/docker-compose.yml up -d clamd
```

```bash
node scripts/local-supabase.mjs prove-scanner
```

Fifteen checks: two uploads as the client (a clean synthetic PDF and the
EICAR test file), one pass, the two verdicts, the receipts naming
ClamAV and its signature version, the trail, the runner's output free of
names and digests, the sweep, an empty second pass, an outage that
holds, the recovery, and two configuration refusals. The image builds
with `docker build -f deploy/scanner/Dockerfile -t hive-scanner-runner .`
and refuses the same things from inside.

## 3. The host (Kody's door)

The recommended host is one always-on virtual machine in the `hive`
Cloud project, Container-Optimized OS, `e2-medium` (ClamAV holds its
signatures in memory: 2 GB is the floor, 4 GB is comfortable), no
external inbound ports, outbound only (the project over https, the
ClamAV signature mirrors). Cloud Run is the alternative once a job on a
schedule is acceptable: clamd loads its signatures at every start, which
costs a minute of CPU each run.

What Kody does, in order:

1. **Billing** on project `hive` (Cloud console → Billing → link the
   Honeybee billing account). Nothing below works without it.
2. **The secret** into Secret Manager: in the Supabase dashboard of the
   project to scan (staging first), copy the `sb_secret_` key, then in
   the Cloud console → Security → Secret Manager → Create secret
   `hive-scanner-secret-key-staging`, paste it as the value. Never in a
   chat, a file in the repository, or a command line. Rotating it later
   is a new secret version and a restart of the runner.
3. **Say the word**, and the rest is run from this desktop with `gcloud`
   under his signed-in account, recorded in the evidence folder:

```bash
gcloud compute instances create hive-scanner-staging --project hive --zone us-central1-a --machine-type e2-medium --image-family cos-stable --image-project cos-cloud --no-address --shielded-secure-boot --scopes cloud-platform --service-account hive-scanner@hive-510122.iam.gserviceaccount.com
```

A dedicated service account `hive-scanner` with exactly
`roles/secretmanager.secretAccessor` on that one secret; the machine
gets no external address (Cloud NAT for its outbound traffic, or the
project's default egress). On the machine: the runner image pulled
from Artifact Registry (pushed from this desktop after the build
above), the compose file, and a root-only
`/etc/hive-scanner/runner.env` written at boot by a small systemd unit
from `gcloud secrets versions access latest --secret hive-scanner-secret-key-staging`,
then `docker compose --profile hosted up -d`.

4. **Read the proof on staging**: a synthetic document uploaded through
   the app against staging is "Checked" within a minute and its receipt
   names `ClamAV` with a signature version dated that week
   (`node scripts/hosted-supabase.mjs staging list-…` is not needed: the
   receipt is read as the database owner, as the evidence folders do).
5. **Production** the same way, with its own secret and its own machine,
   after staging has run a week without a `scan_failed` that was not an
   unreadable object.

## 4. What the operator watches

- The runner's log: one line per document (id and outcome, a detection's
  signature name), one summary per pass, the engine and signature
  version. No document name, no digest, no key.
- `scan_failed` rows: an object that could not be fetched (a transfer
  that never completed is expired by the sweep) or a clamd error (a
  stream over `StreamMaxLength`, which is above the app's 20 MB bound
  and should never happen).
- The signature version on recent receipts: if it stops advancing,
  `freshclam` inside clamd cannot reach the mirrors.
- The sweep (`expire_stale_document_uploads` and the removal of settled
  objects) is not the runner's job: `node scripts/hosted-supabase.mjs`
  gains a `sweep-uploads` command when the host exists (loopback:
  `local-supabase.mjs sweep-uploads`).

## 5. What is not decided here

- Whether the scanner should also refuse by file type beyond the four
  accepted MIME types (ClamAV judges bytes, not extensions): no.
- Whether a detection tells the client which signature matched: no, the
  client sees "Not accepted" with the reason `malware_detected`, as
  WO-003 decided; the signature name is in the operator's log only.
