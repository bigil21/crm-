# JobCrest file backup and restore

This is a separate **file-body backup**, not the database/Square backup. Enabling the feature without a verified destination is not a successful deployment.

## Destination and access

Use a dedicated, company-owned Google Cloud Storage bucket outside the production Supabase project. Enable uniform bucket access, enforce public access prevention, use a company-controlled Cloud KMS key as the default encryption key, and configure no lifecycle deletion. Review the project's inherited IAM as well as the bucket IAM. Do not use a personal drive, a staff-shared document folder or a publicly accessible bucket. Select residency, budget alerts, independent recovery administrators and the KMS recovery policy before enabling it. Disabling or destroying the KMS key can make every protected file unreadable.

The backup writer needs only storage.buckets.get, storage.objects.get, and storage.objects.create on the vault; do not grant update, delete, IAM administration, or key destruction. Grant the bucket project's Cloud Storage service agent the KMS encryption/decryption role on that key. Configure a read-only recovery identity independently of the CRM. Keep versioning enabled as defense in depth and consider a retention lock under a separately authorized policy; this application never expires objects.

## Runtime

On the existing always-on CRM service, set:

- FILE_VAULT_BUCKET: verified bucket name.
- FILE_VAULT_PROJECT_NUMBER: its independently verified numeric company project ID.
- FILE_VAULT_KMS_KEY: full key resource ending in /cryptoKeys/NAME.
- FILE_VAULT_SERVICE_ACCOUNT: dedicated vault writer reachable via the authorized Google workload identity.
- FILE_VAULT_WIF_CONFIG: server-only path to a workload identity federation configuration. If not set, the existing GOOGLE_APPLICATION_CREDENTIALS path is used. Do not replace the CRM's existing identity configuration to install the backup; grant a separate writer impersonation binding through the deployment administrator.
- FILE_VAULT_SOURCE_REF: approved production Supabase project ref. The origin must match it exactly.
- Existing server-only SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY), and SUPABASE_STATE_ID. No secrets belong in Git, the browser, or logs.
- Set FILE_VAULT_ENABLED=true only once the destination and IAM are verified. Without it, neither a source read nor a destination write occurs.

The scheduler checks after 06:00 UTC each day and retries incomplete runs every 30 minutes while the service is running. A manual first run is `node scripts/media-vault.js backup`. It is not certified complete until it reports the expected inventory count and two verified restores, and the daily marker exists independently in the destination. Monitor for a missing daily marker and for "Media vault incomplete"; a running server is not evidence the backup succeeded.

## Coverage and checks

Walk the storage objects, not just active document rows, in crm-documents (company prefix) and quote-photos (the dedicated website bucket). This includes deleted-record files, unlinked objects, old versions still present in storage, and previews. It cannot recover bytes already permanently removed from source before the first successful copy. Unclassified top-level CRM prefixes fail closed. Other applications must not share these dedicated buckets.

The job checks the account, bucket policy, deletion lifecycle and encryption configuration. It streams one file at a time over TLS, pins each new object to the specified KMS key, and compares byte count and provider checksum with the source. Object and receipt writes are create-only; reuse refers to the original immutable generation. It compares the inventory a second time, and marks a day complete only after downloading and checking both an original photo and a CRM-linked estimate PDF against the saved SHA-256 digests. Duplicate runs, changed files and interrupted writes never overwrite previous backups. No filenames are printed in the normal run log.

## Restore without overwriting

On an authorized recovery host, inspect the date with `node scripts/media-vault.js inspect YYYY-MM-DD`. It returns the object IDs of the two verified samples. Use `node scripts/media-vault.js restore YYYY-MM-DD OBJECT_ID NEW_OUTPUT_PATH` for each. A restored file is created exclusively; an existing path is refused. Do not use a destination inside the CRM. If a stream fails, leave the partial test file alone and retry to a new path. A successful restore checks the exact archived generation, length, MD5 and SHA-256. Neither inspection nor restoration needs a writable destination bucket.

The inspect and restore commands need only the bucket, project, key name and a federated read-only identity. Neither Supabase credentials nor a running CRM nor an enabled scheduler is required. For independent disaster recovery, an authorized storage reader can also retrieve jobcrest-media/v1/days/YYYY-MM-DD.json directly from GCS. The manifest maps original bucket/path to object ID, exact generation, length and SHA-256. Read jobcrest-media/v1/objects/OBJECT_ID at that generation to a fresh file and verify the digest. Keep the separate database backup for restoring lead-to-job links.

The separate Windows two-file drill in scripts/media-vault-pilot.ps1 is not the daily job. It encrypts both files with AES-256-GCM; only the ciphertext goes offsite. Its test key is DPAPI-protected for the creating Windows user, so it is not a portable disaster-recovery key. Do not rely on that profile as the only key for the production vault.
