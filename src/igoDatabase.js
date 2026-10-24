import { supabase } from './supabase';

const requireClient = () => {
  if (!supabase) throw new Error('Supabase is not configured for this app.');
  return supabase;
};

const isMissingWorkspaceAccessFunction = (error, functionName) =>
  error?.code === 'PGRST202'
  || (String(error?.message || '').includes(functionName) && String(error?.message || '').toLowerCase().includes('schema cache'));

export const statusToDb = (status) => ({
  Pending: 'awaiting_collection',
  'Picked Up': 'picked_up',
  'Out for Delivery': 'picked_up',
  Delivered: 'delivered',
  Failed: 'failed_attempt',
  'Failed Delivery': 'failed_attempt',
  'At Godown': 'at_godown',
  'Returned to Godown': 'at_godown',
  Cancelled: 'cancelled',
}[status] || status);

export const statusFromDb = (status) => ({
  awaiting_collection: 'Pending',
  picked_up: 'Out for Delivery',
  delivered: 'Delivered',
  failed_attempt: 'Failed Delivery',
  at_godown: 'Returned to Godown',
  cancelled: 'Cancelled',
}[status] || status);

export function packageFromDb(row) {
  if (!row) return row;
  return {
    id: row.package_number ? `IGO-${row.package_number}` : row.id,
    dbId: row.id,
    packageNumber: row.package_number,
    displayId: row.package_number ? `IGO-${row.package_number}` : row.id,
    partnerId: row.partner_id,
    partnerName: row.partners?.name || row.partner_name || '',
    partnerPhone: row.partners?.phone || '',
    partnerAddress: row.partners?.address || '',
    partnerLogo: row.partners?.logo_data_url || '',
    driver: row.drivers?.name || '',
    driverPhone: row.drivers?.phone || '',
    customer: row.customer_name,
    phone: row.customer_phone,
    address: row.address,
    area: row.area,
    boatName: row.boat_name || '',
    boatLocation: row.boat_location || '',
    departureTime: row.departure_time || '',
    landmark: row.landmark || '',
    item: row.item_description,
    fee: Number(row.delivery_fee || 0),
    notes: row.notes || '',
    status: statusFromDb(row.status),
    driverId: row.assigned_driver_id,
    assignedDriverId: row.assigned_driver_id,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
    proofOfDeliveryPath: row.proof_of_delivery_path,
    failedAttemptReason: row.failed_attempt_reason,
    failureReason: row.failed_attempt_reason,
    failedAttemptAt: row.failed_attempt_at,
    warehouseReceivedAt: row.warehouse_received_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function packageToDb(entry) {
  const result = {};
  const fields = {
    customer: 'customer_name',
    phone: 'customer_phone',
    address: 'address',
    area: 'area',
    boatName: 'boat_name',
    boatLocation: 'boat_location',
    departureTime: 'departure_time',
    landmark: 'landmark',
    item: 'item_description',
    fee: 'delivery_fee',
    notes: 'notes',
    status: 'status',
    assignedDriverId: 'assigned_driver_id',
    pickedUpAt: 'picked_up_at',
    deliveredAt: 'delivered_at',
    proofOfDeliveryPath: 'proof_of_delivery_path',
    failedAttemptReason: 'failed_attempt_reason',
    failedAttemptAt: 'failed_attempt_at',
    warehouseReceivedAt: 'warehouse_received_at',
  };
  for (const [from, to] of Object.entries(fields)) {
    if (Object.hasOwn(entry, from)) result[to] = from === 'status' ? statusToDb(entry[from]) : from === 'departureTime' && entry[from] === '' ? null : entry[from];
  }
  return result;
}

export async function loadPackages({ partnerId, driverId } = {}) {
  const client = requireClient();
  let query = client.from('packages').select('*,partners(name,phone,address,logo_data_url),drivers(name,phone)').order('created_at', { ascending: false });
  if (partnerId) query = query.eq('partner_id', partnerId);
  if (driverId) {
    query = query.or(
      `assigned_driver_id.eq.${driverId},and(assigned_driver_id.is.null,status.eq.awaiting_collection)`
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(packageFromDb);
}

export async function createPackages(entries, partnerId) {
  const client = requireClient();
  const rows = entries.map((entry) => ({
    ...packageToDb(entry),
    partner_id: partnerId,
    status: 'awaiting_collection',
  }));
  const { data, error } = await client.from('packages').insert(rows).select('*,partners(name,phone,address,logo_data_url),drivers(name,phone)');
  if (error) throw error;
  return (data || []).map(packageFromDb);
}

export async function updatePackage(id, changes) {
  const client = requireClient();
  const { data, error } = await client
    .from('packages')
    .update(packageToDb(changes))
    .eq('id', id)
    .select('*,partners(name,phone,address,logo_data_url),drivers(name,phone)')
    .single();
  if (error) throw error;
  return packageFromDb(data);
}

export async function uploadIgoFile(file, kind, recordId) {
  const client = requireClient();
  if (!file) throw new Error('Choose a file first.');
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const inferredType = ({
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
  })[extension] || '';
  const reportedType = String(file.type || '').toLowerCase();
  const contentType = reportedType === 'image/jpg'
    ? 'image/jpeg'
    : (!reportedType || reportedType === 'application/octet-stream' ? inferredType : reportedType);
  const allowed = kind === 'proof'
    ? ['image/jpeg', 'image/png', 'image/webp']
    : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(contentType)) {
    throw new Error('Choose a JPG, PNG, WebP, or PDF file. HEIC photos are not supported.');
  }
  if (!file.size || file.size > 10 * 1024 * 1024) {
    throw new Error('The file must be non-empty and under 10 MB.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${userData.user.id}/${kind}/${recordId}/${Date.now()}-${safeName}`;
  const { error } = await client.storage.from('igo-delivery-files').upload(path, file, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function getPrivateFileUrl(path) {
  if (!path) return null;
  const { data, error } = await requireClient().storage
    .from('igo-delivery-files')
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

export async function getCurrentPartnerId() {
  const { data, error } = await requireClient().rpc('current_partner_id');
  if (error) throw error;
  if (!data) throw new Error('This account has no approved partner profile.');
  return data;
}
export async function getCurrentPartnerIdOptional() {
  const { data, error } = await requireClient().rpc('current_partner_id');
  if (error) throw error;
  return data || null;
}


export async function getCurrentDriverId() {
  const { data, error } = await requireClient().rpc('current_driver_id');
  if (error) throw error;
  if (!data) throw new Error('This account has no approved driver profile.');
  return data;
}
export async function ensureAdminDriverWorkspace() {
  const { data, error } = await requireClient().rpc('ensure_admin_driver_workspace');
  if (error) throw error;
  if (!data) throw new Error('Could not prepare this admin driver workspace.');
  return data;
}

export async function setupAdminPartnerWorkspace({ businessName, address }) {
  const { data, error } = await requireClient().rpc('setup_admin_partner_workspace', {
    p_business_name: businessName,
    p_address: address,
  });
  if (error) throw error;
  if (!data) throw new Error('Could not save partner workspace details.');
  return data;
}


export async function getDriverIdByName(name) {
  const { data, error } = await requireClient().from('drivers').select('id').eq('name', name).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Choose an active driver from the database list.');
  return data.id;
}

export async function loadFinanceRecords({ workspace = 'Admin', partnerId } = {}) {
  const isAdmin = workspace === 'Admin';
  const client = requireClient();
  let invoiceQuery = client.from('invoices').select('*,partners(name),invoice_items(id,package_id,amount,packages(package_number,customer_name,customer_phone,address,area,item_description,delivery_fee))').order('created_at', { ascending: false });
  let paymentQuery = client.from('payments').select('*,partners(name),invoices!payments_target_invoice_id_fkey(invoice_number),payment_allocations(invoice_id,amount,invoices(invoice_number))').order('submitted_at', { ascending: false });
  let creditQuery = client.from('partner_credit_ledger').select('partner_id,amount');
  if (partnerId) {
    invoiceQuery = invoiceQuery.eq('partner_id', partnerId);
    paymentQuery = paymentQuery.eq('partner_id', partnerId);
    creditQuery = creditQuery.eq('partner_id', partnerId);
  }
  let partnerQuery = client.from('partners').select('id,invoice_cutoff').order('created_at', { ascending: false });
  if (partnerId) partnerQuery = partnerQuery.eq('id', partnerId);
  const [invoiceResult, paymentResult, expenseResult, withdrawalResult, accountResult, partnerResult, creditResult] = await Promise.all([
    invoiceQuery,
    paymentQuery,
    isAdmin ? client.from('business_expenses').select('*').order('expense_date', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    isAdmin ? client.from('driver_withdrawal_requests').select('*,drivers(name)').order('requested_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    client.from('bank_accounts').select('*').order('created_at', { ascending: false }),
    partnerQuery,
    creditQuery,
  ]);
  for (const result of [invoiceResult, paymentResult, expenseResult, withdrawalResult, accountResult, partnerResult, creditResult]) {
    if (result.error) throw result.error;
  }
  const savedCutoffs = [...new Set((partnerResult.data || []).map((row) => row.invoice_cutoff == null ? null : String(row.invoice_cutoff).slice(0, 5)))];
  return {
    invoices: (invoiceResult.data || []).map((row) => ({
      id: row.invoice_number,
      dbId: row.id,
      partnerId: row.partner_id,
      partner: row.partners?.name || '',
      period: row.period_start ? new Date(row.period_start).toLocaleDateString('en-MV', { month: 'short', year: 'numeric' }) : '',
      createdAt: row.generated_at || row.created_at,
      amount: Number(row.subtotal || 0),
      paidAmount: Number(row.paid_amount || 0),
      status: row.status,
      lines: (row.invoice_items || []).map((line) => ({
        packageId: line.packages?.package_number ? `IGO-${line.packages.package_number}` : line.package_id,
        packageDbId: line.package_id,
        customer: line.packages?.customer_name || '',
        area: line.packages?.area || '',
        description: line.packages?.item_description || '',
        amount: Number(line.amount || 0),
      })),
    })),
    payments: (paymentResult.data || []).map((row) => ({
      id: row.id,
      invoiceId: row.payment_allocations?.map((a) => a.invoices?.invoice_number).filter(Boolean).join(', ') || row.invoices?.invoice_number || row.note?.match(/Invoices included:\s*(.*)/i)?.[1] || row.note?.match(/Full payment for invoices:\s*(.*)/i)?.[1] || '',
      invoiceIds: row.invoice_ids || (row.target_invoice_id ? [row.target_invoice_id] : []),
      invoiceDues: (row.invoice_ids || (row.target_invoice_id ? [row.target_invoice_id] : [])).map((invoiceId) => {
        const invoice = (invoiceResult.data || []).find((item) => item.id === invoiceId || item.invoice_number === invoiceId);
        return invoice ? {
          invoiceId: invoice.invoice_number,
          amount: Math.max(0, Number(invoice.subtotal || 0) - Number(invoice.paid_amount || 0)),
          lines: (invoice.invoice_items || []).map((line) => ({
            id: line.id,
            packageId: line.packages?.package_number ? `IGO-${line.packages.package_number}` : line.package_id,
            description: line.packages?.item_description || '',
            amount: Number(line.amount || 0),
          })),
        } : null;
      }).filter(Boolean),
      allocations: (row.payment_allocations || []).map((a) => ({ invoiceId: a.invoices?.invoice_number || a.invoice_id, amount: Number(a.amount || 0) })),
      partnerId: row.partner_id,
      partner: row.partners?.name || '',
      amount: Number(row.status === 'confirmed' ? row.verified_amount ?? row.amount : row.amount || 0),
      reportedAmount: Number(row.amount || 0),
      verifiedAmount: Number(row.verified_amount || 0),
      reference: row.reference_number || '',
      transferDate: row.transfer_date,
      slipPath: row.receipt_path,
      status: row.status,
      submittedAt: row.submitted_at,
      verifiedAt: row.verified_at,
      rejectionReason: row.rejection_reason,
    })),
    expenses: expenseResult.data || [],
    withdrawals: (withdrawalResult.data || []).map((row) => ({
      ...row,
      driver: row.drivers?.name || 'Driver',
      requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    requestDate: row.request_date,
      bankDetails: row.bank_details_snapshot,
    })),
    bankAccounts: accountResult.data || [],
    partnerCredits: (creditResult.data || []).reduce((totals, row) => {
      totals[row.partner_id] = (totals[row.partner_id] || 0) + Number(row.amount || 0);
      return totals;
    }, {}),
    invoiceCutoff: savedCutoffs.length === 1 ? savedCutoffs[0] || null : null,
    invoiceCutoffMixed: savedCutoffs.length > 1,
  };
}

export async function submitInvoicePayment({ partnerId, invoices, amount, reference, transferDate, note, file }) {
  const client = requireClient();
  if (!Array.isArray(invoices) || invoices.length === 0 || invoices.some((invoice) => !invoice.invoiceId)) {
    throw new Error('Choose at least one outstanding invoice.');
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new Error('Enter the amount you actually transferred.');
  }
  const path = await uploadIgoFile(file, 'receipts', 'payment-' + Date.now());
  const displayInvoices = invoices.map((invoice) => invoice.label || invoice.invoiceId);
  const { data, error } = await client.from('payments').insert({
    partner_id: partnerId,
    target_invoice_id: null,
    invoice_ids: invoices.map((invoice) => invoice.invoiceId),
    amount: Number(amount),
    reference_number: (reference || 'Payment for invoices').trim(),
    transfer_date: transferDate || new Date().toISOString().slice(0, 10),
    note: (note || 'Payment for invoices') + ' · Invoices included: ' + displayInvoices.join(', '),
    receipt_path: path,
    status: 'pending_verification',
  }).select().single();
  if (error) throw error;
  return data;
}

export async function reviewPayment(paymentId, status, verifiedAmount, reason = '') {
  const { data, error } = await requireClient().rpc('review_partner_payment', {
    p_payment_id: paymentId,
    p_status: status,
    p_verified_amount: status === 'confirmed' ? Number(verifiedAmount) : null,
    p_rejection_reason: status === 'rejected' ? reason : null,
  });
  if (error) throw error;
  return data;
}

export async function sendPaymentReceipt(paymentId) {
  const { data, error } = await requireClient().functions.invoke('send-payment-receipt', {
    body: { paymentId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadDriverSettings() {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const { data, error } = await client.from('driver_settings').select('*').eq('user_id', userData.user.id).maybeSingle();
  if (error) throw error;
  return data || { user_id: userData.user.id, online: false, share_percent: 0 };
}

export async function loadDriverRoster() {
  const client = requireClient();
  const [drivers, settings] = await Promise.all([
    client.from('drivers').select('id,user_id,name,phone,active,approval_status').order('name'),
    client.from('driver_settings').select('user_id,online,online_updated_at,share_percent'),
  ]);
  if (drivers.error) throw drivers.error;
  if (settings.error) throw settings.error;
  const byUser = new Map((settings.data || []).map((row) => [row.user_id, row]));
  return (drivers.data || []).map((row) => {
    const setting = byUser.get(row.user_id);
    const onlineUpdatedAt = setting?.online_updated_at || null;
    const heartbeatAt = onlineUpdatedAt ? Date.parse(onlineUpdatedAt) : NaN;
    const hasRecentHeartbeat = Number.isFinite(heartbeatAt)
      && heartbeatAt <= Date.now() + 30000
      && Date.now() - heartbeatAt <= 120000;
    return {
      ...row,
      online: Boolean(setting?.online && hasRecentHeartbeat),
      onlineUpdatedAt,
      sharePercent: Number(setting?.share_percent || 0),
    };
  });
}

export async function saveDriverSettings(changes) {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const { data, error } = await client.from('driver_settings').upsert({
    user_id: userData.user.id,
    ...changes,
    updated_at: new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  return data;
}

export async function adminUpdateDriverSettings(userId, changes) {
  const { data, error } = await requireClient().from('driver_settings').upsert({
    user_id: userId,
    ...changes,
    updated_at: new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  return data;
}

export async function loadNotifications() {
  const { data, error } = await requireClient().from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(id) {
  const { error } = await requireClient().from('notifications').update({ read: true }).eq('id', id);
  if (error) throw error;
}

export async function loadManualNotificationRecipients() {
  const { data, error } = await requireClient().rpc('list_manual_notification_recipients');
  if (error) throw error;
  return data || [];
}

export async function loadManualNotificationHistory() {
  const { data, error } = await requireClient().rpc('list_manual_notification_history');
  if (error) throw error;
  return data || [];
}

export async function sendManualNotification({ title, message, scope, userIds = [], channels = ['in_app', 'telegram'] }) {
  const { data, error } = await requireClient().functions.invoke('manual-notification-dispatch', {
    body: { action: 'send', title, message, scope, userIds, channels },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function retryManualNotification(batchId) {
  const { data, error } = await requireClient().functions.invoke('manual-notification-dispatch', {
    body: { action: 'retry', batchId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadTelegramConnection() {
  const { data, error } = await requireClient()
    .from('telegram_connections')
    .select('telegram_username, linked_at')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createTelegramLink() {
  const { data, error } = await requireClient().functions.invoke('telegram-link', {
    body: { action: 'create-link' },
  });
  if (error) throw error;
  if (!data?.url) throw new Error(data?.error || 'Could not create a Telegram link.');
  return data.url;
}

export async function disconnectTelegram() {
  const client = requireClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) throw authError || new Error('Sign in first.');
  const { error } = await client.from('telegram_connections').delete().eq('user_id', authData.user.id);
  if (error) throw error;
}

export async function loadWithdrawalRequests() {
  const { data, error } = await requireClient().from('driver_withdrawal_requests').select('*,drivers(name)').order('requested_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({ ...row, driver: row.drivers?.name || 'Driver', requestedAt: row.requested_at, reviewedAt: row.reviewed_at, requestDate: row.request_date, bankDetails: row.bank_details_snapshot }));
}

export async function requestWithdrawal(amount, bankDetails) {
  const client = requireClient();
  const driverId = await getCurrentDriverId();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const { data, error } = await client.from('driver_withdrawal_requests').insert({
    driver_id: driverId,
    requested_by: userData.user.id,
    amount,
    bank_details_snapshot: bankDetails,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function reviewWithdrawal(id, status) {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const { error } = await client.from('driver_withdrawal_requests').update({
    status,
    reviewed_by: userData.user.id,
    reviewed_at: new Date().toISOString(),
    ...(status === 'paid' ? { paid_at: new Date().toISOString() } : {}),
  }).eq('id', id);
  if (error) throw error;
}

export async function createBusinessExpense(expense) {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const { data, error } = await client.from('business_expenses').insert({
    expense_date: expense.date,
    category: expense.category,
    description: expense.description,
    paid_to: expense.paidTo,
    amount: expense.amount,
    reference: expense.reference || null,
    recorded_by: userData.user.id,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function savePaymentAccount({ id, bankName = '', accountName, accountNumber, currency = 'MVR' }) {
  const { data, error } = await requireClient().from('bank_accounts').upsert({
    ...(id ? { id } : {}),
    bank_name: bankName,
    account_name: accountName,
    account_number: accountNumber,
    currency,
    active: true,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function saveInvoiceCutoff(time) {
  const client = requireClient();
  const { data, error } = await client.rpc('save_invoice_cutoff', {
    p_cutoff: time,
  });
  if (error) throw error;
  if (!Number(data)) {
    throw new Error('The cutoff was not saved. No partner records were updated.');
  }
  return Number(data);
}

export async function loadCurrentRole() {
  const client = requireClient();
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError || !userResult.user) throw userError || new Error('Sign in first.');
  const { data, error } = await client.from('profiles').select('id,full_name,phone,role').eq('id', userResult.user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This signed-in account has no iGO profile yet.');
  let profile = data;
  if (['admin', 'staff'].includes(data.role)) {
    const { data: access, error: accessError } = await client.rpc('get_igo_current_workspace_access');
    if (accessError && !isMissingWorkspaceAccessFunction(accessError, 'get_igo_current_workspace_access')) throw accessError;
    profile = {
      ...data,
      ...(accessError ? {} : {
        allowedWorkspaces: access?.workspace_access || (data.role === 'admin' ? ['Admin', 'Partner', 'Driver'] : ['Staff']),
        workspaceSwitcherVisible: access?.workspace_switcher_visible !== false,
      }),
    };
  }
  return { user: userResult.user, profile };
}

async function loadAccountContactEmails(client = requireClient()) {
  const { data, error } = await client.rpc('list_igo_account_contact_emails');
  if (error) throw error;
  return new Map((data || []).map((row) => [row.user_id, row.email || '']));
}

export async function loadApprovalAccounts() {
  const client = requireClient();
  const [partners, drivers, emails] = await Promise.all([
    client.from('partners').select('id,owner_id,name,contact_name,phone,email,approval_status,created_at').order('created_at', { ascending: false }),
    client.from('drivers').select('id,user_id,name,phone,approval_status,created_at').order('created_at', { ascending: false }),
    loadAccountContactEmails(client),
  ]);
  if (partners.error) throw partners.error;
  if (drivers.error) throw drivers.error;
  return [
    ...(partners.data || []).map((row) => ({ ...row, email: row.email || emails.get(row.owner_id) || '', type: 'Partner', accountId: row.id, status: row.approval_status })),
    ...(drivers.data || []).map((row) => ({ ...row, email: emails.get(row.user_id) || '', type: 'Driver', accountId: row.id, status: row.approval_status })),
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

export async function loadManagedUserAccounts() {
  const client = requireClient();
  const [accounts, admins, audit, accessSettings, emails] = await Promise.all([
    loadApprovalAccounts(),
    client.from('profiles').select('id,full_name,phone,role,created_at').in('role', ['admin', 'staff']).order('created_at', { ascending: false }),
    client.rpc('list_igo_admin_invite_audit'),
    client.rpc('list_igo_admin_access_settings'),
    loadAccountContactEmails(client),
  ]);
  if (admins.error) throw admins.error;
  if (audit.error) throw audit.error;
  const workspaceAccessReady = !accessSettings.error;
  if (accessSettings.error && !isMissingWorkspaceAccessFunction(accessSettings.error, 'list_igo_admin_access_settings')) throw accessSettings.error;
  const auditByUserId = new Map((audit.data || []).map((row) => [row.invited_user_id, row]));
  const settingsByUserId = new Map((accessSettings.data || []).map((row) => [row.invited_user_id, row]));
  return [
    ...accounts,
    ...(admins.data || []).filter((row) => auditByUserId.has(row.id)).map((row) => {
      const inviter = auditByUserId.get(row.id);
      const access = settingsByUserId.get(row.id);
      return {
        ...row,
        email: emails.get(row.id) || '',
        name: row.full_name,
        type: 'Admin',
        accountId: row.id,
        status: row.role,
        adminRole: row.role,
        workspaceAccess: access?.workspace_access || (row.role === 'admin' ? ['Admin', 'Partner', 'Driver'] : ['Staff']),
        workspaceSwitcherVisible: access?.workspace_switcher_visible !== false,
        workspaceAccessReady,
        addedByName: inviter?.invited_by_name || '',
        addedByEmail: inviter?.invited_by_email || '',
        invitedAt: inviter?.invited_at || '',
      };
    }),
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

export async function setAccountApproval(type, id, status) {
  const table = type === 'Driver' ? 'drivers' : 'partners';
  const { error } = await requireClient().from(table).update({ approval_status: status }).eq('id', id);
  if (error) throw error;
}


export async function loadPartnerLogo() {
  const partnerId = await getCurrentPartnerId();
  const { data, error } = await requireClient()
    .from('partners')
    .select('logo_data_url')
    .eq('id', partnerId)
    .maybeSingle();
  if (error) throw error;
  return data?.logo_data_url || '';
}

export async function savePartnerLogo(logoDataUrl) {
  const { error } = await requireClient().rpc('save_igo_partner_logo', {
    p_logo_data_url: logoDataUrl,
  });
  if (error) throw error;
}


export async function loadRiderCardVisibility() {
  const { data, error } = await requireClient()
    .from('public_site_settings')
    .select('value')
    .eq('key', 'show_rider_card')
    .maybeSingle();
  if (error) throw error;
  return data?.value === true;
}

export async function saveRiderCardVisibility(visible) {
  const client = requireClient();
  const { data: isSuperadmin, error: roleError } = await client.rpc('is_igo_superadmin');
  if (roleError) throw roleError;
  if (isSuperadmin !== true) throw new Error('Only the superadmin can change public landing page settings.');
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const { error } = await client.from('public_site_settings').upsert({
    key: 'show_rider_card',
    value: Boolean(visible),
    updated_at: new Date().toISOString(),
    updated_by: userData.user.id,
  }, { onConflict: 'key' });
  if (error) throw error;
}

const landingSlideBucket = 'landing-page-slides';
const landingSlideFields = 'id,image_path,alt_text,caption,display_order,is_visible,created_at,updated_at';

async function requireLandingSlideshowSuperadmin() {
  const client = requireClient();
  const { data: isSuperadmin, error } = await client.rpc('is_igo_superadmin');
  if (error) throw error;
  if (isSuperadmin !== true) throw new Error('Only the superadmin can manage the public landing page slideshow.');
  return client;
}

function landingSlideWithPublicUrl(client, row) {
  const { data } = client.storage.from(landingSlideBucket).getPublicUrl(row.image_path);
  return { ...row, imageUrl: data.publicUrl };
}

export async function loadLandingSlideshowVisibility() {
  const { data, error } = await requireClient()
    .from('public_site_settings')
    .select('value')
    .eq('key', 'show_slideshow_card')
    .maybeSingle();
  if (error) throw error;
  return data?.value === true;
}

const defaultLandingHeroCopy = {
  title: 'Focus on your business. We’ll handle the deliveries.',
  subtitle: 'Best rates. Fast delivery.',
};

export async function loadLandingHeroCopy() {
  const { data, error } = await requireClient()
    .from('public_site_settings')
    .select('value')
    .eq('key', 'landing_hero_copy')
    .maybeSingle();
  if (error) throw error;
  const value = data?.value && typeof data.value === 'object' ? data.value : {};
  return {
    title: String(value.title || defaultLandingHeroCopy.title),
    subtitle: String(value.subtitle || defaultLandingHeroCopy.subtitle),
  };
}

export async function saveLandingHeroCopy({ title, subtitle }) {
  const client = await requireLandingSlideshowSuperadmin();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const cleanTitle = String(title || '').trim();
  const cleanSubtitle = String(subtitle || '').trim();
  if (!cleanTitle || !cleanSubtitle) throw new Error('Enter both the heading and supporting line.');
  const { error } = await client.from('public_site_settings').upsert({
    key: 'landing_hero_copy',
    value: { title: cleanTitle.slice(0, 120), subtitle: cleanSubtitle.slice(0, 180) },
    updated_at: new Date().toISOString(),
    updated_by: userData.user.id,
  }, { onConflict: 'key' });
  if (error) throw error;
}

export async function loadLandingSlideshowTransition() {
  const { data, error } = await requireClient()
    .from('public_site_settings')
    .select('value')
    .eq('key', 'slideshow_transition')
    .maybeSingle();
  if (error) throw error;
  return ['fade', 'slide', 'zoom'].includes(data?.value) ? data.value : 'fade';
}

export async function saveLandingSlideshowTransition(transition) {
  const client = await requireLandingSlideshowSuperadmin();
  if (!['fade', 'slide', 'zoom'].includes(transition)) throw new Error('Choose a valid slide transition.');
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const { error } = await client.from('public_site_settings').upsert({
    key: 'slideshow_transition',
    value: transition,
    updated_at: new Date().toISOString(),
    updated_by: userData.user.id,
  }, { onConflict: 'key' });
  if (error) throw error;
}

export async function saveLandingSlideshowVisibility(visible) {
  const client = await requireLandingSlideshowSuperadmin();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const { error } = await client.from('public_site_settings').upsert({
    key: 'show_slideshow_card',
    value: Boolean(visible),
    updated_at: new Date().toISOString(),
    updated_by: userData.user.id,
  }, { onConflict: 'key' });
  if (error) throw error;
}

export async function loadLandingPageSlides(includeHidden = false) {
  const client = requireClient();
  let query = client.from('landing_page_slides')
    .select(landingSlideFields)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (!includeHidden) query = query.eq('is_visible', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => landingSlideWithPublicUrl(client, row));
}

export async function uploadLandingPageSlide({ file, altText, caption = '' }) {
  const client = await requireLandingSlideshowSuperadmin();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  if (!file) throw new Error('Choose an image to upload.');
  const extensionsByType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/jpg': 'jpg' };
  const type = String(file.type || '').toLowerCase();
  const contentType = type === 'image/jpg' ? 'image/jpeg' : type;
  if (!extensionsByType[contentType]) throw new Error('Choose a JPG, PNG, or WebP image.');
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.');
  const cleanAltText = String(altText || '').trim();
  if (!cleanAltText) throw new Error('Add alternative text to describe the image.');
  const imagePath = `${crypto.randomUUID()}.${extensionsByType[contentType]}`;
  const { error: uploadError } = await client.storage.from(landingSlideBucket).upload(imagePath, file, {
    cacheControl: '3600',
    contentType,
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { data, error } = await client.from('landing_page_slides').insert({
    image_path: imagePath,
    alt_text: cleanAltText.slice(0, 240),
    caption: String(caption || '').trim().slice(0, 160),
    updated_by: userData.user.id,
  }).select(landingSlideFields).single();
  if (error) {
    await client.storage.from(landingSlideBucket).remove([imagePath]);
    throw error;
  }
  return landingSlideWithPublicUrl(client, data);
}

export async function updateLandingPageSlide(id, changes) {
  const client = await requireLandingSlideshowSuperadmin();
  const update = { updated_at: new Date().toISOString() };
  if (Object.hasOwn(changes, 'alt_text')) {
    const altText = String(changes.alt_text || '').trim();
    if (!altText) throw new Error('Alternative text cannot be empty.');
    update.alt_text = altText.slice(0, 240);
  }
  if (Object.hasOwn(changes, 'caption')) update.caption = String(changes.caption || '').trim().slice(0, 160);
  if (Object.hasOwn(changes, 'is_visible')) update.is_visible = Boolean(changes.is_visible);
  const { data, error } = await client.from('landing_page_slides')
    .update(update)
    .eq('id', id)
    .select(landingSlideFields)
    .single();
  if (error) throw error;
  return landingSlideWithPublicUrl(client, data);
}

export async function reorderLandingPageSlides(slideIds) {
  const client = await requireLandingSlideshowSuperadmin();
  if (!Array.isArray(slideIds)) throw new Error('Invalid slide order.');
  for (const [index, id] of slideIds.entries()) {
    const { error } = await client.from('landing_page_slides')
      .update({ display_order: index, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }
}

export async function deleteLandingPageSlide(id) {
  const client = await requireLandingSlideshowSuperadmin();
  const { data: slide, error: loadError } = await client.from('landing_page_slides')
    .select('image_path')
    .eq('id', id)
    .single();
  if (loadError) throw loadError;
  const { error } = await client.from('landing_page_slides').delete().eq('id', id);
  if (error) throw error;
  const { error: storageError } = await client.storage.from(landingSlideBucket).remove([slide.image_path]);
  if (storageError) console.warn('Slideshow image cleanup failed:', storageError);
}

