begin;

create extension if not exists pgtap with schema extensions;
select plan(1);

select ok(
  exists (
    select 1
    from pg_index as index_definition
    join pg_class as index_relation on index_relation.oid = index_definition.indexrelid
    where index_definition.indrelid = 'public.ocr_batches'::regclass
      and index_definition.indisvalid
      and index_definition.indisready
      and (
        select array_agg(attribute.attname order by key_position.ordinality)
        from unnest(index_definition.indkey::smallint[]) with ordinality as key_position(attribute_number, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = index_definition.indrelid
         and attribute.attnum = key_position.attribute_number
        where key_position.ordinality <= 2
      ) = array['document_id', 'user_id']::text[]
  ),
  'ocr_batches document ownership foreign key has a covering index'
);

select * from finish();
rollback;
