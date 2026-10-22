-- Allow the expense owner (payee) to record a received payment, not just the
-- debtor. The receive-money flow detects an incoming credit and offers to
-- settle the matching "they owe me" share; until now settle_share() required
-- auth.uid() to be the participant, so that flow always failed with not_payer.
--
-- The function keeps its signature, so the existing EXECUTE grant survives
-- CREATE OR REPLACE. The ledger still records who paid and who was paid:
--   debtor calls  -> payer = auth.uid(), payee = owner
--   owner calls   -> payer = participant, payee = auth.uid()
--
-- Also move the idempotency replay lookup after authorization (previously any
-- authenticated user who knew a key could read another user's settlement) and
-- make concurrent retries with the same key return the existing row.

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
  v_payer uuid;
  v_payee uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_participant
  from public.shared_expense_participants
  where id = p_participant_id
  for update;
  if not found then
    raise exception 'participant_not_found';
  end if;

  select * into v_expense
  from public.shared_expenses
  where id = v_participant.expense_id
  for update;
  if not found or v_expense.status <> 'active' then
    raise exception 'expense_not_active';
  end if;

  -- Both the debtor and the owner may settle; everyone else may not.
  if v_participant.user_id = auth.uid() then
    v_payer := auth.uid();
    v_payee := v_expense.owner_id;
  elsif v_expense.owner_id = auth.uid() then
    v_payer := v_participant.user_id;
    v_payee := auth.uid();
  else
    raise exception 'not_participant';
  end if;

  -- Replay check after authorization, scoped to a party of the settlement.
  select * into v_settlement
  from public.shared_settlements
  where idempotency_key = p_idempotency_key
    and (payer_id = auth.uid() or payee_id = auth.uid());
  if found then
    return v_settlement;
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

  begin
    insert into public.shared_settlements (
      expense_id, participant_id, payer_id, payee_id, amount, method,
      idempotency_key
    ) values (
      v_expense.id, v_participant.id, v_payer, v_payee,
      round(p_amount, 2), p_method, p_idempotency_key
    ) returning * into v_settlement;
  exception when unique_violation then
    -- A concurrent retry with the same key won the insert.
    select * into v_settlement
    from public.shared_settlements
    where idempotency_key = p_idempotency_key
      and (payer_id = auth.uid() or payee_id = auth.uid());
    if not found then
      raise;
    end if;
    return v_settlement;
  end;

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
