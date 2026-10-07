-- =============================================================================
-- INVENTORY MVP tests (MASTER_BUILD_PROMPT §43):
--   1 multiple godowns · 2 consolidated stock · 3 rack/bin · 4 same item in
--   multiple locations · 6 stock transfer · 32 stock manipulation attempt
--   + negative stock OFF by default / ON from settings, item master fields,
--   item-specific packing, movement history.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('INV-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

-- ------------------------------------------------ setup (owner): godowns + racks
select test.login(null);
insert into public.godowns (company_id, code, name) values (test.id('company'), 'DEL', 'Delhi') returning id as v \gset del_
insert into public.godowns (company_id, code, name) values (test.id('company'), 'NOI', 'Noida') returning id as v \gset noi_
insert into public.godowns (company_id, code, name) values (test.id('company'), 'FAC', 'Factory') returning id as v \gset fac_
select test.ok((select count(*) = 1 from public.storage_locations where godown_id = :'del_v' and is_default),
               'Every new godown gets a default UNASSIGNED location');

select test.login(test.id('admin'));
insert into public.storage_locations (company_id, godown_id, rack, shelf, bin)
values (test.id('company'), :'del_v', 'b1', 'c', '123') returning id as v \gset l123_
select test.eq((select code from public.storage_locations where id = :'l123_v'), 'B1-C-123', 'Location shown as RACK-SHELF-BIN');
select test.location(test.id('company'), :'del_v', 'B1', 'C', '124') as v \gset l124_
select test.location(test.id('company'), :'noi_v', 'A2', 'B', '041') as v \gset l041_
select test.location(test.id('company'), :'fac_v', 'F1', 'A', '009') as v \gset l009_
select test.throws(format($$ insert into public.storage_locations (company_id, godown_id, rack, shelf, bin)
                            values (%L, %L, 'B1', 'C', '123') $$, test.id('company'), :'del_v'),
                   '%duplicate key%', 'Same rack/bin twice in one godown is rejected');

-- item master fields (§7)
insert into public.items (company_id, code, name, description, item_kind, base_unit_id, sales_unit_id,
                          purchase_unit_id, barcode, purchase_price, sale_price, min_stock, max_stock, reorder_level)
values (test.id('company'), 'BOLT-10', '10mm Bolt', 'Zinc plated 10mm bolt', 'RAW_MATERIAL', test.id('pcs'),
        test.id('pcs'), test.id('pcs'), '8901234567890', 100, 123, 500, 50000, 1000)
returning id as v \gset bolt_
select test.throws(format($$ insert into public.items (company_id, code, name, item_kind, base_unit_id, barcode)
                            values (%L, 'X', 'X', 'RAW_MATERIAL', %L, '8901234567890') $$, test.id('company'), test.id('pcs')),
                   '%duplicate key%', 'Barcode is unique per company');
select test.throws(format($$ update public.items set sales_unit_id = %L where id = %L $$, test.id('box'), :'bolt_v'),
                   '%packing%', 'Sales unit must be the base unit or have an item packing');

-- item-specific packing (§8): FG 18/box, FG2 36/box
select test.login(null);
select test.eq(app.unit_factor(test.id('fg'), test.id('box'), current_date), 18.000000::numeric, 'Item A: 1 box = 18 pairs');
select test.eq(app.unit_factor(test.id('fg2'), test.id('box'), current_date), 36.000000::numeric, 'Item B: 1 box = 36 pairs');
select test.eq(app.fmt_qty(test.id('fg'), 360, current_date), '20 BOX (360 PAIR)', 'Both units shown: 20 boxes / 360 pairs');

-- ------------------------------------------------ 1–4: stock IN into locations of several godowns
select test.login(test.id('operator'));
create or replace function pg_temp.stock_in(p_godown uuid, p_loc uuid, p_qty numeric) returns jsonb language sql as $$
  select public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
    'company_id', test.id('company'), 'doc_date', '2026-09-01', 'godown_id', p_godown, 'reason', 'STOCK_IN',
    'lines', jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where code = 'BOLT-10'
                                                              and company_id = test.id('company')),
                                                  'direction', 1, 'qty', p_qty, 'unit_id', test.id('pcs'),
                                                  'location_id', p_loc)))))
$$;
select test.eq(pg_temp.stock_in(:'del_v', :'l123_v', 5000)->>'status', 'POSTED', 'Stock IN Delhi B1-C-123: 5000');
select pg_temp.stock_in(:'del_v', :'l124_v', 3000);
select pg_temp.stock_in(:'noi_v', :'l041_v', 7000);
select pg_temp.stock_in(:'fac_v', :'l009_v', 5000);

select test.eq((select physical_qty from public.v_inventory_items where item_id = :'bolt_v'), 20000.000::numeric,
               'Consolidated physical stock = 20,000');
select test.eq((select location_count from public.v_inventory_items where item_id = :'bolt_v'), 4::bigint,
               'Item is in 4 locations');
select test.eq((select godown_count from public.v_inventory_items where item_id = :'bolt_v'), 3::bigint,
               'Item is in 3 godowns');
