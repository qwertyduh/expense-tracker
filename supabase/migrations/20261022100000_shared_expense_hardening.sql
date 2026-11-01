-- Follow-up hardening for the shared-expense schema (additive; earlier
-- migrations are already deployed and are not edited).
--
--  * RPC surface: revoke EXECUTE from PUBLIC/anon (Postgres and Supabase both
--    grant it by default), keep it for authenticated only.
--  * pair_balances: group receivables by the debtor, not by the owner.
--  * create/update_shared_expense: ownership check on replay, duplicate
--    participants, owner_share + shares <= total, stable participant ids on
--    update (clients cache participant ids for queued settlements).
--  * void_shared_expense: lock the expense and participants before checking.
--  * send_friend_request: a mutual request accepts instead of ping-ponging.
--  * profiles: counterparties on shared expenses stay readable after an
--    unfriend; usernames cannot be renamed to reserved names.
--  * devices: security-definer token registration so a second account on the
--    same device can take over the push token.
--  * indexes for the hot RLS / query paths.

-- ---------------------------------------------------------------------------
-- Notification dedupe (notify-debt claims these atomically before sending)
-- ---------------------------------------------------------------------------

alter table public.shared_expenses
  add column if not exists created_notified_at timestamptz;
alter table public.shared_settlements
  add column if not exists notified_at timestamptz;

-- Rows that existed before this migration were already announced.
update public.shared_expenses
   set created_notified_at = created_at
 where created_notified_at is null;
update public.shared_settlements
   set notified_at = created_at
 where notified_at is null;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.can_read_expense(uuid),
  public.lookup_user(text),
  public.my_profile(),
  public.are_friends(uuid, uuid),
  public.send_friend_request(text),
  public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid),
  public.create_shared_expense(jsonb),
  public.update_shared_expense(jsonb),
  public.settle_share(uuid, numeric, text, text),
  public.dispute_share(uuid),
  public.void_shared_expense(uuid),
  public.pair_balances()
from public, anon;

-- are_friends(a, b) lets a caller probe any pair of UUIDs. Clients never call
-- it; it is only used inside security-definer functions (the profiles policy
-- below no longer needs it).
revoke execute on function public.are_friends(uuid, uuid) from authenticated;


-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists shared_expenses_owner_idx
  on public.shared_expenses (owner_id);
create index if not exists shared_participants_user_idx
  on public.shared_expense_participants (user_id);
create index if not exists shared_participants_expense_idx
  on public.shared_expense_participants (expense_id);
create index if not exists friendships_requester_idx
  on public.friendships (requester_id);
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id);
create index if not exists devices_user_idx
  on public.devices (user_id);
create index if not exists shared_settlements_payer_idx
  on public.shared_settlements (payer_id);
create index if not exists shared_settlements_payee_idx
  on public.shared_settlements (payee_id);
create index if not exists shared_settlements_participant_idx
  on public.shared_settlements (participant_id);
create index if not exists shared_adjustments_expense_idx
  on public.shared_expense_adjustments (expense_id);

-- ---------------------------------------------------------------------------
-- pair_balances: receivables belong to the debtor
-- ---------------------------------------------------------------------------

create or replace function public.pair_balances()
returns table (
  counterparty_id uuid,
  username text,
  display_name text,
  net numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select
      p.user_id as counterparty_id,
      round(sum(greatest(p.share_amount - p.settled_amount, 0)), 2) as amount
    from public.shared_expense_participants p
    join public.shared_expenses e on e.id = p.expense_id
    where e.owner_id = auth.uid()
      and e.status = 'active'
      and p.status = 'pending'
    group by p.user_id
  ),
  theirs as (
    select
      e.owner_id as counterparty_id,
      round(sum(greatest(p.share_amount - p.settled_amount, 0)), 2) as amount
    from public.shared_expense_participants p
    join public.shared_expenses e on e.id = p.expense_id
    where p.user_id = auth.uid()
      and e.status = 'active'
      and p.status = 'pending'
    group by e.owner_id
  ),
  combined as (
    select counterparty_id, amount from mine
    union all
    select counterparty_id, -amount from theirs
  )
  select
    c.counterparty_id,
    pr.username,
    pr.display_name,
    round(sum(c.amount), 2) as net
  from combined c
  join public.profiles pr on pr.id = c.counterparty_id
  group by c.counterparty_id, pr.username, pr.display_name
  having round(sum(c.amount), 2) <> 0;
