-- Public, exact-match username availability check for the sign-up form. It
-- never returns profile details and only answers whether the name is free.
-- Usernames remain unique first-come-first-served in the profiles table.

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with candidate as (
    select lower(btrim(p_username)) as name
  )
  select
    c.name ~ '^[a-z0-9]{3,20}$'
    and not public.is_reserved_username(c.name)
    and not exists (
      select 1 from public.profiles p where p.username = c.name
    )
  from candidate c;
$$;

grant execute on function public.is_username_available(text) to anon, authenticated;
