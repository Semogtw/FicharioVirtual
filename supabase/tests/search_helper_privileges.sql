begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(
  has_function_privilege(
    'authenticated',
    'public.normalize_search_text(text)',
    'execute'
  ),
  'authenticated can execute the pure search normalizer used by search_pages'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.page_effective_text(public.pages)',
    'execute'
  ),
  'authenticated can execute the pure effective-text helper used by search_pages'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.search_excerpt(text,text,integer)',
    'execute'
  ),
  'authenticated can execute the pure excerpt helper used by search_pages'
);

select ok(
  not has_function_privilege('anon', 'public.normalize_search_text(text)', 'execute'),
  'anon cannot execute the search normalizer'
);

select ok(
  not has_function_privilege('anon', 'public.page_effective_text(public.pages)', 'execute'),
  'anon cannot execute the effective-text helper'
);

select ok(
  not has_function_privilege('anon', 'public.search_excerpt(text,text,integer)', 'execute'),
  'anon cannot execute the excerpt helper'
);

select * from finish();
rollback;
