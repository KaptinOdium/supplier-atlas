create table public.atlas_agent_scans (
  user_id uuid not null references public.supplier_members(user_id) on delete cascade,
  id uuid not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  lease_id uuid not null,
  attempts integer not null check (attempts between 1 and 2),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb,
  error text,
  primary key (user_id, id),
  check (
    (status = 'running' and result is null and error is null and finished_at is null) or
    (status = 'succeeded' and result is not null and error is null and finished_at is not null) or
    (status = 'failed' and result is null and error is not null and finished_at is not null)
  )
);

create index atlas_agent_scans_latest_success
  on public.atlas_agent_scans (user_id, finished_at desc) where status = 'succeeded';
alter table public.atlas_agent_scans enable row level security;
revoke all on public.atlas_agent_scans from public, anon, authenticated;
grant select (user_id, id, status, finished_at, result, error) on public.atlas_agent_scans to authenticated;
grant select, insert, update on public.atlas_agent_scans to service_role;

create policy atlas_agent_scans_own_reads on public.atlas_agent_scans for select to authenticated
  using (
    user_id = (select auth.uid()) and exists (
      select 1 from public.supplier_members m
      where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','editor','viewer')
    )
  );

-- A retry or concurrent poll for the same member and click can start at most
-- one worker per lease. A crashed worker can be replaced once after expiry.
create function public.reserve_atlas_agent_scan(p_user_id uuid, p_id uuid, p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  job public.atlas_agent_scans;
  claimed boolean := false;
begin
  if not exists (
    select 1 from public.supplier_members
    where user_id = p_user_id and active and role in ('owner','editor','viewer')
  ) then
    raise insufficient_privilege using message = 'An active Atlas membership is required.';
  end if;

  insert into public.atlas_agent_scans (user_id,id,lease_id,status,attempts)
    values (p_user_id,p_id,p_lease,'running',1)
    on conflict (user_id,id) do nothing returning * into job;
  if found then
    claimed := true;
  else
    select * into strict job from public.atlas_agent_scans
      where user_id = p_user_id and id = p_id for update;
    if job.status = 'running' and job.started_at < now() - interval '2 minutes' then
      if job.attempts < 2 then
        update public.atlas_agent_scans
          set started_at = now(), lease_id = p_lease, attempts = attempts + 1
          where user_id = p_user_id and id = p_id returning * into job;
        claimed := true;
      else
        update public.atlas_agent_scans
          set status = 'failed', finished_at = now(), error = 'The research worker timed out. Start a new scan.'
          where user_id = p_user_id and id = p_id returning * into job;
      end if;
    end if;
  end if;
  return jsonb_build_object('claimed',claimed,'id',job.id,'status',job.status,'result',job.result,'error',job.error);
end;
$$;
revoke all on function public.reserve_atlas_agent_scan(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.reserve_atlas_agent_scan(uuid,uuid,uuid) to service_role;
