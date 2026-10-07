-- =============================================================================
-- INVENTORY MVP tests: 21 document upload · 22 email enabled · 23 email
-- disabled · 24 customer invoice email · 25 vendor document email (PO PDF +
-- document) · email failure never fails the transaction · worker claim /
-- complete / retry with back-off · settings re-checked at send time.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('MAIL-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'VEND-A', 'SUPPLIER', 'orders@vend-a.test') as v \gset va_
select test.party(test.id('company'), 'VEND-NOMAIL', 'SUPPLIER') as v \gset vn_
select test.party(test.id('company'), 'CUST-A', 'CUSTOMER', 'accounts@cust-a.test; buyer@cust-a.test') as v \gset ca_
select test.user_with_role(test.id('company'), 'ACCOUNTANT') as v \gset acc_
select test.user_with_role(test.id('company'), 'PURCHASE') as v \gset buyer_
select test.portal_user(test.id('company'), :'ca_v', 'CUSTOMER') as v \gset pca_
update public.company_settings set customer_portal_enabled = true where company_id = test.id('company');

create or replace function pg_temp.po(p_party uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.doc_save('PURCHASE_ORDER', jsonb_build_object('company_id', test.id('company'), 'doc_date', '2026-09-01',
         'party_id', p_party, 'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 100,
         'unit_id', test.id('mtr'), 'rate', 200))));
  perform public.doc_submit('PURCHASE_ORDER', v);
  return v;
end $$;

-- ------------------------------------------------ 23: email automation OFF (default) → nothing generated
select test.login(:'buyer_v');
insert into t values ('po0', pg_temp.po(:'va_v'));
select test.eq((select count(*) from public.email_outbox)::int, 0, 'Email automation OFF by default: no email generated');

-- ------------------------------------------------ 22: email automation ON → vendor PO email queued
select test.login(test.id('admin'));
update public.company_settings set email_automation = true where company_id = test.id('company');
select test.login(:'buyer_v');
insert into t values ('po1', pg_temp.po(:'va_v'));
select test.eq((select row(kind, status::text, to_emails::text)::text from public.email_outbox
                where entity_id = (select v from t where k = 'po1')),
               '(VENDOR_PO,QUEUED,{orders@vend-a.test})', 'Vendor PO email queued to the vendor');
select test.eq((select attachments from public.email_outbox where entity_id = (select v from t where k = 'po1')),
               jsonb_build_array(jsonb_build_object('po_pdf', (select v from t where k = 'po1'))), 'PO PDF attached');

-- a vendor without an email address: the PO is still confirmed, email shows FAILED with a clear error
insert into t values ('po2', pg_temp.po(:'vn_v'));
select test.eq((select status::text from public.purchase_orders where id = (select v from t where k = 'po2')), 'OPEN',
               'PO confirmed even though the email cannot be sent');
select test.eq((select row(status::text, last_error)::text from public.email_outbox where entity_id = (select v from t where k = 'po2')),
               '(FAILED,"No email address is set for VEND-NOMAIL")', 'Email failure recorded, transaction not failed');

-- ------------------------------------------------ 21 + 25: vendor document upload → PO PDF + document
select test.throws(format($$ select public.document_register(jsonb_build_object('company_id', %L, 'entity_type', 'purchase_order',
                            'entity_id', %L, 'category', 'PURCHASE_DOCUMENT', 'storage_path', 'other-company/x.pdf', 'file_name', 'x.pdf')) $$,
                          test.id('company'), (select v from t where k = 'po1')),
                   '%company folder%', 'Upload outside the company folder rejected');
insert into t values ('doc1', (public.document_register(jsonb_build_object(
  'company_id', test.id('company'), 'entity_type', 'purchase_order', 'entity_id', (select v from t where k = 'po1'),
  'category', 'PURCHASE_DOCUMENT', 'storage_path', test.id('company') || '/purchase_order/abc-specs.pdf',
  'file_name', 'specs.pdf', 'mime_type', 'application/pdf', 'size_bytes', 1234))->>'document_id')::uuid);
