revoke execute on function public.search_excerpt(text, text, integer)
  from public, anon;
grant execute on function public.search_excerpt(text, text, integer)
  to authenticated;
