import { canonicalJson } from "../../index.js";

import {
  documentStatus,
  documentTitle,
  sortedDocuments,
  sortedEvents,
  sortedRecords,
  type ViewRenderContext,
} from "./view-rendering.js";

function compareNode(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): number {
  return String(left.id).localeCompare(String(right.id)) ||
    String(left.kind).localeCompare(String(right.kind));
}

export function renderIndex(context: ViewRenderContext): string {
  const documents = [
    ...context.snapshot.components,
    ...context.snapshot.domains,
    ...context.snapshot.initiatives,
    ...context.snapshot.workstreams,
    ...context.snapshot.tasks,
  ];
  const nodes: Readonly<Record<string, unknown>>[] = [
    ...sortedDocuments(documents).map((document) => ({
      id: document.envelope.id,
      kind: "artifact",
      type: document.envelope.type,
      revision: document.envelope.revision,
      status: documentStatus(document),
      title: documentTitle(document),
    })),
    ...sortedRecords(context.snapshot.records).map((record) => ({
      id: record.id,
      kind: "record",
      type: record.type,
      status: record.status,
      title: record.title,
      occurred_at: record.created_at,
    })),
    ...context.snapshot.claims.map((claim) => {
      const candidateId = claim.value.id ?? claim.value.claim_id;
      return {
        id: typeof candidateId === "string" ? candidateId : claim.relative_path,
        kind: "claim",
        type: "claim",
        status: claim.value.status ?? null,
        title: "Canonical claim",
      };
    }),
    ...sortedEvents(context.snapshot.events).map((event) => ({
      id: event.event_hash,
      kind: "event",
      type: event.event_type,
      status: null,
      title: event.event_type,
      occurred_at: event.occurred_at,
    })),
  ];
  nodes.sort(compareNode);

  const edges: Readonly<Record<string, unknown>>[] = [];
  for (const record of sortedRecords(context.snapshot.records)) {
    for (const relationship of record.relationships) {
      edges.push({
        source_id: record.id,
        type: relationship.type,
        target_id: relationship.target_id,
      });
    }
  }
  for (const event of sortedEvents(context.snapshot.events)) {
    edges.push({
      source_id: event.event_hash,
      type: "event_for",
      target_id: event.aggregate_id,
    });
  }
  edges.sort(
    (left, right) =>
      String(left.source_id).localeCompare(String(right.source_id)) ||
      String(left.type).localeCompare(String(right.type)) ||
      String(left.target_id).localeCompare(String(right.target_id)),
  );

  return canonicalJson({
    metadata: {
      schema_version: "1.0.0",
      generated: "DO NOT EDIT",
      ...context.metadata,
    },
    nodes,
    edges,
    source_hashes: context.snapshot.source_hashes,
  });
}
