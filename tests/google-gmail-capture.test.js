const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261027190000_google_gmail_capture.sql"), "utf8");

test("automatic Gmail capture is replay-safe and appends only new provider messages", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create function public.crm_base_state_id() returns text language sql stable as $$select 'coastal-crest'$$;
      create table public.crm_records(
        company_state_id text not null, record_type text not null, id text not null,
        data jsonb not null default '{}'::jsonb, deleted_at timestamptz, updated_at timestamptz not null default now(),
        primary key(company_state_id, record_type, id)
      );
    `);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(`insert into public.crm_records(company_state_id,record_type,id,data) values
      ('coastal-crest','job','job-1','{"emails":[{"provider":"gmail","providerMessageId":"old-1"}]}'::jsonb)`);
    const messages = [
      { id: "gmail_old", provider: "gmail", providerMessageId: "old-1", providerThreadId: "thread-1" },
      { id: "gmail_new", provider: "gmail", providerMessageId: "new-1", providerThreadId: "thread-1", direction: "inbound" },
    ];
    const first = await db.query("select public.crm_capture_gmail_messages($1,$2::jsonb) count", ["job-1", JSON.stringify(messages)]);
    const second = await db.query("select public.crm_capture_gmail_messages($1,$2::jsonb) count", ["job-1", JSON.stringify(messages)]);
    assert.equal(first.rows[0].count, 1);
    assert.equal(second.rows[0].count, 0);
    const saved = await db.query("select data->'emails' emails from public.crm_records where id='job-1'");
    assert.equal(saved.rows[0].emails.length, 2);
    assert.equal(saved.rows[0].emails[0].providerMessageId, "new-1");
  } finally { await db.close(); }
});
