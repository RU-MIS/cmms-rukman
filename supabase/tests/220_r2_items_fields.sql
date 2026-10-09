-- =============================================================================
-- PLATFORM R2 — item master, custom fields, field-level security (rates /
-- cost), rate history, item images.
-- =============================================================================
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('ITEM-TEST'));
create temp table t (k text primary key, v uuid) on commit drop;
grant all on t to authenticated;

select test.login(null);
select test.user_with_role(test.id('company'), 'SALES') as v \gset sales_
select test.user_with_role(test.id('company'), 'PURCHASE') as v \gset purch_
select test.user_with_role(test.id('company'), 'INVENTORY') as v \gset inv_
select test.party(test.id('company'), 'C1', 'CUSTOMER') as v \gset c1_
select test.party(test.id('company'), 'V1', 'SUPPLIER') as v \gset v1_

-- ------------------------------------------------ custom fields + item master
select test.login(test.id('admin'));
select public.custom_field_save(test.id('company'), null, '{"entity":"ITEM","field_key":"finish","label":"Finish","field_type":"DROPDOWN","options":["ZINC","BLACK"],"is_required":true}');
select public.custom_field_save(test.id('company'), null, '{"entity":"ITEM","field_key":"length_mm","label":"Length (mm)","field_type":"NUMBER"}');
select test.throws(format($$ insert into public.items (company_id, code, name, item_kind, base_unit_id) values (%L, 'B-1', 'Bolt', 'RAW_MATERIAL', %L) $$,
                          test.id('company'), test.id('pcs')), 'Finish is required%', 'Required custom field enforced by the database');
select test.throws(format($$ insert into public.items (company_id, code, name, item_kind, base_unit_id, custom) values (%L, 'B-1', 'Bolt', 'RAW_MATERIAL', %L, '{"finish":"RED"}') $$,
                          test.id('company'), test.id('pcs')), 'Finish must be one of%', 'Dropdown value validated');
select test.throws(format($$ insert into public.items (company_id, code, name, item_kind, base_unit_id, custom) values (%L, 'B-1', 'Bolt', 'RAW_MATERIAL', %L, '{"finish":"ZINC","colour":"x"}') $$,
                          test.id('company'), test.id('pcs')), 'Unknown custom field colour%', 'Unknown custom field rejected');
insert into public.items (company_id, code, name, item_kind, base_unit_id, sku, hsn_code, barcode, min_stock, max_stock, reorder_level,
                          purchase_price, sale_price, notes, custom)
values (test.id('company'), 'B-1', 'Bolt 10mm', 'RAW_MATERIAL', test.id('pcs'), 'SKU-B1', '7318', '890001', 10, 1000, 50,
        1.10, 1.50, 'Zinc plated', '{"finish":"ZINC","length_mm":"40"}')
returning id as v \gset b1_
select test.eq((select custom->'length_mm' from public.v_items where id = :'b1_v'), '40'::jsonb, 'Custom NUMBER stored as number');
update public.items set name = 'Bolt 10mm zinc', sale_price = 1.60 where id = :'b1_v';
select test.eq((select name from public.items where id = :'b1_v'), 'Bolt 10mm zinc', 'Item edited');
select test.throws(format($$ insert into public.items (company_id, code, name, item_kind, base_unit_id, sku, custom) values (%L, 'B-2', 'x', 'RAW_MATERIAL', %L, 'sku-b1', '{"finish":"ZINC"}') $$,
                          test.id('company'), test.id('pcs')), '%duplicate key%', 'SKU unique per company');

-- ------------------------------------------------ rate history (append-only)
select test.eq((select string_agg(rate_type || ':' || action || ':' || coalesce(old_rate::text, '-') || '>' || new_rate, ',' order by id)
                from public.item_rate_history where item_id = :'b1_v'),
               'SALE:SET:->1.5000,PURCHASE:SET:->1.1000,SALE:CHANGE:1.5000>1.6000', 'Rate history: set and change with old / new');
