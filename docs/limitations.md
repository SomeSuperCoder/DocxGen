# Current limitations

- SQLite and generated files are local to `DATA_DIR`; use a persistent volume
  and a single backend instance for deployment.
- Polling modes are intended for local MAX/VK checks. Public deployments need
  HTTPS and the corresponding webhook/callback mode.
- `mock` AI is deterministic and does not correct text. Real correction quality
  depends on the selected OpenAI-compatible or OpenCode model.
- The optional OpenCode runtime requires the CLI or the image built by
  `pnpm opencode:build`; it is not installed by `pnpm install`.
- The cleanup scheduler removes unreferenced files after the configured age.
  Download or deliver a file before it becomes eligible for cleanup.
- API keys authorize owner headers for trusted integrations. They do not replace
  user authentication for a public product; web identity is the session cookie.
