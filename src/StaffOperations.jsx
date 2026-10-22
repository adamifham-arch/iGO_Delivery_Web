import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

const roleLabels = {
  department_requester: 'Payment requester',
  finance_approver: 'Finance approver',
  payment_officer: 'Payment officer',
  operations_manager: 'Operations manager',
  operations_staff: 'Operations staff',
  customer_support: 'Customer support',
  people_manager: 'People manager',
};
const money = (value) => 'MVR ' + Number(value || 0).toFixed(2);
const card = { padding: 18, borderRadius: 16, border: '1px solid #405169', background: '#1e2b40', color: '#edf3ff', marginBottom: 16 };

export function StaffOperations({ user, profile, isOwner = false, view = 'all' }) {
  const showOperations = ['all', 'operations', 'staff'].includes(view);
  const showFinance = ['all', 'finance'].includes(view);
  const showPeople = ['all', 'people', 'staff'].includes(view);
  const assignments = profile?.staffAssignments || [];
  const roles = new Set(assignments.map((item) => item.role));
  const [requests, setRequests] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [events, setEvents] = useState({});
  const [people, setPeople] = useState([]);
  const [staffRows, setStaffRows] = useState([]);
  const [packages, setPackages] = useState([]);
  const [packageSearchInput, setPackageSearchInput] = useState('');
  const [packageSearch, setPackageSearch] = useState('');
  const [packagePartnerFilter, setPackagePartnerFilter] = useState('all');
  const [packageStatusFilter, setPackageStatusFilter] = useState('all');
  const [packageAreaFilter, setPackageAreaFilter] = useState('all');
  const supportPackagePartners = [...new Map(packages.map((item) => [item.partner_id, item.partners?.name || item.partner_name || 'Partner unavailable']).filter(([id]) => id)).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const supportPackageStatuses = [...new Set(packages.map((item) => item.status).filter(Boolean))].sort();
  const supportPackageAreas = [...new Set(packages.map((item) => item.area).filter(Boolean))].sort();
  const visibleSupportPackages = packages.filter((item) => {
    const query = packageSearch.trim().toLocaleLowerCase();
    const searchable = [item.package_number, item.package_code, item.id, item.customer_name, item.customer_phone, item.partners?.name, item.partner_name, item.area, item.address, item.item_description, item.notes, item.status].filter(Boolean).join(' ').toLocaleLowerCase();
    return (!query || searchable.includes(query)) &&
      (packagePartnerFilter === 'all' || item.partner_id === packagePartnerFilter) &&
      (packageStatusFilter === 'all' || item.status === packageStatusFilter) &&
      (packageAreaFilter === 'all' || item.area === packageAreaFilter);
  });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ departmentId: assignments[0]?.department_id || '', category: 'Supplies', description: '', payee: '', amount: '', dueDate: '' });
  const [assignmentDraft, setAssignmentDraft] = useState({ userId: '', departmentId: assignments[0]?.department_id || '', role: 'department_requester' });
  const canManage = isOwner || roles.has('people_manager');
  const canReview = isOwner || roles.has('finance_approver');
  const canPay = isOwner || roles.has('payment_officer');
  const canRequest = isOwner || roles.has('department_requester') || roles.has('operations_manager');

  const refresh = async () => {
    setError('');
    try {
      const [requestResult, withdrawalResult, departmentResult] = await Promise.all([
        supabase.from('payment_requests').select('*,departments(name),payment_request_events(id,actor_id,event,details,created_at)').order('created_at', { ascending: false }),
        supabase.from('driver_withdrawal_requests').select('*,drivers(name)').order('requested_at', { ascending: false }),
        supabase.from('departments').select('id,name,description,active').order('name'),
      ]);
      if (requestResult.error) throw requestResult.error;
      if (withdrawalResult.error && (canReview || canPay || isOwner)) throw withdrawalResult.error;
      if (departmentResult.error) throw departmentResult.error;
      setRequests(requestResult.data || []);
      setWithdrawals(withdrawalResult.data || []);
      setDepartments(departmentResult.data || []);
      if (roles.has('customer_support') && !roles.has('operations_manager') && !roles.has('operations_staff') && !isOwner) {
        const packageResult = await supabase.from('packages').select('*,partners(name,phone,address),drivers(name,phone)').order('created_at', { ascending: false }).limit(1000);
        if (packageResult.error) throw packageResult.error;
        setPackages(packageResult.data || []);
      } else setPackages([]);
      if (canManage) {
        const [profileResult, assignmentResult] = await Promise.all([
          supabase.from('profiles').select('id,full_name,role').in('role', ['admin', 'staff']).order('full_name'),
          supabase.from('staff_role_assignments').select('id,user_id,role,active,department_id,departments(name),profiles(full_name)').order('created_at', { ascending: false }),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (assignmentResult.error) throw assignmentResult.error;
        setPeople(profileResult.data || []);
        setStaffRows(assignmentResult.data || []);
      }
    } catch (loadError) {
      setError(loadError.message || 'Could not load staff payment operations.');
    }
  };

  useEffect(() => { void refresh(); }, [canManage, canReview, canPay, isOwner]);

  const submitRequest = async (event) => {
    event.preventDefault();
    setNotice(''); setError('');
    try {
      const { error: insertError } = await supabase.from('payment_requests').insert({
        department_id: draft.departmentId,
        requester_id: user.id,
        category: draft.category.trim(),
        description: draft.description.trim(),
        payee_name: draft.payee.trim(),
        amount: Number(draft.amount),
        due_date: draft.dueDate || null,
      });
      if (insertError) throw insertError;
      setDraft((current) => ({ ...current, description: '', payee: '', amount: '', dueDate: '' }));
      setNotice('Payment request submitted to Finance.');
      await refresh();
    } catch (submitError) { setError(submitError.message || 'Could not submit this request.'); }
  };

  const decide = async (table, id, status, rejectionReason = '') => {
    setNotice(''); setError('');
    try {
      const { error: updateError } = await supabase.from(table).update(
        table === 'payment_requests' ? { status, rejection_reason: rejectionReason } : { status, rejection_reason: rejectionReason }
      ).eq('id', id);
      if (updateError) throw updateError;
      setNotice(status === 'approved' ? 'Approved. The payment officer has been notified.' : status === 'rejected' ? 'Request rejected.' : 'Request updated.');
      await refresh();
    } catch (updateError) { setError(updateError.message || 'Could not update the request.'); }
  };

  const openSlip = async (path) => {
    try {
      const { data, error: signedError } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 60);
      if (signedError) throw signedError;
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (openError) { setError(openError.message || 'Could not open the payment slip.'); }
  };

  const recordPayment = async (table, id, event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get('slip');
    if (!(file instanceof File) || !file.size) { setError('Attach the payment slip.'); return; }
    setNotice(''); setError('');
    const path = user.id + '/' + id + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    try {
      const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (uploadError) throw uploadError;
      const patch = table === 'payment_requests'
        ? { status: 'paid', paid_by: user.id, paid_at: new Date().toISOString(), payment_reference: String(values.get('reference') || '').trim(), payment_slip_path: path }
        : { status: 'paid', paid_by: user.id, paid_at: new Date().toISOString(), paid_reference: String(values.get('reference') || '').trim(), payment_slip_path: path };
      const { error: updateError } = await supabase.from(table).update(patch).eq('id', id);
      if (updateError) throw updateError;
      setNotice('Payment recorded with the attached slip.');
      await refresh();
    } catch (paymentError) { setError(paymentError.message || 'Could not record the payment.'); }
  };

  const assignRole = async (event) => {
    event.preventDefault();
    const { error: assignError } = await supabase.rpc('assign_igo_staff_role', {
      p_user_id: assignmentDraft.userId,
      p_department_id: assignmentDraft.departmentId,
      p_role: assignmentDraft.role,
      p_active: true,
    });
    if (assignError) setError(assignError.message);
    else { setNotice('Staff role assigned. The account will have restricted staff access after signing in again.'); await refresh(); }
  };

  const requestRows = useMemo(() => requests.map((item) => ({ ...item, kind: 'payment', date: item.created_at, displayName: item.departments?.name || 'Department' })), [requests]);
  const withdrawalRows = useMemo(() => withdrawals.map((item) => ({ ...item, kind: 'withdrawal', date: item.requested_at, displayName: item.drivers?.name || 'Driver' })), [withdrawals]);
  const rows = [...requestRows, ...withdrawalRows].sort((a, b) => new Date(b.date) - new Date(a.date));

  const renderPaymentForm = (item, table) => <form className="staff-payment-form" onSubmit={(event) => recordPayment(table, item.id, event)} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, marginTop: 12 }}>
    <label>Payment reference<input name="reference" required /></label>
    <label>Payment slip<input name="slip" type="file" accept="image/*,application/pdf" required /></label>
    <button type="submit">Attach slip and mark paid</button>
  </form>;

  return <div className="staff-operations">
    {notice && <p role="status" className="notice">{notice}</p>}
    {error && <p role="alert" className="notice">{error}</p>}
    {view === 'staff' && !isOwner && !canManage && !['operations_manager', 'operations_staff', 'customer_support'].some((role) => roles.has(role)) && (
      <section style={card} role="status">
        <h2>No staff tools are assigned</h2>
        {['department_requester', 'finance_approver', 'payment_officer'].some((role) => roles.has(role))
          ? <p>This account has finance access. Open Finance Management from the menu to view payment requests.</p>
          : <p>Ask the iGO owner to assign an active department and staff role to this account.</p>}
      </section>
    )}

    {showOperations && roles.has('customer_support') && !roles.has('operations_manager') && !roles.has('operations_staff') && !isOwner && <section style={card}>
      <h3>Package operations · read-only</h3>
      <p>Search packages and check delivery details. This role cannot change package records.</p>
      <form className="staff-package-filters" onSubmit={(event) => { event.preventDefault(); setPackageSearch(packageSearchInput); }}>
        <label>Search packages
          <input type="search" value={packageSearchInput} onChange={(event) => setPackageSearchInput(event.target.value)} placeholder="Package number, customer, phone, partner…" />
        </label>
        <button type="submit">Search</button>
        <label>Partner
          <select value={packagePartnerFilter} onChange={(event) => setPackagePartnerFilter(event.target.value)}>
            <option value="all">All partners</option>
            {supportPackagePartners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>Status
          <select value={packageStatusFilter} onChange={(event) => setPackageStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {supportPackageStatuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <label>Area
          <select value={packageAreaFilter} onChange={(event) => setPackageAreaFilter(event.target.value)}>
            <option value="all">All areas</option>
            {supportPackageAreas.map((area) => <option key={area} value={area}>{area}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => { setPackageSearchInput(''); setPackageSearch(''); setPackagePartnerFilter('all'); setPackageStatusFilter('all'); setPackageAreaFilter('all'); }}>Clear filters</button>
      </form>
      <p className="staff-package-result-count">Showing {visibleSupportPackages.length} of {packages.length} packages</p>
      {visibleSupportPackages.length ? <div className="staff-package-list">
        {visibleSupportPackages.map((item) => <details className="staff-package-card" key={item.id}>
          <summary>
            <span><strong>{item.package_number || item.package_code || item.id}</strong><span>{item.customer_name || 'Customer unavailable'} · {item.customer_phone || item.phone || 'Phone unavailable'}</span></span>
            <span className="staff-package-summary-meta"><strong>{item.partners?.name || item.partner_name || 'Partner unavailable'}</strong><span>{String(item.status || 'status unavailable').replaceAll('_', ' ')}</span></span>
          </summary>
          <dl className="staff-package-detail-grid">
            <div><dt>Partner</dt><dd>{item.partners?.name || item.partner_name || 'Partner unavailable'}</dd></div>
            <div><dt>Partner phone</dt><dd>{item.partners?.phone || '—'}</dd></div>
            <div><dt>Package number</dt><dd>{item.package_number || item.package_code || item.id}</dd></div>
            <div><dt>Customer</dt><dd>{item.customer_name || '—'}</dd></div>
            <div><dt>Customer phone</dt><dd>{item.customer_phone || item.phone || '—'}</dd></div>
            <div><dt>Area</dt><dd>{item.area || '—'}</dd></div>
            <div><dt>Address</dt><dd>{item.address || '—'}</dd></div>
            <div><dt>Status</dt><dd>{String(item.status || '—').replaceAll('_', ' ')}</dd></div>
            <div><dt>Item</dt><dd>{item.item_description || '—'}</dd></div>
            <div><dt>Assigned driver</dt><dd>{item.drivers?.name || 'Not assigned'}</dd></div>
            <div><dt>Added</dt><dd>{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</dd></div>
            {item.notes && <div className="staff-package-detail-wide"><dt>Notes</dt><dd>{item.notes}</dd></div>}
          </dl>
        </details>)}
      </div> : <p>No packages match these search terms or filters.</p>}
    </section>}

    {showFinance && canRequest && <section style={card}>
      <h3>Request a payment</h3>
      <form onSubmit={submitRequest} className="finance-expense-form">
        <label>Department<select required value={draft.departmentId} onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}><option value="">Choose department</option>{departments.filter((department) => department.active && (isOwner || roles.has('people_manager') || assignments.some((item) => item.department_id === department.id))).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        <label>Category<input required value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
        <label>Payee<input required value={draft.payee} onChange={(event) => setDraft({ ...draft, payee: event.target.value })} /></label>
        <label>Amount (MVR)<input type="number" min="0.01" step="0.01" required value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
        <label>Needed by<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        <label>Description<input required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <button type="submit">Send to Finance</button>
      </form>
    </section>}

    {showFinance && <section id="staff-payment-status" style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><div><h3>Payment status</h3><p>Finance sees requests for review; payment officers see approved items to pay.</p></div><button type="button" onClick={() => void refresh()}>Refresh</button></div>
      {rows.length ? rows.map((item) => {
        const withdrawal = item.kind === 'withdrawal';
        const status = item.status;
        const canApprove = canReview && status === 'pending_review' && !withdrawal
          || canReview && status === 'pending' && withdrawal;
        const canComplete = canPay && status === 'approved';
        const history = item.payment_request_events || [];
        return <article key={item.kind + item.id} style={{ borderTop: '1px solid #526178', padding: '14px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div><strong>{withdrawal ? 'Driver withdrawal' : item.category}</strong> · {item.displayName}<p>{withdrawal ? 'Withdrawal request' : item.description + ' · Payee: ' + item.payee_name}</p><p>{money(item.amount)} · Submitted {new Date(item.date).toLocaleString()}</p></div>
            <strong className={'status-pill status-' + status}>{status.replaceAll('_', ' ')}</strong>
          </div>
          {withdrawal && <details><summary>Bank details for payout</summary><p>{item.bank_details_snapshot?.bankName} · {item.bank_details_snapshot?.accountHolder} · {item.bank_details_snapshot?.accountNumber} · {item.bank_details_snapshot?.branch}</p></details>}
          {item.rejection_reason && <p><strong>Reason:</strong> {item.rejection_reason}</p>}
          {withdrawal && (item.reviewed_at || item.paid_at) && <p><strong>Reviewed:</strong> {item.reviewed_at ? new Date(item.reviewed_at).toLocaleString() + ' · ' + (item.reviewed_by || 'system').slice(0, 8) : '—'}{item.paid_at && <> · <strong>Paid:</strong> {new Date(item.paid_at).toLocaleString()} · {(item.paid_by || 'system').slice(0, 8)}</>}</p>}
          {(item.payment_reference || item.paid_reference) && <p><strong>Payment reference:</strong> {item.payment_reference || item.paid_reference}</p>}
          {item.payment_slip_path && <p><strong>Payment slip attached.</strong> <button type="button" onClick={() => void openSlip(item.payment_slip_path)}>View slip</button></p>}
          {canApprove && <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={() => void decide(withdrawal ? 'driver_withdrawal_requests' : 'payment_requests', item.id, 'approved')}>Approve and request payment</button>
            <form onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get('reason') || '').trim(); if (reason.length < 3) { setError('Enter a reason for rejection.'); return; } void decide(withdrawal ? 'driver_withdrawal_requests' : 'payment_requests', item.id, 'rejected', reason); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input name="reason" placeholder="Reason for rejection" required minLength={3} /><button type="submit">Reject with reason</button>
            </form>
          </div>}
          {canComplete && renderPaymentForm(item, withdrawal ? 'driver_withdrawal_requests' : 'payment_requests')}
          {!withdrawal && history.length > 0 && <details style={{ marginTop: 8 }}><summary>Activity history</summary>{history.map((entry) => <p key={entry.id}>{entry.event} · {new Date(entry.created_at).toLocaleString()} · by {entry.actor_id ? entry.actor_id.slice(0, 8) : 'system'} {entry.details && '· ' + entry.details}</p>)}</details>}
        </article>;
      }) : <p>No payment requests are visible to your role.</p>}
    </section>}

    {showPeople && canManage && <section style={card}>
      <h3>Departments and staff access</h3>
      <p>Invite a person through User Management first, then assign their account here. Staff assignments replace broad admin access with the selected department role.</p>
      <form onSubmit={assignRole} className="finance-expense-form">
        <label>Account<select required value={assignmentDraft.userId} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, userId: event.target.value })}><option value="">Choose invited account</option>{people.filter((person) => person.id !== user.id).map((person) => <option key={person.id} value={person.id}>{person.full_name || person.id.slice(0, 8)} · {person.role}</option>)}</select></label>
        <label>Department<select required value={assignmentDraft.departmentId} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, departmentId: event.target.value })}><option value="">Choose department</option>{departments.filter((department) => department.active && (isOwner || roles.has('people_manager') || assignments.some((item) => item.department_id === department.id))).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        <label>Staff role<select value={assignmentDraft.role} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, role: event.target.value })}>{Object.entries(roleLabels).filter(([role]) => isOwner || !['finance_approver','payment_officer','people_manager'].includes(role)).map(([role,label]) => <option key={role} value={role}>{label}</option>)}</select></label>
        <button type="submit">Assign department role</button>
      </form>
      {staffRows.filter((row) => row.active).map((row) => <p key={row.id}>{row.profiles?.full_name || row.user_id.slice(0,8)} · {row.departments?.name} · {roleLabels[row.role]} · {row.active ? 'Active' : 'Inactive'} {row.active && (isOwner || (roles.has('people_manager') && !['finance_approver','payment_officer','people_manager'].includes(row.role))) && <button type="button" onClick={async () => { const { error: revokeError } = await supabase.rpc('assign_igo_staff_role', { p_user_id: row.user_id, p_department_id: row.department_id, p_role: row.role, p_active: false }); if (revokeError) setError(revokeError.message); else { setNotice('Staff role removed.'); await refresh(); } }}>Remove role</button>}</p>)}
    </section>}
  </div>;
}
