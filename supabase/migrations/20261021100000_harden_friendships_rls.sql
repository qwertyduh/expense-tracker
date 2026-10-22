-- Block forged friendships.
--
-- The original policies on public.friendships only constrained the parties,
-- never the status, while table-level insert/update/delete was granted to
-- authenticated. Any signed-in user could therefore POST a row such as
-- (requester = self, addressee = victim, status = 'accepted'), or PATCH an
-- existing pending/declined row to 'accepted'. are_friends() then returns true
-- and the attacker can add the victim to a shared expense and push-notify them.
--
-- Friendship mutations are already performed exclusively by the SECURITY
-- DEFINER RPCs (send_friend_request, respond_friend_request, remove_friend), so
-- clients only need SELECT on this table.

revoke insert, update, delete on public.friendships from anon, authenticated;

drop policy if exists "friendships insert own request" on public.friendships;
drop policy if exists "friendships update as addressee or requester" on public.friendships;
drop policy if exists "friendships delete as party" on public.friendships;

-- Defense in depth: these policies are inert while the DML grants are revoked,
-- and correct if insert/update is ever re-granted by a future migration.
-- A request must start as pending, and only the addressee may answer it.
create policy "friendships insert own pending request"
  on public.friendships for insert
  to authenticated
  with check (
    requester_id = auth.uid()
    and addressee_id <> auth.uid()
    and status = 'pending'
  );

create policy "friendships addressee responds"
  on public.friendships for update
  to authenticated
  using (
    addressee_id = auth.uid()
    and status = 'pending'
  )
  with check (
    addressee_id = auth.uid()
    and status in ('accepted', 'declined')
  );
