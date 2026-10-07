-- Godown negative-stock flag is an Owner/Admin control; company members list.
begin;
set client_min_messages = notice;
insert into test.ctx values ('fx', test.fixture('UI-TEST'));
select test.login(test.id('operator'));
select test.throws(format($$ update public.godowns set allow_negative = true where id = %L $$, test.id('b336')),
                   'Only the Owner / Admin can allow negative stock%', 'Operator cannot allow negative stock for a godown');
select test.throws(format($$ insert into public.godowns (company_id, code, name, allow_negative) values (%L, 'NEG', 'Neg', true) $$, test.id('company')),
                   'Only the Owner / Admin%', 'Operator cannot create a godown that allows negative stock');
select test.throws(format($$ select public.company_members(%L) $$, test.id('company')), 'Permission denied%', 'Operator cannot list members');
select test.login(test.id('admin'));
update public.godowns set allow_negative = true where id = test.id('b336');
select test.ok((select allow_negative from public.godowns where id = test.id('b336')), 'Admin can allow negative stock for a godown');
select test.eq((select count(*) from public.company_members(test.id('company')))::int, 3, 'Admin lists 3 members');
select test.ok((select 'OWNER' = any (roles) from public.company_members(test.id('company')) where email like '%-admin@%'),
               'Creator is OWNER');
rollback;
