# Contributing

Contributions to Project Memory are welcome through GitHub issues and pull
requests.

## Development workflow

1. Fork the repository and create a focused branch.
2. Keep each commit to one logical change.
3. Follow `AGENTS.md` and the approved architecture specifications.
4. Run commands from `plugins/project-memory/` unless documented otherwise.
5. Run the complete verification set before opening a pull request:

   ```powershell
   npm ci --ignore-scripts
   npm run check
   npm run generated:verify
   npm run plugin:verify
   npm run package:verify
   ```

6. Describe what changed, why it changed, the checks run, and any remaining
   risk in the pull request.

Do not include secrets, credentials, private project data, raw model output,
generated temporary directories, or unrelated changes. Product, architecture,
security, licensing, and governance proposals remain subject to maintainer
review and explicit acceptance.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md)
and use GitHub's private vulnerability-reporting flow.

By contributing, you agree that your contribution is licensed under the
repository's [MIT License](LICENSE).
