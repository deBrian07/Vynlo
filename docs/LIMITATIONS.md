# Known limitations

## Gmail compatibility

The first adapter supports a narrow, corroborated identity path: a visible account control, one supported conversation heading with legacy/permanent thread attributes and a corroborated route. Legacy hexadecimal routes are supported, as are canonical opaque `f` tokens whose decoded permanent and legacy IDs both match the visible heading. Unknown encodings and draft tokens remain unsupported. Reading panes, ambiguous headings and unsupported account-control languages disable tracking.

Saved references use an account email query rather than a numeric account slot. Their behavior across consumer accounts, Workspace accounts and changed sign-in order still needs live validation. Opaque decoding is restricted to a source-grounded, independently corroborated format. There is no page-global inspection or network interception.

Fixtures cover expected and failed states. They do not establish live Gmail compatibility, Gmail draft autosave reliability or compatibility with every deployed layout. The remaining live checklist is in [GMAIL_COMPATIBILITY.md](GMAIL_COMPATIBILITY.md). Public release should wait for those checks and a usable supported navigation path.

## Reminders

- Tracking and reply status are manual. Vynlo does not detect replies or send follow-ups.
- Chrome can delay alarms; sleeping or closed devices cannot guarantee on-time notification. Overdue records are reconciled when the worker runs again.
- Desktop notifications depend on Chrome and operating-system settings. The dashboard is the durable reminder surface.
- An attempted notification is marked before dispatch. A crash at that boundary can suppress an alert, and notification failures are not automatically retried. Snoozing schedules another attempt.
- There is one reminder per tracked conversation. Changing the date replaces the current schedule.
- Scheduled instants remain fixed when the device time zone changes. Calendar-day presets, including Later today, are calculated in the local time zone when selected. Later today means 6:00pm if that is at least an hour away, otherwise 9:00am the next morning.

## Drafts and shortcuts

Snippet insertion supports a captured Gmail content-editable textbox. The editor and cursor must still exist, and the account must remain the same. With multiple composers, focus the intended one before opening snippets. Plain text is inserted after the selection, preserving selected content. Chromium's editing command is required; unsupported environments return an error rather than applying an unverified DOM fallback.

Variables require explicit values. Vynlo does not guess names or companies from page text. There is no rich-HTML template editor or automatic sending.

Shortcuts do not run while typing, including in compose editors. Browser, OS and other-extension conflicts cannot all be detected. Cmd/Ctrl+K remains available through Vynlo's visible UI when typing prevents the shortcut from opening the palette.

## Local data and scale

Data belongs to one extension installation in one browser profile. There is no cross-device sync or encryption. Uninstalling or changing the extension ID can make records unavailable; export first. Backups merge missing records, keep existing local IDs and replace settings. Import is not an exact rollback of local records.

Account-scoped snapshots use IndexedDB account indexes. Mutations and scheduler reconciliation still validate full record collections in memory. It is designed for a personal tracker, not a mailbox archive. Imports are limited to 20,000 records per collection and field lengths are validated, but that limit is not a measured performance guarantee. Large workspaces need targeted indexed queries and profiling before stronger scalability claims.

Automatic theme detection uses page background luminance and an OS fallback; Gmail image themes may need an explicit light/dark setting. Chromium is the initial target; Firefox, Safari and mobile Gmail are not supported releases.

## Release status

The project includes a build and automated validation workflow. A configured workflow is not evidence that it ran on GitHub. A ZIP is not evidence of store approval. Authenticated Gmail validation, final screenshots, a public repository/support URL and publisher review remain separate release gates.

## Experimental email classification

Tags are Vynlo records, not native Gmail labels. Optional Tev1 0.8B inference uses only the subject of a supported conversation as you open it. It cannot categorize the unopened mailbox, identify replies or disambiguate context absent from a subject. All model tags remain unreviewed until explicitly confirmed; score concentration is not measured accuracy.

No actual Tev1 model execution, email-quality result or GPU timing has been measured in this environment. The native Chromium process aborts before it can open a page or inspect WebGPU. Mocked engine tests verify software boundaries only. Production approval requires independent representative evaluation and live-browser validation. See [browser AI](BROWSER_AI.md) and [classification validation](CLASSIFICATION_VALIDATION.md).

Database version 2 adds an account-indexed tag store without deleting version-one data. JSON schema version 1 adds optional `emailTags` for older backups. Older Vynlo releases may ignore tags on import; preserve an original backup when moving between versions. Classification consent is never imported.