insert into public.party_item_rates (company_id, rate_type, party_id, item_id, rate, effective_from)
values (test.id('company'), 'SALE', :'c1_v', :'b1_v', 1.45, '2026-10-01'), (test.id('company'), 'PURCHASE', :'v1_v', :'b1_v', 1.05, '2026-10-01');
select test.ok((select count(*) from public.item_rate_history where item_id = :'b1_v' and source = 'RATE_LIST') = 2,
               'Customer and vendor rates are in the history');
select test.throws($$ update public.item_rate_history set new_rate = 0 $$, '%', 'History cannot be changed');

-- ------------------------------------------------ field-level security: SALES
select test.login(:'sales_v');
select test.throws(format($$ select purchase_price from public.items where id = %L $$, :'b1_v'), '%permission denied%',
                   'Purchase price column cannot be read from the table');
select test.throws(format($$ select sale_price from public.items where id = %L $$, :'b1_v'), '%permission denied%',
                   'Prices are only readable through the masked view');
select test.eq((select sale_price from public.v_items where id = :'b1_v'), 1.6000::numeric, 'Sales sees the sales rate');
select test.ok((select purchase_price is null and not can_view_purchase_rate from public.v_items where id = :'b1_v'), 'Sales does not see the purchase rate');
select test.eq((select string_agg(rate_type, ',') from public.party_item_rates where item_id = :'b1_v'), 'SALE', 'Sales sees only sales rates');
select test.ok(not exists (select 1 from public.item_rate_history where item_id = :'b1_v' and rate_type = 'PURCHASE'),
               'Sales does not see the purchase rate history');
update public.items set sale_price = 9 where id = :'b1_v';
select test.eq((select sale_price from public.v_items where id = :'b1_v'), 1.6000::numeric, 'Sales cannot change the item (RLS: no row updated)');
select test.throws($$ select * from public.stock_valuation(test.id('company'), current_date) $$, 'Permission denied: Stock valuation needs the stock valuation right%',
                   'No stock valuation without the cost right');
select test.throws($$ select rate from public.stock_movements limit 1 $$, '%permission denied%', 'Movement cost not readable');

-- ------------------------------------------------ PURCHASE
select test.login(:'purch_v');
select test.ok((select sale_price is null and purchase_price = 1.10 from public.v_items where id = :'b1_v'),
               'Purchase sees the purchase rate, not the sales rate');
select test.eq((select string_agg(rate_type, ',') from public.party_item_rates where item_id = :'b1_v'), 'PURCHASE', 'Purchase sees only vendor rates');
update public.items set purchase_price = 1.15 where id = :'b1_v';
select test.eq((select purchase_price from public.v_items where id = :'b1_v'), 1.1500::numeric, 'Purchase (edit rates) changes the purchase price');

-- ------------------------------------------------ INVENTORY (no rate rights by default)
select test.login(:'inv_v');
select test.ok((select sale_price is null and purchase_price is null from public.v_items where id = :'b1_v'), 'Inventory sees no rates');
select test.ok(exists (select 1 from public.v_inventory_items where item_id = :'b1_v' and sale_price is null), 'Inventory list masks the sale price');
select test.eq((select count(*) from public.party_item_rates where item_id = :'b1_v')::int, 0, 'Inventory sees no party rates');
select test.throws(format($$ update public.items set sale_price = 2 where id = %L $$, :'b1_v'),
                   'Permission denied: items.edit_rate%', 'Changing a price needs Edit rates (also with items.edit)');
update public.items set min_stock = 20 where id = :'b1_v';
select test.eq((select min_stock from public.items where id = :'b1_v'), 20.000::numeric, 'Inventory edits non-price fields');
select test.throws(format($$ insert into public.party_item_rates (company_id, rate_type, party_id, item_id, rate) values (%L, 'SALE', %L, %L, 1) $$,
                          test.id('company'), :'c1_v', :'b1_v'), '%', 'Party rates cannot be written without Edit rates');

-- configurable: give Inventory the sales-rate right in the matrix → visible
select test.login(test.id('admin'));
select public.role_set_permissions((select id from public.roles where company_id = test.id('company') and code = 'INVENTORY'),
  array(select permission_code from public.role_permissions rp join public.roles r on r.id = rp.role_id
        where r.company_id = test.id('company') and r.code = 'INVENTORY') || array['items.view_sale_rate']);
