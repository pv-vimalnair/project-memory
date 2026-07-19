# Privacy

Project Memory is an offline, repository-first Codex Plugin. It has no hosted
service, account system, analytics, telemetry, advertising, or built-in network
client.

## Data handled locally

When an agent uses Project Memory, the Plugin can read the repository selected
for the current task and can propose or, after the required approval, write
Project Memory records inside that repository. Those records and their Git
history remain under the repository owner's control.

Project Memory does not send repository content, prompts, generated records, or
usage information to Pv Vimal Nair or to a Project Memory service. The Plugin's
bundled MCP process communicates locally over standard input and output.

Before a new repository is initialized, the exact reviewed bootstrap plan is
kept temporarily in the current operating-system user's local temporary folder.
This bounded, expiring cache lets approval continue across short-lived MCP
processes without writing to the product repository. It is deleted after a
successful apply; expired entries are removed on later Project Memory use. The
cache is not canonical project memory and is never sent to a hosted service.

## Third-party tools

Codex, Git hosting, model providers, and any other tools an agent uses have
their own privacy practices. Project Memory does not change or extend those
services' data handling.

## Removing local data

Uninstalling the Plugin removes the Plugin from Codex. Project Memory records
already committed to a product repository remain part of that repository and
can be retained, archived, or removed through its normal governed Git workflow.
Any unexpired bootstrap cache entries can also be removed from the operating
system's temporary `project-memory/proposal-cache-v1` folder.

Questions can be raised through
[the repository](https://github.com/pv-vimalnair/project-memory).
