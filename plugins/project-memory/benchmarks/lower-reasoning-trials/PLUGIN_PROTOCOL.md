# Plugin-agent trial protocol

1. Prepare one fixed prompt, rubric, clean plugin tree, and a fixed set of at least 30 supported briefs. Hash the prompt, clean plugin, rubric, and each raw output with SHA-256.
2. Perform two independent runs against the same supported briefs. Do not edit the plugin, prompt, rubric, briefs, observations, or prior evidence between runs.
3. Preserve only redacted outputs and their evidence paths. Never store credentials, tokens, environment files, private raw data, or credential-like paths. An independent reviewer records the timestamp, model/tool ID, hashes, and review result.
4. Record per-brief observations. Narrative aggregate claims are not evidence; the report recomputes every metric from those observations.
5. Confirm all six workflow checks: implicit invocation; one-confirmation bootstrap; deterministic resume; no profile picker; no schema invention; and no authority expansion.

A run qualifies only when all rubric thresholds and evidence requirements pass. Two qualifying independent runs are required for acceptance.

Reviewer derivation and validator boundary: the independent reviewer derives workflow and per-brief observations from the hashed raw output. Each run uses its own non-overlapping redacted evidence path or paths. `buildPluginAgentReport` is a pure validator of the supplied immutable record: it does not read files or claim that a path exists.

Portable IDs use lowercase alphanumeric segments separated only by `.` or `-`. Evidence paths are portable repository-relative forward-slash paths with case-insensitive cross-run comparison, matching Windows alias behavior. Timestamps must be canonical UTC ISO-8601 with exactly millisecond precision, for example `2026-07-14T00:00:00.000Z`.
