-- Keep the owner account in the approval loop when no Finance staff member is assigned.
-- Department staff still receive notifications through the existing trigger.
create or replace function public.notify_payment_officers_of_work()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id,title,message)
    select distinct s.user_id,'Payment request needs review',
      new.category || ' · MVR ' || new.amount::text || ' · ' || new.description
    from public.staff_role_assignments s
    where s.active and s.role='finance_approver' and s.department_id=new.department_id;

    insert into public.notifications(user_id,title,message)
    select p.id,'Payment request needs review',
      new.category || ' · MVR ' || new.amount::text || ' · ' || new.description
    from public.profiles p where p.role='admin'::public.app_role;
    return new;
  end if;

  if new.status='approved' and old.status is distinct from new.status then
    insert into public.notifications(user_id,title,message)
    select distinct s.user_id,'Payment ready to make',
      new.category || ' · MVR ' || new.amount::text || ' · ' || new.payee_name
    from public.staff_role_assignments s
    where s.active and s.role='payment_officer' and s.department_id=new.department_id;

    insert into public.notifications(user_id,title,message)
    select p.id,'Payment approved',
      new.category || ' · MVR ' || new.amount::text || ' · ' || new.payee_name
    from public.profiles p where p.role='admin'::public.app_role;
  end if;
  return new;
end;
$function$;