$$;
revoke execute on function public.pair_balances() from public, anon;
grant execute on function public.pair_balances() to authenticated;

-- ---------------------------------------------------------------------------
-- Shared expense create / update / void
-- ---------------------------------------------------------------------------

create or replace function public.create_shared_expense(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_expense_id uuid := (p_payload ->> 'id')::uuid;
  v_total numeric := round((p_payload ->> 'total_amount')::numeric, 2);
  v_owner_share numeric := round((p_payload ->> 'owner_share')::numeric, 2);
  v_label text := nullif(btrim(coalesce(p_payload ->> 'label', '')), '');
  v_occurred_at timestamptz := coalesce(
    (p_payload ->> 'occurred_at')::timestamptz,
    now()
  );
  v_participant jsonb;
  v_profile public.profiles;
  v_share numeric;
  v_sum numeric := 0;
  v_seen uuid[] := '{}';
  v_existing public.shared_expenses;
begin
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;
  if v_expense_id is null then
    raise exception 'missing_expense_id';
  end if;
  if v_total is null or v_total <= 0 then
    raise exception 'invalid_total';
  end if;
  if v_owner_share is null or v_owner_share < 0 or v_owner_share > v_total then
    raise exception 'invalid_owner_share';
  end if;

  -- Replay of my own active create is a no-op; someone else's id is a
  -- conflict. My own voided expense is revived (a void is only allowed while
  -- nothing has been paid), so re-adding a friend after removing them all
  -- yields a working expense instead of a silently dead one.
  select * into v_existing
  from public.shared_expenses
  where id = v_expense_id
  for update;
  if found then
    if v_existing.owner_id <> v_owner then
      raise exception 'expense_id_conflict';
    end if;
    if v_existing.status = 'active' then
      return v_expense_id;
    end if;
    delete from public.shared_expense_participants where expense_id = v_expense_id;
    update public.shared_expenses
       set status = 'active', voided_at = null, locked_at = null,
           total_amount = v_total, owner_share = v_owner_share,
           label = v_label, occurred_at = v_occurred_at,
           created_notified_at = null,
           version = version + 1, updated_at = now()
     where id = v_expense_id;
  else
    insert into public.shared_expenses (
      id, owner_id, total_amount, owner_share, label, occurred_at
    ) values (
      v_expense_id, v_owner, v_total, v_owner_share, v_label, v_occurred_at
    );
  end if;

  for v_participant in
    select * from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]'::jsonb))
  loop
    v_share := round((v_participant ->> 'share_amount')::numeric, 2);
    if v_share is null or v_share <= 0 then
      raise exception 'invalid_share';
    end if;

    select * into v_profile
    from public.profiles
    where username = lower(btrim(v_participant ->> 'username'));
    if not found then
      raise exception 'user_not_found';
    end if;
    if v_profile.id = v_owner then
      raise exception 'cannot_split_with_self';
    end if;
    if v_profile.id = any (v_seen) then
      raise exception 'duplicate_participant';
    end if;
    if not public.are_friends(v_owner, v_profile.id) then
      raise exception 'not_friends';
    end if;

    v_seen := v_seen || v_profile.id;
    v_sum := v_sum + v_share;

    insert into public.shared_expense_participants (
      expense_id, user_id, share_amount
    ) values (
      v_expense_id, v_profile.id, v_share
    );
  end loop;

  -- Local-only participants never sync, so the linked shares may add up to
  -- less than the bill; they must never add up to more.
  if v_owner_share + v_sum > v_total + 0.01 then
    raise exception 'invalid_split';
  end if;

  return v_expense_id;
end;
$$;

