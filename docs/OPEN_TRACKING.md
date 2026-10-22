# Optional email open tracking

Vynlo can add a tracking image to a draft you choose. When that image is requested,
Cloudflare records an image-load event. This is **not a read receipt**: Vynlo cannot
prove that a person read your message, or that a message with no detected open is unread.
Tracking does not send your email. You still send it yourself in Gmail.

Tracking is off until you connect a service, and it is never added to every draft automatically.
Conversations, notes, reminders and snippets continue to work without a server.

## Connect an existing service

If you already have a Vynlo tracking service, there is no development setup:

1. Open **Vynlo Settings → Email open tracking**.
2. Paste your service's HTTPS endpoint and connection key. Approve Chrome's request
   to connect to that address.
3. Connect, then open a Gmail draft and choose Vynlo's tracking action when you want it.

Use your own key. Do not paste a Cloudflare login, password or account API token into Vynlo.
The connection key authorizes creating tracking links; treat it as a password.

## Create your own service once

This part is for the person running the service. It requires a Cloudflare account,
Node 22.13 or later, pnpm and a checkout with dependencies installed. Ordinary use of
an already connected extension does not require Node, pnpm or an open terminal.

From the repository, run:

```sh
pnpm tracking:setup
```

The helper explains what will be published and asks before making cloud changes.
It then opens Cloudflare sign-in in your browser, creates one D1 database, applies
its schema, generates a connection key and deploys one Worker. You do not need to
edit a config file, generate keys yourself or copy a database ID. After deployment,
paste the `https://…workers.dev` address printed by Cloudflare when the helper asks.

When it finishes, choose **Show connection file** in the terminal. Your file manager
opens with the private connection file selected. Open that file locally and copy
`endpoint` into **Worker URL** and `secret` into **Connection key** in Vynlo's form.
If your file manager cannot open, use the full file path printed by the helper:
**`cloudflare/.setup/connection.json`**. The helper tests the deployed
connection and D1 schema by creating, activating, reading and deleting a temporary
record before reporting success. It never loads the test pixel or fabricates an
open event. A failed cleanup is reported as a setup failure; a remaining temporary
record expires after 30 days. It does not print your key in terminal output
or pass it in command arguments.

The helper uses pinned Wrangler **4.151.3**, fetched through `pnpm dlx`. Cloudflare
handles sign-in; the helper does not collect login credentials or accept terms for you.
If Cloudflare asks you to create a Workers subdomain, complete that in its dashboard
and run the helper again. No custom domain is required.

### Keep setup private

`cloudflare/.setup/` contains your reusable service configuration, secret and
connection details. It is ignored by Git. The helper restricts the folder and files
to your operating-system user where POSIX file permissions apply. This is **not encryption**.
Keep these files out of screenshots, bug reports, shared drives and public repositories.

Run setup again to update the same service. It preserves the database and key.
Do not delete the setup folder to retry a failed deployment: doing so loses the
connection key and resource bindings. If the first database creation succeeded but
the binding was not saved, find the database ID in Cloudflare's D1 dashboard and add
its `DB` binding to the generated `cloudflare/.setup/wrangler.json`, then rerun.

## What leaves your browser

The extension sends random tracking identifiers and capability tokens to your configured
service. The service stores hashed read/delete capabilities, expiry dates and image-load
counts/timestamps. It does not receive email addresses, subjects, notes or message bodies.
Email-to-tracking associations remain in extension storage.

The image URL contains a random public identifier, never your connection key.
Anyone with that URL can cause image-load events. Anyone with a record's private
read/delete capabilities can inspect or delete that record. The connection key
cannot list everyone's existing records.

Cloudflare necessarily handles network request metadata, including IP addresses
and request headers. The Worker does not put those into D1 and its application
observability is disabled by default. Cloudflare's own infrastructure and account
policies still apply; do not describe this feature as fully local or anonymous.

Tracking records expire after 30 days. Expired records stop reporting data, and a
daily scheduled cleanup removes them from D1. Deleting a record stops future
recording for its pixel. Removing a pixel from a draft before sending prevents
that copy of the email from carrying it; it cannot remove pixels from delivered mail.

## What an event means

The interface reports **“Open detected”** or **“No open detected”** rather than
“read” or “unread.” Known limitations include:

- Image blocking and offline reading can hide actual opens.
- Gmail image proxies and caches can collapse several views into one event.
- Security scanners, privacy preloads and forwarded mail can generate events.
- Loading a tracking image in your own draft or Sent mail can count as an event.
  Draft previews can request an image before the email is sent.
- Multiple recipients share the pixel in that message. Events do not identify
  which person opened it. Vynlo does not identify recipients through fingerprinting.
- Explicit prefetch hints and HEAD requests are excluded, and requests are rate
  limited. These measures cannot distinguish every automated or self-generated load.
- Tracking requires the recipient to load the image from a reachable service.
  It cannot be added retroactively to emails already sent.

Test with a separate mailbox and compare image-enabled, image-blocked, draft,
Sent and forwarded-message behavior before relying on any result. Fixture tests
cannot establish behavior for every Gmail version or recipient email client.

## Costs and operating the service

The Worker and D1 can fit within Cloudflare's free-tier quotas for personal use.
Free-tier availability, request limits and billing depend on your Cloudflare plan;
this project does not promise unlimited free hosting. Check your plan before deploying.
Rate limits reduce bursts but are not a spending cap or a defense against all abuse.

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [Worker deployment and secrets commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)

Use a personal service for your own extension. This initial key-based deployment is
not a public multi-user SaaS: it has no user signup, quota allocation or hosted key
issuance. Do not distribute your own connection key with the extension package.

If the key leaks, rotate `ADMIN_SECRET` through Cloudflare's Worker settings and
replace the value in the private setup secrets file before the next deployment.
Reconnect Vynlo with the new key. Existing record capabilities remain valid until
deleted or expired; key rotation does not erase already delivered pixels.

To stop: disconnect tracking in Vynlo, then remove the Worker and D1 database in
Cloudflare if you no longer want to host them. Disconnecting the extension alone
does not remove the service or undo delivered tracking images.

## Release checks

Before enabling this for other people:

- Deploy your own test service and verify authenticated connection, image loading,
  refresh, deletion, expiry and missing/incorrect-key errors.
- Confirm the shipped extension asks only for the configured endpoint's permission
  and that connection credentials are absent from the Gmail DOM, pixels and backups.
- Verify cancellation leaves existing draft content intact and no message is sent
  automatically. Test multiple composers and account switching.
- Review the privacy policy, Chrome Web Store disclosures and recipient disclosure
  appropriate for your intended use. No compliance certification is implied.
- Check Cloudflare usage, billing and disabled observability after deployment.

The repository's automated tests do not create cloud resources. A passing test
suite or local Worker test does not mean the production Cloudflare deployment or
live Gmail tracking has been verified.
