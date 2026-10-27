-- Cover foreign keys introduced by the native CRM integration migrations.
-- These indexes keep tag, custom-field, and refund joins predictable as data grows.
create index if not exists crm_custom_field_values_field_idx
  on public.crm_custom_field_values (company_state_id, field_id);

create index if not exists crm_record_tags_tag_idx
  on public.crm_record_tags (company_state_id, tag_id);

create index if not exists crm_refunds_invoice_idx
  on public.crm_refunds (company_state_id, invoice_id);