create or replace function public.update_shared_expense(p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_expense_id uuid := (p_payload ->> 'id')::uuid;
  v_total numeric := round((p_payload ->> 'total_amount')::numeric, 2);
  v_owner_share numeric := round((p_payload ->> 'owner_share')::numeric, 2);
  v_label text := nullif(btrim(coalesce(p_payload ->> 'label', '')), '');
  v_occurred_at timestamptz := coalesce(
    (p_payload ->> 'occurred_at')::timestamptz,
    now()
  );
  v_expense public.shared_expenses;
  v_participant jsonb;
  v_profile public.profiles;
  v_share numeric;
  v_sum numeric := 0;
  v_seen uuid[] := '{}';
begin
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;
  if v_expense_id is null then
    raise exception 'missing_expense_id';
  end if;
  if v_total is null or v_total <= 0 then
    raise exception 'invalid_total';
  end if;
  if v_owner_share is null or v_owner_share < 0 or v_owner_share > v_total then
    raise exception 'invalid_owner_share';
  end if;

  -- Same lock order as settle_share / void: expense first, then participants.
  select * into v_expense
  from public.shared_expenses
  where id = v_expense_id
  for update;
  if not found then
    raise exception 'expense_not_found';
  end if;
  if v_expense.owner_id <> v_owner then
    raise exception 'not_owner';
  end if;
  if v_expense.status <> 'active' then
    raise exception 'expense_not_active';
  end if;

  perform 1
  from public.shared_expense_participants
  where expense_id = v_expense_id
  for update;

  if exists (
    select 1 from public.shared_expense_participants
    where expense_id = v_expense_id
      and (status in ('paid', 'disputed') or settled_amount > 0)
  ) then
    raise exception 'expense_locked';
  end if;

  update public.shared_expenses
     set total_amount = v_total,
         owner_share = v_owner_share,
         label = v_label,
         occurred_at = v_occurred_at,
         version = version + 1,
         updated_at = now()
   where id = v_expense_id;

  -- Upsert by user so participant ids stay stable across edits.
  for v_participant in
    select * from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]'::jsonb))
  loop
    v_share := round((v_participant ->> 'share_amount')::numeric, 2);
    if v_share is null or v_share <= 0 then
      raise exception 'invalid_share';
    end if;

    select * into v_profile
    from public.profiles
    where username = lower(btrim(v_participant ->> 'username'));
    if not found then
      raise exception 'user_not_found';
    end if;
    if v_profile.id = v_owner then
      raise exception 'cannot_split_with_self';
    end if;
    if v_profile.id = any (v_seen) then
      raise exception 'duplicate_participant';
    end if;
    if not public.are_friends(v_owner, v_profile.id) then
      raise exception 'not_friends';
    end if;

    v_seen := v_seen || v_profile.id;
    v_sum := v_sum + v_share;

    insert into public.shared_expense_participants (expense_id, user_id, share_amount)
    values (v_expense_id, v_profile.id, v_share)
    on conflict (expense_id, user_id)
    do update set share_amount = excluded.share_amount, updated_at = now();
  end loop;

  delete from public.shared_expense_participants
  where expense_id = v_expense_id
    and not (user_id = any (v_seen));

  if v_owner_share + v_sum > v_total + 0.01 then
    raise exception 'invalid_split';
  end if;

  return (select version from public.shared_expenses where id = v_expense_id);
end;
$$;

create or replace function public.void_shared_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.shared_expenses;
begin
  select * into v_expense
  from public.shared_expenses
  where id = p_expense_id
  for update;
  if not found or v_expense.owner_id <> auth.uid() then
    raise exception 'not_owner';
  end if;
  if v_expense.status = 'voided' then
    return;
  end if;

  perform 1
  from public.shared_expense_participants
  where expense_id = p_expense_id
  for update;

  if exists (
    select 1 from public.shared_expense_participants
    where expense_id = p_expense_id
      and (status = 'paid' or settled_amount > 0)
  ) then
    raise exception 'expense_locked';
  end if;

  update public.shared_expenses
     set status = 'voided', voided_at = now(), locked_at = now()
   where id = p_expense_id;
end;
$$;

