-- =============================================================================
-- Purchase (optional PO, partial receipt, GST input credit, return), service
-- bill, sales order → partial dispatch → customer bill (Tally) → receipt with
-- TDS / less amount / debit note (bill register Q-23), partial payment,
-- contra transfers, journal, trial balance balanced, P&L, balance sheet.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('ACC-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

-- ------------------------------------------------ masters (admin)
select test.login(test.id('admin'));
insert into public.parties (company_id, code, name) values (test.id('company'), 'CITY', 'CITY') returning id as v \gset sup_
insert into public.party_roles values (:'sup_v', 'SUPPLIER');
insert into public.parties (company_id, code, name) values (test.id('company'), 'DMART', 'D-MART') returning id as v \gset cust_
insert into public.party_roles values (:'cust_v', 'CUSTOMER');
insert into public.party_addresses (party_id, address_type, code, name) values (:'cust_v', 'SHIP_TO', 'BHIWANDI', 'D-Mart DC Bhiwandi')
returning id as v \gset dc_
insert into public.parties (company_id, code, name) values (test.id('company'), 'ABHISHEK', 'ABHISHEK CUTTING') returning id as v \gset cut_
insert into public.party_roles values (:'cut_v', 'CUTTER');
insert into public.accounts (company_id, code, name, account_type, sub_type, parent_id)
values (test.id('company'), '2131', 'Current Axis Bank', 'ASSET', 'BANK',
        (select id from public.accounts where company_id = test.id('company') and code = '2130')) returning id as v \gset axis_
insert into public.accounts (company_id, code, name, account_type, sub_type, parent_id)
values (test.id('company'), '2132', 'Current ICICI Bank', 'ASSET', 'BANK',
        (select id from public.accounts where company_id = test.id('company') and code = '2130')) returning id as v \gset icici_
select id as v from public.accounts where company_id = test.id('company') and system_key = 'CASH' \gset cash_
select id as v from public.voucher_books where company_id = test.id('company') and code = 'MAIN' \gset book_

-- capital introduced into the bank (journal voucher)
select test.eq(public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'voucher_type', 'JOURNAL', 'book_id', :'book_v',
  'lines', jsonb_build_array(
     jsonb_build_object('account_id', :'axis_v', 'debit', 1000000),
     jsonb_build_object('account_id', (select id from public.accounts where company_id = test.id('company') and system_key = 'CAPITAL'),
                        'credit', 1000000)))))->>'status', 'POSTED', 'Journal voucher posted');
select test.throws(format($$ select public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-01', 'voucher_type', 'JOURNAL', 'book_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('account_id', %L, 'debit', 10),
                             jsonb_build_object('account_id', %L, 'credit', 9))))) $$,
  test.id('company'), :'book_v', :'axis_v', :'cash_v'), '%not balanced%', 'Unbalanced journal rejected');

-- ------------------------------------------------ purchase: PO 100 MTR, receive 60 + 40, 5% GST
select test.login(test.id('operator'));
insert into t values ('po', public.doc_save('PURCHASE_ORDER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-02', 'party_id', :'sup_v',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 100, 'unit_id', test.id('mtr'), 'rate', 200)))));
select public.doc_submit('PURCHASE_ORDER', (select v from t where k = 'po'));
insert into t select 'poline', id from public.purchase_order_lines where order_id = (select v from t where k = 'po');

create or replace function pg_temp.purchase(p_qty numeric, p_po boolean) returns jsonb language sql as $$
  select public.doc_submit('PURCHASE_RECEIPT', public.doc_save('PURCHASE_RECEIPT', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', '2026-09-03', 'party_id', (select id from public.parties where code = 'CITY' and company_id = test.id('company')),
    'godown_id', test.id('rm_godown'), 'supplier_bill_no', 'C-1',
    'lines', jsonb_build_array(jsonb_build_object('po_line_id', case when p_po then (select v from t where k = 'poline') end,
       'item_id', test.id('rm'), 'qty', p_qty, 'unit_id', test.id('mtr'), 'rate', 200, 'gst_rate', 5)))))
$$;
insert into t select 'pr1', (pg_temp.purchase(60, true)->>'id')::uuid;
set constraints all immediate; set constraints all deferred;
select test.eq((select row(taxable_amount, gst_amount, total_amount)::text from public.purchase_receipts where id = (select v from t where k = 'pr1')),
               '(12000.00,600.00,12600.00)', 'GST split: taxable 12000 + 5% = 12600');
