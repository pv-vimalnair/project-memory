import {
  linesOrNone,
  markdownView,
  payloadStrings,
  payloadText,
  recordPayload,
  validatedChanges,
  type ViewRenderContext,
} from "./view-rendering.js";

export function renderChangelog(context: ViewRenderContext): string {
  const changes = validatedChanges(context.snapshot).flatMap((record) => {
    const payload = recordPayload(record);
    const commits = payloadStrings(payload, "commits");
    const artifacts = payloadStrings(payload, "artifacts");
    return [
      `## ${record.created_at} — ${record.title}`,
      "",
      payloadText(payload, "summary") ?? "Validated change.",
      "",
      `- Record: \`${record.id}\``,
      `- Commits: ${commits.map((value) => `\`${value}\``).join(", ")}`,
      `- Artifacts: ${artifacts.length === 0 ? "None" : artifacts.join(", ")}`,
      "",
    ];
  });
  return markdownView(context.metadata, [
    "# Changelog",
    "",
    ...(changes.length === 0 ? linesOrNone([]) : changes),
  ]);
}
