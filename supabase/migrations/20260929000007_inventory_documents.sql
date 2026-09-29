-- =============================================================================
-- 0007 INVENTORY DOCUMENTS — posting of stock transfers and adjustments
-- =============================================================================

insert into app.doc_types (doc_type, table_name, line_table, line_fk, perm_prefix, label) values
  ('STOCK_TRANSFER',   'stock_transfers',   'stock_transfer_lines',   'transfer_id',   'stock_transfer',   'Stock transfer'),
  ('STOCK_ADJUSTMENT', 'stock_adjustments', 'stock_adjustment_lines', 'adjustment_id', 'stock_adjustment', 'Stock adjustment');

-- Stock transfer: OUT from source + IN to destination (spec §34).
create or replace function app.post_stock_transfer(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h        public.stock_transfers;
  l        public.stock_transfer_lines;
  v_doc_no text;
  v_warn   text;
  v_warns  text[] := '{}';
begin
  select * into h from public.stock_transfers where id = p_id;
  perform app.assert_same_company(h.company_id, 'godowns', h.from_godown_id);
  perform app.assert_same_company(h.company_id, 'godowns', h.to_godown_id);
  perform app.normalise_lines(app.doc_type('STOCK_TRANSFER'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'STOCK_TRANSFER', h.doc_date);

  for l in select * from public.stock_transfer_lines where transfer_id = p_id order by line_no loop
    v_warn := app.post_stock(h.company_id, l.item_id, h.from_godown_id, h.doc_date,
                             'STOCK_TRANSFER_OUT', -1::smallint, l.qty, l.unit_id, l.factor_to_base,
                             null, null, 'stock_transfers', p_id, l.id, v_doc_no);
    if v_warn is not null then v_warns := v_warns || v_warn; end if;
    perform app.post_stock(h.company_id, l.item_id, h.to_godown_id, h.doc_date,
                           'STOCK_TRANSFER_IN', 1::smallint, l.qty, l.unit_id, l.factor_to_base,
                           null, null, 'stock_transfers', p_id, l.id, v_doc_no);
  end loop;

  update public.stock_transfers set doc_no = v_doc_no, status = 'POSTED' where id = p_id;
  return app.result(p_id, v_doc_no, 'POSTED', v_warns);
end;
$$;

create or replace function app.cancel_stock_transfer(p_id uuid, p_date date)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.cancel_standard('stock_transfers', p_id, p_date) $$;

-- Stock adjustment: IN / OUT per line (physical count, damage, opening stock).
create or replace function app.post_stock_adjustment(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  h        public.stock_adjustments;
  l        public.stock_adjustment_lines;
  v_doc_no text;
  v_warn   text;
  v_warns  text[] := '{}';
begin
  select * into h from public.stock_adjustments where id = p_id;
  perform app.assert_same_company(h.company_id, 'godowns', h.godown_id);
  perform app.normalise_lines(app.doc_type('STOCK_ADJUSTMENT'), p_id, h.doc_date);
  v_doc_no := app.next_doc_no(h.company_id, 'STOCK_ADJUSTMENT', h.doc_date);

  for l in select * from public.stock_adjustment_lines where adjustment_id = p_id order by line_no loop
    v_warn := app.post_stock(h.company_id, l.item_id, h.godown_id, h.doc_date,
                             case when h.reason = 'OPENING' then 'OPENING'::public.movement_type
                                  when l.direction = 1 then 'STOCK_ADJUSTMENT_IN'
                                  else 'STOCK_ADJUSTMENT_OUT' end,
                             l.direction, l.qty, l.unit_id, l.factor_to_base,
                             l.rate, null, 'stock_adjustments', p_id, l.id, v_doc_no);
    if v_warn is not null then v_warns := v_warns || v_warn; end if;
  end loop;

  update public.stock_adjustments set doc_no = v_doc_no, status = 'POSTED' where id = p_id;
  return app.result(p_id, v_doc_no, 'POSTED', v_warns);
end;
$$;

create or replace function app.cancel_stock_adjustment(p_id uuid, p_date date)
returns void
language sql security definer
set search_path = public, app, pg_temp
as $$ select app.cancel_standard('stock_adjustments', p_id, p_date) $$;