select test.eq((select status::text from public.purchase_orders where id = (select v from t where k = 'po')),
               'PARTIALLY_RECEIVED', 'RM PO partially received');
select test.throws($$ select pg_temp.purchase(41, true) $$, '%more than pending%', 'RM PO over-receipt rejected');
select pg_temp.purchase(40, true);
select test.eq((select status::text from public.purchase_orders where id = (select v from t where k = 'po')),
               'FULLY_RECEIVED', 'RM PO fully received');
select test.eq(pg_temp.purchase(10, false)->>'status', 'POSTED', 'Direct purchase without PO (Q-16)');
set constraints all immediate; set constraints all deferred;
select test.eq((select payable_balance from public.v_party_balances where party_id = :'sup_v'),
               23100.00::numeric, 'Supplier payable 110 MTR × 200 + 5%');
select test.eq(public.suggest_rate(test.id('company'), 'PURCHASE', :'sup_v', test.id('rm'), test.id('rm_godown')),
               200.0000::numeric(14,4), 'Last purchase rate suggested');

-- purchase return 5 MTR
select public.doc_submit('PURCHASE_RETURN', public.doc_save('PURCHASE_RETURN', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-04', 'party_id', :'sup_v', 'godown_id', test.id('rm_godown'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 5, 'unit_id', test.id('mtr'), 'rate', 200, 'gst_rate', 5)))));
set constraints all immediate; set constraints all deferred;
select test.eq((select payable_balance from public.v_party_balances where party_id = :'sup_v'),
               22050.00::numeric, 'Purchase return reduces payable by 1050');
select test.eq((select base_qty from public.stock_balances where item_id = test.id('rm') and godown_id = test.id('rm_godown')),
               105.000::numeric(16,3), 'RM stock 110 − 5 = 105 MTR');

-- cutting bill (Q-14)
select public.doc_submit('SERVICE_BILL', public.doc_save('SERVICE_BILL', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-05', 'bill_type', 'CUTTING', 'party_id', :'cut_v',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', 50, 'rate', 4.5)))));
set constraints all immediate; set constraints all deferred;
select test.eq((select payable_balance from public.v_party_balances where party_id = :'cut_v'),
               225.00::numeric, 'Cutting bill → cutter payable (purchase ledger)');

-- documents cannot be written directly (only through the RPCs)
select test.throws(format($$ insert into public.stock_adjustments (company_id, doc_date, godown_id, reason, status)
                             values (%L, '2026-09-01', %L, 'OPENING', 'POSTED') $$, test.id('company'), test.id('b336')),
                   'permission denied%', 'Direct insert into a document table is refused');

-- ------------------------------------------------ opening FG stock (admin)
select test.login(test.id('admin'));
select public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-01', 'godown_id', test.id('b336'), 'reason', 'OPENING',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'direction', 1, 'qty', 100,
                                                'unit_id', test.id('box'), 'rate', 190)))));