select test.eq((select base_qty from public.v_stock_balance where item_id = :'bolt_v' and godown_id = :'del_v'),
               8000.000::numeric, 'Delhi godown = 8,000 (two racks)');
select test.eq((select base_qty from public.v_stock_by_location where location_id = :'l123_v'), 5000.000::numeric(16,3),
               'Delhi / B1-C-123 = 5,000');
select test.eq((select base_qty from public.v_stock_by_location where location_id = :'l124_v'), 3000.000::numeric(16,3),
               'Delhi / B1-C-124 = 3,000 (same item, second location)');
select test.eq(jsonb_array_length(public.inventory_item_detail(:'bolt_v')->'locations'), 4, 'Item detail: 4 location rows');
select test.eq(jsonb_array_length(public.inventory_item_detail(:'bolt_v')->'godowns'), 3, 'Item detail: 3 godown rows');
select test.eq((public.inventory_item_detail(:'bolt_v')->>'sale_price')::numeric, 123::numeric, 'Item detail shows sale price');
select test.login(null);
select test.eq(app.location_label(:'l041_v'), 'Noida / A2-B-041', 'Location label "Noida / A2-B-041"');
select test.login(test.id('operator'));
select test.eq((select stock_status from public.v_inventory_items where item_id = :'bolt_v'), 'IN_STOCK', 'Stock status IN_STOCK');

-- ------------------------------------------------ stock OUT from a specific bin; auto-pick
select test.throws(format($$ select public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-02', 'godown_id', %L, 'reason', 'STOCK_OUT',
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'direction', -1, 'qty', 3500, 'unit_id', %L,
                                                'location_id', %L))))) $$,
  test.id('company'), :'del_v', :'bolt_v', test.id('pcs'), :'l124_v'),
  'Insufficient stock%at location%', 'Cannot take 3500 from B1-C-124 holding 3000');
select test.eq(public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-02', 'godown_id', :'del_v', 'reason', 'STOCK_OUT',
  'lines', jsonb_build_array(jsonb_build_object('item_id', :'bolt_v', 'direction', -1, 'qty', 6000, 'unit_id', test.id('pcs'))))))->>'status',
  'POSTED', 'Stock OUT 6000 from Delhi without a bin: picked from several racks');
select test.eq((select count(*) from public.stock_movements where item_id = :'bolt_v' and movement_type = 'STOCK_OUT')::int, 2,
               'Auto-pick split the OUT over two locations');
select test.eq((select base_qty from public.v_stock_balance where item_id = :'bolt_v' and godown_id = :'del_v'),
               2000.000::numeric, 'Delhi = 2,000 after OUT');

-- ------------------------------------------------ negative stock OFF by default (§5)
select test.ok(not (select allow_negative_stock from public.company_settings where company_id = test.id('company')),
               'Negative stock is OFF by default');
select test.throws(format($$ select public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-02', 'godown_id', %L, 'reason', 'STOCK_OUT',
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'direction', -1, 'qty', 2001, 'unit_id', %L))))) $$,
  test.id('company'), :'del_v', :'bolt_v', test.id('pcs')),
  'Insufficient stock of 10mm Bolt in Delhi: available 2000%', 'Going below zero is blocked with a clear message');
-- an operator cannot switch it on (RLS: settings.edit only for owner/admin)
update public.company_settings set allow_negative_stock = true where company_id = test.id('company');
select test.ok(not (select allow_negative_stock from public.company_settings where company_id = test.id('company')),
               'Operator cannot enable negative stock');

-- ------------------------------------------------ 6: stock transfer godown → godown (and rack → rack)
select test.eq(public.doc_submit('STOCK_TRANSFER', public.doc_save('STOCK_TRANSFER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-03', 'from_godown_id', :'noi_v', 'to_godown_id', :'del_v',
  'lines', jsonb_build_array(jsonb_build_object('item_id', :'bolt_v', 'qty', 2000, 'unit_id', test.id('pcs'),
                                                'from_location_id', :'l041_v', 'to_location_id', :'l123_v')))))->>'status',
  'POSTED', 'Transfer 2000 Noida A2-B-041 → Delhi B1-C-123');
select test.eq((select base_qty from public.v_stock_balance where item_id = :'bolt_v' and godown_id = :'noi_v'),
               5000.000::numeric, 'Noida 7000 − 2000 = 5000');
select test.eq((select base_qty from public.v_stock_balance where item_id = :'bolt_v' and godown_id = :'del_v'),
               4000.000::numeric, 'Delhi 2000 + 2000 = 4000');
select test.ok(exists (select 1 from public.stock_movements where item_id = :'bolt_v' and movement_type = 'STOCK_TRANSFER_OUT')
               and exists (select 1 from public.stock_movements where item_id = :'bolt_v' and movement_type = 'STOCK_TRANSFER_IN'),
               'Transfer creates STOCK_TRANSFER_OUT + STOCK_TRANSFER_IN movements');
