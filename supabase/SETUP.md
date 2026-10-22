# Connect iGO to Supabase

## 1. Add the app connection settings

In StackBlitz project settings, add these environment variables using the URL and publishable key from the iGO Supabase project:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Do not paste service-role keys into this project. The app uses authenticated sessions and row-level security.

## 2. Apply the database migrations in order

Run each SQL file separately in Supabase SQL Editor, in this order:

1. `migrations/202610190001_add_operational_statuses.sql`
2. `migrations/202610190002_persistent_workflows.sql`
3. `migrations/202610190003_invoice_cutoff_scheduler.sql`
4. `migrations/202610210001_partner_payment_review_and_credits.sql`
5. `migrations/202610210002_payment_receipt_email_log.sql`
6. `migrations/202610210003_admin_partner_driver_workspaces.sql` (already applied to the production iGO Supabase project)
7. `migrations/202610220001_add_staff_role.sql`
8. `migrations/202610220002_departments_payment_requests.sql`
9. `migrations/202610220003_staff_withdrawal_handoff.sql`
10. `migrations/202610220004_people_manager_scope.sql`
11. `migrations/202610220005_department_access_scopes.sql`
12. `migrations/202610220006_finance_notifications_storage.sql`
13. `migrations/202610220007_owner_payment_notifications.sql`

The first file adds enum values, which must commit before the next migration refers to them. The third file enables Supabase Cron (`pg_cron`) and schedules a once-per-minute check; invoices are generated once the configured Maldives-local cutoff passes. If Supabase says the extension is unavailable or cannot be enabled through SQL, enable **pg_cron** in the project dashboard under Integrations → Cron, then run migration 3 again. Manual invoice generation works independently of the scheduler.

Admin workspace migration lets each admin create a linked partner profile on first use and a driver profile using their registered name and phone.\n\nDepartment workflow migrations create Finance, Operations, Customer Support, and People Management departments. Invite staff from User Management, then assign one or more department roles from the staff workspace controls. Use the owner account to assign finance approvers, payment officers, and People Managers. Finance staff approve/reject payment requests and driver withdrawals; payment officers then attach proof and mark approved payouts paid. Operations and support roles can look up packages without changing their status. The owner account keeps full admin access.\n\nPartner-payment migrations allow one submission to cover every outstanding invoice, record the admin-verified amount, leave unpaid balances due, and apply overpayment as credit to future invoices. Rejection requires a reason. Run migrations 4 and 5 before using the updated payment UI.

## 3. Sign in with an existing iGO account

The app looks up the signed-in user's `profiles.role`. Admin, partner, and driver screens are selected from that role. Pending, rejected, or suspended partners and drivers cannot use the approved operational functions because the database role helpers and RLS policies gate those operations.

## Email itemized partner receipts

Deploy the `send-payment-receipt` Edge Function after applying migrations 4 and 5. Configure the project secrets `RESEND_API_KEY` and `RESEND_FROM_EMAIL` with a verified sender address in Resend, then deploy with `supabase functions deploy send-payment-receipt`. The function emails an itemized PDF receipt to the partner email saved on their account. The payment decision and in-app notification are saved even if email delivery is unavailable; the admin gets an error so delivery can be retried.

## What is stored in Supabase

- Packages, assignments, status history, and private proof images
- Invoices, invoice items, payment slips, and confirmed payment allocations
- Driver online state, approved driver percentage, bank details, and withdrawal requests
- Business expenses, payment-account settings, and notifications
- Partner account approval status and daily invoice cutoff

Reports are generated from these saved records. No demo records are copied into the live database.

## Verify the live setup

After applying the migrations and adding the two app settings, sign in with an existing admin account. Confirm the Finance Management page loads from Supabase, then test using a dedicated test partner and test driver account: pending/rejected/suspended accounts should not register packages or claim jobs; an approved partner can create a package; an approved driver can claim it and record pickup; boat delivery must reject missing proof; only an admin can approve a submitted payment or an account; and an admin can generate an invoice for delivered packages. Use test records only, and delete them through the app after confirming the flow.
