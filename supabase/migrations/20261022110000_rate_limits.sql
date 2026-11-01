-- Per-user fixed-window rate limits for RPCs that can be abused to enumerate
-- accounts or spam other users. Counters live in a table no client can touch;
-- only security-definer functions read and write it.

create table if not exists public.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, action, window_start)
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Raises 'rate_limited' once the caller exceeds p_max calls of p_action within
-- the current p_window. Fixed windows: simple, cheap, and good enough to stop
-- scripted enumeration (a burst can straddle a boundary for at most 2x).
create or replace function public.enforce_rate_limit(
  p_action text,
  p_max integer,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_start timestamptz := date_bin(p_window, now(), timestamptz 'epoch');
  v_count integer;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.rate_limits
   where user_id = v_user
     and action = p_action
     and window_start < v_start;

  insert into public.rate_limits (user_id, action, window_start, count)
  values (v_user, p_action, v_start, 1)
  on conflict (user_id, action, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  if v_count > p_max then
    raise exception 'rate_limited';
  end if;
end;
$$;
revoke execute on function public.enforce_rate_limit(text, integer, interval)
  from public, anon, authenticated;

-- lookup_user: username -> id/display name. Was a stable SQL function; it now
-- writes a counter, so it is volatile plpgsql with the same signature.
create or replace function public.lookup_user(p_username text)
returns table (id uuid, username text, display_name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.enforce_rate_limit('lookup_user', 20, interval '1 minute');
  return query
    select p.id, p.username, p.display_name
    from public.profiles p
    where p.username = lower(btrim(p_username))
    limit 1;
end;
$$;
revoke execute on function public.lookup_user(text) from public, anon;
grant execute on function public.lookup_user(text) to authenticated;

-- send_friend_request: wrap the existing function rather than copy its body.
alter function public.send_friend_request(text) rename to send_friend_request_unlimited;
revoke execute on function public.send_friend_request_unlimited(text) from public, anon, authenticated;

create or replace function public.send_friend_request(p_username text)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enforce_rate_limit('send_friend_request', 30, interval '1 hour');
  return public.send_friend_request_unlimited(p_username);
end;
$$;
revoke execute on function public.send_friend_request(text) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;
