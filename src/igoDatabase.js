import { supabase } from './supabase';

const requireClient = () => {
  if (!supabase) throw new Error('Supabase is not configured for this app.');
  return supabase;
};

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
  let query = client
    .from('packages')
    .select('*,partners(name,phone,address,logo_data_url),drivers(name,phone)')
    .order('created_at', { ascending: false });
  if (partnerId) query = query.eq('partner_id', partnerId);
  if (driverId) query = query.eq('assigned_driver_id', driverId);
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
  const allowed = kind === 'proof'
    ? ['image/jpeg', 'image/png', 'image/webp']
    : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('Use a JPG, PNG, WebP, or PDF file under 10 MB.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${userData.user.id}/${kind}/${recordId}/${Date.now()}-${safeName}`;
  const { error } = await client.storage.from('igo-delivery-files').upload(path, file, {
    contentType: file.type,
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
  const accountQuery = client.from('bank_accounts').select('*').order('created_at', { ascending: false });
  const partnerQuery = client.from('partners').select('id,invoice_cutoff').order('created_at', { ascending: false });
  if (partnerId) {
    invoiceQuery = invoiceQuery.eq('partner_id', partnerId);
    paymentQuery = paymentQuery.eq('partner_id', partnerId);
  }
  const [invoiceResult, paymentResult, expenseResult, withdrawalResult, accountResult, partnerResult] = await Promise.all([
    invoiceQuery,
    paymentQuery,
    isAdmin ? client.from('business_expenses').select('*').order('expense_date', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    isAdmin ? client.from('driver_withdrawal_requests').select('*,drivers(name)').order('requested_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    accountQuery,
    partnerQuery,
  ]);
  for (const result of [invoiceResult, paymentResult, expenseResult, withdrawalResult, accountResult, partnerResult]) {
    if (result.error) throw result.error;
  }
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
      invoiceId: row.invoices?.invoice_number || row.payment_allocations?.map((a) => a.invoices?.invoice_number).filter(Boolean).join(', ') || '',
      partnerId: row.partner_id,
      partner: row.partners?.name || '',
      amount: Number(row.amount || 0),
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
    invoiceCutoff: partnerResult.data?.[0]?.invoice_cutoff || '18:00',
  };
}

export async function submitInvoicePayment({ partnerId, invoiceId, amount, reference, transferDate, note, file }) {
  const client = requireClient();
  const path = await uploadIgoFile(file, 'receipts', invoiceId);
  const { data, error } = await client.from('payments').insert({
    partner_id: partnerId,
    target_invoice_id: invoiceId,
    amount,
    reference_number: reference,
    transfer_date: transferDate || new Date().toISOString().slice(0, 10),
    note,
    receipt_path: path,
    status: 'pending_verification',
  }).select().single();
  if (error) throw error;
  return data;
}

export async function reviewPayment(paymentId, status, reason = '') {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Sign in first.');
  const { error } = await client.from('payments').update({
    status,
    rejection_reason: status === 'rejected' ? reason : null,
    verified_by: userData.user.id,
    verified_at: new Date().toISOString(),
  }).eq('id', paymentId);
  if (error) throw error;
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
    return ({
    ...row,
    online: setting?.online || false,
    onlineUpdatedAt: setting?.online_updated_at || null,
    sharePercent: Number(setting?.share_percent || 0),
  });
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
  const { data: partners, error: listError } = await client.from('partners').select('id');
  if (listError) throw listError;
  if (!partners?.length) throw new Error('No partner records are available.');
  const results = await Promise.all(partners.map(({ id }) => client.from('partners').update({ invoice_cutoff: time }).eq('id', id)));
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
}

export async function loadCurrentRole() {
  const client = requireClient();
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError || !userResult.user) throw userError || new Error('Sign in first.');
  const { data, error } = await client.from('profiles').select('id,full_name,phone,role').eq('id', userResult.user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This signed-in account has no iGO profile yet.');
  return { user: userResult.user, profile: data };
}

export async function loadApprovalAccounts() {
  const client = requireClient();
  const [partners, drivers] = await Promise.all([
    client.from('partners').select('id,owner_id,name,contact_name,phone,email,approval_status,created_at').order('created_at', { ascending: false }),
    client.from('drivers').select('id,user_id,name,phone,approval_status,created_at').order('created_at', { ascending: false }),
  ]);
  if (partners.error) throw partners.error;
  if (drivers.error) throw drivers.error;
  return [
    ...(partners.data || []).map((row) => ({ ...row, type: 'Partner', accountId: row.id, status: row.approval_status })),
    ...(drivers.data || []).map((row) => ({ ...row, type: 'Driver', accountId: row.id, status: row.approval_status })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
