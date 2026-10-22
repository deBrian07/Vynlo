# Keep your workspace safe

Vynlo keeps your workspace on this device. Ordinary updates preserve that data. Uninstalling the extension removes its browser storage, so save a backup outside Chrome before reinstalling or switching installations.

All backup features are optional. Cloud backups and automatic backups start off.

## Save a local backup

1. Open **Vynlo Settings → Data protection**.
2. Choose an encrypted backup download and set a strong password.
3. Keep the downloaded file somewhere outside Chrome, and keep its password in your password manager.

To recover after reinstalling, open Data protection, choose the encrypted file and enter its password. Check the restore preview before confirming. Keep your last good backup until you have checked the recovered workspace.

This path needs no account, cloud service or command line. Downloads only protect changes included in that file; download a fresh copy after important changes. Local downloads are manual. Keep at least one completed copy outside Chrome; uninstalling Vynlo also removes its locally saved backup configuration.

## Turn on automatic cloud backups

Once your backup service is available:

1. In **Settings → Data protection**, select **Choose connection file** and choose the file provided by your service operator.
2. Select **Prepare cloud backup**, then **Save recovery file**. Keep it outside Chrome, somewhere private that you can still access after reinstalling.
3. Confirm that you saved the recovery file, then select **Enable automatic backups**.

The extension encrypts your workspace before upload. The recovery file contains the information needed to retrieve and decrypt it. Losing both the kit and the installed extension's recovery information makes the cloud backup irrecoverable. A service operator cannot reset your encryption key.

After reinstalling, choose cloud recovery in Data protection and provide your recovery file. Review the restore preview, then confirm the restore. Re-enable automatic backups only after checking the result.

Changes queue a backup, and Vynlo also checks periodically while Chrome is running. Chrome suspension, device sleep, network errors and unavailable service permissions can delay uploads; the protection status shows whether a backup completed or needs attention. A conflicting remote revision stops uploads rather than silently overwriting another copy.

Turning off automatic backups stops new uploads. It does not remove previously downloaded files or a cloud backup. The service operator can delete stored objects in Cloudflare R2. Keep your recovery file private: anyone who has it may be able to access your backup.

## One-time cloud service setup

This section is for the person hosting the service. Everyday users only need their connection file and Vynlo's in-app controls.

Requirements: Node 22.13 or later, pnpm, internet and a Cloudflare account with R2 enabled. R2 onboarding may ask for billing details even if your usage fits its free allowance. Review Cloudflare's current plans yourself; the helper does not buy plans or accept terms for you.

From the repository, run:

```sh
pnpm backups:setup
```

The guided helper explains what will be created and asks you to type `yes` before contacting Cloudflare. It then opens sign-in, creates a private R2 bucket, publishes a Worker and checks the endpoint and connection key. Paste the root `https://name.account.workers.dev` address printed by Wrangler when prompted. It offers to reveal the completed connection file in your file manager.

In Vynlo Settings → Data protection, select **Choose connection file**, then **Prepare cloud backup**. Select **Save recovery file**, confirm it is saved, and select **Enable automatic backups**. Nothing is uploaded until you enable backups in the extension. No workspace, encryption password or recovery key is sent by the setup helper.

The helper uses pinned Wrangler `4.151.3` with its normal terminal prompts. Private configuration, connection and secret files are kept in `cloudflare-backups/.setup/`, which is excluded from Git. Files use owner-only permissions on platforms that support them. Keep this folder private, retain it for service updates and never attach its files or authentication logs to bug reports. The connection key can provision backup vaults; it is distinct from a workspace recovery file.

Rerunning setup reuses only the bucket recorded by its saved configuration. If bucket creation fails because that name already exists without saved setup, the helper stops rather than adopting it. Choose another service name by correcting the saved configuration or moving aside the incomplete `.setup` folder, then rerun. Do not remove the only copy of a working service's secrets.

If setup stops at billing or account access, finish Cloudflare onboarding yourself and rerun. If a deployment succeeds but its check fails, rerun after checking the Cloudflare error; the existing key and bucket configuration are preserved. The helper writes a connection file only after successful verification.

The R2 bucket is private, Worker observability is disabled in the generated configuration, and the service stores encrypted objects. Cloudflare still receives request metadata; operators with account access may change logging or retention settings. This is optional remote storage, not a promise that local browser data is encrypted at rest.

## Compatibility and verification

The backup includes supported Vynlo user-created records and preferences; it does not back up Gmail messages or attachments. Reminder schedules are rebuilt from restored records. A backup cannot restore an unimplemented feature or missing records from an older export format.

The automated suite exercises encrypted recovery, validation, service behavior and setup-file safeguards. No live Cloudflare deployment or real Gmail reinstall recovery has been executed for this feature in the development environment. Before relying on a deployment, save a local backup, create a cloud backup, and test recovery using a separate Chrome profile. Keep the original profile until the recovered workspace is checked.

Operator references: [Cloudflare bucket creation](https://developers.cloudflare.com/r2/buckets/create-buckets/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/) and [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
