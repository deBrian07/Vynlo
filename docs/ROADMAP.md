# Roadmap

The first release keeps its data local and focuses on manual conversation tracking. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) records implementation gates and validation status.

## Before broad release

1. Validate the identity adapter and saved account links in real Gmail sessions. The opaque-route restriction is the largest adoption blocker. Broaden support only with a dependable relationship between account, route and visible thread; preserve fail-closed behavior.
2. Complete draft insertion/autosave/undo checks, multiple-account tests and browser restart notification checks on supported Chrome versions.
3. Test keyboard and screen-reader behavior in real Gmail, including dark/image themes and multiple open composers.
4. Publish the actual repository and privacy/support URLs, capture synthetic screenshots and finish the store disclosure review.

## Reliability improvements

- Collect opt-in, sanitized bug reproductions for new Gmail layouts; do not add telemetry or automatic mailbox snapshots.
- Profile larger local trackers, replace full-collection snapshots with indexed queries where measurements justify it, and set tested scale expectations.
- Add explicit backup migrations as the data model evolves. Preserve existing data and show recoverable import errors.
- Review notification retry tradeoffs without introducing duplicate alerts or hiding the current at-most-once attempt behavior.
- Broaden shortcut conflict guidance and test additional keyboard layouts.

## Later, with a separate design review

Advanced inbox views, analytics, calendar connections and other email providers are optional future work. Reliable background reply detection would require an authorized integration such as the Gmail API, with new scope, verification and privacy decisions. It is not part of this local-first release.

Cloud synchronization, AI services and collaborative features are neither required dependencies nor promised features. Any proposal must explain the user value, account-isolation model and change to local-only handling before implementation.
