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

  const isOwner = expense.owner_id === user.id;
  const mine = expense.participants.find(
    (participant: { user_id: string }) => participant.user_id === user.id
  );
  if (!isOwner && !mine) return json({ error: 'not_a_participant' }, 403);

  type Recipient = { userId: string; title: string; body: string; data: Record<string, string> };

  const recipients: Recipient[] = [];
  if (body.kind === 'created' && isOwner) {
    for (const participant of expense.participants) {
      if (participant.user_id === user.id) continue;
      recipients.push({
        userId: participant.user_id,
        title: 'New shared expense',
        body: `@${expense.owner.username} added you to ${
          expense.label ?? 'a shared expense'
        } — ₹${Number(participant.share_amount).toFixed(2)}`,
        data: { type: 'shared_expense', expenseId: expense.id },
      });
    }
  } else if (body.kind === 'settled' && mine) {
    recipients.push({
      userId: expense.owner_id,
      title: 'Payment marked',
      body: `@${mine.profile?.username ?? 'A friend'} settled ₹${Number(
        mine.share_amount
      ).toFixed(2)} for ${expense.label ?? 'a shared expense'}`,
      data: { type: 'settled', expenseId: expense.id },
    });
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

  const byUser = new Map(recipients.map((recipient) => [recipient.userId, recipient]));
  const messages = (devices ?? []).flatMap(
    (device: { user_id: string; expo_push_token: string }) => {
      const recipient = byUser.get(device.user_id);
      if (!recipient) return [];
      return [
        {
          to: device.expo_push_token,
          title: recipient.title,
          body: recipient.body,
          data: recipient.data,
          sound: 'default',
          channelId: 'debts',
        },
      ];
    }
  );

  if (messages.length === 0) return json({ ok: true, sent: 0 });

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });

  return json({ ok: response.ok, sent: messages.length });
});
