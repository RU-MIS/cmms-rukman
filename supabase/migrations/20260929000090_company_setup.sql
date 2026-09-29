-- =============================================================================
-- 0090 COMPANY SETUP
-- app.init_company seeds everything a NEW company needs (system roles,
-- numbering, approval policies, minimal chart of accounts, MAIN voucher book).
-- It contains no company data: names, banks, parties, items are created by
-- the user (decisions Q-25, Q-30, Q-32).
-- =============================================================================

-- Default numbering. Prefixes are only defaults; the admin changes them in
-- Settings → Numbering (Q-37).
create table app.default_sequences (
  doc_type      text primary key,
  prefix        text not null,
  pattern       text not null,
  padding       smallint not null,
  reset_policy  text not null
);
insert into app.default_sequences values
  ('JOB_WORK_ORDER',      'GT-',   '{PREFIX}{NUMBER}',       1, 'NEVER'),
  ('JOB_WORK_RECEIPT',    'JWR-',  '{PREFIX}{FY}/{NUMBER}',  4, 'FY'),
  ('MATERIAL_ISSUE',      'GS-',   '{PREFIX}{NUMBER}',       1, 'NEVER'),
  ('JOB_WORK_RETURN',     'DNGT-', '{PREFIX}{NUMBER}',       1, 'NEVER'),
  ('STOCK_TRANSFER',      'ST-',   '{PREFIX}{FY}/{NUMBER}',  4, 'FY'),
  ('STOCK_ADJUSTMENT',    'SA-',   '{PREFIX}{FY}/{NUMBER}',  4, 'FY'),
  ('JOURNAL',             'JV-',   '{PREFIX}{FY}/{NUMBER}',  5, 'FY');

-- Default approval policy per document type (Q-10: RM issue needs approval).
create table app.default_approvals (
  doc_type           text primary key,
  requires_approval  boolean not null
);
insert into app.default_approvals values ('MATERIAL_ISSUE', true);

-- Minimal chart of accounts (groups + system accounts used by posting code).
create table app.default_accounts (
  code         text primary key,
  name         text not null,
  parent_code  text,
  is_group     boolean not null default false,
  account_type public.account_type not null,
  sub_type     public.account_sub_type not null default 'GENERAL',
  system_key   text unique,
  sort_order   integer not null
);
insert into app.default_accounts (code, name, parent_code, is_group, account_type, sub_type, system_key, sort_order) values
  ('1000', 'Capital Account',              null,   true,  'EQUITY',    'CAPITAL',            null,                    10),
  ('1010', 'Capital',                      '1000', false, 'EQUITY',    'CAPITAL',            'CAPITAL',               11),
  ('1020', 'Drawings',                     '1000', false, 'EQUITY',    'DRAWINGS',           'DRAWINGS',              12),
  ('1030', 'Opening Balance Adjustment',   '1000', false, 'EQUITY',    'GENERAL',            'OPENING_BALANCE_ADJ',   13),
  ('1100', 'Loans (Liability)',            null,   true,  'LIABILITY', 'LOAN',               null,                    20),
  ('1200', 'Current Liabilities',          null,   true,  'LIABILITY', 'GENERAL',            null,                    30),
  ('1210', 'Sundry Creditors',             '1200', false, 'LIABILITY', 'PAYABLE_CONTROL',    'SUNDRY_CREDITORS',      31),
  ('1220', 'Duties & Taxes',               '1200', true,  'LIABILITY', 'TAX',                null,                    32),
  ('1221', 'Output GST',                   '1220', false, 'LIABILITY', 'TAX',                'OUTPUT_GST',            33),
  ('1222', 'GST Payable',                  '1220', false, 'LIABILITY', 'TAX',                'GST_PAYABLE',           34),
  ('1223', 'TDS Payable',                  '1220', false, 'LIABILITY', 'TAX',                'TDS_PAYABLE',           35),
  ('2000', 'Fixed Assets',                 null,   true,  'ASSET',     'GENERAL',            null,                    40),
  ('2100', 'Current Assets',               null,   true,  'ASSET',     'GENERAL',            null,                    50),
  ('2110', 'Sundry Debtors',               '2100', false, 'ASSET',     'RECEIVABLE_CONTROL', 'SUNDRY_DEBTORS',        51),
  ('2120', 'Cash-in-Hand',                 '2100', true,  'ASSET',     'CASH',               null,                    52),
  ('2121', 'Cash',                         '2120', false, 'ASSET',     'CASH',               'CASH',                  53),
  ('2130', 'Bank Accounts',                '2100', true,  'ASSET',     'BANK',               null,                    54),
  ('2140', 'Input GST',                    '2100', false, 'ASSET',     'TAX',                'INPUT_GST',             55),
  ('2150', 'TDS Receivable',               '2100', false, 'ASSET',     'TAX',                'TDS_RECEIVABLE',        56),
  ('2160', 'Stock-in-Hand',                '2100', false, 'ASSET',     'STOCK',              'STOCK_IN_HAND',         57),
  ('3000', 'Sales Accounts',               null,   true,  'INCOME',    'GENERAL',            null,                    60),
  ('3010', 'Sales',                        '3000', false, 'INCOME',    'GENERAL',            'SALES',                 61),
  ('3020', 'Material Issued to Job Workers','3000', false, 'INCOME',   'GENERAL',            'MATERIAL_ISSUED_TO_JW', 62),
  ('3100', 'Indirect Income',              null,   true,  'INCOME',    'GENERAL',            null,                    65),
  ('3110', 'Round Off',                    '3100', false, 'INCOME',    'GENERAL',            'ROUND_OFF',             66),
  ('4000', 'Purchase Accounts',            null,   true,  'EXPENSE',   'GENERAL',            null,                    70),
  ('4010', 'Purchase',                     '4000', false, 'EXPENSE',   'GENERAL',            'PURCHASE',              71),
  ('4100', 'Direct Expenses',              null,   true,  'EXPENSE',   'GENERAL',            null,                    80),
  ('4110', 'Job-Work Charges',             '4100', false, 'EXPENSE',   'GENERAL',            'JOB_WORK_CHARGES',      81),
  ('4120', 'Factory Wages',                '4100', false, 'EXPENSE',   'GENERAL',            'FACTORY_WAGES',         82),
  ('4130', 'Cutting Charges',              '4100', false, 'EXPENSE',   'GENERAL',            'CUTTING_CHARGES',       83),
  ('4140', 'Freight & Cartage',            '4100', false, 'EXPENSE',   'GENERAL',            'FREIGHT',               84),
  ('4200', 'Indirect Expenses',            null,   true,  'EXPENSE',   'GENERAL',            null,                    90),
  ('4210', 'Bank Charges',                 '4200', false, 'EXPENSE',   'GENERAL',            'BANK_CHARGES',          91),
  ('4220', 'Rate Difference / Short Receipt','4200', false, 'EXPENSE', 'GENERAL',            'RATE_DIFFERENCE',       92);

