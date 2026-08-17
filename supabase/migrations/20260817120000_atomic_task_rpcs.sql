-- Atomic board mutations for drag/drop and the task detail editor.

begin;

create or replace function public.reorder_tasks(p_updates jsonb)
returns setof public.tasks
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  requested_count integer;
  affected_count integer;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'An authenticated user is required';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_updates must be a JSON array';
  end if;

  select count(*)
  into requested_count
  from jsonb_array_elements(p_updates);

  if exists (
    select 1
    from jsonb_array_elements(p_updates) as entry(value)
    where jsonb_typeof(value) <> 'object'
      or not (value ? 'id')
      or jsonb_typeof(value -> 'id') <> 'string'
      or not (value ? 'status')
      or jsonb_typeof(value -> 'status') <> 'string'
      or value ->> 'status' not in (
        'todo',
        'in_progress',
        'in_review',
        'done'
      )
      or not (value ? 'position')
      or jsonb_typeof(value -> 'position') <> 'number'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Each update must contain string id, valid status, and numeric position';
  end if;

  if requested_count <> (
    select count(distinct value ->> 'id')
    from jsonb_array_elements(p_updates) as entry(value)
  ) then
    raise exception using
      errcode = '22023',
      message = 'p_updates must not contain duplicate task ids';
  end if;

  return query
  with requested as (
    select update_row.id, update_row.status, update_row.position
    from jsonb_to_recordset(p_updates) as update_row(
      id uuid,
      status text,
      position numeric
    )
  ),
  changed as (
    update public.tasks as task
    set
      status = requested.status,
      position = requested.position
    from requested
    where task.id = requested.id
      and task.user_id = current_user_id
    returning task.*
  )
  select changed.*
  from changed;

  get diagnostics affected_count = row_count;

  if affected_count <> requested_count then
    raise exception using
      errcode = 'P0002',
      message = 'One or more tasks were not found or are not owned by the current user';
  end if;
end;
$$;

create or replace function public.create_task_with_relationships(
  p_title text,
  p_description text,
  p_status text,
  p_priority text,
  p_due_date date,
  p_position numeric,
  p_assignee_ids uuid[] default array[]::uuid[],
  p_label_ids uuid[] default array[]::uuid[]
)
returns setof public.tasks
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  requested_assignee_ids uuid[] := coalesce(
    p_assignee_ids,
    array[]::uuid[]
  );
  requested_label_ids uuid[] := coalesce(
    p_label_ids,
    array[]::uuid[]
  );
  created_task public.tasks%rowtype;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'An authenticated user is required';
  end if;

  if exists (
    select 1
    from unnest(requested_assignee_ids) as requested(member_id)
    left join public.team_members as member
      on member.id = requested.member_id
      and member.user_id = current_user_id
    where member.id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every assignee must belong to the current user';
  end if;

  if exists (
    select 1
    from unnest(requested_label_ids) as requested(label_id)
    left join public.labels as label
      on label.id = requested.label_id
      and label.user_id = current_user_id
    where label.id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every label must belong to the current user';
  end if;

  insert into public.tasks (
    user_id,
    title,
    description,
    status,
    priority,
    due_date,
    position
  ) values (
    current_user_id,
    p_title,
    p_description,
    p_status,
    p_priority,
    p_due_date,
    p_position
  )
  returning * into created_task;

  insert into public.task_assignees (
    task_id,
    team_member_id,
    user_id
  )
  select
    created_task.id,
    requested.member_id,
    current_user_id
  from (
    select distinct unnest(requested_assignee_ids) as member_id
  ) as requested;

  insert into public.task_labels (
    task_id,
    label_id,
    user_id
  )
  select
    created_task.id,
    requested.label_id,
    current_user_id
  from (
    select distinct unnest(requested_label_ids) as label_id
  ) as requested;

  return query
  select task.*
  from public.tasks as task
  where task.id = created_task.id
    and task.user_id = current_user_id;
end;
$$;


create or replace function public.update_task_with_relationships(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_status text,
  p_priority text,
  p_due_date date,
  p_position numeric,
  p_assignee_ids uuid[] default array[]::uuid[],
  p_label_ids uuid[] default array[]::uuid[]
)
returns setof public.tasks
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  requested_assignee_ids uuid[] := coalesce(
    p_assignee_ids,
    array[]::uuid[]
  );
  requested_label_ids uuid[] := coalesce(
    p_label_ids,
    array[]::uuid[]
  );
  updated_task public.tasks%rowtype;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'An authenticated user is required';
  end if;

  update public.tasks as task
  set
    title = p_title,
    description = p_description,
    status = p_status,
    priority = p_priority,
    due_date = p_due_date,
    position = p_position
  where task.id = p_task_id
    and task.user_id = current_user_id
  returning task.* into updated_task;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Task was not found or is not owned by the current user';
  end if;

  if exists (
    select 1
    from unnest(requested_assignee_ids) as requested(member_id)
    left join public.team_members as member
      on member.id = requested.member_id
      and member.user_id = current_user_id
    where member.id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every assignee must belong to the current user';
  end if;

  if exists (
    select 1
    from unnest(requested_label_ids) as requested(label_id)
    left join public.labels as label
      on label.id = requested.label_id
      and label.user_id = current_user_id
    where label.id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every label must belong to the current user';
  end if;

  delete from public.task_assignees as assignment
  where assignment.task_id = p_task_id
    and assignment.user_id = current_user_id
    and not (
      assignment.team_member_id = any(requested_assignee_ids)
    );

  insert into public.task_assignees (
    task_id,
    team_member_id,
    user_id
  )
  select
    p_task_id,
    requested.member_id,
    current_user_id
  from (
    select distinct unnest(requested_assignee_ids) as member_id
  ) as requested
  on conflict (task_id, team_member_id) do nothing;

  delete from public.task_labels as task_label
  where task_label.task_id = p_task_id
    and task_label.user_id = current_user_id
    and not (task_label.label_id = any(requested_label_ids));

  insert into public.task_labels (
    task_id,
    label_id,
    user_id
  )
  select
    p_task_id,
    requested.label_id,
    current_user_id
  from (
    select distinct unnest(requested_label_ids) as label_id
  ) as requested
  on conflict (task_id, label_id) do nothing;

  return query
  select task.*
  from public.tasks as task
  where task.id = p_task_id
    and task.user_id = current_user_id;
end;
$$;

comment on function public.reorder_tasks(jsonb) is
  'Atomically updates status and position for an owned batch of tasks.';

comment on function public.create_task_with_relationships(
  text,
  text,
  text,
  text,
  date,
  numeric,
  uuid[],
  uuid[]
) is
  'Atomically creates an owned task with its assignees and labels.';

comment on function public.update_task_with_relationships(
  uuid,
  text,
  text,
  text,
  text,
  date,
  numeric,
  uuid[],
  uuid[]
) is
  'Atomically edits an owned task and synchronizes its assignees and labels.';

revoke all on function public.reorder_tasks(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_task_with_relationships(
  text,
  text,
  text,
  text,
  date,
  numeric,
  uuid[],
  uuid[]
) from public, anon, authenticated, service_role;
revoke all on function public.update_task_with_relationships(
  uuid,
  text,
  text,
  text,
  text,
  date,
  numeric,
  uuid[],
  uuid[]
) from public, anon, authenticated, service_role;

grant execute on function public.reorder_tasks(jsonb) to authenticated;
grant execute on function public.create_task_with_relationships(
  text,
  text,
  text,
  text,
  date,
  numeric,
  uuid[],
  uuid[]
) to authenticated;
grant execute on function public.update_task_with_relationships(
  uuid,
  text,
  text,
  text,
  text,
  date,
  numeric,
  uuid[],
  uuid[]
) to authenticated;

commit;