select test.eq((select physical_qty from public.v_inventory_items where item_id = :'bolt_v'), 14000.000::numeric,
               'Consolidated stock unchanged by transfer (20000 − 6000 OUT)');
select test.eq(public.doc_submit('STOCK_TRANSFER', public.doc_save('STOCK_TRANSFER', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-03', 'from_godown_id', :'del_v', 'to_godown_id', :'del_v',
  'lines', jsonb_build_array(jsonb_build_object('item_id', :'bolt_v', 'qty', 100, 'unit_id', test.id('pcs'),
                                                'from_location_id', :'l123_v', 'to_location_id', :'l124_v')))))->>'status',
  'POSTED', 'Rack-to-rack move inside one godown');
select test.throws(format($$ select public.doc_save('STOCK_TRANSFER', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-03', 'from_godown_id', %L, 'to_godown_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 1, 'unit_id', %L,
                                                'from_location_id', %L, 'to_location_id', %L)))) $$,
  test.id('company'), :'del_v', :'del_v', :'bolt_v', test.id('pcs'), :'l123_v', :'l123_v'),
  '%must be different%', 'Transfer to the same location is rejected');
select test.throws(format($$ select public.doc_submit('STOCK_TRANSFER', public.doc_save('STOCK_TRANSFER', jsonb_build_object(
  'company_id', %L, 'doc_date', '2026-09-03', 'from_godown_id', %L, 'to_godown_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('item_id', %L, 'qty', 999999, 'unit_id', %L))))) $$,
  test.id('company'), :'fac_v', :'noi_v', :'bolt_v', test.id('pcs')),
  'Insufficient stock%', 'Transfer of more than available is rejected — nothing half-posted');
select test.eq((select base_qty from public.v_stock_balance where item_id = :'bolt_v' and godown_id = :'fac_v'),
               5000.000::numeric, 'Factory stock untouched after the failed transfer');

-- movement history: item, godown, location, qty, unit, type, reference, date, user, timestamp
select test.ok((select bool_and(item_id is not null and godown_id is not null and location_code is not null
                                and qty > 0 and unit is not null and movement_type is not null and doc_no is not null
                                and movement_date is not null and created_by is not null and created_at is not null)
                from public.v_stock_movement_history where item_id = :'bolt_v' and source_table <> 'fixture'),
               'Every movement records item, godown, location, qty, unit, type, reference, date, user, time');

-- ------------------------------------------------ 32: stock manipulation attempts
select test.throws(format($$ insert into public.stock_balances values (%L, %L, %L, %L, 99999) $$,
                          test.id('company'), :'bolt_v', :'del_v', :'l123_v'), 'permission denied%',
                   'User cannot write stock balances directly');
select test.throws(format($$ update public.stock_balances set base_qty = 99999 where item_id = %L $$, :'bolt_v'),
                   'permission denied%', 'User cannot change a stock balance');
select test.throws(format($$ insert into public.stock_movements (company_id, item_id, godown_id, location_id, movement_date,
                            movement_type, direction, qty, unit_id, factor_to_base, base_qty, source_table, source_id)
                            values (%L, %L, %L, %L, current_date, 'STOCK_IN', 1, 5, %L, 1, 5, 'x', gen_random_uuid()) $$,
                          test.id('company'), :'bolt_v', :'del_v', :'l123_v', test.id('pcs')),
                   'permission denied%', 'User cannot insert a stock movement');
select test.throws($$ update public.stock_reserved set reserved_qty = 0 $$, 'permission denied%',
                   'User cannot change reserved stock');
select test.throws(format($$ select app.post_stock(%L, %L, %L, current_date, 'STOCK_IN', 1::smallint, 5, %L, 1, null, null, 'x', gen_random_uuid(), null, 'x') $$,
                          test.id('company'), :'bolt_v', :'del_v', test.id('pcs')),
                   'permission denied%', 'User cannot call the internal posting engine');
select test.login(null);
select test.throws($$ update public.stock_movements set qty = 1 $$, '%append-only%', 'Historical movements cannot be edited');

-- ------------------------------------------------ owner enables negative stock in Settings
select test.login(test.id('admin'));
update public.company_settings set allow_negative_stock = true where company_id = test.id('company');
select test.ok((select allow_negative_stock from public.company_settings where company_id = test.id('company')),
               'Owner/Admin enabled negative stock');
select test.login(test.id('operator'));
select test.ok(jsonb_array_length(public.doc_submit('STOCK_ADJUSTMENT', public.doc_save('STOCK_ADJUSTMENT', jsonb_build_object(
  'company_id', test.id('company'), 'doc_date', '2026-09-04', 'godown_id', :'fac_v', 'reason', 'STOCK_OUT',
  'lines', jsonb_build_array(jsonb_build_object('item_id', :'bolt_v', 'direction', -1, 'qty', 5500, 'unit_id', test.id('pcs'))))))->'warnings') = 1,
  'With negative stock ON the OUT posts with a warning');
select test.eq((select base_qty from public.v_stock_balance where item_id = :'bolt_v' and godown_id = :'fac_v'),
               -500.000::numeric, 'Factory stock is −500');
rollback;
