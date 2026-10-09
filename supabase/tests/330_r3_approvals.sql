-- =============================================================================
-- PLATFORM R3 — approval workflows (W3, D2)
--   multi-level rules with roles / permissions / thresholds, maker-checker,
--   same-approver rule, scope of the approver, mandatory rejection reason,
--   history + audit, inbox (with masked amounts), rate-change approval.
-- AC 3.1–3.7, 3.9, 3.10 (3.8: the R1 / R2 suite runs unchanged)
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('APPR-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.party(test.id('company'), 'V1', 'SUPPLIER') as v \gset v1_
select test.stock_in(test.id('company'), test.id('fg'), test.id('b336'), 500);
select test.stock_in(test.id('company'), test.id('fg'), test.id('warehouse'), 500);
update public.items set sale_price = 400 where id = test.id('fg');

-- roles: purchase manager (role-based level), rate approver, scoped transfer approver
select test.login(test.id('admin'));
insert into t values ('pm_role', public.role_save(test.id('company'), null, '{"code":"PURCHASE_MANAGER","name":"Purchase manager"}'));
select public.role_set_permissions((select v from t where k = 'pm_role'), array['purchase_order.view', 'items.view']);
insert into t values ('pm_nopo', public.role_save(test.id('company'), null, '{"code":"PM_NO_VIEW","name":"Approver without access"}'));
select public.role_set_permissions((select v from t where k = 'pm_nopo'), array['items.view']);
insert into t values ('rate_role', public.role_save(test.id('company'), null, '{"code":"RATE_APPROVER","name":"Rate approver"}'));
select public.role_set_permissions((select v from t where k = 'rate_role'), array['items.view', 'rates.approve', 'items.view_sale_rate', 'items.view_purchase_rate']);
insert into t values ('rate_req', public.role_save(test.id('company'), null, '{"code":"RATE_EDITOR","name":"Rate editor"}'));
select public.role_set_permissions((select v from t where k = 'rate_req'), array['items.view', 'items.edit', 'items.edit_rate', 'items.view_sale_rate', 'rates.view', 'rates.edit']);
insert into t values ('tr_role', public.role_save(test.id('company'), null, '{"code":"TRANSFER_APPROVER","name":"Transfer approver"}'));
select public.role_set_permissions((select v from t where k = 'tr_role'), array['stock_transfer.view', 'stock_transfer.approve', 'items.view', 'godowns.view']);
select test.login(null);
select test.user_with_role(test.id('company'), 'PURCHASE_MANAGER') as v \gset pm_
select test.user_with_role(test.id('company'), 'PURCHASE_MANAGER') as v \gset pm2_
select test.user_with_role(test.id('company'), 'PM_NO_VIEW') as v \gset nv_
select test.user_with_role(test.id('company'), 'RATE_APPROVER') as v \gset ra_
select test.user_with_role(test.id('company'), 'RATE_EDITOR') as v \gset re_
select test.user_with_role(test.id('company'), 'TRANSFER_APPROVER') as v \gset ta_
select test.login(test.id('admin'));
select public.user_set_scope(test.id('company'), :'ta_v', 'GODOWN', array[test.id('b336'), test.id('warehouse')]);

create or replace function pg_temp.po(p_qty numeric) returns uuid language sql as $$
  select (public.doc_submit('PURCHASE_ORDER', public.doc_save('PURCHASE_ORDER', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', current_date, 'party_id', (select id from public.parties where code = 'V1' and company_id = test.id('company')),
    'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('rm'), 'qty', p_qty, 'unit_id', test.id('mtr'), 'rate', 200)))))->>'id')::uuid
$$;
create or replace function pg_temp.status(p_id uuid) returns text language sql as $$
  select status::text from public.purchase_orders where id = p_id $$;

-- ------------------------------------------------------------ configuration (UI / API, no code change)
select test.login(test.id('operator'));
select test.throws(format($$ select public.approval_rules_save(%L, 'PURCHASE_ORDER', true, '[]') $$, test.id('company')),
                   '%settings_approvals.edit%', 'Approval rules need the Approvals section right');
select test.login(test.id('admin'));
select test.throws(format($$ select public.approval_rules_save(%L, 'PURCHASE_ORDER', true, '[{},{},{},{}]') $$, test.id('company')),
                   '%At most 3%', 'At most three levels');
select public.approval_rules_save(test.id('company'), 'PURCHASE_ORDER', true, jsonb_build_array(
  jsonb_build_object('approver_role_id', (select v from t where k = 'pm_role')),
  jsonb_build_object('approver_role_id', (select id from public.roles where company_id = test.id('company') and code = 'OWNER'), 'min_amount', 100000)));
select test.ok(exists (select 1 from public.audit_log where company_id = test.id('company') and table_name = 'approval_rules' and action = 'APPROVAL_RULES'),
               'Rule change audited');
select test.ok(exists (select 1 from jsonb_array_elements(public.approval_config(test.id('company'))) x
                       where x->>'doc_type' = 'PURCHASE_ORDER' and jsonb_array_length(x->'levels') = 2), 'Configuration lists the two levels');

-- ------------------------------------------------------------ AC-3.1: thresholds
select test.login(test.id('operator'));
insert into t values ('po_small', pg_temp.po(250));        -- 250 × 200 = 50,000
insert into t values ('po_big', pg_temp.po(1000));         -- 1000 × 200 = 2,00,000
select test.eq(pg_temp.status((select v from t where k = 'po_small')), 'PENDING_APPROVAL', 'PO of 50,000 waits for approval');
select test.eq(jsonb_array_length(app.approval_state('PURCHASE_ORDER', (select v from t where k = 'po_small'))->'levels'), 1,
               'PO of 50,000: one level applies');
select test.eq(jsonb_array_length(app.approval_state('PURCHASE_ORDER', (select v from t where k = 'po_big'))->'levels'), 2,
               'PO of 2,00,000: two levels apply');

-- AC-3.7: no inbox entries / refused without the role; AC-3.9: refused without access to the record
select test.eq(jsonb_array_length(public.approval_inbox(test.id('company'))), 0, 'Creator (not an approver) has an empty inbox');
select test.throws(format($$ select public.approval_approve('PURCHASE_ORDER', %L) $$, (select v from t where k = 'po_small')),
                   '%must be approved by role Purchase manager%', 'Operator refused (not the approver role)');
select test.login(:'nv_v');
select test.throws(format($$ select public.approval_approve('PURCHASE_ORDER', %L) $$, (select v from t where k = 'po_small')),
                   '%', 'User without the role and without PO access refused');
-- give the no-view user the role but not the view right: still refused (must be able to open the record)
select test.login(null);
insert into public.user_roles (user_id, company_id, role_id) values (:'nv_v', test.id('company'), (select v from t where k = 'pm_role'));
delete from public.user_roles where user_id = :'nv_v' and role_id = (select v from t where k = 'pm_nopo');
select test.login(test.id('admin'));
select public.user_set_overrides(test.id('company'), :'nv_v', '[{"permission_code":"purchase_order.view","effect":"DENY","reason":"test"}]');
select test.login(:'nv_v');
select test.throws(format($$ select public.approval_approve('PURCHASE_ORDER', %L) $$, (select v from t where k = 'po_small')),
                   '%purchase_order.view%', 'Approver role without access to purchase orders refused');

select test.login(:'pm_v');
select test.eq((select count(*) from jsonb_array_elements(public.approval_inbox(test.id('company'))) x
                where x->>'doc_type' = 'PURCHASE_ORDER')::int, 2, 'Purchase manager sees both POs in the inbox');
select test.ok((select bool_and(x->'amount' = 'null'::jsonb and not (x->'state' ? 'amount'))
                from jsonb_array_elements(public.approval_inbox(test.id('company'))) x),
               'Inbox hides the amount from an approver without the purchase-rate right (D3)');
select test.eq(public.approval_approve('PURCHASE_ORDER', (select v from t where k = 'po_small'), 'ok')->>'status', 'OPEN',
               'PO of 50,000 posts after one approval');
select test.eq(public.approval_approve('PURCHASE_ORDER', (select v from t where k = 'po_big'))->>'status', 'PENDING_APPROVAL',
               'PO of 2,00,000 still pending after level 1');
select test.eq(pg_temp.status((select v from t where k = 'po_big')), 'PENDING_APPROVAL', '... status stays PENDING_APPROVAL');
-- AC-3.5: same level twice / next level by the wrong role
select test.throws(format($$ select public.approval_approve('PURCHASE_ORDER', %L) $$, (select v from t where k = 'po_big')),
                   '%Level 2 must be approved by role Owner%', 'Level 1 approver cannot approve level 2');
select test.login(:'pm2_v');
select test.throws(format($$ select public.approval_approve('PURCHASE_ORDER', %L) $$, (select v from t where k = 'po_small')),
                   '%not waiting for approval%', 'An approved document cannot be approved again');
select test.login(test.id('admin'));
select test.ok((select x->'amount' <> 'null'::jsonb from jsonb_array_elements(public.approval_inbox(test.id('company'))) x
                where (x->>'id')::uuid = (select v from t where k = 'po_big')), 'Owner sees the amount in the inbox');
select test.eq(public.approval_approve('PURCHASE_ORDER', (select v from t where k = 'po_big'))->>'status', 'OPEN',
               'PO of 2,00,000 posts after level 2 (owner)');
-- AC-3.10: history + audit
select test.eq((select string_agg(decision || coalesce(':' || level_no, ''), ',' order by id) from public.approval_actions
                where doc_id = (select v from t where k = 'po_big')), 'SUBMITTED,APPROVED:1,APPROVED:2', 'Approval history per level');
select test.eq((select count(*) from public.audit_log where row_id = (select v from t where k = 'po_big')::text and action = 'APPROVE')::int, 2,
               'Each approval is in the audit log');
update public.approval_actions set comment = 'changed' where doc_id = (select v from t where k = 'po_big');
select test.ok(not exists (select 1 from public.approval_actions where comment = 'changed'), 'Approval history cannot be changed through the API');
select test.login(null);
select test.throws(format($$ delete from public.approval_actions where doc_id = %L $$, (select v from t where k = 'po_big')),
                   '%', 'Approval history is immutable even for the service role');
select test.login(test.id('admin'));

-- ------------------------------------------------------------ same approver on two levels
select public.approval_rules_save(test.id('company'), 'PURCHASE_ORDER', true, jsonb_build_array(
  jsonb_build_object('approver_permission', 'purchase_order.approve'),
  jsonb_build_object('approver_permission', 'purchase_order.approve')));
select test.login(test.id('operator'));
insert into t values ('po_two', pg_temp.po(10));
select test.login(test.id('approver'));
select public.approval_approve('PURCHASE_ORDER', (select v from t where k = 'po_two'));
select test.throws(format($$ select public.approval_approve('PURCHASE_ORDER', %L) $$, (select v from t where k = 'po_two')),
                   '%already approved another level%', 'The same person cannot approve two levels');
select test.login(test.id('admin'));
select test.eq(public.approval_approve('PURCHASE_ORDER', (select v from t where k = 'po_two'))->>'status', 'OPEN', 'A second person approves level 2');

-- ------------------------------------------------------------ AC-3.2: maker-checker
select public.approval_rules_save(test.id('company'), 'PURCHASE_ORDER', true, '[{"approver_permission":"purchase_order.approve"}]');
select test.login(test.id('approver'));
insert into t values ('po_own', pg_temp.po(5));
select test.throws(format($$ select public.approval_approve('PURCHASE_ORDER', %L) $$, (select v from t where k = 'po_own')),
                   '%cannot be approved by the user who created it%', 'Creator cannot approve his own PO');
select test.ok(not exists (select 1 from jsonb_array_elements(public.approval_inbox(test.id('company'))) x
                           where (x->>'id')::uuid = (select v from t where k = 'po_own')), 'Own document is not in the creator''s inbox');
select test.login(test.id('admin'));
select public.approval_rules_save(test.id('company'), 'PURCHASE_ORDER', true, '[{"approver_permission":"purchase_order.approve","allow_self":true}]');
select test.login(test.id('approver'));
select test.eq(public.approval_approve('PURCHASE_ORDER', (select v from t where k = 'po_own'))->>'status', 'OPEN',
               'Self-approval allowed when the rule says so');

-- ------------------------------------------------------------ AC-3.4: rejection
select test.login(test.id('admin'));
select public.approval_rules_save(test.id('company'), 'PURCHASE_ORDER', true, '[{"approver_permission":"purchase_order.approve"}]');
select test.login(test.id('operator'));
insert into t values ('po_rej', pg_temp.po(7));
select test.login(test.id('approver'));
select test.throws(format($$ select public.approval_reject('PURCHASE_ORDER', %L, '  ') $$, (select v from t where k = 'po_rej')),
                   '%reason is required%', 'Reject without a reason refused');
select test.throws(format($$ select public.doc_reject('PURCHASE_ORDER', %L, null) $$, (select v from t where k = 'po_rej')),
                   '%reason is required%', 'Old doc_reject also needs a reason');
select test.eq(public.approval_reject('PURCHASE_ORDER', (select v from t where k = 'po_rej'), 'Rate too high')->>'status', 'DRAFT',
               'Rejected PO returns to DRAFT');
select test.login(test.id('operator'));
select test.eq((select comment from public.approval_actions where doc_id = (select v from t where k = 'po_rej') and decision = 'REJECTED'),
               'Rate too high', 'Creator sees the rejection reason');
select test.login(test.id('admin'));
select test.ok(exists (select 1 from public.audit_log a, lateral app.audit_values(a.id) v
                       where a.row_id = (select v from t where k = 'po_rej')::text and a.action = 'REJECT'
                         and v.new_data->>'reason' = 'Rate too high'), 'Rejection reason in the audit log');
select test.login(test.id('operator'));
select test.eq(public.doc_submit('PURCHASE_ORDER', (select v from t where k = 'po_rej'))->>'status', 'PENDING_APPROVAL', 'Resubmitted: new round');
select test.eq(jsonb_array_length(public.approval_inbox(test.id('company'))), 0, 'Operator still has no inbox entries');

-- ------------------------------------------------------------ AC-3.3: approver scope
select test.login(test.id('admin'));
select public.approval_rules_save(test.id('company'), 'STOCK_TRANSFER', true, '[{"approver_permission":"stock_transfer.approve"}]');
create or replace function pg_temp.transfer(p_from uuid, p_to uuid) returns uuid language sql as $$
  select (public.doc_submit('STOCK_TRANSFER', public.doc_save('STOCK_TRANSFER', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', current_date, 'from_godown_id', p_from, 'to_godown_id', p_to,
    'lines', jsonb_build_array(jsonb_build_object('item_id', test.id('fg'), 'qty', 1, 'unit_id', test.id('pair'))))))->>'id')::uuid $$;
insert into t values ('tr_a', pg_temp.transfer(test.id('b336'), test.id('warehouse')));
insert into t values ('tr_b', pg_temp.transfer(test.id('warehouse'), test.id('rm_godown')));
select test.login(:'ta_v');
select test.eq((select string_agg(x->>'id', ',') from jsonb_array_elements(public.approval_inbox(test.id('company'))) x),
               (select v from t where k = 'tr_a')::text, 'Godown-scoped approver sees only the transfer inside his godowns');
select test.throws(format($$ select public.approval_approve('STOCK_TRANSFER', %L) $$, (select v from t where k = 'tr_b')),
                   '%', 'Approving a transfer outside the scope is refused');
select test.eq(public.approval_approve('STOCK_TRANSFER', (select v from t where k = 'tr_a'))->>'status', 'POSTED', 'In-scope transfer approved');

-- ------------------------------------------------------------ AC-3.6: rate-change approval
select test.login(test.id('admin'));
select public.settings_save(test.id('company'), 'approvals', '{"rate_change_approval": true}');
select test.login(:'re_v');
update public.items set sale_price = 555 where id = test.id('fg');
select test.ok((select sale_price is distinct from 555 from public.v_items where id = test.id('fg')), 'Price change not effective before approval');
select test.eq((select new_rate from public.rate_change_requests where item_id = test.id('fg') and status = 'PENDING'), 555.0000::numeric(14,4),
               'Pending rate change recorded');
select test.eq(public.party_rate_save(test.id('company'), jsonb_build_object('rate_type', 'SALE', 'item_id', test.id('fg'),
                 'party_id', (select id from public.parties where code = 'ALEEM' and company_id = test.id('company')), 'rate', 444))->>'status',
               'PENDING_APPROVAL', 'Party rate entry becomes a pending request');
select test.throws(format($$ select public.rate_change_decide(%L, true) $$,
                          (select id from public.rate_change_requests where item_id = test.id('fg') and kind = 'ITEM_PRICE')),
                   'Permission denied%', 'Requester cannot decide');
select test.login(:'ra_v');
select test.eq((select old_rate || ' → ' || new_rate from public.rate_change_requests where kind = 'ITEM_PRICE'),
               '400.0000 → 555.0000', 'Approver sees old vs new');
select test.throws(format($$ select public.rate_change_decide(%L, false, '') $$,
                          (select id from public.rate_change_requests where kind = 'PARTY_RATE')),
                   '%reason is required%', 'Rejecting a rate change needs a reason');
select public.rate_change_decide((select id from public.rate_change_requests where kind = 'PARTY_RATE'), false, 'Too low');
select public.rate_change_decide((select id from public.rate_change_requests where kind = 'ITEM_PRICE'), true);
select test.eq((select sale_price from public.v_items where id = test.id('fg')), 555.0000::numeric(14,4), 'Approved price is effective');
select test.ok((select requested_by = :'re_v'::uuid and approved_by = :'ra_v'::uuid from public.item_rate_history
                where item_id = test.id('fg') and rate_type = 'SALE' order by id desc limit 1), 'Rate history shows requester and approver');
select test.ok(not exists (select 1 from public.party_item_rates where rate = 444), 'Rejected party rate never written');
select test.login(test.id('admin'));
select test.eq((select string_agg(action, ',' order by id) from public.audit_log where table_name = 'rate_change_requests'),
               'REJECT,APPROVE', 'Rate decisions audited');
-- the owner / rates.approve holders change rates directly (no request)
update public.items set sale_price = 600 where id = test.id('fg');
select test.eq((select sale_price from public.v_items where id = test.id('fg')), 600.0000::numeric(14,4), 'Rate approvers change rates directly');
rollback;
