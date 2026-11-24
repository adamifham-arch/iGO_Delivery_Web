import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { getCurrentPartnerIdOptional } from './igoDatabase';

const mvr = (n) => 'MVR ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseMoney = (n) => Number(n || 0);

export default function CodSettlementManagement({ workspace = 'Partner' }) {
  const isAdmin = workspace === 'Admin';
  const [partnerId, setPartnerId] = useState('');
  const [packages, setPackages] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [requests, setRequests] = useState([]);
  const [cashAllocations, setCashAllocations] = useState([]);
  const [invoiceAllocations, setInvoiceAllocations] = useState([]);
  const [selected, setSelected] = useState([]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(Boolean(supabase));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reload = async () => {
    if (!supabase) return;
    const id = isAdmin ? null : await getCurrentPartnerIdOptional();
    if (!isAdmin && !id) {
      setPartnerId('');
      setPackages([]);
      setInvoices([]);
      setRequests([]);
      setCashAllocations([]);
      setInvoiceAllocations([]);
      setError('No approved partner is linked to this workspace.');
      return;
    }
    setPartnerId(id || '');
    let p = supabase.from('packages').select('id,package_number,partner_id,customer_name,status,cod_amount,cod_collected_amount,cod_collected_at,cod_received_by_igo_at,partners(name),drivers(name)').not('cod_amount', 'is', null).order('created_at', { ascending: false });
    let i = supabase.from('invoices').select('id,partner_id,invoice_number,subtotal,paid_amount,status,created_at').order('created_at', { ascending: false });
    let r = supabase.from('cod_invoice_settlement_requests').select('*,partners(name)').order('requested_at', { ascending: false });
    let c = supabase.from('cod_invoice_settlement_cash_allocations').select('settlement_id,package_id,amount,packages(partner_id)');
    let a = supabase.from('cod_invoice_settlement_invoice_allocations').select('settlement_id,invoice_id,amount,invoices(invoice_number)');
    if (id) {
      p = p.eq('partner_id',id);
      i = i.eq('partner_id',id);
      r = r.eq('partner_id',id);
    }
    const out = await Promise.all([p,i,r,c,a]);
    const failure = out.find(x => x.error);
    if (failure) throw failure.error;
    setPackages(out[0].data || []);
    setInvoices(out[1].data || []);
    setRequests(out[2].data || []);
    setCashAllocations(out[3].data || []);
    setInvoiceAllocations(out[4].data || []);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void reload().catch(e => {
      if (active) setError(e.message || 'Could not load COD settlements.');
    }).finally(() => { if (active) setLoading(false); });
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void reload().catch(e => { if (active) setError(e.message || 'Could not refresh COD balances.'); });
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('igo-live-finance-updated', refresh);
    const interval = window.setInterval(refresh, 30000);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('igo-live-finance-updated', refresh);
      window.clearInterval(interval);
    };
  }, [workspace]);

  const usedByPackage = useMemo(() => {
    const map = new Map();
    cashAllocations.forEach(row => map.set(row.package_id, parseMoney(map.get(row.package_id)) + parseMoney(row.amount)));
    return map;
  }, [cashAllocations]);

  const collected = packages.filter(p => p.cod_collected_at && p.status === 'delivered' && p.cod_collected_amount != null);
  const totalCollected = collected.reduce((n,p) => n+parseMoney(p.cod_collected_amount),0);
  const totalVerified = collected.filter(p=>p.cod_received_by_igo_at).reduce((n,p)=>n+parseMoney(p.cod_collected_amount),0);
  const used = collected.reduce((n,p)=>n+parseMoney(usedByPackage.get(p.id)),0);
  const ownRequests = isAdmin ? [] : requests.filter(r => r.partner_id === partnerId);
  const pendingAmount = ownRequests.filter(r=>r.status==='pending').reduce((n,r)=>n+parseMoney(r.requested_amount),0);
  const requestable = Math.max(0, totalCollected-used-pendingAmount);
  const partnerBalances = useMemo(() => {
    const map = new Map();
    const ensure = (id, name) => {
      if (!map.has(id)) map.set(id, { id, name: name || 'Partner', collected: 0, verified: 0, used: 0, pending: 0 });
      const row = map.get(id);
      if (name) row.name = name;
      return row;
    };
    collected.forEach(p => {
      const row = ensure(p.partner_id, p.partners?.name);
      row.collected += parseMoney(p.cod_collected_amount);
      if (p.cod_received_by_igo_at) row.verified += parseMoney(p.cod_collected_amount);
      row.used += parseMoney(usedByPackage.get(p.id));
    });
    requests.filter(r => r.status === 'pending').forEach(r => {
      ensure(r.partner_id, r.partners?.name).pending += parseMoney(r.requested_amount);
    });
    return [...map.values()].map(row => ({
      ...row,
      available: Math.max(0, Math.round((row.verified - row.used - row.pending) * 100) / 100),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [collected, requests, usedByPackage]);
  const verifiedAvailable = isAdmin
    ? partnerBalances.reduce((n, row) => n + row.available, 0)
    : Math.max(0, Math.round((totalVerified - used - pendingAmount) * 100) / 100);
  const allPendingAmount = requests.filter(r => r.status === 'pending').reduce((n,r) => n + parseMoney(r.requested_amount), 0);
  const unpaid = invoices.filter(i => ['unpaid','partially_paid'].includes(i.status) && parseMoney(i.subtotal)>parseMoney(i.paid_amount));
  const selectedInvoices = unpaid.filter(i=>selected.includes(i.id));
  const selectedDue = selectedInvoices.reduce((n,i)=>n+Math.max(0,parseMoney(i.subtotal)-parseMoney(i.paid_amount)),0);
  const readyAmount = Number(amount);

  const perform = async (label, call, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      const { data, error: rpcError } = await call();
      if (rpcError) throw rpcError;
      await reload();
      window.dispatchEvent(new Event('igo-live-finance-updated'));
      setMessage(label + ' completed.');
      return data;
    } catch (err) {
      setError(err.message || 'Could not complete the action.');
      return null;
    } finally {
      setBusy('');
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selected.length) { setError('Choose one or more unpaid invoices.'); return; }
    if (!Number.isFinite(readyAmount) || readyAmount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(amount.trim()) || readyAmount > requestable + 0.0001 || readyAmount > selectedDue + 0.0001) {
      setError('Amount must be positive and cannot exceed unallocated COD collected or your selected invoice balances.');
      return;
    }
    const result = await perform('COD settlement request',
      () => supabase.rpc('request_cod_invoice_settlement', { p_invoice_ids: selected, p_amount: readyAmount, p_note: note }));
    if (result) { setSelected([]); setAmount(''); setNote(''); }
  };

  const verifyCash = (p) => perform('COD cash receipt verification',
    () => supabase.rpc('verify_cod_cash_received_by_igo', { p_package_id: p.id }),
    'Confirm that iGO has physically received ' + mvr(p.cod_collected_amount) + ' from the driver for package IGO-' + p.package_number + '? This is a financial verification.');

  const review = (r, approve) => {
    if (!approve) {
      const reason = window.prompt('Reason for rejecting this partner COD settlement:');
      if (reason == null) return;
      if (reason.trim().length < 3) { setError('Enter a reason of at least three characters.'); return; }
      void perform('COD settlement rejection', () => supabase.rpc('review_cod_invoice_settlement', { p_request_id: r.id, p_approve: false, p_rejection_reason: reason.trim() }));
      return;
    }
    void perform('COD invoice settlement approval',
      () => supabase.rpc('review_cod_invoice_settlement', { p_request_id: r.id, p_approve: true, p_rejection_reason: null }),
      'Approve ' + mvr(r.requested_amount) + ' of verified iGO-held COD cash against this partner’s invoices? The invoice balances will be reduced immediately and cannot be undone from this screen.');
  };

  const settlementDetails = (r) => {
    const assigned = invoiceAllocations.filter(a=>a.settlement_id===r.id);
    return assigned.length
      ? assigned.map(a => (a.invoices?.invoice_number || a.invoice_id) + ': ' + mvr(a.amount)).join(' · ')
      : r.invoice_ids?.map(id => invoices.find(i=>i.id===id)?.invoice_number || id).join(', ') || 'Invoices unavailable';
  };

  if (!supabase) return null;

  return <section className="card cod-settlement-management" style={{ padding: 18, marginTop: 16, display: 'grid', gap: 16 }} aria-label="COD invoice settlements">
    <header>
      <p className="eyebrow">COD ACCOUNTING</p>
      <h2 style={{ margin: '4px 0 5px' }}>{isAdmin ? 'COD cash receipts and invoice settlements' : 'Settle your iGO invoices using COD'}</h2>
      <p className="muted" style={{ margin: 0 }}>Customer COD money remains separate from iGO delivery-fee charges. A partner requests an invoice offset, and iGO confirms it only after physically receiving the cash.</p>
    </header>
    {loading && <p className="muted">Loading COD balances…</p>}
    {message && <p role="status" className="notice">{message}</p>}
    {error && <p role="alert" className="notice">{error}</p>}
    {!loading && !isAdmin && partnerId && <>
      <div className="stat-card" style={{ borderColor: '#155d43' }}>
        <span>Available COD balance</span><strong style={{ color: '#155d43' }}>{mvr(verifiedAvailable)}</strong>
        <small>Verified cash remaining after approved invoice offsets and pending requests</small>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><span>COD collected by drivers</span><strong>{mvr(totalCollected)}</strong></div>
        <div className="stat-card"><span>COD received by iGO</span><strong>{mvr(totalVerified)}</strong></div>
        <div className="stat-card"><span>Awaiting cash verification</span><strong>{mvr(Math.max(0,totalCollected-totalVerified))}</strong></div>
        <div className="stat-card"><span>Applied to invoices</span><strong>{mvr(used)}</strong></div>
        <div className="stat-card"><span>Pending settlement requests</span><strong>{mvr(pendingAmount)}</strong><small>Reserved until reviewed</small></div>
        <div className="stat-card"><span>COD eligible to request</span><strong>{mvr(requestable)}</strong><small>Includes collected cash not yet verified; approval requires verified cash</small></div>
      </div>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Request payment of outstanding invoices</h3>
        {unpaid.length ? <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="secondary-btn" onClick={()=>setSelected(unpaid.map(i=>i.id))}>Select all unpaid invoices</button>
            <button type="button" className="secondary-btn" onClick={()=>setSelected([])}>Clear selection</button>
          </div>
          {unpaid.map(i=><label key={i.id} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '8px 0' }}>
            <input type="checkbox" checked={selected.includes(i.id)} onChange={e => setSelected(old => e.target.checked ? [...old,i.id] : old.filter(id=>id!==i.id))} />
            <span><strong>{i.invoice_number}</strong> · outstanding {mvr(parseMoney(i.subtotal)-parseMoney(i.paid_amount))}</span>
          </label>)}
          <p className="muted" style={{ margin: 0 }}>Selected invoice balance: <strong>{mvr(selectedDue)}</strong></p>
          <label>COD amount to apply (MVR)
            <input type="number" min="0.01" step="0.01" max={Math.max(0,Math.min(requestable,selectedDue))} required value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount from collected COD" />
          </label>
          <button type="button" className="secondary-btn" onClick={()=>setAmount(Math.max(0,Math.min(requestable,selectedDue)).toFixed(2))} disabled={!selected.length||requestable<=0}>Use maximum available</button>
          <label>Note (optional)<textarea rows={2} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Please settle our oldest invoices from COD collections" /></label>
          <p className="muted" style={{ margin: 0 }}>Submitting does not automatically pay invoices. Cash not yet physically received by iGO must be verified before approval.</p>
          <button className="primary-btn" type="submit" disabled={Boolean(busy)||!selected.length||!(requestable>0)}>{busy==='COD settlement request'?'Submitting…':'Request COD invoice settlement'}</button>
        </> : <p className="muted">There are no outstanding invoices to settle.</p>}
      </form>
    </>}
    {!loading && isAdmin && <>
      <div className="stats-grid">
        <div className="stat-card"><span>COD collected (all partners)</span><strong>{mvr(totalCollected)}</strong></div>
        <div className="stat-card"><span>iGO-verified COD cash</span><strong>{mvr(totalVerified)}</strong></div>
        <div className="stat-card"><span>Applied to invoices</span><strong>{mvr(used)}</strong><small>Cash cannot be applied twice</small></div>
        <div className="stat-card"><span>Awaiting review</span><strong>{requests.filter(r=>r.status==='pending').length}</strong><small>{mvr(allPendingAmount)} reserved</small></div>
        <div className="stat-card"><span>Awaiting cash verification</span><strong>{mvr(Math.max(0,totalCollected-totalVerified))}</strong></div>
        <div className="stat-card"><span>Available COD balance</span><strong>{mvr(verifiedAvailable)}</strong><small>Sum of each partner's uncommitted verified cash</small></div>
      </div>
      <div>
        <h3>COD balances by partner</h3>
        {partnerBalances.length ? partnerBalances.map(row => <article key={row.id} style={{ borderBottom: '1px solid #dce3e9', padding: '12px 0', display: 'grid', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><strong>{row.name}</strong><strong style={{ color: '#155d43' }}>{mvr(row.available)} available</strong></div>
          <small>Collected: {mvr(row.collected)} · Verified: {mvr(row.verified)}</small>
          <small>Applied: {mvr(row.used)} · Pending: {mvr(row.pending)} · Awaiting verification: {mvr(Math.max(0,row.collected-row.verified))}</small>
        </article>) : <p className="muted">No partner COD balances recorded yet.</p>}
      </div>
      <div>
        <h3>Confirm physical cash received by iGO</h3>
        <p className="muted">Only confirm when the driver has handed the cash to iGO. Driver collection alone is not sufficient.</p>
        {collected.filter(p=>!p.cod_received_by_igo_at).length
          ? collected.filter(p=>!p.cod_received_by_igo_at).map(p=><article key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #dce3e9', padding: '10px 0' }}>
              <span><strong>IGO-{p.package_number}</strong> · {p.partners?.name || 'Partner'} · {p.drivers?.name || 'Driver'}<small style={{ display: 'block' }}>Collected from customer: {mvr(p.cod_collected_amount)}</small></span>
              <button type="button" className="secondary-btn" disabled={Boolean(busy)} onClick={()=>verifyCash(p)}>Confirm iGO received {mvr(p.cod_collected_amount)}</button>
            </article>)
          : <p className="muted">No collected COD cash awaiting iGO receipt verification.</p>}
      </div>
    </>}
    <div id="cod-settlement-requests" style={{ scrollMarginTop: 92 }}>
    {!loading && <div>
      <h3>{isAdmin?'Partner settlement requests':'Your COD settlement requests'}</h3>
      {requests.length ? requests.map(r => <article key={r.id} style={{ borderBottom: '1px solid #dce3e9', padding: '12px 0', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, flexWrap: 'wrap' }}>
          <div><strong>{mvr(r.requested_amount)}</strong> · {r.status.toUpperCase()}
            {isAdmin && <span> · {r.partners?.name || 'Partner'}</span>}
            <small className="muted" style={{ display: 'block' }}>Requested {new Date(r.requested_at).toLocaleString()}</small>
          </div>
          {isAdmin && r.status==='pending' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="primary-btn" disabled={Boolean(busy)} onClick={()=>review(r,true)}>Approve settlement</button>
            <button type="button" className="secondary-btn" disabled={Boolean(busy)} onClick={()=>review(r,false)}>Reject</button>
          </div>}
        </div>
        <small>Invoices: {settlementDetails(r)}</small>
        {r.status==='approved' && <small>Approved {new Date(r.reviewed_at).toLocaleString()} · invoice balances updated</small>}
        {r.status==='rejected' && <small>Rejected: {r.rejection_reason || 'No reason available'}</small>}
      </article>) : <p className="muted">No COD invoice settlement requests yet.</p>}
    </div>}
    </div>
  </section>;
}
