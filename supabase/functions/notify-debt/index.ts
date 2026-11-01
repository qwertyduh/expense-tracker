import { createClient } from 'npm:@supabase/supabase-js@2';

type Body = {
  expenseId?: string;
  participantId?: string;
  kind?: 'created' | 'settled';
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authorization = request.headers.get('Authorization') ?? '';

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return json({ error: 'not_authenticated' }, 401);

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!body.expenseId) return json({ error: 'missing_expense_id' }, 400);

  const admin = createClient(url, serviceKey);

  const { data: expense, error: expenseError } = await admin
    .from('shared_expenses')
    .select(
      `id, owner_id, total_amount, label, status,
       owner:profiles!shared_expenses_owner_id_fkey(id, username, display_name),
       participants:shared_expense_participants(
         id, user_id, share_amount, status,
         profile:profiles!shared_expense_participants_user_id_fkey(
           id, username, display_name
         )
       )`
    )
    .eq('id', body.expenseId)
    .maybeSingle();

  if (expenseError || !expense) return json({ error: 'expense_not_found' }, 404);

  type Person = { username: string };
  const ownerUsername = (expense.owner as unknown as Person).username;
  const participants = expense.participants as unknown as {
    user_id: string;
    share_amount: number;
    profile: Person | null;
  }[];
  const isOwner = expense.owner_id === user.id;
  const mine = participants.find((participant) => participant.user_id === user.id);
  if (!isOwner && !mine) return json({ error: 'not_a_participant' }, 403);

  type Recipient = { userId: string; title: string; body: string; data: Record<string, string> };

  const recipients: Recipient[] = [];
  const label = expense.label ?? 'a shared expense';

  if (body.kind === 'created' && isOwner && expense.status === 'active') {
    // Claim the announcement atomically: an outbox retry after a lost response
    // re-invokes this function, and must not push the same expense twice.
    const { data: claimed } = await admin
      .from('shared_expenses')
      .update({ created_notified_at: new Date().toISOString() })
      .eq('id', expense.id)
      .is('created_notified_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) return json({ ok: true, sent: 0 });

    for (const participant of participants) {
      if (participant.user_id === user.id) continue;
      recipients.push({
        userId: participant.user_id,
        title: 'New shared expense',
        body: `@${ownerUsername} added you to ${label} — ₹${Number(
          participant.share_amount
        ).toFixed(2)}`,
        data: { type: 'shared_expense', expenseId: expense.id },
      });
    }
  } else if (body.kind === 'settled' && (isOwner || mine)) {
    // Only announce a settlement that exists, was made by this caller's side,
    // and has not been announced yet; report what was actually paid.
    let query = admin
      .from('shared_settlements')
      .select('id, payer_id, payee_id, amount, participant_id')
      .eq('expense_id', expense.id)
      .is('notified_at', null)
      .or(`payer_id.eq.${user.id},payee_id.eq.${user.id}`)
      .order('created_at', { ascending: true });
    if (body.participantId) query = query.eq('participant_id', body.participantId);
    const { data: settlements } = await query;

    for (const settlement of settlements ?? []) {
      const { data: claimed } = await admin
        .from('shared_settlements')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', settlement.id)
        .is('notified_at', null)
        .select('id');
      if (!claimed || claimed.length === 0) continue;

      const callerPaid = settlement.payer_id === user.id;
      const otherId = callerPaid ? settlement.payee_id : settlement.payer_id;
      const callerUsername = callerPaid
        ? mine?.profile?.username
        : ownerUsername;
      recipients.push({
        userId: otherId,
        title: callerPaid ? 'Payment marked' : 'Payment received',
        body: callerPaid
          ? `@${callerUsername ?? 'A friend'} paid ₹${Number(settlement.amount).toFixed(
              2
            )} for ${label}`
          : `@${callerUsername ?? 'A friend'} marked your ₹${Number(
              settlement.amount
            ).toFixed(2)} for ${label} as received`,
        data: { type: 'settled', expenseId: expense.id },
      });
    }
  } else {
    return json({ ok: true, sent: 0 });
  }

  if (recipients.length === 0) return json({ ok: true, sent: 0 });

  const { data: devices } = await admin
    .from('devices')
    .select('user_id, expo_push_token')
    .in(
      'user_id',
      recipients.map((recipient) => recipient.userId)
    );

  // One message per device per recipient (a user can have several settlements
  // announced in the same call).
  const messages = (devices ?? []).flatMap(
    (device: { user_id: string; expo_push_token: string }) =>
      recipients
        .filter((recipient) => recipient.userId === device.user_id)
        .map((recipient) => ({
          to: device.expo_push_token,
          title: recipient.title,
          body: recipient.body,
          data: recipient.data,
          sound: 'default',
          channelId: 'debts',
        }))
  );

  if (messages.length === 0) return json({ ok: true, sent: 0 });

  // Expo accepts at most 100 messages per request.
  const dead: string[] = [];
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      });
      if (!response.ok) continue;
      const result = (await response.json()) as {
        data?: { status: string; details?: { error?: string } }[];
      };
      (result.data ?? []).forEach((ticket, index) => {
        if (ticket.status === 'ok') sent += 1;
        else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(chunk[index].to);
      });
    } catch {
      // A failed chunk must not block the rest.
    }
  }

  if (dead.length > 0) {
    await admin.from('devices').delete().in('expo_push_token', dead);
  }

  return json({ ok: true, sent });
});
