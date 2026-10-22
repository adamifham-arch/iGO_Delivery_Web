-- Limit payment officers to finance-approved driver withdrawals.
-- Finance approvers and requesters retain their existing access.

drop policy if exists "Staff review driver withdrawals" on public.driver_withdrawal_requests;
create policy "Staff review driver withdrawals"
on public.driver_withdrawal_requests for select to authenticated
using (
  public.is_igo_full_admin()
  or requested_by = auth.uid()
  or public.has_staff_role(
    'finance_approver',
    (select id from public.departments where name = 'Finance')
  )
  or (
    status in ('approved', 'paid')
    and public.has_staff_role(
      'payment_officer',
      (select id from public.departments where name = 'Finance')
    )
  )
);

-- Withdrawal proof links must follow the same visibility boundary as the requests.
drop policy if exists "Payment staff read payment proofs" on storage.objects;
create policy "Payment staff read payment proofs"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    public.is_igo_full_admin()
    or exists (
      select 1 from public.payment_requests r
      where r.id::text = split_part(name, '/', 2)
        and (
          r.requester_id = auth.uid()
          or public.has_staff_role('finance_approver', r.department_id)
          or (
            r.status in ('approved', 'paid')
            and public.has_staff_role('payment_officer', r.department_id)
          )
        )
    )
    or exists (
      select 1 from public.driver_withdrawal_requests w
      where w.id::text = split_part(name, '/', 2)
        and (
          w.requested_by = auth.uid()
          or public.has_staff_role(
            'finance_approver',
            (select id from public.departments where name = 'Finance')
          )
          or (
            w.status in ('approved', 'paid')
            and public.has_staff_role(
              'payment_officer',
              (select id from public.departments where name = 'Finance')
            )
          )
        )
    )
  )
);
