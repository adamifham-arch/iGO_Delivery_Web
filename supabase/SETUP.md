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
4. Apply the account and workspace migrations in date order, including `migrations/202610210001_admin_partner_driver_workspaces.sql`.

The first file adds enum values, which must commit before the next migration refers to them. The third file enables Supabase Cron (`pg_cron`) and schedules a once-per-minute check; invoices are generated once the configured Maldives-local cutoff passes. If Supabase says the extension is unavailable or cannot be enabled through SQL, enable **pg_cron** in the project dashboard under Integrations → Cron, then run migration 3 again. Manual invoice generation works independently of the scheduler.

The admin workspace migration is already applied in the production iGO Supabase project. It allows each admin to create their own linked partner profile on first use and driver profile from their registered name and phone.

## 3. Sign in with an existing iGO account

The app looks up the signed-in user's `profiles.role`. Admin, partner, and driver screens are selected from that role. Pending, rejected, or suspended partners and drivers cannot use the approved operational functions because the database role helpers and RLS policies gate those operations.

## What is stored in Supabase

- Packages, assignments, status history, and private proof images
- Invoices, invoice items, payment slips, and confirmed payment allocations
- Driver online state, approved driver percentage, bank details, and withdrawal requests
- Business expenses, payment-account settings, and notifications
- Partner account approval status and daily invoice cutoff

Reports are generated from these saved records. No demo records are copied into the live database.

## Verify the live setup

After applying the migrations and adding the two app settings, sign in with an existing admin account. Confirm the Finance Management page loads from Supabase, then test using a dedicated test partner and test driver account: pending/rejected/suspended accounts should not register packages or claim jobs; an approved partner can create a package; an approved driver can claim it and record pickup; boat delivery must reject missing proof; only an admin can approve a submitted payment or an account; and an admin can generate an invoice for delivered packages. Use test records only, and delete them through the app after confirming the flow.
