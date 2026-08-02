alter table public.tags
  drop constraint if exists tags_name_check,
  drop constraint if exists tags_normalized_name_check,
  drop constraint if exists tags_name_length_check,
  drop constraint if exists tags_normalized_name_length_check;

alter table public.tags
  add constraint tags_name_length_check
    check (char_length(name) between 1 and 120),
  add constraint tags_normalized_name_length_check
    check (char_length(normalized_name) between 1 and 120);
