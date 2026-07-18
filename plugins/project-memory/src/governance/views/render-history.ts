import {
  historicalRecords,
  linesOrNone,
  markdownView,
  recordLine,
  sortedEvents,
  type ViewRenderContext,
} from "./view-rendering.js";

export function renderHistory(context: ViewRenderContext): string {
  const records = historicalRecords(context.snapshot).map(
    (record) => `- ${record.created_at} — ${recordLine(record).slice(2)}`,
  );
  const events = sortedEvents(context.snapshot.events)
    .filter((event) =>
      new Set(["integrated_verified", "hub_finalized"]).has(event.event_type),
    )
    .map(
      (event) =>
        `- ${event.occurred_at} — \`${event.event_type}\` for \`${event.aggregate_id}\``,
    );
  return markdownView(context.metadata, [
    "# History",
    "",
    "## Completed and Superseded Records",
    "",
    ...linesOrNone(records),
    "",
    "## Verified Integration Events",
    "",
    ...linesOrNone(events),
  ]);
}
