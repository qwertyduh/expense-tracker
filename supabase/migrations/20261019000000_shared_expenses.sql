-- Accounts, friendships, shared expenses, settlements, and net balances.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9]{3,20}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_reserved_username(p_username text)
returns boolean
language sql
immutable
as $$
  select p_username = any (array[
    'admin', 'support', 'help', 'system', 'expense', 'expenses',
    'expensetracker', 'null', 'undefined'
  ]);
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display_name text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if v_username !~ '^[a-z0-9]{3,20}$' then
    raise exception 'invalid_username';
  end if;
  if public.is_reserved_username(v_username) then
    raise exception 'reserved_username';
  end if;
  if v_display_name = '' then
    v_display_name := v_username;
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, left(v_display_name, 60));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Friendships
-- ---------------------------------------------------------------------------

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

create unique index friendships_pair_key
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a)
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Shared expenses
-- ---------------------------------------------------------------------------

create table public.shared_expenses (
  id uuid primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  total_amount numeric(12, 2) not null check (total_amount > 0),
  owner_share numeric(12, 2) not null check (owner_share >= 0),
  currency text not null default 'INR',
  label text,
  occurred_at timestamptz not null,
  version integer not null default 1,
  status text not null default 'active'
    check (status in ('active', 'voided')),
  locked_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_share <= total_amount)
);

create table public.shared_expense_participants (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.shared_expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  share_amount numeric(12, 2) not null check (share_amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'disputed')),
  settled_amount numeric(12, 2) not null default 0 check (settled_amount >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expense_id, user_id)
);

