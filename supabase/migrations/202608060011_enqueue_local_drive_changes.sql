create or replace function public.is_drive_service_request()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role(),
    ''
  ) = 'service_role';
$$;

revoke execute on function public.is_drive_service_request() from public, anon;
grant execute on function public.is_drive_service_request() to authenticated, service_role;

create unique index drive_sync_jobs_one_active_folder_create
  on public.drive_sync_jobs (user_id, notebook_id)
  where operation = 'create_folder'
    and status in ('pending', 'processing', 'retryable');

create or replace function public.mark_local_notebook_drive_pending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_drive_service_request() then
    return new;
  end if;

  if new.drive_folder_id is not null
    and (
      new.name is distinct from old.name
      or new.parent_notebook_id is distinct from old.parent_notebook_id
    )
  then
    new.drive_sync_status := 'pending';
  end if;

  return new;
end;
$$;

create or replace function public.enqueue_local_notebook_drive_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  operation_name public.drive_sync_operation;
  desired_payload jsonb;
begin
  if public.is_drive_service_request() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.drive_folder_id is null then
      insert into public.drive_sync_jobs (
        user_id,
        operation,
        status,
        notebook_id,
        idempotency_key,
        payload
      )
      select
        new.user_id,
        'create_folder',
        'pending',
        new.id,
        'local:create_folder:' || new.id::text || ':' || extensions.gen_random_uuid()::text,
        jsonb_strip_nulls(
          jsonb_build_object(
            'name', new.name,
            'parentNotebookId', new.parent_notebook_id
          )
        )
      where not exists (
        select 1
        from public.drive_sync_jobs as job
        where job.user_id = new.user_id
          and job.notebook_id = new.id
          and job.operation = 'create_folder'
          and job.status in ('pending', 'processing', 'retryable')
      );
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.drive_folder_id is not null then
      insert into public.drive_sync_jobs (
        user_id,
        operation,
        status,
        drive_file_id,
        idempotency_key,
        payload
      ) values (
        old.user_id,
        'delete_permanently',
        'pending',
        old.drive_folder_id,
        'local:delete_folder:' || old.id::text || ':' || extensions.gen_random_uuid()::text,
        jsonb_build_object(
          'targetKind', 'folder',
          'name', old.name,
          'deletedNotebookId', old.id
        )
      );
    end if;
    return old;
  end if;

  if new.drive_folder_id is null then
    insert into public.drive_sync_jobs (
      user_id,
      operation,
      status,
      notebook_id,
      idempotency_key,
      payload
    )
    select
      new.user_id,
      'create_folder',
      'pending',
      new.id,
      'local:create_folder:' || new.id::text || ':' || extensions.gen_random_uuid()::text,
      jsonb_strip_nulls(
        jsonb_build_object(
          'name', new.name,
          'parentNotebookId', new.parent_notebook_id
        )
      )
    where not exists (
      select 1
      from public.drive_sync_jobs as job
      where job.user_id = new.user_id
        and job.notebook_id = new.id
        and job.operation = 'create_folder'
        and job.status in ('pending', 'processing', 'retryable')
    );
    return new;
  end if;

  if new.name is distinct from old.name then
    operation_name := 'rename_folder';
    desired_payload := jsonb_build_object('name', new.name);
    insert into public.drive_sync_jobs (
      user_id,
      operation,
      status,
      notebook_id,
      drive_file_id,
      idempotency_key,
      payload
    ) values (
      new.user_id,
      operation_name,
      'pending',
      new.id,
      new.drive_folder_id,
      'local:rename_folder:' || new.id::text || ':' || extensions.gen_random_uuid()::text,
      desired_payload
    );
  end if;

  if new.parent_notebook_id is distinct from old.parent_notebook_id then
    operation_name := 'move_folder';
    desired_payload := jsonb_strip_nulls(
      jsonb_build_object('parentNotebookId', new.parent_notebook_id)
    );
    insert into public.drive_sync_jobs (
      user_id,
      operation,
      status,
      notebook_id,
      drive_file_id,
      idempotency_key,
      payload
    ) values (
      new.user_id,
      operation_name,
      'pending',
      new.id,
      new.drive_folder_id,
      'local:move_folder:' || new.id::text || ':' || extensions.gen_random_uuid()::text,
      desired_payload
    );
  end if;

  return new;
end;
$$;

create or replace function public.enqueue_local_document_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_drive_service_request()
    or new.notebook_id is not distinct from old.notebook_id
    or new.drive_file_id is null
  then
    return new;
  end if;

  new.drive_sync_status := 'pending';

  insert into public.drive_sync_jobs (
    user_id,
    operation,
    status,
    document_id,
    drive_file_id,
    idempotency_key,
    payload
  ) values (
    new.user_id,
    'update_file',
    'pending',
    new.id,
    new.drive_file_id,
    'local:update_file:' || new.id::text || ':' || extensions.gen_random_uuid()::text,
    jsonb_strip_nulls(jsonb_build_object('notebookId', new.notebook_id))
  );

  return new;
end;
$$;

create or replace function public.enqueue_local_document_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_drive_service_request() or old.drive_file_id is null then
    return old;
  end if;

  insert into public.drive_sync_jobs (
    user_id,
    operation,
    status,
    drive_file_id,
    idempotency_key,
    payload
  ) values (
    old.user_id,
    'delete_permanently',
    'pending',
    old.drive_file_id,
    'local:delete_file:' || old.id::text || ':' || extensions.gen_random_uuid()::text,
    jsonb_build_object(
      'targetKind', 'file',
      'name', old.original_filename,
      'mimeType', coalesce(old.drive_mime_type, ''),
      'deletedDocumentId', old.id
    )
  );

  return old;
end;
$$;

create trigger notebooks_mark_drive_pending
before update of name, parent_notebook_id on public.notebooks
for each row execute function public.mark_local_notebook_drive_pending();

create trigger notebooks_enqueue_drive_create
after insert on public.notebooks
for each row execute function public.enqueue_local_notebook_drive_change();

create trigger notebooks_enqueue_drive_update
after update of name, parent_notebook_id on public.notebooks
for each row execute function public.enqueue_local_notebook_drive_change();

create trigger notebooks_enqueue_drive_delete
before delete on public.notebooks
for each row execute function public.enqueue_local_notebook_drive_change();

create trigger documents_enqueue_drive_move
before update of notebook_id on public.documents
for each row execute function public.enqueue_local_document_move();

create trigger documents_enqueue_drive_delete
before delete on public.documents
for each row execute function public.enqueue_local_document_delete();

insert into public.drive_sync_jobs (
  user_id,
  operation,
  status,
  notebook_id,
  idempotency_key,
  payload
)
select
  notebook.user_id,
  'create_folder',
  'pending',
  notebook.id,
  'backfill:create_folder:' || notebook.id::text,
  jsonb_strip_nulls(
    jsonb_build_object(
      'name', notebook.name,
      'parentNotebookId', notebook.parent_notebook_id
    )
  )
from public.notebooks as notebook
join public.app_users as app_user
  on app_user.user_id = notebook.user_id
 and app_user.is_active
where notebook.drive_folder_id is null
  and not exists (
    select 1
    from public.drive_sync_jobs as job
    where job.user_id = notebook.user_id
      and job.notebook_id = notebook.id
      and job.operation = 'create_folder'
      and job.status in ('pending', 'processing', 'retryable')
  )
on conflict (user_id, idempotency_key) do nothing;
