begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(
  position(
    'fotossintcse' in public.search_excerpt(
      repeat('contexto anterior ', 30)
        || 'fotossintcse transforma energia luminosa '
        || repeat('contexto posterior ', 30),
      'fotossíntese',
      120
    )
  ) > 0,
  'excerpt is centered around a fuzzy OCR-like token'
);

select ok(
  char_length(
    public.search_excerpt(
      repeat('contexto anterior ', 30)
        || 'fotossintcse transforma energia luminosa '
        || repeat('contexto posterior ', 30),
      'fotossíntese',
      120
    )
  ) <= 122,
  'excerpt remains bounded apart from the two ellipsis markers'
);

select is(
  public.search_excerpt('Fotossíntese e respiração celular.', 'fotossintese', 360),
  'Fotossíntese e respiração celular.',
  'short matching text is preserved verbatim'
);

select is(
  public.search_excerpt('', 'fotossíntese', 360),
  '',
  'empty text produces an empty excerpt'
);

select * from finish();
rollback;
