# Vynlo branding

The approved mark is the navy rounded tile with the folded mint/teal V. The full corrected kit is preserved in [`assets/brand`](../assets/brand), including vector logos, icons, light/dark banners and the original [brand guide](../assets/brand/guidelines/BRAND-GUIDE.md). The supplied Downloads folder was copied, not removed.

## Product use

- `public/icons/{16,32,48,128}.png` are the exact supplied Chrome icon exports. The existing manifest paths, extension ID behavior and permissions remain unchanged.
- `src/components/Brand.tsx` adapts the approved SVG paths for the workspace, popup and Gmail launcher. The wordmark uses the kit's outlined glyphs, cropped to remove export whitespace. No font, image request, remote script or new dependency is needed.
- Paint gradients use per-instance IDs so repeated marks do not share document references. Icons are decorative; the outlined wordmark has an accessible Vynlo label. Light/dark themes choose navy/white wordmark colors while retaining the two-tone mark.
- The interface now follows the brand palette: navy text and primary actions, deep teal interactive accents and soft mint selections in light mode; layered navy surfaces with mint actions in dark mode. The supplied kit is preserved verbatim, including its older illustrative screenshots. Product tokens live in `src/styles/app.css`.
- Primary action text uses a separate foreground token. Bright mint is paired with navy; small light-theme text uses a darker teal for contrast. Amber due reminders, blue Needs Reply indicators and green resolved indicators keep their meanings in both themes.
- Navigation, inputs, hover/focus states, notices, dialogs and the command palette share the same theme tokens. The palette inherits the selected appearance and no longer forces a brown/purple dark theme or monospace command labels.
- The full-page sidebar has room for the approved lockup. Preview controls stay inside the sidebar; the standalone header is removed.

## Documentation use

The README selects the provided light or dark GitHub banner through a `picture` element. These are labeled brand illustrations, not verified Gmail captures. The corrected artwork uses generic account information. Detailed workflow and setup instructions live in [USAGE.md](USAGE.md), keeping the README brief.

Retain the original aspect ratios. Brand vectors and marketing assets stay in the source repository; only required icons and compiled local vectors enter the extension package. Do not add the entire marketing folder to `public`.

## Validation and merge notes

This branch starts directly from main `e9244ed`, independently of `feat/data-backups` and `feat/open-tracking`. It changes branding and documentation without adding those features. When merging the feature branches, retain the new README structure and add accurate optional-feature links; preserve both sides' privacy disclosures.

Executed: 103 existing unit/integration tests pass; strict TypeScript, ESLint, formatting, WXT build/ZIP and Vite preview build pass. Supplied icon dimensions and byte identity, README local links, SVG resource safety and ZIP contents were checked. No new live Gmail compatibility claim is made. Native Playwright launch is blocked in this sandbox (SIGABRT/EPERM as recorded for the backup branch); browser fixture runs and an installed-extension visual check remain release gates.

## Theme validation

Computed sRGB contrast ratios from the source tokens (not a blanket accessibility certification):

| Foreground / background        |   Light |    Dark |
| ------------------------------ | ------: | ------: |
| Main text / page               | 17.85:1 | 13.86:1 |
| Muted text / surface           |  5.78:1 |  7.38:1 |
| Accent text / selected surface |  5.63:1 |  7.39:1 |
| Primary button text / fill     | 17.85:1 |  9.59:1 |
| Destructive button text / fill |  5.46:1 |  9.14:1 |
| Input boundary / page          |  3.10:1 |  3.68:1 |

The full 103-test suite, lint, strict types, formatting and production packaging pass after the theme changes. Original Chrome preview had been visually checked for the mark; this theme pass could not complete native browser review: Chrome had no available window, automatic approval review rejected selecting Arc because its existing window could expose unrelated private tabs, and the isolated browser was unavailable. Live visual and Gmail checks remain release gates. No email data or remote services were used for these styling changes.

## Dashboard refinement

The full-page view uses a smaller brand lockup, understated account/status selectors, a simple active navigation tint and grouped summary statistics. Duplicate default result counts remain available to screen readers; search and filtered views show them visibly. Row dividers appear within groups, and reminder actions use text buttons. Keyboard focus indicators and all actions remain available. The preview theme control no longer adds a framed block to the sidebar.

## Gmail launcher

The floating Gmail control keeps the original launcher layout and sizing: a 28px icon, the regular text label “Vynlo”, the dashboard icon and the command control. Only the original purple tile is replaced with the navy/mint mark. The outlined SVG wordmark belongs in the workspace and popup, not the launcher. A launcher-scoped rule hides older SVG lockups so mismatched cached markup cannot overflow the small control.
