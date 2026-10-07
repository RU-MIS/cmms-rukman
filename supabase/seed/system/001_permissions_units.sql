-- =============================================================================
-- SYSTEM SEED (every instance). Idempotent. Contains no company data.
-- =============================================================================

-- Permissions for every registered document type: <prefix>.<action>
insert into public.permissions (code, module, action, description)
select d.perm_prefix || '.' || lower(a::text), d.perm_prefix, a, d.label || ' — ' || lower(a::text)
from app.doc_types d
cross join unnest(enum_range(null::public.perm_action)) a
on conflict (code) do nothing;

-- Permissions for masters, reports and administration.
insert into public.permissions (code, module, action, description)
select m.module || '.' || lower(a::text), m.module, a, m.label || ' — ' || lower(a::text)
from (values
  ('items',          'Items & packing'),
  ('parties',        'Parties'),
  ('godowns',        'Godowns'),
  ('accounts',       'Chart of accounts'),
  ('rates',          'Rate lists'),
  ('settings',       'Company settings & numbering'),
  ('users',          'Users & roles'),
  ('reports',        'Reports'),
  ('audit',          'Audit log'),
  ('customer_po',    'Customer POs (review / approve)'),
  ('reservation',    'Stock reservations'),
  ('documents',      'Documents'),
  ('email',          'Email log & sending'),
  ('portal',         'Customer / vendor portal access')
) as m(module, label)
cross join unnest(enum_range(null::public.perm_action)) a
on conflict (code) do nothing;

-- System units (company_id NULL = available to all companies).
insert into public.units (company_id, code, name, decimals)
select null, v.code, v.name, v.decimals
from (values
  ('PAIR', 'Pair', 0), ('BOX', 'Box', 0), ('PCS', 'Pieces', 0), ('NOS', 'Numbers', 0),
  ('MTR', 'Metre', 2), ('KGS', 'Kilogram', 3), ('LTR', 'Litre', 3), ('PKT', 'Packet', 0),
  ('ROLL', 'Roll', 0), ('DOLLY', 'Dolly', 0), ('CONE', 'Cone', 0), ('BOTTLE', 'Bottle', 0),
  ('SET', 'Set', 0)
) as v(code, name, decimals)
where not exists (select 1 from public.units u where u.company_id is null and upper(u.code) = v.code);
