# Zoho Sign Smart Document setup

JobCrest can turn a document already saved to a lead, job, or the company library into a Zoho Sign draft. It opens Zoho's field editor so the employee can place signature, initial, date, and other fields before explicitly sending the envelope. JobCrest does not automatically send a signature request.

## 1. Prepare Zoho Sign

1. Confirm the company Zoho Sign account has API access and sufficient API credits.
2. In the Zoho API Console, create a **Server-based Application** owned by the company.
3. Select the Zoho data center used by the company account.
4. Register this production redirect URI exactly:

   `https://jobcrestcrm.com/api/integrations/zoho/callback`

5. For local testing, also register:

   `http://127.0.0.1:4175/api/integrations/zoho/callback`

JobCrest requests only the Zoho Sign document permissions needed to create, read, and update Smart Documents. Keep the client secret in Render's protected environment settings, never in source control or browser code.

## 2. Prepare the database

Apply these migrations to the Supabase project in order:

1. `supabase/migrations/20261005_google_workspace_integrations.sql`
2. `supabase/migrations/20261005_zoho_sign_smart_documents.sql`

The first migration provides the encrypted, server-only OAuth connection store shared by supported integrations. The second adds a service-only operation that links one Zoho Sign request to the durable CRM document without exposing credentials or allowing browser users to replace that link.

## 3. Add protected server settings

Add these values to the Render web service:

- `ZOHO_CLIENT_ID`: the server application's client ID
- `ZOHO_CLIENT_SECRET`: the server application's client secret
- `ZOHO_REDIRECT_URI`: `https://jobcrestcrm.com/api/integrations/zoho/callback`
- `ZOHO_OAUTH_STATE_SECRET`: a new random server secret of at least 32 characters
- `ZOHO_DATA_CENTER`: the company's Zoho suffix, such as `com`, `eu`, `in`, `jp`, `com.au`, `zohocloud.ca`, `sa`, `uk`, `sg`, or `ae`
- `INTEGRATION_TOKEN_ENCRYPTION_KEY`: a random 32-byte key encoded as base64; this can be the same integration encryption key used by the Google connector

Do not reuse the Supabase, session, Square, OAuth state, or Zoho client secrets as the encryption key.

## 4. Connect and use it

1. Sign into JobCrest and open **Settings > Integrations**.
2. Choose **Connect Zoho Sign** and approve access to the company Zoho account.
3. Upload a supported file to a lead, job, or the company document library. For a single-file upload, select **Prepare in Zoho Sign** to open the preparation form immediately.
4. Alternatively, choose **Smart Doc** on any previously saved supported document.
5. Enter the signer name and email, then choose **Create Smart Document**.
6. Place the required fields in Zoho's editor, review the document, and send it from Zoho Sign.

Files must first exist in JobCrest's durable shared storage. This prevents local-only or unverified browser files from being transmitted to Zoho. JobCrest supports Zoho Sign's common document, image, and spreadsheet formats and enforces a 25 MB individual-file limit before upload.

## 5. Verify before rollout

Use a non-customer test document and recipient, then verify:

- A user without a connected Zoho account cannot prepare a Smart Document.
- A saved PDF opens as a Zoho draft and no email is sent before the user sends it from Zoho.
- Reopening the same CRM document continues the existing Zoho request rather than creating a duplicate.
- An unsupported or oversized file is rejected before it is sent to Zoho.
- The CRM document keeps its lead/job association and displays its Zoho draft status and recipient.
- Sales users can prepare documents they are allowed to access, while integration tokens remain server-only.
- Disconnecting Zoho stops new requests without deleting existing Zoho drafts or CRM documents.
