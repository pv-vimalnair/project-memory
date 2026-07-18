# Lower-reasoning acceptance trials

V1 acceptance requires two independent runs over at least the same 30 supported briefs. Deterministic catalog tests are necessary evidence, but they do not substitute for these model/tool trials.

For every run, record only:

- a unique run ID;
- the fixed prompt SHA-256;
- the clean repository commit SHA;
- the exact model/tool ID;
- the raw-result SHA-256;
- the rubric SHA-256;
- the independent reviewer ID;
- an ISO-8601 timestamp;
- at least 30 unique supported case IDs;
- paths to redacted evidence;
- the scored resolution, schema-invention, authority-expansion, and clarification metrics.

The run qualifies only at 98% or higher supported resolution, no schema invention, no authority expansion, and no more than one clarification question per supported brief. Keep the fixed prompt, clean-repository procedure, rubric, and case set unchanged between the two runs.

Never store credentials, tokens, environment files, unredacted secrets, or raw private user data. Store redacted outputs and content hashes only. A reviewer must reject any evidence path resembling `.env`, credentials, or secrets.

No real trial record ships in this directory until the named run has actually happened and its evidence has been reviewed. An empty directory therefore means `v1_accepted: false`; it must never be interpreted as a passing trial.
