create table if not exists private.push_signing_config (
  singleton_id boolean primary key default true check (singleton_id),
  public_material text not null,
  vault_id uuid not null,
  updated_at timestamptz not null default now()
);
revoke all on private.push_signing_config from public, anon, authenticated;

create or replace function public.save_push_signing_material(p_public_material text, p_secret_material text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare sid uuid;
begin
  if coalesce(p_public_material, '') = '' or coalesce(p_secret_material, '') = '' then
    raise exception 'push signing material is required';
  end if;

  select vault_id into sid from private.push_signing_config where singleton_id = true;
  if sid is null then
    select vault.create_secret(p_secret_material, 'puma-web-push-signing', 'Puma Web Push signing material') into sid;
    insert into private.push_signing_config (singleton_id, public_material, vault_id)
    values (true, p_public_material, sid)
    on conflict (singleton_id) do update set public_material = excluded.public_material, vault_id = excluded.vault_id, updated_at = now();
  else
    perform vault.update_secret(sid, p_secret_material, 'puma-web-push-signing', 'Puma Web Push signing material');
    update private.push_signing_config set public_material = p_public_material, updated_at = now() where singleton_id = true;
  end if;
  return p_public_material;
end;
$$;

create or replace function public.get_push_signing_material()
returns table(public_material text, secret_material text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.public_material, v.decrypted_secret
  from private.push_signing_config c
  join vault.decrypted_secrets v on v.id = c.vault_id
  where c.singleton_id = true;
$$;

revoke all on function public.save_push_signing_material(text, text) from public, anon, authenticated;
revoke all on function public.get_push_signing_material() from public, anon, authenticated;
grant execute on function public.save_push_signing_material(text, text) to service_role;
grant execute on function public.get_push_signing_material() to service_role;
