const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const {
  normalizeStoredQuote, normalizeWebsiteLead, payloadHash, quoteServiceId,
  verifyWebsiteIntakeSignature, websiteIntakeIds,
} = require("../website-intake");

test("website signature is current, body-bound, and timing-safe", () => {
  const secret = "a".repeat(32);
  const timestamp = 1_800_000_000;
  const rawBody = JSON.stringify({ requestId: "request-1" });
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  assert.equal(verifyWebsiteIntakeSignature({ secret, timestamp, signature: `sha256=${signature}`, rawBody, now: timestamp * 1000 }), true);
  assert.equal(verifyWebsiteIntakeSignature({ secret, timestamp, signature, rawBody: `${rawBody} `, now: timestamp * 1000 }), false);
  assert.equal(verifyWebsiteIntakeSignature({ secret, timestamp, signature, rawBody, now: (timestamp + 301) * 1000 }), false);
});

test("website payload normalization preserves sales context and validates photos", () => {
  const lead = normalizeWebsiteLead({
    requestId: "site:42", name: "Home Owner", email: "Owner@Example.com", phone: "555-555-0199",
    address: "101 Main St", propertyType: "Commercial", division: "Construction", service: "Remodel / Addition",
    activeLeak: true, insuranceClaim: "yes", photos: ["https://cdn.example.com/leak.jpg"], notes: "Ceiling is wet.",
  }, new Date("2026-10-28T12:00:00Z"));
  assert.deepEqual({ division: lead.division, service: lead.service, urgency: lead.urgency, source: lead.source }, {
    division: "construction", service: "remodel-addition", urgency: "emergency", source: undefined,
  });
  assert.equal(lead.insuranceClaim, true);
  assert.equal(lead.email, "owner@example.com");
  assert.throws(() => normalizeWebsiteLead({ ...lead, requestId: "site:43", photos: ["http://unsafe.example/a.jpg"] }), /invalid_photo_url/);
  assert.equal(payloadHash(lead), payloadHash({ ...lead }));
  assert.match(websiteIntakeIds(lead.requestId).leadId, /^web_lead_[a-f0-9]{24}$/);
});

test("stored website quotes map to configured CRM divisions and services", () => {
  const quote = normalizeStoredQuote({
    id: "123e4567-e89b-42d3-a456-426614174000",
    created_at: "2026-10-29T12:30:00Z",
    segment: "commercial",
    division: "construction",
    services: ["Tenant improvements & build-outs"],
    urgency: "Just planning / budgeting",
    insurance_claim: "No",
    first_name: "Pat",
    last_name: "Manager",
    email: "pat@example.com",
    street: "100 Main St",
    city: "Bonita Springs",
    zip: "34135",
    photo_paths: ["123e4567-e89b-42d3-a456-426614174000/1-roof.jpg"],
  });
  assert.equal(quote.requestId, "quote:123e4567-e89b-42d3-a456-426614174000");
  assert.equal(quote.division, "construction");
  assert.equal(quote.service, "remodel-addition");
  assert.equal(quote.propertyType, "commercial");
  assert.match(quote.address, /Bonita Springs/);
  assert.deepEqual(quote.photoStoragePaths, ["123e4567-e89b-42d3-a456-426614174000/1-roof.jpg"]);
  assert.equal(quoteServiceId("services", ["Pressure washing & roof cleaning"]), "pressure-washing");
  assert.equal(quoteServiceId("roofing", ["Free roof inspection"]), "roof-inspection");
});

test("division migration is replay-safe and website requests are idempotent", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
      create function public.crm_base_state_id() returns text language sql stable set search_path='' as $$select 'coastal-crest'$$;
      create function public.is_coastal_crest_user() returns boolean language sql stable set search_path='' as $$select true$$;
      create function public.can_manage_team_crm() returns boolean language sql stable set search_path='' as $$select true$$;
      create function public.is_crm_admin() returns boolean language sql stable set search_path='' as $$select true$$;
      create table public.crm_user_access(user_id uuid primary key, approved boolean not null default true);
      create table public.crm_records(company_state_id text not null,record_type text not null,id text not null,lead_id text,job_id text,owner_id uuid,data jsonb not null default '{}'::jsonb,version integer not null default 1,deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),updated_by uuid,primary key(company_state_id,record_type,id));
      create table public.crm_audit_events(id text primary key,company_state_id text not null,lead_id text not null,job_id text,event_type text not null,actor_user_id uuid,actor_name text not null default '',message text not null default '',status text not null default '',metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
    `);
    const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261028031155_website_intake_and_division_foundation.sql"), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const payload = normalizeWebsiteLead({ requestId: "website-100", name: "Test Owner", email: "owner@example.com", address: "5 Ocean Ave", division: "services", service: "pressure-washing" });
    const ids = websiteIntakeIds(payload.requestId);
    const params = ["coastal-crest", payload.requestId, payloadHash(payload), ids.leadId, ids.jobId, null, JSON.stringify(payload)];
    const first = await db.query("select public.crm_ingest_website_request($1,$2,$3,$4,$5,$6::uuid,$7::jsonb) result", params);
    const second = await db.query("select public.crm_ingest_website_request($1,$2,$3,$4,$5,$6::uuid,$7::jsonb) result", params);
    assert.equal(first.rows[0].result.created, true);
    assert.equal(second.rows[0].result.created, false);
    const rows = await db.query("select record_type,data->>'status' status,data->>'source' source from public.crm_records order by record_type");
    assert.deepEqual(rows.rows.map((row) => [row.record_type, row.status]), [["contact", "Request"], ["job", "Request"]]);
    assert.equal(rows.rows[0].source, "Website");
  } finally {
    await db.close();
  }
});

test("lead and job forms expose division-aware fields without hardcoded single-pipeline saves", () => {
  const root = path.resolve(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(page, /name="division" data-division-select/);
  assert.match(page, /name="service" data-service-select/);
  assert.match(page, /name="propertyType"/);
  assert.match(page, /name="insuranceClaim"/);
  assert.match(app, /function populateDivisionFields/);
  assert.match(app, /pipelineStagesFor\(job\.division\)/);
  assert.match(app, /data-pipeline-division/);
  assert.match(app, /crm_pipeline_stages/);
});
