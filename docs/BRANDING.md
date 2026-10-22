# Vynlo branding

The approved mark is the navy rounded tile with the folded mint/teal V. The full corrected kit is preserved in [`assets/brand`](../assets/brand), including vector logos, icons, light/dark banners and the original [brand guide](../assets/brand/guidelines/BRAND-GUIDE.md). The supplied Downloads folder was copied, not removed.

## Product use

- `public/icons/{16,32,48,128}.png` are the exact supplied Chrome icon exports. The existing manifest paths, extension ID behavior and permissions remain unchanged.
- `src/components/Brand.tsx` adapts the approved SVG paths for the workspace, popup and Gmail launcher. The wordmark uses the kit's outlined glyphs, cropped to remove export whitespace. No font, image request, remote script or new dependency is needed.
- Paint gradients use per-instance IDs so repeated marks do not share document references. Icons are decorative; the outlined wordmark has an accessible Vynlo label. Light/dark themes choose navy/white wordmark colors while retaining the two-tone mark.
- Existing indigo UI interaction colors remain, as the supplied guide permits. Do not turn the brand mark into a purple tile or generic text V.

## Documentation use

The README selects the provided light or dark GitHub banner through a `picture` element. These are labeled brand illustrations, not verified Gmail captures. The corrected artwork uses generic account information. Detailed workflow and setup instructions live in [USAGE.md](USAGE.md), keeping the README brief.

Retain the original aspect ratios. Brand vectors and marketing assets stay in the source repository; only required icons and compiled local vectors enter the extension package. Do not add the entire marketing folder to `public`.

## Validation and merge notes

This branch starts directly from main `e9244ed`, independently of `feat/data-backups` and `feat/open-tracking`. It changes branding and documentation without adding those features. When merging the feature branches, retain the new README structure and add accurate optional-feature links; preserve both sides' privacy disclosures.

Executed: 103 existing unit/integration tests pass; strict TypeScript, ESLint, formatting, WXT build/ZIP and Vite preview build pass. Supplied icon dimensions and byte identity, README local links, SVG resource safety and ZIP contents were checked. No new live Gmail compatibility claim is made. Native Playwright launch is blocked in this sandbox (SIGABRT/EPERM as recorded for the backup branch); browser fixture runs and an installed-extension visual check remain release gates.