-- System roles and their permissions.
create table app.default_roles (
  code  text primary key,
  name  text not null
);
insert into app.default_roles values
  ('ADMIN',    'Administrator'),
  ('APPROVER', 'Senior / Approver'),
  ('OPERATOR', 'Data entry'),
  ('VIEWER',   'View only');

-- -----------------------------------------------------------------------------
-- app.init_company — idempotent.
-- -----------------------------------------------------------------------------
create or replace function app.init_company(p_company_id uuid)
returns void
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare a app.default_accounts;
begin
  insert into public.document_sequences (company_id, doc_type, prefix, pattern, padding, reset_policy)
  select p_company_id, doc_type, prefix, pattern, padding, reset_policy from app.default_sequences
  on conflict do nothing;

  insert into public.approval_policies (company_id, doc_type, requires_approval)
  select p_company_id, doc_type, requires_approval from app.default_approvals
  on conflict do nothing;

  for a in select * from app.default_accounts order by sort_order loop
    insert into public.accounts (company_id, code, name, parent_id, is_group, account_type, sub_type,
                                 system_key, is_system)
    values (p_company_id, a.code, a.name,
            (select id from public.accounts where company_id = p_company_id and code = a.parent_code),
            a.is_group, a.account_type, a.sub_type, a.system_key, a.system_key is not null)
    on conflict do nothing;
  end loop;

  insert into public.voucher_books (company_id, code, name)
  values (p_company_id, 'MAIN', 'Main book')
  on conflict do nothing;

  insert into public.roles (company_id, code, name, is_system)
  select p_company_id, code, name, true from app.default_roles
  on conflict do nothing;

  -- ADMIN: everything. APPROVER: everything except DELETE. OPERATOR: VIEW,
  -- CREATE, EDIT, EXPORT. VIEWER: VIEW, EXPORT.
  insert into public.role_permissions (role_id, permission_code)
  select r.id, p.code
  from public.roles r
  cross join public.permissions p
  where r.company_id = p_company_id and r.is_system
    and (r.code = 'ADMIN'
         or (r.code = 'APPROVER' and p.action <> 'DELETE')
         or (r.code = 'OPERATOR' and p.action in ('VIEW', 'CREATE', 'EDIT', 'EXPORT'))
         or (r.code = 'VIEWER' and p.action in ('VIEW', 'EXPORT')))
  on conflict do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Create a company. The first company of an instance can only be created by
-- the service role (instance:init script); later companies by a user who is
-- ADMIN of an existing company. The creator becomes ADMIN of the new company.
-- -----------------------------------------------------------------------------
create or replace function public.create_company(p_payload jsonb, p_admin_user_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id    uuid;
  v_admin uuid := coalesce(p_admin_user_id, auth.uid());
begin
  if not app.is_trusted_caller() then
    if not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                   where ur.user_id = auth.uid() and r.code = 'ADMIN') then
      raise exception 'Only an administrator can create a company' using errcode = '42501';
    end if;
    v_admin := auth.uid();
  end if;
  if v_admin is null then
    raise exception 'An admin user is required' using errcode = 'P0001';
  end if;

  insert into public.companies (code, legal_name, trade_name, gstin, pan, address_line1, address_line2,
                                city, state, state_code, pincode, phone, email, website, fy_start_month)
  values (p_payload->>'code', p_payload->>'legal_name', p_payload->>'trade_name', p_payload->>'gstin',
          p_payload->>'pan', p_payload->>'address_line1', p_payload->>'address_line2', p_payload->>'city',
          p_payload->>'state', p_payload->>'state_code', p_payload->>'pincode', p_payload->>'phone',
          p_payload->>'email', p_payload->>'website', coalesce((p_payload->>'fy_start_month')::smallint, 4))
  returning id into v_id;

  perform app.init_company(v_id);

  insert into public.user_roles (user_id, company_id, role_id)
  select v_admin, v_id, id from public.roles where company_id = v_id and code = 'ADMIN';
  perform app.audit(v_id, 'companies', v_id::text, 'CREATE', null, p_payload);
  return v_id;
end;
$$;