select test.login(:'inv_v');
select test.eq((select sale_price from public.v_items where id = :'b1_v'), 1.6000::numeric, 'Field right granted in the matrix → visible immediately');

-- owner unrestricted; financial statements unchanged
select test.login(test.id('admin'));
select test.ok((select sale_price is not null and purchase_price is not null from public.v_items where id = :'b1_v'), 'Owner sees every rate');
select test.ok(exists (select 1 from public.stock_valuation(test.id('company'), current_date)), 'Owner sees the stock valuation');
select test.login(test.id('approver'));
select test.ok((select count(*) from public.balance_sheet(test.id('company'), current_date)) > 0, 'Balance sheet still works');

-- ------------------------------------------------ item images
select test.login(test.id('admin'));
select test.throws(format($$ select public.item_image_register(%L, jsonb_build_object('storage_path', 'other/x.png', 'file_name', 'x.png', 'content_type', 'image/png', 'size_bytes', 10)) $$, :'b1_v'),
                   'Image path does not belong%', 'Image path must be <company>/<item>/…');
insert into t values ('img1', public.item_image_register(:'b1_v', jsonb_build_object('storage_path', test.id('company') || '/' || :'b1_v' || '/a.png',
                      'file_name', 'a.png', 'content_type', 'image/png', 'size_bytes', 1200)));
insert into t values ('img2', public.item_image_register(:'b1_v', jsonb_build_object('storage_path', test.id('company') || '/' || :'b1_v' || '/b.webp',
                      'file_name', 'b.webp', 'content_type', 'image/webp', 'size_bytes', 900)));
select test.ok((select is_primary from public.item_images where id = (select v from t where k = 'img1')), 'First image is primary');
select public.item_image_set_primary((select v from t where k = 'img2'));
select test.ok((select is_primary from public.item_images where id = (select v from t where k = 'img2'))
               and not (select is_primary from public.item_images where id = (select v from t where k = 'img1')), 'Primary image replaced');
select test.throws(format($$ select public.item_image_register(%L, jsonb_build_object('storage_path', %L, 'file_name', 'x.exe', 'content_type', 'application/x-msdownload', 'size_bytes', 10)) $$,
                          :'b1_v', test.id('company') || '/' || :'b1_v' || '/x.exe'), '%', 'Only image types are accepted');
select test.ok(app.item_image_can_read(test.id('company') || '/' || :'b1_v' || '/a.png'), 'Storage read allowed for items.view');
select test.login(:'sales_v');
select test.throws(format($$ select public.item_image_delete(%L) $$, (select v from t where k = 'img1')),
                   'Permission denied: items.upload_image%', 'Sales cannot delete images');
select test.ok(not app.item_image_can_write(test.id('company') || '/' || :'b1_v' || '/c.png'), 'Storage write refused without upload right');
select test.login(test.id('admin'));
select test.eq(public.item_image_delete((select v from t where k = 'img2')), test.id('company') || '/' || :'b1_v' || '/b.webp',
               'Delete returns the storage path for the file removal');
select test.ok((select is_primary from public.item_images where id = (select v from t where k = 'img1')), 'Remaining image becomes primary');
select test.ok(exists (select 1 from public.audit_log where table_name = 'items' and row_id = :'b1_v' and action = 'IMAGE_ADD'), 'Image changes audited');

-- cross-company: no access to images / items of another company
select test.login(null);
insert into test.ctx values ('fx2', test.fixture('ITEM-OTHER'));
select test.login((select (v->>'admin')::uuid from test.ctx where k = 'fx2'));
select test.ok(not app.item_image_can_read(test.id('company') || '/' || :'b1_v' || '/a.png'), 'Other company cannot read the image file');
select test.eq((select count(*) from public.item_images where item_id = :'b1_v')::int, 0, 'Other company sees no image rows');
select test.eq((select count(*) from public.v_items where id = :'b1_v')::int, 0, 'Other company does not see the item');
select test.throws(format($$ select public.item_image_register(%L, jsonb_build_object('storage_path', %L, 'file_name', 'x.png', 'content_type', 'image/png', 'size_bytes', 10)) $$,
                          :'b1_v', test.id('company') || '/' || :'b1_v' || '/x.png'), 'Item not found%', 'Other company cannot add images');

rollback;