create table public.shared_settlements (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.shared_expenses (id) on delete cascade,
  participant_id uuid not null references public.shared_expense_participants (id) on delete cascade,
  payer_id uuid not null references public.profiles (id) on delete cascade,
  payee_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null default 'manual'
    check (method in ('manual', 'detected_incoming', 'detected_outgoing')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.shared_settlement_allocations (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.shared_settlements (id) on delete cascade,
  participant_id uuid not null references public.shared_expense_participants (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table public.shared_expense_adjustments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.shared_expenses (id) on delete cascade,
  participant_id uuid references public.shared_expense_participants (id) on delete cascade,
  kind text not null check (kind in ('rounding', 'refund', 'extra')),
  amount numeric(12, 2) not null,
  note text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.payment_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  direction text not null check (direction in ('incoming', 'outgoing')),
  amount numeric(12, 2) not null check (amount > 0),
  counterparty_id uuid references public.profiles (id) on delete set null,
  participant_id uuid references public.shared_expense_participants (id) on delete set null,
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'dismissed')),
  raw_text text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web', 'unknown')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'friendships', 'shared_expenses',
    'shared_expense_participants'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile helpers
-- ---------------------------------------------------------------------------

create or replace function public.lookup_user(p_username text)
returns table (id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name
  from public.profiles p
  where p.username = lower(btrim(p_username))
  limit 1;
$$;

create or replace function public.my_profile()
returns table (id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Friendship RPCs
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
        greatest(auth.uid(), v_target.id);

  if found then
    if v_existing.status = 'blocked' then
      raise exception 'blocked';
    end if;
    if v_existing.status = 'accepted' then
      return v_existing;
    end if;
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

create or replace function public.respond_friend_request(
  p_friendship_id uuid,
  p_accept boolean
)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.friendships;
begin
  update public.friendships
     set status = case when p_accept then 'accepted' else 'declined' end
   where id = p_friendship_id
     and addressee_id = auth.uid()
     and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'request_not_found';
  end if;
  return v_row;
end;
$$;

create or replace function public.remove_friend(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.friendships
  where (requester_id = auth.uid() and addressee_id = p_user_id)
     or (requester_id = p_user_id and addressee_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Shared expense RPCs
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
  if exists (select 1 from public.shared_expenses where id = v_expense_id) then
    return v_expense_id;
  end if;

  insert into public.shared_expenses (
    id, owner_id, total_amount, owner_share, label, occurred_at
  ) values (
    v_expense_id, v_owner, v_total, v_owner_share, v_label, v_occurred_at
  );

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
    if not public.are_friends(v_owner, v_profile.id) then
      raise exception 'not_friends';
    end if;

    insert into public.shared_expense_participants (
      expense_id, user_id, share_amount
    ) values (
      v_expense_id, v_profile.id, v_share
    );
  end loop;

  return v_expense_id;
end;
$$;

create or replace function public.settle_share(
  p_participant_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text
)
returns public.shared_settlements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant public.shared_expense_participants;
  v_expense public.shared_expenses;
  v_remaining numeric;
  v_rounding numeric := 0;
  v_settlement public.shared_settlements;
  v_allocation numeric;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_settlement
  from public.shared_settlements
  where idempotency_key = p_idempotency_key;
  if found then
    return v_settlement;
  end if;

  select * into v_participant
  from public.shared_expense_participants
  where id = p_participant_id
  for update;
  if not found then
    raise exception 'participant_not_found';
  end if;
  if v_participant.user_id <> auth.uid() then
    raise exception 'not_payer';
  end if;

  select * into v_expense
  from public.shared_expenses
  where id = v_participant.expense_id
  for update;
  if not found or v_expense.status <> 'active' then
    raise exception 'expense_not_active';
  end if;
  if v_participant.status = 'paid' then
    raise exception 'already_paid';
  end if;
  if v_participant.status = 'disputed' then
    raise exception 'share_disputed';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  if p_method not in ('manual', 'detected_incoming', 'detected_outgoing') then
    raise exception 'invalid_method';
  end if;

  v_remaining := round(v_participant.share_amount - v_participant.settled_amount, 2);
  if v_remaining <= 0 then
    raise exception 'already_paid';
  end if;

  -- Exact partial payments are allowed. Anything within ₹1 of the full
  -- remaining balance settles it, recording the difference as a rounding
  -- adjustment so the ledger ends at zero.
  if abs(p_amount - v_remaining) <= 0.01 then
    v_allocation := v_remaining;
  elsif abs(p_amount - v_remaining) <= 1.00 then
    v_allocation := v_remaining;
    v_rounding := round(v_remaining - p_amount, 2);
  elsif p_amount <= v_remaining then
    v_allocation := round(p_amount, 2);
  else
    raise exception 'amount_exceeds_balance';
  end if;

  insert into public.shared_settlements (
    expense_id, participant_id, payer_id, payee_id, amount, method,
    idempotency_key
  ) values (
    v_expense.id, v_participant.id, auth.uid(), v_expense.owner_id,
    round(p_amount, 2), p_method, p_idempotency_key
  ) returning * into v_settlement;

  insert into public.shared_settlement_allocations (
    settlement_id, participant_id, amount
  ) values (
    v_settlement.id, v_participant.id, v_allocation
  );

  if v_rounding <> 0 then
    insert into public.shared_expense_adjustments (
      expense_id, participant_id, kind, amount, note, created_by
    ) values (
      v_expense.id, v_participant.id, 'rounding', v_rounding,
      'Full-debt settlement rounding', auth.uid()
    );
  end if;

  update public.shared_expense_participants
     set settled_amount = round(settled_amount + v_allocation, 2),
         status = case
           when round(settled_amount + v_allocation, 2) >= share_amount - 0.01
             then 'paid'
           else status
         end,
         paid_at = case
           when round(settled_amount + v_allocation, 2) >= share_amount - 0.01
             then now()
           else paid_at
         end
   where id = v_participant.id;

  update public.shared_expenses
     set locked_at = coalesce(locked_at, now())
   where id = v_expense.id;

  return v_settlement;
end;
$$;

create or replace function public.dispute_share(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shared_expense_participants
     set status = 'disputed'
   where id = p_participant_id
     and user_id = auth.uid()
     and status = 'pending';
  if not found then
    raise exception 'share_not_found';
  end if;
end;
$$;

create or replace function public.void_shared_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.shared_expenses
    where id = p_expense_id and owner_id = auth.uid()
  ) then
    raise exception 'not_owner';
  end if;
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

-- ---------------------------------------------------------------------------
-- Pairwise balances
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
      e.owner_id as counterparty_id,
      round(sum(greatest(p.share_amount - p.settled_amount, 0)), 2) as amount
    from public.shared_expense_participants p
    join public.shared_expenses e on e.id = p.expense_id
    where e.owner_id = auth.uid()
      and e.status = 'active'
      and p.status = 'pending'
    group by e.owner_id
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

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- Security-definer helpers keep the policies from recursively invoking each
-- other (expenses -> participants -> expenses). The function owner bypasses
-- RLS, and it only ever returns a boolean for the current user.
create or replace function public.can_read_expense(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shared_expenses e
    where e.id = p_expense_id and e.owner_id = auth.uid()
  ) or exists (
    select 1 from public.shared_expense_participants p
    where p.expense_id = p_expense_id and p.user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.shared_expenses enable row level security;
alter table public.shared_expense_participants enable row level security;
alter table public.shared_settlements enable row level security;
alter table public.shared_settlement_allocations enable row level security;
alter table public.shared_expense_adjustments enable row level security;
alter table public.payment_matches enable row level security;
alter table public.devices enable row level security;

create policy "profiles readable by self, friends, and counterparties"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.are_friends(auth.uid(), id)
    or exists (
      select 1
      from public.friendships f
      where (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
         or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
    )
  );

create policy "profiles update self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "friendships visible to parties"
  on public.friendships for select
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "friendships insert own request"
  on public.friendships for insert
  with check (requester_id = auth.uid());

create policy "friendships update as addressee or requester"
  on public.friendships for update
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "friendships delete as party"
  on public.friendships for delete
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "expenses visible to owner and participants"
  on public.shared_expenses for select
  using (public.can_read_expense(id));

create policy "participants visible to owner and participant"
  on public.shared_expense_participants for select
  using (public.can_read_expense(expense_id));

create policy "settlements visible to payer and payee"
  on public.shared_settlements for select
  using (payer_id = auth.uid() or payee_id = auth.uid());

create policy "allocations visible with settlement"
  on public.shared_settlement_allocations for select
  using (
    exists (
      select 1 from public.shared_settlements s
      where s.id = shared_settlement_allocations.settlement_id
        and (s.payer_id = auth.uid() or s.payee_id = auth.uid())
    )
  );

create policy "adjustments visible to owner and participant"
  on public.shared_expense_adjustments for select
  using (public.can_read_expense(expense_id));

create policy "payment matches visible to self"
  on public.payment_matches for select
  using (user_id = auth.uid());

create policy "payment matches insert self"
  on public.payment_matches for insert
  with check (user_id = auth.uid());

create policy "payment matches update self"
  on public.payment_matches for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "devices own rows"
  on public.devices for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Table-level grants: shared writes only through the RPCs above.
grant select on public.profiles, public.friendships, public.shared_expenses,
  public.shared_expense_participants, public.shared_settlements,
  public.shared_settlement_allocations, public.shared_expense_adjustments,
  public.payment_matches to authenticated;
grant insert, update, delete on public.friendships to authenticated;
grant all on public.devices to authenticated;

revoke all on public.shared_expenses from anon, authenticated;
grant select on public.shared_expenses to authenticated;
revoke all on public.shared_expense_participants from anon, authenticated;
grant select on public.shared_expense_participants to authenticated;
revoke all on public.shared_settlements from anon, authenticated;
grant select on public.shared_settlements to authenticated;
revoke all on public.shared_settlement_allocations from anon, authenticated;
grant select on public.shared_settlement_allocations to authenticated;
revoke all on public.shared_expense_adjustments from anon, authenticated;
grant select on public.shared_expense_adjustments to authenticated;

grant execute on function public.can_read_expense(uuid) to authenticated;
grant execute on function public.lookup_user(text) to authenticated;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.create_shared_expense(jsonb) to authenticated;
grant execute on function public.settle_share(uuid, numeric, text, text) to authenticated;
grant execute on function public.dispute_share(uuid) to authenticated;
grant execute on function public.void_shared_expense(uuid) to authenticated;
grant execute on function public.pair_balances() to authenticated;

-- Realtime for the tables clients mirror locally.
alter publication supabase_realtime add table public.shared_expenses;
alter publication supabase_realtime add table public.shared_expense_participants;
alter publication supabase_realtime add table public.shared_settlements;
alter publication supabase_realtime add table public.friendships;
