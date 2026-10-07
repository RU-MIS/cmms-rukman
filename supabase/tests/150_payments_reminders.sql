-- =============================================================================
-- INVENTORY MVP tests: 26 customer payment reminder · 27 partial payment ·
-- 28 reminder stops after full payment · 29 vendor payment reminder (to
-- internal roles) · payment methods · contra transfers · one payment → many
-- invoices · one invoice → many payments · reminder OFF generates nothing.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('REM-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'CUST-A', 'CUSTOMER', 'ap@cust-a.test') as v \gset ca_
update public.parties set credit_days = 50 where id = :'ca_v';
select test.party(test.id('company'), 'VEND-A', 'SUPPLIER', 'ar@vend-a.test') as v \gset va_
update public.parties set credit_days = 30 where id = :'va_v';
select test.user_with_role(test.id('company'), 'ACCOUNTANT') as v \gset acc_
select test.portal_user(test.id('company'), :'ca_v', 'CUSTOMER') as v \gset pca_
update public.company_settings set customer_portal_enabled = true, email_automation = true where company_id = test.id('company');

select test.login(test.id('admin'));
insert into public.accounts (company_id, code, name, account_type, sub_type, parent_id)
values (test.id('company'), '2131', 'HDFC Bank', 'ASSET', 'BANK',
        (select id from public.accounts where company_id = test.id('company') and code = '2130')) returning id as v \gset hdfc_
insert into public.accounts (company_id, code, name, account_type, sub_type, parent_id)
values (test.id('company'), '2132', 'SBI Bank', 'ASSET', 'BANK',
        (select id from public.accounts where company_id = test.id('company') and code = '2130')) returning id as v \gset sbi_
select id as v from public.accounts where company_id = test.id('company') and system_key = 'CASH' \gset cash_
select id as v from public.voucher_books where company_id = test.id('company') and code = 'MAIN' \gset book_

-- invoices (recorded from Tally) — due date = bill date + 50 credit days
select test.login(:'acc_v');
create or replace function pg_temp.bill(p_no text, p_date date, p_amount numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.doc_save('CUSTOMER_BILL', jsonb_build_object('company_id', test.id('company'), 'doc_date', p_date,
         'bill_no', p_no, 'party_id', (select id from public.parties where code = 'CUST-A' and company_id = test.id('company')),
         'amount', p_amount));
  perform public.doc_submit('CUSTOMER_BILL', v);
  return v;
end $$;
create or replace function pg_temp.receipt(p_amount numeric, p_alloc jsonb, p_method text default 'BANK',
                                           p_account uuid default null) returns jsonb language plpgsql as $$
declare v uuid;
begin
  v := public.doc_save('VOUCHER', jsonb_build_object('company_id', test.id('company'), 'doc_date', '2026-10-01',
         'voucher_type', 'RECEIPT', 'book_id', (select id from public.voucher_books where company_id = test.id('company') and code = 'MAIN'),
         'cash_bank_account_id', coalesce(p_account, (select id from public.accounts where company_id = test.id('company') and code = '2131')),
         'party_id', (select id from public.parties where code = 'CUST-A' and company_id = test.id('company')),
         'amount', p_amount, 'payment_method', p_method, 'instrument_ref', 'UTR-' || p_amount));
  perform public.voucher_set_allocations(v, p_alloc);
  return public.doc_submit('VOUCHER', v);
end $$;
insert into t values ('b1', pg_temp.bill('T/070', '2026-09-10', 100000));
select test.eq((select due_date from public.customer_bills where id = (select v from t where k = 'b1')), date '2026-10-30',
               'Due date = bill date + customer credit days (30 October)');

-- ------------------------------------------------ reminders OFF (default) → nothing
select test.login(null);
select test.eq((public.run_payment_reminders(date '2026-10-20')->>'customer_reminders')::int, 0, 'Reminder OFF: nothing generated');

-- ------------------------------------------------ 26: start 15 days before due, daily
update public.company_settings set customer_reminder_enabled = true, customer_reminder_start_days = 15,
       customer_reminder_frequency = 'DAILY' where company_id = test.id('company');
select test.eq((public.run_payment_reminders(date '2026-10-14')->>'customer_reminders')::int, 0, '14 Oct: before the start date');
select test.eq((public.run_payment_reminders(date '2026-10-15')->>'customer_reminders')::int, 1, '15 Oct: reminder starts');
select test.eq((public.run_payment_reminders(date '2026-10-15')->>'customer_reminders')::int, 0, 'Only once per day');
select test.eq((select row(kind, to_emails::text, status::text)::text from public.email_outbox where kind = 'CUSTOMER_PAYMENT_REMINDER'),
               '(CUSTOMER_PAYMENT_REMINDER,{ap@cust-a.test},QUEUED)', 'Reminder email queued to the customer');
select test.ok((select body_text like '%Outstanding: ₹1,00,000.00%' or body_text like '%Outstanding: ₹100,000.00%'
                from public.email_outbox where kind = 'CUSTOMER_PAYMENT_REMINDER'), 'Reminder shows the outstanding amount');
select test.eq((public.run_payment_reminders(date '2026-10-16')->>'customer_reminders')::int, 1, '16 Oct: daily reminder again');

-- ------------------------------------------------ 27: partial payment → reminder continues with new outstanding
select test.login(:'acc_v');
select pg_temp.receipt(40000, jsonb_build_array(jsonb_build_object('bill_table', 'customer_bills',
                                                'bill_id', (select v from t where k = 'b1'), 'amount', 40000)), 'UPI');
set constraints all immediate; set constraints all deferred;
select test.eq((select outstanding_amount from public.v_bill_outstanding where bill_id = (select v from t where k = 'b1')),
               60000.00::numeric, 'Invoice 100000 − paid 40000 = outstanding 60000');
select test.login(null);
select test.eq((public.run_payment_reminders(date '2026-10-17')->>'customer_reminders')::int, 1, 'Reminder continues after partial payment');
select test.eq((select outstanding_amount from public.payment_reminders where reminder_date = '2026-10-17'), 60000.00::numeric,
               'Reminder uses the new outstanding 60000');

-- ------------------------------------------------ 28: full payment → reminder stops, queued ones cancelled
select test.login(:'acc_v');
select pg_temp.receipt(60000, jsonb_build_array(jsonb_build_object('bill_table', 'customer_bills',
                                                'bill_id', (select v from t where k = 'b1'), 'amount', 60000)), 'CHEQUE');
set constraints all immediate; set constraints all deferred;
select test.eq((select outstanding_amount from public.v_bill_outstanding where bill_id = (select v from t where k = 'b1')),
               0.00::numeric, 'Outstanding 0');
select test.login(null);
select test.eq((select count(*) from public.email_outbox where kind = 'CUSTOMER_PAYMENT_REMINDER' and status = 'QUEUED')::int, 0,
               'Queued reminders of the paid invoice are cancelled');
select test.eq((public.run_payment_reminders(date '2026-10-18')->>'customer_reminders')::int, 0, 'No reminder for a fully paid invoice');
select test.eq((public.run_payment_reminders(date '2026-11-05')->>'customer_reminders')::int, 0, 'Not even after the due date');

-- worker double-check: reminder queued, then the bill gets paid before sending
insert into t values ('b2', null);
select test.login(:'acc_v');
update t set v = pg_temp.bill('T/071', '2026-09-20', 5000) where k = 'b2';
select test.login(null);
select test.eq((public.run_payment_reminders(date '2026-10-30')->>'customer_reminders')::int, 1, 'Reminder for T/071');
update public.email_outbox set status = 'CANCELLED' where kind <> 'CUSTOMER_PAYMENT_REMINDER';
-- simulate a payment recorded with no allocation trigger effect yet: allocate via receipt
select test.login(:'acc_v');
select pg_temp.receipt(5000, jsonb_build_array(jsonb_build_object('bill_table', 'customer_bills',
                                               'bill_id', (select v from t where k = 'b2'), 'amount', 5000)), 'CASH',
                       (select id from public.accounts where company_id = test.id('company') and system_key = 'CASH'));
select test.login(null);
select test.eq(jsonb_array_length(public.email_claim(10)), 0, 'Worker never sends a reminder for a paid invoice');

-- weekly frequency
update public.company_settings set customer_reminder_frequency = 'WEEKLY' where company_id = test.id('company');
select test.login(:'acc_v');
insert into t values ('b3', pg_temp.bill('T/072', '2026-09-25', 7000));
select test.login(null);
select test.eq((public.run_payment_reminders(date '2026-10-30')->>'customer_reminders')::int, 1, 'Weekly: first reminder');
select test.eq((public.run_payment_reminders(date '2026-11-02')->>'customer_reminders')::int, 0, 'Weekly: not again within 7 days');
select test.eq((public.run_payment_reminders(date '2026-11-06')->>'customer_reminders')::int, 1, 'Weekly: again after 7 days');
-- customer override: reminders OFF for this customer
insert into public.party_settings (party_id, payment_reminder_enabled) values (:'ca_v', false);
select test.eq((public.run_payment_reminders(date '2026-11-20')->>'customer_reminders')::int, 0, 'Customer override: no reminders');
delete from public.party_settings where party_id = :'ca_v';
-- payment reminder EMAIL switched off → nothing generated
update public.company_settings set payment_reminder_email = false where company_id = test.id('company');
select test.eq((public.run_payment_reminders(date '2026-11-20')->>'customer_reminders')::int, 0, 'Reminder email OFF: none generated');

-- ------------------------------------------------ 29: vendor payment reminder → internal users by role
select test.login(test.id('admin'));
insert into t values ('pr', public.doc_save('PURCHASE_RECEIPT', jsonb_build_object('company_id', test.id('company'),
  'doc_date', '2026-10-01', 'party_id', :'va_v', 'godown_id', test.id('rm_godown'), 'supplier_bill_no', 'VA-1',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 375, 'unit_id', test.id('mtr'), 'rate', 200)))));
