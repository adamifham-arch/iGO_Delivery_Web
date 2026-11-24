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
  const [payouts, setPayouts] = useState([]);
  const [actorId, setActorId] = useState('');
  const [payoutForm, setPayoutForm] = useState({ amount: '', bank: '', name: '', account: '', note: '' });
  const [cashAllocations, setCashAllocations] = useState([]);
  const [invoiceAllocations, setInvoiceAllocations] = useState([]);
  const [selected, setSelected] = useState([]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [handoverSelected, setHandoverSelected] = useState([]);
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
      setPayouts([]);
      setCashAllocations([]);
      setInvoiceAllocations([]);
      setError('No approved partner is linked to this workspace.');
      return;
    }
    setPartnerId(id || '');
    let p = supabase.from('packages').select('id,package_number,partner_id,customer_name,status,cod_amount,cod_collected_amount,cod_collected_at,cod_collected_by,cod_received_by_igo_at,cod_received_by_igo_by,partners(name),drivers(name,user_id)').not('cod_amount', 'is', null).order('created_at', { ascending: false });
    let i = supabase.from('invoices').select('id,partner_id,invoice_number,subtotal,paid_amount,status,created_at').order('created_at', { ascending: false });
    let r = supabase.from('cod_invoice_settlement_requests').select('*,partners(name)').order('requested_at', { ascending: false });
    let c = supabase.from('cod_invoice_settlement_cash_allocations').select('settlement_id,package_id,amount,packages(partner_id)');
    let a = supabase.from('cod_invoice_settlement_invoice_allocations').select('settlement_id,invoice_id,amount,invoices(invoice_number)');
    let w = supabase.from('cod_payout_requests').select('*,partners(name)').order('requested_at', { ascending: false });
    if (id) {
      p = p.eq('partner_id',id);
      i = i.eq('partner_id',id);
      r = r.eq('partner_id',id);
      w = w.eq('partner_id',id);
    }
    const out = await Promise.all([p,i,r,c,a,w]);
    const { data: authData } = await supabase.auth.getUser();
    setActorId(authData?.user?.id || '');
    const failure = out.find(x => x.error);
    if (failure) throw failure.error;
    setPackages(out[0].data || []);
    setInvoices(out[1].data || []);
    setRequests(out[2].data || []);
    setCashAllocations(out[3].data || []);
    setInvoiceAllocations(out[4].data || []);
    setPayouts(out[5].data || []);
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
  const cashGroups = [...collected.reduce((map,p)=>{
    const key=p.cod_collected_by || 'unknown';
    const group=map.get(key)||{id:key,label:p.drivers?.user_id===p.cod_collected_by && p.drivers?.name?p.drivers.name:'Other / admin collector',rows:[]};
    group.rows.push(p);map.set(key,group);return map;
  },new Map()).values()];
  const selectedCash=collected.filter(p=>!p.cod_received_by_igo_at && handoverSelected.includes(p.id));
  const selectedCashTotal=selectedCash.reduce((n,p)=>n+parseMoney(p.cod_collected_amount),0);
  const selectedCollector=selectedCash[0]?.cod_collected_by;
  const formatTime=(value)=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Indian/Maldives'}):'—';
  const used = collected.reduce((n,p)=>n+parseMoney(usedByPackage.get(p.id)),0);
  const ownRequests = isAdmin ? [] : requests.filter(r => r.partner_id === partnerId);
  const pendingAmount = ownRequests.filter(r=>r.status==='pending').reduce((n,r)=>n+parseMoney(r.requested_amount),0);
  const ownPayouts = payouts.filter(r => isAdmin || r.partner_id === partnerId);
  const payoutPending = ownPayouts.filter(r => ['pending','processing'].includes(r.status)).reduce((n,r) => n+parseMoney(r.amount),0);
  const payoutPaid = ownPayouts.filter(r => r.status==='paid').reduce((n,r) => n+parseMoney(r.amount),0);
  const payoutReserved = payoutPending + payoutPaid;
  const requestable = Math.max(0, Math.round((totalCollected-used-pendingAmount-payoutReserved)*100)/100);
  const partnerBalances = useMemo(() => {
    const map = new Map();
    const ensure = (id, name) => {
      if (!map.has(id)) map.set(id, { id, name: name || 'Partner', collected: 0, verified: 0, used: 0, pending: 0, payoutPending: 0, payoutPaid: 0 });
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
    payouts.filter(r => ['pending','processing','paid'].includes(r.status)).forEach(r => {
      const row = ensure(r.partner_id, r.partners?.name);
      if (r.status === 'paid') row.payoutPaid += parseMoney(r.amount);
      else row.payoutPending += parseMoney(r.amount);
    });
    return [...map.values()].map(row => ({
      ...row,
      available: Math.max(0, Math.round((row.verified - row.used - row.pending - row.payoutPending - row.payoutPaid) * 100) / 100),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [collected, requests, usedByPackage, payouts]);
  const verifiedAvailable = isAdmin
    ? partnerBalances.reduce((n, row) => n + row.available, 0)
    : Math.max(0, Math.round((totalVerified - used - pendingAmount - payoutReserved) * 100) / 100);
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

  const updatePayout = (key, value) => setPayoutForm(old => ({ ...old, [key]: value }));
  const submitPayout = async event => {
    event.preventDefault();
    const value = Number(payoutForm.amount);
    if (!/^\d+(?:\.\d{1,2})?$/.test(payoutForm.amount.trim()) || !Number.isFinite(value) || value <= 0 || value > verifiedAvailable + 0.0001) {
      setError('Enter an amount within your available verified COD balance.'); return;
    }
    const result = await perform('COD bank payout request', () => supabase.rpc('request_cod_payout', {
      p_amount: value, p_bank_name: payoutForm.bank, p_account_name: payoutForm.name, p_account_number: payoutForm.account, p_note: payoutForm.note
    }), 'Request a bank transfer of ' + mvr(value) + '? Confirm your bank account details. The amount will be reserved.');
    if (result) setPayoutForm({ amount: '', bank: '', name: '', account: '', note: '' });
  };
  const reviewPayout = (r, action) => {
    if (action === 'claim') {
      void perform('COD payout processing', () => supabase.rpc('review_cod_payout', { p_request_id: r.id, p_action: action }), 'Claim this payout before making the transfer. Other admins cannot process it.');
      return;
    }
    const detail = window.prompt(action === 'paid' ? 'Enter the completed bank transfer reference:' : 'Enter a rejection reason:');
    if (detail == null) return;
    if (detail.trim().length < 3) { setError('Enter at least three characters.'); return; }
    void perform(action === 'paid' ? 'COD payout transfer confirmation' : 'COD payout rejection',
      () => supabase.rpc('review_cod_payout', { p_request_id: r.id, p_action: action, p_detail: detail.trim() }),
      action === 'paid' ? 'Confirm only if the actual bank transfer of ' + mvr(r.amount) + ' has been completed to the requested account.' : 'Confirm no money was transferred. Rejecting will release the reserved balance.');
  };

  const verifyHandover = async () => {
    if(!selectedCash.length || selectedCash.length>100 || !selectedCollector || selectedCash.some(p=>p.cod_collected_by!==selectedCollector)) return;
    const result=await perform('COD cash handover',()=>supabase.rpc('verify_cod_cash_handover',{p_package_ids:selectedCash.map(p=>p.id),p_expected_amount:Number(selectedCashTotal.toFixed(2))}),
      'Confirm physical receipt of '+mvr(selectedCashTotal)+' for '+selectedCash.length+' packages from this collector? Verify the cash before proceeding.');
    if(result!=null) setHandoverSelected([]);
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
        <small>Verified cash remaining after invoice offsets, completed transfers and pending requests</small>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><span>COD collected by drivers</span><strong>{mvr(totalCollected)}</strong></div>
        <div className="stat-card"><span>COD received by iGO</span><strong>{mvr(totalVerified)}</strong></div>
        <div className="stat-card"><span>Awaiting cash verification</span><strong>{mvr(Math.max(0,totalCollected-totalVerified))}</strong></div>
        <div className="stat-card"><span>Applied to invoices</span><strong>{mvr(used)}</strong></div>
        <div className="stat-card"><span>Pending settlement requests</span><strong>{mvr(pendingAmount)}</strong><small>Reserved until reviewed</small></div>
        <div className="stat-card"><span>Pending bank payouts</span><strong>{mvr(payoutPending)}</strong></div>
        <div className="stat-card"><span>Transferred to bank</span><strong>{mvr(payoutPaid)}</strong></div>
        <div className="stat-card"><span>COD eligible to request</span><strong>{mvr(requestable)}</strong><small>Includes collected cash not yet verified; approval requires verified cash</small></div>
      </div>
      <form onSubmit={submitPayout} style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Request transfer to bank account</h3>
        <p className="muted" style={{ margin: 0 }}>Request any amount up to your available verified COD balance. iGO will transfer it manually after review.</p>
        <label>Transfer amount (MVR)<input type="number" min="0.01" max={verifiedAvailable} step="0.01" required value={payoutForm.amount} onChange={e=>updatePayout('amount',e.target.value)} /></label>
        <button type="button" className="secondary-btn" disabled={verifiedAvailable<=0} onClick={()=>updatePayout('amount',verifiedAvailable.toFixed(2))}>Use full available balance</button>
        <label>Bank name<input required minLength={2} maxLength={100} value={payoutForm.bank} onChange={e=>updatePayout('bank',e.target.value)} /></label>
        <label>Account holder name<input required minLength={2} maxLength={150} value={payoutForm.name} onChange={e=>updatePayout('name',e.target.value)} /></label>
        <label>Account number<input required minLength={4} maxLength={80} value={payoutForm.account} onChange={e=>updatePayout('account',e.target.value)} /></label>
        <label>Note (optional)<textarea rows={2} maxLength={500} value={payoutForm.note} onChange={e=>updatePayout('note',e.target.value)} /></label>
        <button className="primary-btn" type="submit" disabled={Boolean(busy)||verifiedAvailable<=0}>{busy==='COD bank payout request'?'Submitting…':'Request bank transfer'}</button>
      </form>
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
        <div className="stat-card"><span>Pending bank payouts</span><strong>{mvr(payoutPending)}</strong></div>
        <div className="stat-card"><span>Transferred to bank</span><strong>{mvr(payoutPaid)}</strong></div>
        <div className="stat-card"><span>Available COD balance</span><strong>{mvr(verifiedAvailable)}</strong><small>Sum of each partner's uncommitted verified cash</small></div>
        <div className="stat-card"><span>Verified cash not yet settled or paid out</span><strong>{mvr(totalVerified-used-payoutPaid)}</strong><small>Includes cash reserved for pending requests; not delivery revenue</small></div>
      </div>
      <div>
        <h3>COD balances by partner</h3>
        {partnerBalances.length ? partnerBalances.map(row => <article key={row.id} style={{ borderBottom: '1px solid #dce3e9', padding: '12px 0', display: 'grid', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><strong>{row.name}</strong><strong style={{ color: '#155d43' }}>{mvr(row.available)} available</strong></div>
          <small>Collected: {mvr(row.collected)} · Verified: {mvr(row.verified)}</small>
          <small>Applied: {mvr(row.used)} · Pending invoices: {mvr(row.pending)} · Awaiting verification: {mvr(Math.max(0,row.collected-row.verified))}</small>
          <small>Bank payouts pending: {mvr(row.payoutPending)} · Transferred: {mvr(row.payoutPaid)}</small>
        </article>) : <p className="muted">No partner COD balances recorded yet.</p>}
      </div>
      <div id="cod-cash-handover" style={{scrollMarginTop:92}}>
        <h3>Rider cash handovers</h3>
        <p className="muted">Select collected packages from one cash collector. Confirm only after physically receiving the full selected amount. Previous receipts cannot be counted twice.</p>
        {cashGroups.length?cashGroups.map(group=>{
          const pending=group.rows.filter(p=>!p.cod_received_by_igo_at);
          const received=group.rows.filter(p=>p.cod_received_by_igo_at);
          const pendingTotal=pending.reduce((n,p)=>n+parseMoney(p.cod_collected_amount),0);
          const receivedTotal=received.reduce((n,p)=>n+parseMoney(p.cod_collected_amount),0);
          return <article key={group.id} style={{border:'1px solid var(--border,#d8dee8)',borderRadius:10,padding:12,margin:'10px 0',display:'grid',gap:8}}>
            <strong>{group.label}</strong>
            <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><span>Awaiting handover</span><strong style={{color:pendingTotal>0?'#b45309':'inherit'}}>{mvr(pendingTotal)}</strong></div>
            <small>Already received: {mvr(receivedTotal)} · {received.length} packages</small>
            {pending.length>0 && <details open={pending.some(p=>handoverSelected.includes(p.id))}>
              <summary>{pending.length} packages awaiting receipt</summary>
              {group.id!=='unknown' && <button type="button" className="secondary-btn" disabled={Boolean(busy)} onClick={()=>setHandoverSelected(pending.slice(0,100).map(p=>p.id))}>Select first {Math.min(100,pending.length)} packages</button>}
              {pending.map(p=><div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:'1px solid #dce3e9'}}>
                {group.id!=='unknown'?<input type="checkbox" aria-label={'Select package IGO-'+p.package_number} style={{width:18,height:18,minHeight:0,flex:'0 0 auto'}} checked={handoverSelected.includes(p.id)} disabled={Boolean(busy)} onChange={e=>setHandoverSelected(old=>e.target.checked?[...old.filter(id=>pending.some(x=>x.id===id)),p.id]:old.filter(id=>id!==p.id))}/>:<button type="button" className="secondary-btn" disabled={Boolean(busy)} onClick={()=>verifyCash(p)}>Verify receipt</button>}
                <div style={{flex:1,minWidth:0}}><strong>IGO-{p.package_number}</strong> · {p.partners?.name||'Partner'}<small style={{display:'block'}}>{formatTime(p.cod_collected_at)}</small></div><strong>{mvr(p.cod_collected_amount)}</strong>
              </div>)}
            </details>}
            {received.length>0 && <details><summary>Receipt history ({received.length})</summary>{received.map(p=><div key={p.id} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'8px 0'}}><span>IGO-{p.package_number}<small style={{display:'block'}}>Received {formatTime(p.cod_received_by_igo_at)}</small></span><strong>{mvr(p.cod_collected_amount)}</strong></div>)}</details>}
          </article>
        }):<p className="muted">No collected COD cash recorded yet.</p>}
        {selectedCash.length>0&&<div style={{display:'grid',gap:8,padding:12,border:'1px solid var(--border,#d8dee8)',borderRadius:8}}><strong>{selectedCash.length} selected · {mvr(selectedCashTotal)}</strong><button type="button" className="primary-btn" disabled={Boolean(busy)||selectedCash.length>100} onClick={verifyHandover}>Confirm physical cash handover</button><button type="button" className="secondary-btn" disabled={Boolean(busy)} onClick={()=>setHandoverSelected([])}>Clear selection</button></div>}
      </div>
    </>}
    {!loading && <div id="cod-payout-requests" style={{ scrollMarginTop: 92 }}>
      <h3>{isAdmin ? 'Partner bank payout requests' : 'Your bank payout requests'}</h3>
      {ownPayouts.length ? ownPayouts.map(r => <article key={r.id} style={{ borderBottom: '1px solid #dce3e9', padding: '12px 0', display: 'grid', gap: 6 }}>
        <strong>{mvr(r.amount)} · {r.status === 'paid' ? 'TRANSFERRED' : r.status.toUpperCase()}{isAdmin ? ' · ' + (r.partners?.name || 'Partner') : ''}</strong>
        <small>Requested {new Date(r.requested_at).toLocaleString()}</small>
        <small>{r.bank_name} · {r.account_name} · {isAdmin && ['pending','processing'].includes(r.status) ? r.account_number : '•••• ' + r.account_number.slice(-4)}</small>
        {r.note && <small>Note: {r.note}</small>}
        {r.status === 'paid' && <small>Transfer reference: {r.transfer_reference} · {new Date(r.reviewed_at).toLocaleString()}</small>}
        {r.status === 'rejected' && <small>Rejected: {r.rejection_reason}</small>}
        {isAdmin && r.status==='pending' && <div style={{display:'flex', gap:8, flexWrap:'wrap'}}><button className="primary-btn" disabled={Boolean(busy)} onClick={()=>reviewPayout(r,'claim')}>Start processing</button><button className="secondary-btn" disabled={Boolean(busy)} onClick={()=>reviewPayout(r,'reject')}>Reject</button></div>}
        {isAdmin && r.status==='processing' && (r.processing_by===actorId ? <div style={{display:'flex', gap:8, flexWrap:'wrap'}}><button className="primary-btn" disabled={Boolean(busy)} onClick={()=>reviewPayout(r,'paid')}>Confirm bank transfer</button><button className="secondary-btn" disabled={Boolean(busy)} onClick={()=>reviewPayout(r,'reject')}>Reject (no transfer made)</button></div> : <small>Being processed by another admin.</small>)}
      </article>) : <p className="muted">No bank payout requests yet.</p>}
    </div>}
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
