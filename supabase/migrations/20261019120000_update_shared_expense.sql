-- Owner-side edit of a shared expense. Allowed only while no participant has
-- paid or disputed; after that the expense is locked and corrections must be
-- linked adjustments.

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

  delete from public.shared_expense_participants where expense_id = v_expense_id;

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

    insert into public.shared_expense_participants (expense_id, user_id, share_amount)
    values (v_expense_id, v_profile.id, v_share);
  end loop;

  return (select version from public.shared_expenses where id = v_expense_id);
end;
$$;

grant execute on function public.update_shared_expense(jsonb) to authenticated;
