# Contributing to Vynlo

Vynlo is a local-first Gmail extension. A small change that makes tracking reliable is more useful than another feature that depends on a guessed thread identity.

## Get started

Use Node.js 22.13.0 or newer and pnpm 11.9.0. Run `pnpm install --frozen-lockfile`, then `pnpm dev`. For a production installation, run `pnpm build` and load `.output/chrome-mv3` through Chrome's extension Developer mode. Details are in [DEVELOPMENT.md](docs/DEVELOPMENT.md).

Before opening a pull request, run:

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

If an environment prevents a check, report the exact command and error. Do not describe an unexecuted browser interaction as verified.

## Code conventions

- Use strict TypeScript and typed runtime-message contracts. Validate persisted/imported data at runtime; a type assertion is not validation.
- Keep Gmail DOM selectors and composer logic in `src/gmail`. Components consume adapter context instead of querying Gmail themselves.
- Keep structured storage in the extension service worker. Preserve account namespaces in reads, mutations, reminders and navigation links.
- Prefer small cohesive modules and existing dependencies. Explain a new dependency's necessity, bundle impact and privacy implications.
- Use React text rendering and plain-text snippet insertion. Do not add remote executable scripts, mailbox scraping, analytics, OAuth or automatic sending.
- Format with Prettier and use short, focused conventional commit messages, such as `fix: preserve reminder dates`. Do not add co-author or contributor trailers.

## Tests and reviews

For Gmail adapter changes, include synthetic fixtures for success and uncertainty: absent/multiple elements, stale route transitions, account switching and removed composers. Run the live compatibility checklist when a real session is available, recording browser version and layout without exposing personal content. Fixture tests are necessary but do not prove every Gmail rollout works.

Storage changes need isolation, import validation and migration coverage. Reminder changes need clock-controlled restart and overdue tests. UI changes need keyboard, focus, empty/error and disabled-state checks appropriate to the interaction.

Keep pull requests scoped. Explain the concrete problem, resulting behavior, validation performed and remaining limitation. Update docs when supported behavior, permissions, schema or release commands change. Preserve unrelated work. The repository [AGENTS.md](AGENTS.md) applies to AI-assisted changes too.

## Bug reports

Include Vynlo version, Chrome version, Gmail layout/language, reproduction steps and whether the URL shape is a legacy hexadecimal route or an opaque route. Replace account addresses, subjects and thread tokens with synthetic values. Never attach Google credentials, session cookies, browser profiles, full backups or screenshots containing personal messages. Use the private reporting channel described in [SECURITY.md](docs/SECURITY.md) for security-sensitive issues once configured.

Contributions are made under the project's [MIT license](LICENSE). No public repository or issue tracker URL is configured in this preview; publication must establish those links before directing users there.
