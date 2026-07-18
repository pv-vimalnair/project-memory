import {
  activeWorkstreams,
  blockerRecords,
  linesOrNone,
  markdownView,
  nextActionLines,
  recordLine,
  sortedRecords,
  type ViewRenderContext,
} from "./view-rendering.js";

export function renderNow(context: ViewRenderContext): string {
  const accepted = sortedRecords(context.snapshot.effective_records)
    .filter(
      (record) =>
        record.status === "accepted" &&
        new Set(["decision", "finding", "risk", "lesson"]).has(record.type),
    )
    .map(recordLine);
  return markdownView(context.metadata, [
    "# Now",
    "",
    `Root: \`${context.snapshot.root_id}\``,
    "",
    "## Accepted Current State",
    "",
    ...linesOrNone(accepted),
    "",
    "## Active Workstreams",
    "",
    ...linesOrNone(activeWorkstreams(context.snapshot).map((item) => `- \`${item.envelope.id}\` — ${item.body.match(/^#\s+(.+)$/m)?.[1] ?? item.envelope.id}`)),
    "",
    "## Blockers",
    "",
    ...linesOrNone(blockerRecords(context.snapshot).map(recordLine)),
    "",
    "## Next Actions",
    "",
    ...linesOrNone(nextActionLines(context.snapshot)),
  ]);
}
