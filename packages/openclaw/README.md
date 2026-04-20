# openclaw

Legacy compatibility package for EasyClaw.

- `npm install -g openclaw` keeps the legacy package name working.
- `openclaw` runs the EasyClaw CLI through a compatibility entrypoint.
- `openclaw/plugin-sdk/*` re-exports the matching `easyclaw/plugin-sdk/*` modules.

This package is published from the EasyClaw monorepo and is kept on the same release line as `easyclaw@2026.3.14`.