select test.eq((select row(entity_type, party_id::text, uploaded_by::text)::text from public.documents where id = (select v from t where k = 'doc1')),
               format('(purchase_order,%s,%s)', :'va_v', :'buyer_v'), 'Document metadata saved and linked to the PO + vendor');
select test.eq((select row(kind, status::text)::text from public.email_outbox where document_id = (select v from t where k = 'doc1')),
               '(VENDOR_DOCUMENT,QUEUED)', 'Vendor document email queued');
select test.eq((select attachments from public.email_outbox where document_id = (select v from t where k = 'doc1')),
               jsonb_build_array(jsonb_build_object('po_pdf', (select v from t where k = 'po1')),
                                 jsonb_build_object('document_id', (select v from t where k = 'doc1'))),
               'Email contains PO PDF + uploaded document');

-- vendor document email OFF → upload still succeeds, no email
select test.login(test.id('admin'));
update public.company_settings set vendor_document_email = false where company_id = test.id('company');
select test.login(:'buyer_v');
select test.ok((public.document_register(jsonb_build_object(
  'company_id', test.id('company'), 'entity_type', 'purchase_order', 'entity_id', (select v from t where k = 'po1'),
  'category', 'OTHER', 'storage_path', test.id('company') || '/purchase_order/def-note.pdf', 'file_name', 'note.pdf'))->>'email_id') is null,
  'Vendor document email OFF: document saved, no email');
select test.login(test.id('admin'));
update public.company_settings set vendor_document_email = true where company_id = test.id('company');

-- ------------------------------------------------ 24: customer invoice email (Tally PDF)
select test.login(:'acc_v');
insert into t values ('bill', public.doc_save('CUSTOMER_BILL', jsonb_build_object('company_id', test.id('company'),
  'doc_date', '2026-09-10', 'bill_no', 'T/26-27/070', 'party_id', :'ca_v', 'amount', 100000)));
select public.doc_submit('CUSTOMER_BILL', (select v from t where k = 'bill'));
insert into t values ('inv', (public.document_register(jsonb_build_object(
  'company_id', test.id('company'), 'entity_type', 'customer_bill', 'entity_id', (select v from t where k = 'bill'),
  'category', 'INVOICE', 'storage_path', test.id('company') || '/customer_bill/inv-070.pdf', 'file_name', 'T-26-27-070.pdf',
  'mime_type', 'application/pdf'))->>'document_id')::uuid);
select test.eq((select row(kind, status::text, to_emails::text)::text from public.email_outbox where document_id = (select v from t where k = 'inv')),
               '(CUSTOMER_INVOICE,QUEUED,"{accounts@cust-a.test,buyer@cust-a.test}")', 'Invoice emailed to the customer addresses');
select test.ok((select subject like 'Invoice T/26-27/070%' from public.email_outbox where document_id = (select v from t where k = 'inv')),
               'Email names the invoice');
select test.ok((select visible_to_party from public.documents where id = (select v from t where k = 'inv')),
               'Invoice PDF visible in the customer portal');
select test.login(:'pca_v');
select test.eq(public.portal_my_invoices(test.id('company'))->0->'documents'->0->>'file_name', 'T-26-27-070.pdf',
               'Customer sees his invoice PDF');

-- customer invoice email OFF / customer override OFF
select test.login(test.id('admin'));
insert into public.party_settings (party_id, email_enabled) values (:'ca_v', false);
select test.login(:'acc_v');
select test.ok((public.document_register(jsonb_build_object(
  'company_id', test.id('company'), 'entity_type', 'customer_bill', 'entity_id', (select v from t where k = 'bill'),
  'category', 'INVOICE', 'storage_path', test.id('company') || '/customer_bill/inv-070-v2.pdf', 'file_name', 'v2.pdf'))->>'email_id') is null,
  'Customer email override OFF: no invoice email');
select test.login(test.id('admin'));
delete from public.party_settings where party_id = :'ca_v';