-- ------------------------------------------------ sales: D-Mart PO 94 box, dispatch 40 + 54
select test.login(test.id('operator'));
insert into t values ('so', public.doc_save('SALES_ORDER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-05', 'party_id', :'cust_v', 'ship_to_address_id', :'dc_v',
  'customer_po_no', '5003072470', 'delivery_date', '2026-09-30',
  'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 94, 'unit_id', test.id('box'))))));
select public.doc_submit('SALES_ORDER', (select v from t where k = 'so'));
insert into t select 'soline', id from public.sales_order_lines where order_id = (select v from t where k = 'so');

create or replace function pg_temp.dispatch(p_box numeric) returns jsonb language sql as $$
  select public.doc_submit('DISPATCH', public.doc_save('DISPATCH', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', '2026-09-20', 'sales_order_id', (select v from t where k = 'so'),
    'godown_id', test.id('b336'),
    'lines', jsonb_build_array(jsonb_build_object('order_line_id', (select v from t where k = 'soline'),
       'item_id', test.id('fg'), 'qty', p_box, 'unit_id', test.id('box'))))))
$$;
insert into t select 'd1', (pg_temp.dispatch(40)->>'id')::uuid;
select test.eq((select status::text from public.sales_orders where id = (select v from t where k = 'so')),
               'PARTIALLY_DISPATCHED', 'Partial dispatch allowed (Q-21)');
select test.eq((select pending_pack_qty from public.v_sales_order_lines where order_line_id = (select v from t where k = 'soline')),
               54.000::numeric, 'Pending 54 box');
select test.throws($$ select pg_temp.dispatch(55) $$, '%more than pending%', 'Dispatch above pending rejected');
select test.eq(pg_temp.dispatch(54)->>'status', 'POSTED', 'Second dispatch 54 box');
select test.eq((select status::text from public.sales_orders where id = (select v from t where k = 'so')),
               'DISPATCHED', 'Order fully dispatched');
select test.eq((select base_qty from public.stock_balances where item_id = test.id('fg') and godown_id = test.id('b336')),
               108.000::numeric(16,3), 'FG stock 1800 − 1692 = 108 pair');

-- date revision (Q-22)
select public.sales_order_revise_date((select v from t where k = 'so'), 'DELIVERY_DATE', date '2026-10-05', 'D-Mart appointment moved');
select test.ok((select is_revised from public.v_sales_order_lines where order_id = (select v from t where k = 'so') limit 1),
               'Order shows as revised');
select test.eq((select old_date from public.sales_order_date_revisions where sales_order_id = (select v from t where k = 'so')),
               date '2026-09-30', 'Old delivery date kept in history');

-- ------------------------------------------------ customer bill from Tally, linked to both dispatches (Q-24)
insert into t values ('bill', public.doc_save('CUSTOMER_BILL', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-21', 'bill_no', 'T/26-27/070', 'party_id', :'cust_v',
  'ship_to_address_id', :'dc_v', 'amount', 1037761.20,
  'lines', jsonb_build_array(jsonb_build_object('dispatch_id', (select v from t where k = 'd1')),
                             jsonb_build_object('sales_order_id', (select v from t where k = 'so'))))));
select test.eq(public.doc_submit('CUSTOMER_BILL', (select v from t where k = 'bill'))->>'doc_no', 'T/26-27/070',
               'Bill recorded with the Tally number');
set constraints all immediate; set constraints all deferred;
select test.throws(format($$ select public.doc_save('CUSTOMER_BILL', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-21', 'bill_no', 't/26-27/070', 'party_id', %L, 'amount', 1)) $$,
  test.id('company'), :'cust_v'), '%customer_bills_no_uq%', 'Duplicate bill number rejected');

-- receipt: 1,036,772.66 received + 988.34 TDS; register shows less amount −0.20
select test.eq(public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-27', 'voucher_type', 'RECEIPT', 'book_id', :'book_v',
  'cash_bank_account_id', :'axis_v', 'party_id', :'cust_v', 'amount', 1036772.66, 'instrument', 'NEFT')) is not null,
  true, 'Receipt draft saved');
insert into t select 'rcpt', id from public.vouchers where company_id = test.id('company') and voucher_type = 'RECEIPT';
select public.voucher_set_allocations((select v from t where k = 'rcpt'), jsonb_build_array(jsonb_build_object(
  'bill_table', 'customer_bills', 'bill_id', (select v from t where k = 'bill'),
  'amount', 1036772.66, 'tds_amount', 988.34, 'short_amount', 0.20)));
select public.doc_submit('VOUCHER', (select v from t where k = 'rcpt'));
set constraints all immediate; set constraints all deferred;
select test.eq((select row(place, amount, tds, amount_received, less_amount, outstanding)::text
                from public.v_customer_bill_register where bill_id = (select v from t where k = 'bill')),
               '(BHIWANDI,1037761.20,988.34,1036772.66,-0.20,0.00)',
               'Bill register row exactly like the sheet: TDS, received, less amount, outstanding 0');
select test.eq((select receivable_balance from public.v_party_balances where party_id = :'cust_v'),
               0.00::numeric, 'D-Mart fully settled');
select test.eq((select sum(debit - credit) from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
                where a.system_key = 'TDS_RECEIVABLE' and l.company_id = test.id('company')),
               988.34::numeric, 'TDS booked to TDS Receivable');
select test.throws(format($$ select public.doc_cancel('CUSTOMER_BILL', %L, 'x') $$, (select v from t where k = 'bill')),
                   'Permission denied%', 'Operator cannot cancel a bill');

