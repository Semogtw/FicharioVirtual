revoke execute on function public.normalize_search_text(text) from public, anon;
revoke execute on function public.page_effective_text(public.pages) from public, anon;

grant execute on function public.normalize_search_text(text) to authenticated;
grant execute on function public.page_effective_text(public.pages) to authenticated;
