import { AGENT_READING_ORDER_PREFIX } from "../../agent/start.js";

import {
  activeWorkstreams,
  blockerRecords,
  documentLine,
  linesOrNone,
  markdownView,
  nextActionLines,
  recordLine,
  type ViewRenderContext,
} from "./view-rendering.js";

export function renderHandoff(context: ViewRenderContext): string {
  return markdownView(context.metadata, [
    "# Handoff",
    "",
    "## Canonical Position",
    "",
    `- Root: \`${context.snapshot.root_id}\``,
    `- Source revision: \`${context.snapshot.source_revision}\``,
    `- Profile lock: \`${context.snapshot.profile_lock_hash}\``,
    "",
    "## Startup Continuation Set",
    "",
    ...AGENT_READING_ORDER_PREFIX.map(
      (relativePath, index) => `${String(index + 1)}. Read \`${relativePath}\`.`,
    ),
    ...[
      "Read the assigned workstream and task packet.",
      "Read named component/domain documents and linked records.",
    ].map(
      (instruction, index) =>
        `${String(AGENT_READING_ORDER_PREFIX.length + index + 1)}. ${instruction}`,
    ),
    "",
    "## Active Work",
    "",
    ...linesOrNone([
      ...activeWorkstreams(context.snapshot).map(documentLine),
      ...context.snapshot.tasks.map(documentLine),
    ]),
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
