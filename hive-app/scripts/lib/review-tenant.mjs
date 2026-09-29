/** The review tenant (WO-008, option A): one dedicated synthetic
 * environment with one client, one entity, one case with evidence, and
 * one client review identity. Seeded on demand (never part of the main
 * seed, so the harness's exact-reach proofs are untouched), registered
 * with the server as the review identity, and retired after a review
 * window. Every id is fixed and canonical; every label carries
 * "(Synthetic)". */
export const REVIEW_TENANT = {
  environmentId: '22222222-0000-4000-8000-000000000002',
  clientId: '77777777-0000-4000-8000-000000000001',
  entityId: '77777777-1111-4000-8000-000000000001',
  caseId: '77777777-2222-4000-8000-000000000001',
  attentionItemId: '77777777-3333-4000-8000-000000000001',
  nextActionId: '77777777-4444-4000-8000-000000000001',
  requestIds: ['77777777-5555-4000-8000-000000000001', '77777777-5555-4000-8000-000000000002'],
  activityIds: ['77777777-6666-4000-8000-000000000001', '77777777-6666-4000-8000-000000000002'],
  documentId: '77777777-8888-4000-8000-000000000001',
  identity: {
    id: 'cccccccc-0000-4000-8000-0000000000aa',
    email: 'review.reader@example.invalid',
  },
  labels: {
    environment: 'store-review',
    client: 'Review Bakery LLC (Synthetic)',
    entity: 'Review Bakery LLC (Synthetic)',
    case: '2025 books close for review (Synthetic)',
  },
};

/** The rows, in dependency order, as PostgREST upserts. */
export function reviewTenantRows() {
  const t = REVIEW_TENANT;
  const scope = { environment_id: t.environmentId, client_id: t.clientId, entity_id: t.entityId };
  return [
    {
      table: 'environments',
      rows: [{ id: t.environmentId, name: t.labels.environment, kind: 'development' }],
    },
    {
      table: 'clients',
      rows: [{ id: t.clientId, environment_id: t.environmentId, display_name: t.labels.client }],
    },
    {
      table: 'entities',
      rows: [
        {
          id: t.entityId,
          environment_id: t.environmentId,
          client_id: t.clientId,
          display_name: t.labels.entity,
        },
      ],
    },
    {
      table: 'cases',
      rows: [
        {
          id: t.caseId,
          ...scope,
          title: t.labels.case,
          status: 'EVIDENCE_PENDING',
          status_changed_at: '2026-09-15T16:00:00Z',
          created_at: '2026-09-01T09:00:00Z',
        },
      ],
    },
    {
      table: 'case_attention_items',
      rows: [
        {
          id: t.attentionItemId,
          ...scope,
          case_id: t.caseId,
          summary: 'One statement is still needed to complete the records (Synthetic)',
        },
      ],
    },
    {
      table: 'case_next_actions',
      rows: [
        {
          id: t.nextActionId,
          ...scope,
          case_id: t.caseId,
          summary: 'Provide the missing statement when convenient (Synthetic)',
          owner_role: 'client_user',
        },
      ],
    },
    {
      table: 'requests',
      rows: [
        {
          id: t.requestIds[0],
          ...scope,
          case_id: t.caseId,
          title: 'Bank statement for the closing month (Synthetic)',
          detail: 'Please add the statement for the last month of the year (Synthetic).',
          status: 'OPEN',
          owner_role: 'client_user',
          requested_on: '2026-09-10',
          due_on: '2026-10-10',
        },
        {
          id: t.requestIds[1],
          ...scope,
          case_id: t.caseId,
          title: 'Confirm the vehicle expense category (Synthetic)',
          detail: 'Tell us whether the vehicle costs belong to the business (Synthetic).',
          status: 'OPEN',
          owner_role: 'client_user',
          requested_on: '2026-09-12',
          due_on: null,
        },
      ],
    },
    {
      table: 'activity_events',
      rows: [
        {
          id: t.activityIds[0],
          ...scope,
          case_id: t.caseId,
          event_kind: 'case.status_changed',
          actor_role: 'preparer',
          occurred_at: '2026-09-15T16:00:00Z',
        },
        {
          id: t.activityIds[1],
          ...scope,
          case_id: t.caseId,
          event_kind: 'request.opened',
          actor_role: 'preparer',
          occurred_at: '2026-09-12T10:00:00Z',
        },
      ],
    },
  ];
}
