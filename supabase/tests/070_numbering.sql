-- =============================================================================
-- Configurable numbering (spec §44, Q-37): patterns, padding, FY reset, and
-- numbers longer than the padding are never truncated.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('NUM-TEST'));
select test.login(null);

select test.eq(app.next_doc_no(test.id('company'), 'JOB_WORK_ORDER', date '2026-09-01'), 'GT-1', 'First number');
update public.document_sequence_counters set next_value = 9
 where company_id = test.id('company') and doc_type = 'JOB_WORK_ORDER';
select test.eq(app.next_doc_no(test.id('company'), 'JOB_WORK_ORDER', date '2026-09-01'), 'GT-9', 'Ninth number');
select test.eq(app.next_doc_no(test.id('company'), 'JOB_WORK_ORDER', date '2026-09-01'), 'GT-10',
               'GT-10 is not truncated to GT-1 (padding 1)');
select test.eq(app.next_doc_no(test.id('company'), 'PRODUCTION_LOT', date '2026-09-01'), 'GT 01', 'Lot format GT NN');
select test.eq(app.next_doc_no(test.id('company'), 'JOB_WORK_RECEIPT', date '2026-09-01'), 'JWR-2026-27/0001', 'FY pattern');
select test.eq(app.next_doc_no(test.id('company'), 'JOB_WORK_RECEIPT', date '2027-04-01'), 'JWR-2027-28/0001',
               'Numbering restarts in a new financial year');
select test.eq(app.next_doc_no(test.id('company'), 'JOB_WORK_RECEIPT', date '2027-03-31'), 'JWR-2026-27/0002',
               'Previous FY continues its own series');

update public.document_sequences set prefix = 'LOT/', pattern = '{PREFIX}{FY}-{NUMBER}', padding = 3
 where company_id = test.id('company') and doc_type = 'PRODUCTION_LOT';
select test.eq(app.next_doc_no(test.id('company'), 'PRODUCTION_LOT', date '2026-09-01'), 'LOT/2026-27-002',
               'Admin can change the lot number format');

select test.throws($$ select app.next_doc_no(test.id('company'), 'NOT_CONFIGURED', current_date) $$,
                   'Document numbering is not configured%', 'Unconfigured document type is rejected');

-- calendar-year company (fy_start_month = 1)
update public.companies set fy_start_month = 1 where id = test.id('company');
select test.eq(app.fy_code(test.id('company'), date '2026-09-01'), '2026', 'Calendar-year FY code');
rollback;
