# Visual baseline — recording metadata

The committed captures in this directory are the rendered baseline for the desktop-GUI parity note
(.agents/notes/proposed/architecture/2026-08-14-desktop-gui-minimum-change-standalone-architecture.md).
They record the real WebUI states driven keylessly through the replay lane (no API key, no model
calls) at the web e2e lane baseline viewport. Re-record with:

```sh
DSH_VISUAL_BASELINE=record pnpm run test:web:built -- -t visual-baseline
```

(`pnpm run build` first; `pnpm run test:web` does this automatically.)

## Recording conditions

- Viewport: 1680x1000 (the web e2e lane baseline; see tests/support.ts newEnglishPage)
- Locale: en-US (product surface English unless the state itself is Chinese, e.g. the settings dialog)
- Theme: light by default; 04-conversation-seeded-dark records the `body[data-ds-dark-theme]` cascade
- Platform: win32 x64 (10.0.19045)
- Browser: Playwright Chromium 149.0.7827.55
- Recorded: 2026-08-14T19:10:12.409Z

## Caveats

- Seeded-session captures show the scaffold temp workspace directory basename, which varies per run;
  treat that region as non-asserted (the aria lane normalizes the same value to {{workspace}}).
- Pixel rendering (fonts, antialiasing) is platform-dependent; captures are authoritative for the
  recorded platform only, and the desktop implementation phase re-records on its own platform.

## Captures

- 01-hero-empty-workspace.png
- 02-workspace-picker-dialog.png
- 03-conversation-seeded.png
- 04-conversation-seeded-dark.png
- 05-plan-active.png
- 06-background-jobs.png
- 07-shell-terminal-card.png
- 08-trajectory.png
- 09-settings-plugins.png
- 10-settings-models.png
- 11-command-menu.png
- 12-onboarding-credential-step.png
