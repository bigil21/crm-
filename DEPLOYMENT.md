# Public Deployment Checklist

Use this when you are ready for sales representatives to sign in from outside your computer.

## Recommended Host

Deploy this CRM as a Node web service. Render and Railway are good fits because this project is a plain Node server, not a Next.js app.

For Render:

- Service type: Web Service
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

## Required Environment Variables

Set these in the hosting provider's environment variable screen:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-publishable-key
SUPABASE_SYNC_ENABLED=true
SUPABASE_STATE_ID=coastal-crest
ALLOWED_EMAIL_DOMAIN=coastalcrestroofing.com
DEFAULT_AUTH_ROLE=sales
AUTH_REQUIRED=true
```

Do not upload the local `.env` or `.env.local` files to GitHub.

## Supabase Auth Settings

After the app is deployed and you have a public URL:

1. Open Supabase Dashboard.
2. Go to Authentication > URL Configuration.
3. Set Site URL to your production URL.
4. Add these Redirect URLs:
   - `https://your-public-crm-url/login`
   - `https://your-public-crm-url/**`
   - `http://localhost:4173/login`
   - `http://localhost:4173/**`

## User Setup

Sales users must use `@coastalcrestroofing.com` email addresses.

For each sales rep:

1. Have them open the public CRM URL.
2. Click Create Account.
3. Use their company email and password.
4. If Supabase requires email confirmation, they must confirm from their inbox.

Roles can be set in Supabase user metadata:

```json
{
  "role": "sales"
}
```

Supported roles are `admin`, `sales`, `production`, and `viewer`.