revoke execute on function
  public.create_shared_expense(jsonb),
  public.update_shared_expense(jsonb),
  public.void_shared_expense(uuid)
from public, anon;
grant execute on function
  public.create_shared_expense(jsonb),
  public.update_shared_expense(jsonb),
  public.void_shared_expense(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Friend requests: a mutual request accepts
-- ---------------------------------------------------------------------------

create or replace function public.send_friend_request(p_username text)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_existing public.friendships;
  v_row public.friendships;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_target
  from public.profiles
  where username = lower(btrim(p_username));
  if not found then
    raise exception 'user_not_found';
  end if;
  if v_target.id = auth.uid() then
    raise exception 'cannot_add_self';
  end if;

  select * into v_existing
  from public.friendships f
  where least(f.requester_id, f.addressee_id) =
        least(auth.uid(), v_target.id)
    and greatest(f.requester_id, f.addressee_id) =
        greatest(auth.uid(), v_target.id)
  for update;

  if found then
    if v_existing.status = 'blocked' then
      raise exception 'blocked';
    end if;
    if v_existing.status = 'accepted' then
      return v_existing;
    end if;
    -- They already asked me: accepting is the only sensible reading.
    if v_existing.status = 'pending' and v_existing.addressee_id = auth.uid() then
      update public.friendships
         set status = 'accepted'
       where id = v_existing.id
       returning * into v_row;
      return v_row;
    end if;
    -- My own request is already pending: leave it alone.
    if v_existing.status = 'pending' and v_existing.requester_id = auth.uid() then
      return v_existing;
    end if;
    -- declined: allow a fresh request from the caller.
    update public.friendships
       set requester_id = auth.uid(),
           addressee_id = v_target.id,
           status = 'pending'
     where id = v_existing.id
     returning * into v_row;
    return v_row;
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (auth.uid(), v_target.id, 'pending')
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.send_friend_request(text) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

-- Counterparty visibility: anyone I share an active expense with stays
-- readable even after the friendship is removed, otherwise the debt vanishes
-- from the app of whoever unfriended.
create or replace function public.shares_expense_with_me(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_expenses e
    join public.shared_expense_participants p on p.expense_id = e.id
    where (e.owner_id = auth.uid() and p.user_id = p_other)
       or (p.user_id = auth.uid() and e.owner_id = p_other)
  );
$$;
revoke execute on function public.shares_expense_with_me(uuid) from public, anon;
grant execute on function public.shares_expense_with_me(uuid) to authenticated;

drop policy if exists "profiles readable by self, friends, and counterparties"
  on public.profiles;
create policy "profiles readable by self, friends, and counterparties"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.friendships f
      where (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
         or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
    )
    or public.shares_expense_with_me(id)
  );

-- The signup trigger rejects reserved names; renames must too.
create or replace function public.enforce_username_rules()
returns trigger
language plpgsql
as $$
begin
  if new.username is distinct from old.username
     and public.is_reserved_username(new.username) then
    raise exception 'reserved_username';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_username_rules on public.profiles;
create trigger profiles_username_rules
  before update on public.profiles
  for each row execute function public.enforce_username_rules();

-- Clients may change only display_name; id and username are not theirs to edit
-- directly (a rename would silently orphan every friend's local link).
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Push devices
-- ---------------------------------------------------------------------------

-- A token belongs to one account at a time. RLS blocks an update of a row that
-- another account owns, so reassignment goes through a definer function.
create or replace function public.register_device(
  p_token text,
  p_platform text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'invalid_token';
  end if;

  insert into public.devices (user_id, expo_push_token, platform, last_seen_at)
  values (
    auth.uid(),
    p_token,
    case when p_platform in ('ios', 'android', 'web') then p_platform else 'unknown' end,
    now()
  )
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now();
end;
$$;
revoke execute on function public.register_device(text, text) from public, anon;
grant execute on function public.register_device(text, text) to authenticated;

create or replace function public.unregister_device(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.devices
  where expo_push_token = p_token and user_id = auth.uid();
$$;
revoke execute on function public.unregister_device(text) from public, anon;
grant execute on function public.unregister_device(text) to authenticated;

