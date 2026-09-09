begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(1);

select ok(current_database() is not null, 'database test harness is available');

select * from finish();

rollback;
