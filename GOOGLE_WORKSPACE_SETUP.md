# Google Workspace connection setup

JobCrest's first Google Workspace connectors are Google Calendar and job-specific Gmail. A task or reminder remains saved in JobCrest and is also created or updated on the assigned employee's Calendar. Gmail messages sent from a lead are stored with the selected job, and the user can check that Gmail thread for customer replies.

Drive, Docs, Sheets, and Groups are represented in the integration hub but are not enabled yet. They should be added later through incremental OAuth scopes so Calendar access does not grant broader permissions than it needs.

## 1. Prepare Google Cloud

1. Create or select the Google Cloud project owned by the company.
2. Enable the **Google Calendar API** and **Gmail API**.
3. Configure the OAuth consent screen. For a company-managed Google Workspace domain, use an internal application when that option is available.
4. Create a **Web application** OAuth client.
5. Add this production redirect URI exactly:

   `https://jobcrestcrm.com/api/integrations/google/callback`

6. For local testing, also add:

   `http://127.0.0.1:4175/api/integrations/google/callback`

Keep the client secret in Render's protected environment settings. Never place it in source control or browser code.

## 2. Prepare the database

Run these migrations in the production Supabase project:

1. `supabase/migrations/20261005_google_workspace_integrations.sql`
2. `supabase/migrations/20261005_google_drive_documents.sql`

The table is server-only, has row-level security enabled, and stores refresh tokens encrypted. Browser users cannot read its rows.

## 3. Add protected server settings

Add these values to the Render web service:

- `GOOGLE_CLIENT_ID`: OAuth web client ID from Google Cloud
- `GOOGLE_CLIENT_SECRET`: OAuth web client secret from Google Cloud
- `GOOGLE_REDIRECT_URI`: `https://jobcrestcrm.com/api/integrations/google/callback`
- `GOOGLE_OAUTH_STATE_SECRET`: a new random server secret of at least 32 characters
- `INTEGRATION_TOKEN_ENCRYPTION_KEY`: a new random 32-byte key encoded as base64
- `CRM_TIME_ZONE`: `America/New_York`

Generate the two secrets independently. Do not reuse the Supabase, session, Square, or Google client secrets.

## 4. Prepare the company Shared Drive

Drive document storage uses a dedicated service account instead of an employee's personal Drive. This keeps company files available when an employee leaves and limits the integration to the Shared Drive the company grants it access to.

1. In the same Google Cloud project, enable the **Google Drive API**.
2. Create a service account for JobCrest Drive storage and generate a JSON key.
3. In Google Drive, create or choose a company Shared Drive and a root folder for JobCrest.
4. Add the service account email as a **Content manager** of that Shared Drive, or grant it access to the selected root folder.
5. Add these protected Render settings:

   - `GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL`: `client_email` from the service-account key
   - `GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY`: `private_key` from the service-account key
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID`: the folder ID from the selected JobCrest root folder URL

Never put the service-account JSON file or private key in the repository or browser code. JobCrest creates folders using durable CRM identifiers, so renaming a customer or project does not create a duplicate folder. Each stored document version is copied only once.

## 5. Connect each employee

1. Deploy the tested changes.
2. Sign into JobCrest.
3. Open **Settings > Integrations**.
4. Choose **Connect Google Workspace**.
5. Sign into the Google account whose email exactly matches the JobCrest login email and approve Calendar event, Gmail send, and Gmail read-only access.

Each employee makes this connection once. JobCrest rejects a different Google email so tasks cannot silently land on the wrong person's calendar.

## 6. Verify before company rollout

Use two non-customer test accounts—one administrator and one sales representative—and verify:

- Creating a task saves it in JobCrest and creates one Google Calendar event.
- Editing the task updates that same event instead of creating a duplicate.
- The event contains the lead name and available lead contact/job details.
- The selected reminder behavior is reflected in Google Calendar.
- A sales representative cannot create an event on another employee's calendar.
- Disconnecting Google stops future sync without deleting CRM tasks.
- A Google outage or expired permission does not erase the task from JobCrest.
- Sending from a job uses the connected employee's Gmail account and stores the Gmail message and thread IDs with that job.
- Checking replies adds only new messages from those saved Gmail threads and does not mix messages between jobs.
- Reconnecting an earlier Calendar-only account adds the Gmail permissions without changing the employee identity.
- Uploading documents and multiple photos creates `Lead > Project > Category` folders in the company Shared Drive.
- Two projects for the same customer create separate project folders.
- Retrying the same document version reuses the existing Drive file instead of creating a duplicate.
- A newer CRM document version creates a new immutable Drive copy and updates the CRM link.
- Sales users cannot copy another representative's inaccessible document by guessing its ID.

## Expansion plan

- **Docs:** generate contracts, change orders, warranties, and completion documents from CRM templates, then save the output to the appropriate Drive project folder.
- **Sheets:** export filtered reports and scheduled sales summaries, rather than using Sheets as the source of truth.
- **Groups:** map company groups to notifications and controlled sharing after directory-administration requirements are approved.
- **Zoho:** add OAuth connectors for Zoho Calendar, WorkDrive, Writer, and Sheet using the same encrypted connection store. The existing CSV lead import remains available during that rollout.
