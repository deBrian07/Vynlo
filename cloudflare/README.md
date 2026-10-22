# Optional open detection service

This Worker serves a 1 × 1 transparent image and stores image-load events in D1. It is separate from the extension: Vynlo's conversation tracking, reminders, snippets and notes do not require it.

For the guided setup, see [Open tracking setup](../docs/OPEN_TRACKING.md). An operator deploys the service once; people connecting an existing service only need its address and connection key. The setup helper does not deploy anything until its final confirmation.

## Stored information

Each record contains a cryptographically random ID, hashed read/delete capabilities, creation/expiry and activation times, first/last recorded image-load times and a bounded count. It contains no email address, subject, message body, account identifier, IP address or user agent. No event-by-event history is stored.

Cloudflare necessarily handles request metadata, including the request IP and pixel URL. This code does not persist that metadata. Worker observability is disabled in the supplied configuration. Operator logging, Cloudflare security features and provider backups have their own retention behavior; this is not anonymous or encrypted email tracking.

Records become inaccessible after 30 days. A daily Cron Trigger deletes expired rows. D1 backups may retain deleted data according to Cloudflare's backup policy. Deleting a record stops subsequent loads from being recorded, including copies of the image URL already sent to recipients.

## Detection limits

An image load is **not proof of a human read**. Recipient image blocking and proxy caching hide opens; automated image downloads, the sender's own draft/sent view and security scanners can create apparent opens. Explicit HEAD requests and requests declaring prefetch/prerender are excluded, but there is no reliable way to distinguish every proxy preload from a human open. Forwarded messages share the same image and cannot identify which person opened it. Draft attachment does not confirm sending. New pixels are inactive and image loads are ignored until the user explicitly confirms **I've sent this** in Vynlo. The activation capability is private. This avoids recording insertion itself as an open, but a sender opening their Sent folder after activation can still trigger a load. A proxy that cached the image before activation may never fetch it again; activation can therefore miss real later opens.

Counts are deliberately approximate: at most one event per record per minute, capped at 1,000. The pixel rate limiter further restricts attempts per Cloudflare location. Database failure, unknown/expired records and throttled requests all return the same uncached GIF. Images in recipients' mail should continue loading even when tracking cannot record an event.

## API v1

Private responses use `Cache-Control: no-store` and do not grant web-page CORS access. The extension connects through its background worker with a user-approved host permission. Credentials never belong in a URL, HTML image, Gmail page script or log.

| Request                           | Authentication                           | Result                                                        |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `GET /health`                     | None                                     | `{service:"vynlo-tracking",version:1}`                        |
| `GET /v1/check`                   | Operator key                             | `{ok:true}` without creating a record                         |
| `POST /v1/trackings`              | Operator key                             | `{pixelUrl,expiresAt}`                                        |
| `POST /v1/trackings/:id/activate` | Record delete capability                 | `{ok:true,armedAt}`; idempotently enables recording           |
| `GET /v1/trackings/:id`           | Record read capability                   | `{id,armedAt,firstOpenedAt,lastOpenedAt,openCount,expiresAt}` |
| `DELETE /v1/trackings/:id`        | Record delete capability or operator key | `{deleted:true}`                                              |
| `GET /p/:id.gif`                  | The opaque image ID                      | Transparent GIF; possibly records a load                      |
| `HEAD /p/:id.gif`                 | The opaque image ID                      | No body and no event                                          |

Authentication uses `Authorization: Bearer TOKEN`. The operator key must contain 32–256 ASCII letters, numbers, `_` or `-`; generate it randomly. Creation accepts **only** `{id,readToken,deleteToken}`, each an independently generated 32-byte random value encoded as 64 lowercase hexadecimal characters. Retries with identical credentials return the existing record without resetting expiration. Conflicting credentials return 409. A read token cannot activate or delete; a delete token cannot read; the operator key cannot read individual records. The operator can delete records.

The private API has an aggregate limit of 120 requests/minute/location. This deliberately avoids storing client network identifiers. Someone hammering this personal service can still affect availability. Cloudflare rate limits are approximate and are not spending caps; configure usage alerts and review account quotas before sharing a service widely. Keep the operator key private and rotate it if exposed. Rotating it prevents future registrations with the previous key; existing per-record capabilities continue to work until expiry or deletion.

## Operator configuration

`wrangler.toml` defines all required bindings:

- `DB`: D1 database with `migrations/0001_tracking.sql` applied.
- `ADMIN_SECRET`: encrypted Worker secret, never a plaintext `[vars]` entry.
- `PIXEL_LIMITER`: 2 attempts/minute per opaque image ID/location.
- `API_LIMITER`: 120 private requests/minute/location.
- Daily `scheduled` handler: expired-row cleanup.

The guided helper creates the database, applies the migration, sets the secret and deploys with these settings. For manual operation, use Wrangler's `d1 create`, `d1 migrations apply --remote`, `secret put ADMIN_SECRET`, then `deploy`, with the configuration in this directory. Set `database_id` to the real database ID first. Test `/health` and authenticated `/v1/check` before connecting Vynlo.

Do not enable full request logging or add analytics to this service. Do not reuse capability tokens for different records. Do not expose the key in a shared screenshot or support report. For a new deployment, namespace IDs in the rate limiter configuration should be unique within the operator's Cloudflare account.

## Validation

`tests/unit/tracking-worker.test.ts` applies the actual SQL migration to an in-memory SQLite database and exercises Worker requests, permissions, retries, validation, throttling, expiry, deletion and failure behavior. It uses Node's built-in `node:sqlite` (Node 22.13+). These tests do not prove deployed Cloudflare behavior; run the staging/manual checklist before public use.

Implementation references: [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [Worker rate limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
