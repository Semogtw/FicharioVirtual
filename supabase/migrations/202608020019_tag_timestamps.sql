alter table public.tags
  add column if not exists updated_at timestamptz;

update public.tags
set updated_at = created_at
where updated_at is null;

alter table public.tags
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

drop trigger if exists tags_set_updated_at on public.tags;
create trigger tags_set_updated_at
before update on public.tags
for each row execute function public.set_updated_at();