-- ------------------------------------------------ partial payment to supplier (spec §26)
insert into t values ('pay', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-28', 'voucher_type', 'PAYMENT', 'book_id', :'book_v',
  'cash_bank_account_id', :'axis_v', 'party_id', :'sup_v', 'amount', 10000)));
select public.voucher_set_allocations((select v from t where k = 'pay'), jsonb_build_array(jsonb_build_object(
  'bill_table', 'purchase_receipts', 'bill_id', (select v from t where k = 'pr1'), 'amount', 10000)));
select public.doc_submit('VOUCHER', (select v from t where k = 'pay'));
set constraints all immediate; set constraints all deferred;
select test.eq((select outstanding_amount from public.v_bill_outstanding where bill_id = (select v from t where k = 'pr1')),
               2600.00::numeric, 'Bill 12,600 − payment 10,000 = 2,600 outstanding');
select test.throws(format($$ select public.voucher_set_allocations(%L, '[]') $$, (select v from t where k = 'pay')),
                   '%can no longer be edited%', 'Posted voucher allocations cannot be changed');

-- allocated bill cannot be cancelled (approver)
select test.login(test.id('approver'));
select test.throws(format($$ select public.doc_cancel('PURCHASE_RECEIPT', %L, 'wrong') $$, (select v from t where k = 'pr1')),
                   '%settled by a payment%', 'Settled bill cannot be cancelled before its voucher');

-- ------------------------------------------------ contra (spec §27)
select test.login(test.id('operator'));
select public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-28', 'voucher_type', 'CONTRA', 'book_id', :'book_v',
  'cash_bank_account_id', :'axis_v', 'to_account_id', :'icici_v', 'amount', 100000)));
select public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-28', 'voucher_type', 'CONTRA', 'book_id', :'book_v',
  'cash_bank_account_id', :'icici_v', 'to_account_id', :'cash_v', 'amount', 5000)));
-- expense payment without party (Q-31)
select public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-28', 'voucher_type', 'PAYMENT', 'book_id', :'book_v',
  'cash_bank_account_id', :'cash_v',
  'counter_account_id', (select id from public.accounts where company_id = test.id('company') and system_key = 'BANK_CHARGES'),
  'amount', 150)));
set constraints all immediate; set constraints all deferred;
select test.eq((select balance from public.account_ledger(test.id('company'), :'icici_v', date '2026-04-01', date '2027-03-31')
                order by entry_date desc, entry_no desc nulls last limit 1),
               95000.00::numeric, 'ICICI: +100000 from Axis − 5000 to cash');
select test.eq((select balance from public.account_ledger(test.id('company'), :'cash_v', date '2026-04-01', date '2027-03-31')
                order by entry_date desc, entry_no desc nulls last limit 1),
               4850.00::numeric, 'Cash: +5000 − 150 expense');
select test.throws(format($$ select public.doc_submit('VOUCHER', public.doc_save('VOUCHER', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-28', 'voucher_type', 'CONTRA', 'book_id', %L,
  'cash_bank_account_id', %L, 'to_account_id', %L, 'amount', 1))) $$,
  test.id('company'), :'book_v', :'axis_v', :'axis_v'), '%must be different%', 'Contra to the same account rejected');

-- ------------------------------------------------ books: trial balance, P&L, balance sheet
select test.eq((select sum(debit) = sum(credit) from public.trial_balance(test.id('company'), date '2027-03-31')),
               true, 'Trial balance is balanced');
select test.eq((select count(*) from public.journal_entries e
                where e.company_id = test.id('company')
                  and (select sum(debit) - sum(credit) from public.journal_entry_lines where journal_entry_id = e.id) <> 0)::int,
               0, 'Every journal entry balances');
select test.ok((select amount from public.profit_loss(test.id('company'), date '2026-04-01', date '2027-03-31')
                where section = 'RESULT') is not null, 'P&L computes a result');
select test.eq((select sum(case when section = 'ASSET' then amount else -amount end)
                from public.balance_sheet(test.id('company'), date '2027-03-31')),
               0.00::numeric, 'Balance sheet balances (assets = liabilities + equity + profit)');
select test.ok(exists (select 1 from public.day_book(test.id('company'), date '2026-09-01', date '2026-09-30')),
               'Day book returns entries');

rollback;
