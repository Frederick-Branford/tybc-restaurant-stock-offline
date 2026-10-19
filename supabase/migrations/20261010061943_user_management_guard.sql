-- ============================================================
-- Restaurant Stock System
-- Migration 009: User Management Guard
-- ============================================================

-- This command is intentionally service-role only.
-- Browser clients must never modify user role / active state directly.

create or replace function public.update_user_access(
  p_target_user_id uuid,
  p_role_code text,
  p_is_active boolean,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_role_code text;

  v_current_role_code text;
  v_current_active boolean;

  v_new_role_id uuid;

  v_active_owner_count integer;
begin
  -- ----------------------------------------------------------
  -- Basic validation
  -- ----------------------------------------------------------

  if p_actor_id is null then
    raise exception
      'Actor user id is required.';
  end if;

  if p_target_user_id is null then
    raise exception
      'Target user id is required.';
  end if;

  if p_role_code is null
     or length(trim(p_role_code)) = 0 then
    raise exception
      'Role code is required.';
  end if;

  if p_is_active is null then
    raise exception
      'Active status is required.';
  end if;

  v_requested_role_code :=
    upper(trim(p_role_code));


  -- ----------------------------------------------------------
  -- Permission
  -- ----------------------------------------------------------

  if not public.user_has_permission(
    p_actor_id,
    'users.manage'
  ) then
    raise exception
      'USER_MANAGEMENT_FORBIDDEN'
      using errcode = 'P0001';
  end if;


  -- ----------------------------------------------------------
  -- Serialize OWNER access mutations.
  --
  -- Prevents two concurrent admins from both observing
  -- another active OWNER and removing the final owners.
  -- ----------------------------------------------------------

  perform pg_advisory_xact_lock(
    hashtext(
      'restaurant-stock:user-management-owner-guard'
    )::bigint
  );


  -- ----------------------------------------------------------
  -- Lock target profile
  -- ----------------------------------------------------------

  select
    r.code,
    pr.is_active
  into
    v_current_role_code,
    v_current_active

  from public.profiles pr

  left join public.roles r
    on r.id = pr.role_id

  where pr.id = p_target_user_id

  for update of pr;


  if not found then
    raise exception
      'TARGET_PROFILE_NOT_FOUND'
      using errcode = 'P0001';
  end if;


  -- ----------------------------------------------------------
  -- Requested role must exist and be active
  -- ----------------------------------------------------------

  select r.id
  into v_new_role_id
  from public.roles r
  where r.code = v_requested_role_code
    and r.is_active = true
  limit 1;


  if v_new_role_id is null then
    raise exception
      'ROLE_NOT_AVAILABLE: %',
      v_requested_role_code
      using errcode = 'P0001';
  end if;


  -- ----------------------------------------------------------
  -- Self protection
  --
  -- OWNER may edit own profile information elsewhere,
  -- but may not remove their own administrative access.
  -- ----------------------------------------------------------

  if p_target_user_id = p_actor_id then

    if
      v_current_role_code is distinct from
        v_requested_role_code
      or
      v_current_active is distinct from
        p_is_active
    then
      raise exception
        'SELF_ACCESS_CHANGE_BLOCKED'
        using errcode = 'P0001';
    end if;

  end if;


  -- ----------------------------------------------------------
  -- Last active OWNER protection
  -- ----------------------------------------------------------

  if
    v_current_role_code = 'OWNER'
    and v_current_active = true
    and (
      v_requested_role_code <> 'OWNER'
      or p_is_active = false
    )
  then

    select count(*)
    into v_active_owner_count

    from public.profiles pr

    join public.roles r
      on r.id = pr.role_id

    where r.code = 'OWNER'
      and r.is_active = true
      and pr.is_active = true;


    if v_active_owner_count <= 1 then
      raise exception
        'LAST_ACTIVE_OWNER_PROTECTED'
        using errcode = 'P0001';
    end if;

  end if;


  -- ----------------------------------------------------------
  -- Update access
  -- ----------------------------------------------------------

  update public.profiles
  set
    role_id = v_new_role_id,
    is_active = p_is_active
  where id = p_target_user_id;

end;
$$;


-- ============================================================
-- Privileges
-- ============================================================

revoke all
on function public.update_user_access(
  uuid,
  text,
  boolean,
  uuid
)
from public, anon, authenticated;


grant execute
on function public.update_user_access(
  uuid,
  text,
  boolean,
  uuid
)
to service_role;


-- ============================================================
-- END MIGRATION 009
-- ============================================================