# Encrypted backup service

This optional Worker stores one encrypted workspace per random vault ID in a private R2 bucket. The extension encrypts before uploading. This service does not receive encryption keys, email addresses, message bodies or workspace plaintext. An opaque token hash is stored as private object metadata. No public bucket access or CORS is needed: extension background requests use an explicit host permission.

Provisioning requires the deployment's 64-character hexadecimal `ADMIN_SECRET`. Existing vaults require their independent 64-character bearer token. Updates require the last quoted ETag and use R2's atomic conditional writes; concurrent updates return 409 instead of overwriting data silently. The service does not merge workspaces or keep previous versions. Keep an independent local backup before restoring over a workspace.

There is deliberately no DELETE API: R2 delete has no conditional operation, so deleting concurrently with an upload could discard the newer backup. Disconnecting in Vynlo stops uploads but leaves recovery available. The operator can delete the exact `vaults/<vault-id>` object from the private R2 dashboard after stopping uploads. No automatic expiry is configured.

The 16 MiB upload limit is enforced while reading, including requests without Content-Length. Only the version 1 encrypted envelope is accepted. A per-location Cloudflare rate limiter bounds requests; it is a coarse abuse control, not a global spending cap. Cloudflare infrastructure can still process network metadata. R2 billing/activation requirements and account limits must be reviewed before deployment.

Tests use a mock bucket to verify authentication and conditional writes. They do not prove live Cloudflare behavior. API implementation follows the [official R2 Workers reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
