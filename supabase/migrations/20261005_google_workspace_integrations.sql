-- Server-only OAuth connection storage for Google Workspace and future providers.
-- Browser users receive connection status only; refresh tokens remain encrypted
-- and are accessible solely through the trusted CRM server.

create table if not exists public.crm_oauth_connections (
  company_state_id text not null,
  provider text not null,
  crm_user_id text not null,
  crm_email text not null,
  provider_email text not null,
  provider_subject text not null,
  encrypted_refresh_token text not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (company_state_id, provider, crm_email),
  constraint crm_oauth_provider_check check (provider in ('google', 'zoho')),
  constraint crm_oauth_email_check check (
    crm_email = lower(crm_email) and provider_email = lower(provider_email)
    and length(crm_email) between 3 and 254 and length(provider_email) between 3 and 254
  ),
  constraint crm_oauth_token_check check (
    revoked_at is not null or encrypted_refresh_token ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  )
);

alter table public.crm_oauth_connections enable row level security;

-- No authenticated/anonymous policies by design. The Render server uses its
-- server-only Supabase secret to read and write these rows.
revoke all on table public.crm_oauth_connections from anon, authenticated;
grant all on table public.crm_oauth_connections to service_role;

create index if not exists crm_oauth_connections_active_idx
  on public.crm_oauth_connections (company_state_id, provider, crm_email)
  where revoked_at is null;

comment on table public.crm_oauth_connections is
  'Encrypted OAuth refresh tokens used only by the trusted JobCrest server.';
