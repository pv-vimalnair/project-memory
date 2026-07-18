import {
  documentLine,
  linesOrNone,
  markdownView,
  sortedDocuments,
  type ViewRenderContext,
} from "./view-rendering.js";

export function renderWorkstreams(context: ViewRenderContext): string {
  return markdownView(context.metadata, [
    "# Workstreams",
    "",
    "## Status Index",
    "",
    ...linesOrNone(sortedDocuments(context.snapshot.workstreams).map(documentLine)),
    "",
    "## Tasks",
    "",
    ...linesOrNone(sortedDocuments(context.snapshot.tasks).map(documentLine)),
  ]);
}