-- ------------------------------------------------ email worker: claim → send / fail → retry
select test.login(:'acc_v');
select test.throws($$ select public.email_claim(10) $$, 'permission denied%', 'Users cannot run the email worker API');
select test.login(null);   -- worker (service role / trusted)
select test.eq(jsonb_array_length(public.email_claim(10)), 3, 'Worker claims the 3 queued emails');
select test.eq((select count(*) from public.email_outbox where status = 'SENDING')::int, 3, 'Claimed emails are SENDING');
select test.eq(jsonb_array_length(public.email_claim(10)), 0, 'A second worker gets nothing (no double send)');

select public.email_complete(id, true, null, 'msg-' || id) from public.email_outbox where kind = 'CUSTOMER_INVOICE';
select test.eq((select status::text from public.email_outbox where kind = 'CUSTOMER_INVOICE'), 'SENT', 'Invoice email SENT');
select test.ok((select sent_at is not null and provider_message_id is not null from public.email_outbox where kind = 'CUSTOMER_INVOICE'),
               'Sent time + message id recorded');

select public.email_complete(id, false, 'SMTP 421 try later') from public.email_outbox where kind = 'VENDOR_PO' and status = 'SENDING';
select test.eq((select row(status::text, attempts, last_error)::text from public.email_outbox where kind = 'VENDOR_PO' and entity_id = (select v from t where k = 'po1')),
               '(QUEUED,1,"SMTP 421 try later")', 'Failed send is re-queued with the error');
select test.ok((select next_attempt_at > now() from public.email_outbox where kind = 'VENDOR_PO' and entity_id = (select v from t where k = 'po1')),
               'Retry is delayed (back-off)');
update public.email_outbox set attempts = 5, status = 'SENDING' where kind = 'VENDOR_PO' and entity_id = (select v from t where k = 'po1');
select public.email_complete(id, false, 'Mailbox unavailable') from public.email_outbox where kind = 'VENDOR_PO' and entity_id = (select v from t where k = 'po1');
select test.eq((select status::text from public.email_outbox where kind = 'VENDOR_PO' and entity_id = (select v from t where k = 'po1')),
               'FAILED', 'After max attempts the email is FAILED');
select test.ok((select count(*) >= 4 from public.email_events e join public.email_outbox o on o.id = e.outbox_id
                where o.kind = 'VENDOR_PO' and o.entity_id = (select v from t where k = 'po1')), 'Email history kept');

-- manual retry: picks up the corrected vendor address
update public.parties set email = 'new@vend-nomail.test' where id = :'vn_v';
select test.login(:'acc_v');
select public.email_retry(id) from public.email_outbox where entity_id = (select v from t where k = 'po2');
select test.eq((select row(status::text, to_emails::text)::text from public.email_outbox where entity_id = (select v from t where k = 'po2')),
               '(QUEUED,{new@vend-nomail.test})', 'Retry re-queues with the corrected address');

-- settings re-checked at send time: automation turned OFF → SKIPPED, nothing sent
select test.login(test.id('admin'));
update public.company_settings set email_automation = false where company_id = test.id('company');
select test.login(null);
select test.eq(jsonb_array_length(public.email_claim(10)), 0, 'Automation OFF: worker sends nothing');
select test.eq((select status::text from public.email_outbox where entity_id = (select v from t where k = 'po2')), 'SKIPPED',
               'Queued email SKIPPED because automation is OFF');

-- stale SENDING mail is reclaimed
update public.company_settings set email_automation = true where company_id = test.id('company');
update public.email_outbox set status = 'SENDING', claimed_at = now() - interval '1 hour'
 where kind = 'VENDOR_DOCUMENT' and document_id = (select v from t where k = 'doc1');
select test.eq(jsonb_array_length(public.email_claim(10)), 1, 'Email of a crashed worker is re-claimed');

-- internal log visible to accounts, not to portal users
select test.login(:'acc_v');
select test.ok((select count(*) from public.v_email_log) >= 4, 'Accounts sees the email log');
select test.login(:'pca_v');
select test.eq((select count(*) from public.email_outbox)::int, 0, 'Customer cannot read the email log');
select test.eq((select count(*) from public.documents)::int, 0, 'Customer cannot list documents directly');
rollback;