select public.doc_submit('PURCHASE_RECEIPT', (select v from t where k = 'pr'));
set constraints all immediate; set constraints all deferred;
select test.login(null);
update public.company_settings set vendor_reminder_enabled = true, vendor_reminder_start_days = 10,
       vendor_reminder_roles = array['OWNER', 'ACCOUNTANT'] where company_id = test.id('company');
select test.eq((select due_date from public.purchase_receipts where id = (select v from t where k = 'pr')), date '2026-10-31',
               'Vendor bill due 31 October (30 credit days)');
select test.eq((public.run_payment_reminders(date '2026-10-20')->>'vendor_reminders')::int, 0, 'Vendor: before start');
select test.eq((public.run_payment_reminders(date '2026-10-21')->>'vendor_reminders')::int, 1, 'Vendor: reminder 10 days before due');
select test.eq((select row(recipient_type, cardinality(to_emails))::text from public.email_outbox where kind = 'VENDOR_PAYMENT_REMINDER'),
               '(INTERNAL,2)', 'Vendor reminder goes to internal Owner + Accounts, not to the vendor');
select test.ok(not exists (select 1 from public.email_outbox e where kind = 'VENDOR_PAYMENT_REMINDER'
                           and 'ar@vend-a.test' = any (e.to_emails)), 'Vendor itself is not emailed');
