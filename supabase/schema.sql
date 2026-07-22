-- Task Board: complete Supabase schema
--
-- Anonymous Supabase users receive the `authenticated` database role after
-- sign-in. Every row is scoped to auth.uid(), and unauthenticated (`anon`)
-- clients receive no table privileges.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Core entities
-- ---------------------------------------------------------------------------

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo',
  priority text not null default 'normal',
  due_date date,
  -- Fractional positions let the client insert a card between two cards
  -- without rewriting the entire column.
  position numeric(20, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_id_user_id_key unique (id, user_id),
  constraint tasks_title_not_blank
    check (char_length(btrim(title)) between 1 and 240),
  constraint tasks_description_length
    check (description is null or char_length(description) <= 20000),
  constraint tasks_status_valid
    check (status in ('todo', 'in_progress', 'in_review', 'done')),
  constraint tasks_priority_valid
    check (priority in ('low', 'normal', 'high'))
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null,
  avatar_url text,
  color text not null default '#64748B',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint team_members_id_user_id_key unique (id, user_id),
  constraint team_members_name_not_blank
    check (char_length(btrim(name)) between 1 and 100),
  constraint team_members_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048),
  constraint team_members_color_hex
    check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#6366F1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint labels_id_user_id_key unique (id, user_id),
  constraint labels_name_not_blank
    check (char_length(btrim(name)) between 1 and 40),
  constraint labels_color_hex
    check (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- A guest may use the same label name with different casing only once.
create unique index if not exists labels_user_name_unique
  on public.labels (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- Task relationships and collaboration data
--
-- Each relationship stores user_id and uses composite foreign keys. This is
-- deliberate: even privileged/import code cannot link a task owned by one
-- guest to a member or label owned by another guest.
-- ---------------------------------------------------------------------------

create table if not exists public.task_assignees (
  task_id uuid not null,
  team_member_id uuid not null,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (task_id, team_member_id),
  constraint task_assignees_task_owner_fkey
    foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  constraint task_assignees_member_owner_fkey
    foreign key (team_member_id, user_id)
    references public.team_members (id, user_id) on delete cascade
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint comments_id_user_id_key unique (id, user_id),
  constraint comments_task_owner_fkey
    foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  constraint comments_body_not_blank
    check (char_length(btrim(body)) between 1 and 10000)
);

create table if not exists public.task_labels (
  task_id uuid not null,
  label_id uuid not null,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (task_id, label_id),
  constraint task_labels_task_owner_fkey
    foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  constraint task_labels_label_owner_fkey
    foreign key (label_id, user_id)
    references public.labels (id, user_id) on delete cascade
);

-- Activity rows are append-only to API clients. Database triggers below write
-- authoritative history for task edits, moves, comments, labels and assignees.
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  user_id uuid not null,
  action text not null,
  old_status text,
  new_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint activity_logs_task_owner_fkey
    foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  constraint activity_logs_action_valid check (
    action in (
      'task_created',
      'task_updated',
      'status_changed',
      'assignee_added',
      'assignee_removed',
      'comment_added',
      'label_added',
      'label_removed'
    )
  ),
  constraint activity_logs_old_status_valid check (
    old_status is null
    or old_status in ('todo', 'in_progress', 'in_review', 'done')
  ),
  constraint activity_logs_new_status_valid check (
    new_status is null
    or new_status in ('todo', 'in_progress', 'in_review', 'done')
  ),
  constraint activity_logs_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

-- ---------------------------------------------------------------------------
-- Indexes for board loading, filtering and detail views
-- ---------------------------------------------------------------------------

create index if not exists tasks_user_status_position_idx
  on public.tasks (user_id, status, position, created_at);

create index if not exists tasks_user_priority_idx
  on public.tasks (user_id, priority);

create index if not exists tasks_user_due_date_idx
  on public.tasks (user_id, due_date)
  where due_date is not null and status <> 'done';

create index if not exists tasks_user_created_at_idx
  on public.tasks (user_id, created_at desc);

create index if not exists team_members_user_created_at_idx
  on public.team_members (user_id, created_at);

create index if not exists task_assignees_user_member_idx
  on public.task_assignees (user_id, team_member_id, task_id);

create index if not exists comments_user_task_created_at_idx
  on public.comments (user_id, task_id, created_at);

create index if not exists labels_user_created_at_idx
  on public.labels (user_id, created_at);

create index if not exists task_labels_user_label_idx
  on public.task_labels (user_id, label_id, task_id);

create index if not exists activity_logs_user_task_created_at_idx
  on public.activity_logs (user_id, task_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Timestamp and relationship-integrity triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists team_members_set_updated_at on public.team_members;
create trigger team_members_set_updated_at
before update on public.team_members
for each row execute function public.set_updated_at();

drop trigger if exists labels_set_updated_at on public.labels;
create trigger labels_set_updated_at
before update on public.labels
for each row execute function public.set_updated_at();

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
before update on public.comments
for each row execute function public.set_updated_at();

-- These friendly validation triggers duplicate the composite FKs intentionally:
-- they reject cross-owner links before constraint evaluation and return a clear
-- error to direct API clients.
create or replace function public.validate_task_assignee_ownership()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.tasks as task
    where task.id = new.task_id and task.user_id = new.user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Task does not belong to the assignment owner';
  end if;

  if not exists (
    select 1
    from public.team_members as member
    where member.id = new.team_member_id and member.user_id = new.user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Team member does not belong to the assignment owner';
  end if;

  return new;
end;
$$;

drop trigger if exists task_assignees_validate_ownership
  on public.task_assignees;
create trigger task_assignees_validate_ownership
before insert or update on public.task_assignees
for each row execute function public.validate_task_assignee_ownership();

create or replace function public.validate_task_label_ownership()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.tasks as task
    where task.id = new.task_id and task.user_id = new.user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Task does not belong to the label relationship owner';
  end if;

  if not exists (
    select 1
    from public.labels as label
    where label.id = new.label_id and label.user_id = new.user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Label does not belong to the relationship owner';
  end if;

  return new;
end;
$$;

drop trigger if exists task_labels_validate_ownership on public.task_labels;
create trigger task_labels_validate_ownership
before insert or update on public.task_labels
for each row execute function public.validate_task_label_ownership();

create or replace function public.validate_comment_ownership()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.tasks as task
    where task.id = new.task_id and task.user_id = new.user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Task does not belong to the comment owner';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_validate_ownership on public.comments;
create trigger comments_validate_ownership
before insert or update on public.comments
for each row execute function public.validate_comment_ownership();

-- ---------------------------------------------------------------------------
-- Automatic, append-only activity history
-- ---------------------------------------------------------------------------

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  changed_fields text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (
      task_id,
      user_id,
      action,
      new_status,
      metadata
    ) values (
      new.id,
      new.user_id,
      'task_created',
      new.status,
      jsonb_build_object('title', new.title)
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.activity_logs (
      task_id,
      user_id,
      action,
      old_status,
      new_status,
      metadata
    ) values (
      new.id,
      new.user_id,
      'status_changed',
      old.status,
      new.status,
      '{}'::jsonb
    );
  end if;

  if old.title is distinct from new.title then
    changed_fields := array_append(changed_fields, 'title');
  end if;
  if old.description is distinct from new.description then
    changed_fields := array_append(changed_fields, 'description');
  end if;
  if old.priority is distinct from new.priority then
    changed_fields := array_append(changed_fields, 'priority');
  end if;
  if old.due_date is distinct from new.due_date then
    changed_fields := array_append(changed_fields, 'due_date');
  end if;

  if cardinality(changed_fields) > 0 then
    insert into public.activity_logs (
      task_id,
      user_id,
      action,
      metadata
    ) values (
      new.id,
      new.user_id,
      'task_updated',
      jsonb_build_object('fields', to_jsonb(changed_fields))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_log_activity on public.tasks;
create trigger tasks_log_activity
after insert or update on public.tasks
for each row execute function public.log_task_activity();

create or replace function public.log_assignee_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  source_task_id uuid;
  source_user_id uuid;
  source_member_id uuid;
  source_action text;
begin
  -- Skip relationship removals performed by an FK cascade (for example when
  -- the task itself is deleted). Direct unassign operations run at depth 1.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'INSERT' then
    source_task_id := new.task_id;
    source_user_id := new.user_id;
    source_member_id := new.team_member_id;
    source_action := 'assignee_added';
  else
    source_task_id := old.task_id;
    source_user_id := old.user_id;
    source_member_id := old.team_member_id;
    source_action := 'assignee_removed';
  end if;

  -- During a task/user cascade the parent may already be gone; no activity
  -- should be created for a task whose history is being deleted.
  if exists (
    select 1 from public.tasks
    where id = source_task_id and user_id = source_user_id
  ) then
    insert into public.activity_logs (
      task_id,
      user_id,
      action,
      metadata
    ) values (
      source_task_id,
      source_user_id,
      source_action,
      jsonb_build_object('team_member_id', source_member_id)
    );
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists task_assignees_log_activity
  on public.task_assignees;
create trigger task_assignees_log_activity
after insert or delete on public.task_assignees
for each row execute function public.log_assignee_activity();

create or replace function public.log_label_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  source_task_id uuid;
  source_user_id uuid;
  source_label_id uuid;
  source_action text;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'INSERT' then
    source_task_id := new.task_id;
    source_user_id := new.user_id;
    source_label_id := new.label_id;
    source_action := 'label_added';
  else
    source_task_id := old.task_id;
    source_user_id := old.user_id;
    source_label_id := old.label_id;
    source_action := 'label_removed';
  end if;

  if exists (
    select 1 from public.tasks
    where id = source_task_id and user_id = source_user_id
  ) then
    insert into public.activity_logs (
      task_id,
      user_id,
      action,
      metadata
    ) values (
      source_task_id,
      source_user_id,
      source_action,
      jsonb_build_object('label_id', source_label_id)
    );
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists task_labels_log_activity on public.task_labels;
create trigger task_labels_log_activity
after insert or delete on public.task_labels
for each row execute function public.log_label_activity();

create or replace function public.log_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.activity_logs (
    task_id,
    user_id,
    action,
    metadata
  ) values (
    new.task_id,
    new.user_id,
    'comment_added',
    jsonb_build_object('comment_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists comments_log_activity on public.comments;
create trigger comments_log_activity
after insert on public.comments
for each row execute function public.log_comment_activity();

-- Trigger functions should not be callable as public RPCs. Triggers continue
-- to execute with these privileges revoked.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.validate_task_assignee_ownership()
  from public, anon, authenticated;
revoke all on function public.validate_task_label_ownership()
  from public, anon, authenticated;
revoke all on function public.validate_comment_ownership()
  from public, anon, authenticated;
revoke all on function public.log_task_activity()
  from public, anon, authenticated;
revoke all on function public.log_assignee_activity()
  from public, anon, authenticated;
revoke all on function public.log_label_activity()
  from public, anon, authenticated;
revoke all on function public.log_comment_activity()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.tasks enable row level security;
alter table public.team_members enable row level security;
alter table public.task_assignees enable row level security;
alter table public.comments enable row level security;
alter table public.activity_logs enable row level security;
alter table public.labels enable row level security;
alter table public.task_labels enable row level security;

drop policy if exists tasks_owner_access on public.tasks;
create policy tasks_owner_access
on public.tasks
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists team_members_owner_access on public.team_members;
create policy team_members_owner_access
on public.team_members
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists labels_owner_access on public.labels;
create policy labels_owner_access
on public.labels
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists task_assignees_owner_access
  on public.task_assignees;
create policy task_assignees_owner_access
on public.task_assignees
for all
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.tasks as task
    where task.id = task_assignees.task_id
      and task.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.team_members as member
    where member.id = task_assignees.team_member_id
      and member.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.tasks as task
    where task.id = task_assignees.task_id
      and task.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.team_members as member
    where member.id = task_assignees.team_member_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists comments_owner_access on public.comments;
create policy comments_owner_access
on public.comments
for all
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.tasks as task
    where task.id = comments.task_id
      and task.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.tasks as task
    where task.id = comments.task_id
      and task.user_id = (select auth.uid())
  )
);

drop policy if exists task_labels_owner_access on public.task_labels;
create policy task_labels_owner_access
on public.task_labels
for all
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.tasks as task
    where task.id = task_labels.task_id
      and task.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.labels as label
    where label.id = task_labels.label_id
      and label.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.tasks as task
    where task.id = task_labels.task_id
      and task.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.labels as label
    where label.id = task_labels.label_id
      and label.user_id = (select auth.uid())
  )
);

-- Audit history is readable but not directly writable by browser clients.
drop policy if exists activity_logs_owner_read on public.activity_logs;
create policy activity_logs_owner_read
on public.activity_logs
for select
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.tasks as task
    where task.id = activity_logs.task_id
      and task.user_id = (select auth.uid())
  )
);

-- Explicit grants complement RLS. A Supabase anonymous-auth session uses the
-- authenticated role; a client without a session uses anon and has no access.
revoke all on table public.tasks from public, anon;
revoke all on table public.team_members from public, anon;
revoke all on table public.task_assignees from public, anon;
revoke all on table public.comments from public, anon;
revoke all on table public.activity_logs from public, anon;
revoke all on table public.labels from public, anon;
revoke all on table public.task_labels from public, anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.team_members to authenticated;
grant select, insert, update, delete on table public.task_assignees to authenticated;
grant select, insert, update, delete on table public.comments to authenticated;
grant select on table public.activity_logs to authenticated;
grant select, insert, update, delete on table public.labels to authenticated;
grant select, insert, update, delete on table public.task_labels to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Supabase normally creates supabase_realtime. The guarded block also supports
-- a fresh local Postgres instance and does not fail if a table was added before.
-- RLS SELECT policies remain the authorization boundary for subscriptions.
-- ---------------------------------------------------------------------------

alter table public.tasks replica identity full;
alter table public.team_members replica identity full;
alter table public.task_assignees replica identity full;
alter table public.comments replica identity full;
alter table public.activity_logs replica identity full;
alter table public.labels replica identity full;
alter table public.task_labels replica identity full;

do $$
declare
  relation_name text;
  realtime_relations constant text[] := array[
    'tasks',
    'team_members',
    'task_assignees',
    'comments',
    'activity_logs',
    'labels',
    'task_labels'
  ];
begin
  if not exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    execute 'create publication supabase_realtime';
  end if;

  foreach relation_name in array realtime_relations loop
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = relation_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        relation_name
      );
    end if;
  end loop;
end;
$$;

commit;