select test.ok((select subject like '%VEND-A%75,000.00%' from public.email_outbox where kind = 'VENDOR_PAYMENT_REMINDER'),
               'Subject names vendor and amount ₹75,000');

-- ------------------------------------------------ payment methods + contra
select test.login(:'acc_v');
select test.throws($$ select pg_temp.receipt(10, '[]', 'CASH') $$, 'Cash payments must use a cash account%',
                   'CASH method with a bank account is rejected');
create or replace function pg_temp.contra(p_from uuid, p_to uuid, p_amount numeric) returns text language sql as $$
  select public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object('company_id', test.id('company'),
    'doc_date', '2026-10-02', 'voucher_type', 'CONTRA',
    'book_id', (select id from public.voucher_books where company_id = test.id('company') and code = 'MAIN'),
    'cash_bank_account_id', p_from, 'to_account_id', p_to, 'amount', p_amount)))->>'status'
$$;
select test.eq(pg_temp.contra(:'hdfc_v', :'cash_v', 1000), 'POSTED', 'Contra Bank → Cash');
select test.eq(pg_temp.contra(:'cash_v', :'hdfc_v', 500), 'POSTED', 'Contra Cash → Bank');
select test.eq(pg_temp.contra(:'hdfc_v', :'sbi_v', 2000), 'POSTED', 'Contra Bank → Bank');

-- one payment → multiple invoices
insert into t values ('b4', pg_temp.bill('T/080', '2026-10-01', 3000));
insert into t values ('b5', pg_temp.bill('T/081', '2026-10-01', 4000));
select pg_temp.receipt(7000, jsonb_build_array(
  jsonb_build_object('bill_table', 'customer_bills', 'bill_id', (select v from t where k = 'b4'), 'amount', 3000),
  jsonb_build_object('bill_table', 'customer_bills', 'bill_id', (select v from t where k = 'b5'), 'amount', 4000)));
set constraints all immediate; set constraints all deferred;
select test.eq((select sum(outstanding_amount) from public.v_bill_outstanding
                where bill_id in ((select v from t where k = 'b4'), (select v from t where k = 'b5'))), 0.00::numeric,
               'One payment settled two invoices');
-- one invoice ← many payments (b1 had UPI 40000 + CHEQUE 60000)
select test.eq((select count(*) from public.v_payment_allocations where bill_id = (select v from t where k = 'b1'))::int, 2,
               'One invoice paid by two payments');
select test.eq((select string_agg(payment_method::text, ',' order by allocated_amount) from public.v_payment_allocations
                where bill_id = (select v from t where k = 'b1')), 'UPI,CHEQUE', 'Payment methods recorded');

-- customer portal: payments + outstanding
select test.login(:'pca_v');
select test.eq(jsonb_array_length(public.portal_my_payments(test.id('company'))), 4, 'Customer sees his 4 payments');
select test.eq((public.portal_my_outstanding(test.id('company'))->>'total_outstanding')::numeric, 7000.00::numeric,
               'Customer sees outstanding 7000 (T/072)');
select test.login(null);
update public.company_settings set customer_outstanding_visible = false where company_id = test.id('company');
select test.login(:'pca_v');
select test.eq((public.portal_my_outstanding(test.id('company'))->>'visible')::boolean, false, 'Outstanding hidden when not allowed');
select test.ok((public.portal_my_invoices(test.id('company'))->0->'outstanding') = 'null'::jsonb, 'Invoice outstanding hidden too');
rollback;
