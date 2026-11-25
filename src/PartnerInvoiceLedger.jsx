import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabase';
import { getCurrentPartnerIdOptional, saveInvoiceDueDate } from './igoDatabase';
import './PartnerInvoiceLedger.css';

const money = (amount) => 'MVR ' + (Number(amount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nowMaldivesDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Indian/Maldives', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateLabel = (value) => {
  if (!value) return 'Not set';
  const date = String(value).length === 10 ? new Date(value + 'T12:00:00Z') : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const numeric = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const balance = (i) => Math.max(0, numeric(i.amount) - numeric(i.paidAmount));
const isVoid = (i) => String(i.status || '').toLowerCase() === 'void';
const balanceStatus = (i) => {
  if (isVoid(i)) return 'Voided';
  if (balance(i) <= 0) return 'Paid';
  if (i.dueDate && i.dueDate < nowMaldivesDate()) return 'Overdue';
  if (numeric(i.paidAmount) > 0) return 'Partially paid';
  return 'Unpaid';
};
const paymentDate = (p) => p.verifiedAt || p.transferDate || p.submittedAt;
const dateShort = (v) => dateLabel(v);
const registeredPayments = (payments, invoice) => (payments || []).filter((p) => {
  if (p.status !== 'confirmed') return false;
  return (p.allocations || []).some(a => a.invoiceId === invoice.id || a.invoiceId === invoice.dbId)
    || (p.invoiceIds || []).some(id => id === invoice.dbId || id === invoice.id)
    || String(p.invoiceId || '').split(',').some(s => s.trim() === invoice.id);
});
const amountApplied = (p, invoice) => {
  const items = (p.allocations || []).filter(a => a.invoiceId === invoice.id || a.invoiceId === invoice.dbId);
  return items.length ? items.reduce((s, a) => s + numeric(a.amount), 0) : null;
};

function PrintableContent({ kind, partnerName, invoices, payments, codInvoiceAllocations = [], credit, accountName, accountNumber }) {
  const unpaid = invoices.filter(i => !isVoid(i) && balance(i) > 0);
  const shown = kind === 'invoice' ? invoices : unpaid;
  const sum = (field) => shown.reduce((total, item) => total + numeric(field(item)), 0);
  const totalInvoice = sum(i => i.amount);
  const totalPaid = sum(i => i.paidAmount);
  const totalDue = sum(i => balance(i));
  const single = kind === 'invoice' ? shown[0] : null;
  const codForPrint = codInvoiceAllocations.filter(a => invoices.some(i => i.dbId === a.invoiceDbId));
  return (
    <article className="igo-ledger-print-sheet">
      <header className="igo-ledger-paper-header">
        <div className="igo-ledger-paper-brand">
          <img src="/igo-logo.jpg" alt="iGO - You order. I go." />
        </div>
        <div className="igo-ledger-paper-company">
          <strong>{kind === 'invoice' ? 'INVOICE' : 'STATEMENT'}</strong>
          <small><b>iGO MV</b> Nikagas Magu<br />Malé · Maldives</small>
          <small><b>iGO MV</b><br />7654999<br />admin@igomv.com<br />www.igomv.com</small>
        </div>
      </header>
      <section className="igo-ledger-paper-meta">
        <div className="igo-ledger-paper-bill">
          <small>BILL TO</small>
          <strong>{partnerName || 'iGO partner'}</strong>
        </div>
        <div className="igo-ledger-paper-invoice-meta">
          <div><span>{kind === 'invoice' ? 'Invoice No.:' : 'Statement:'}</span><strong>{single?.id || 'Outstanding balances'}</strong></div>
          <div><span>{kind === 'invoice' ? 'Issue date:' : 'Statement date:'}</span><strong>{dateLabel(single?.createdAt || nowMaldivesDate())}</strong></div>
          <div><span>Due date:</span><strong>{kind === 'invoice' ? dateLabel(single?.dueDate) : 'See each invoice'}</strong></div>
          <div className="igo-ledger-method"><span>Payment:</span><strong>Transfer / approved COD offset</strong></div>
        </div>
      </section>
      {kind === 'invoice' && single ? (
        <>
          <table className="igo-ledger-paper-billing">
            <thead><tr><th>DESCRIPTION</th><th>QUANTITY</th><th>UNIT PRICE (MVR)</th><th>DISCOUNT %</th><th>AMOUNT (MVR)</th></tr></thead>
            <tbody>
              {(single.lines || []).map((l, k) => (
                <tr key={l.id || l.packageId || k}>
                  <td>
                    <strong>{l.kind === 'charge' ? 'Additional service charge' : 'Delivery service'}</strong>
                    <small>{[l.packageId, l.customer, l.area, l.description].filter(Boolean).join(' · ')}</small>
                  </td>
                  <td>1 {l.kind === 'charge' ? 'job' : 'pkg'}</td>
                  <td>{money(l.amount).replace('MVR ', '')}</td>
                  <td>0.00</td>
                  <td>{money(l.amount).replace('MVR ', '')}</td>
                </tr>
              ))}
              {!single.lines?.length && <tr><td colSpan="5">No itemized deliveries recorded.</td></tr>}
            </tbody>
          </table>
          <div className="igo-ledger-paper-total">
            <div><span>TOTAL (MVR):</span><strong>{money(totalInvoice).replace('MVR ', '')}</strong></div>
            <div className="igo-ledger-paper-bold-total"><span>INVOICE TOTAL (MVR)</span><strong>{money(totalInvoice).replace('MVR ', '')}</strong></div>
            {totalPaid > 0 && <div><span>CONFIRMED PAID (MVR)</span><strong>{money(totalPaid).replace('MVR ', '')}</strong></div>}
            <div><span>BALANCE DUE (MVR)</span><strong>{money(totalDue).replace('MVR ', '')}</strong></div>
          </div>
        </>
      ) : (
        <>
          <table className="igo-ledger-paper-billing igo-ledger-statement-table">
            <thead><tr><th>INVOICE</th><th>ISSUE DATE</th><th>TOTAL (MVR)</th><th>PAID (MVR)</th><th>UNPAID (MVR)</th></tr></thead>
            <tbody>
              {unpaid.map(i => (
                <tr key={i.id}>
                  <td><strong>{i.id}</strong><small>Due: {dateLabel(i.dueDate)} · {balanceStatus(i)}</small></td>
                  <td>{dateLabel(i.createdAt)}</td>
                  <td>{money(i.amount).replace('MVR ', '')}</td>
                  <td>{money(i.paidAmount).replace('MVR ', '')}</td>
                  <td><strong>{money(balance(i)).replace('MVR ', '')}</strong></td>
                </tr>
              ))}
              {!unpaid.length && <tr><td colSpan="5">No outstanding invoices recorded.</td></tr>}
            </tbody>
          </table>
          <div className="igo-ledger-paper-total">
            <div><span>INVOICED (MVR)</span><strong>{money(totalInvoice).replace('MVR ', '')}</strong></div>
            <div><span>ALREADY PAID (MVR)</span><strong>{money(totalPaid).replace('MVR ', '')}</strong></div>
            <div className="igo-ledger-paper-bold-total"><span>TOTAL OUTSTANDING (MVR)</span><strong>{money(totalDue).replace('MVR ', '')}</strong></div>
            {credit > 0 && <div><span>UNAPPLIED CREDIT (MVR)</span><strong>{money(credit).replace('MVR ', '')}</strong></div>}
          </div>
          {unpaid.map(i => (
            <section className="igo-ledger-paper-breakdown" key={i.id}>
              <h3>{i.id} · {balanceStatus(i)} · Due {dateLabel(i.dueDate)}</h3>
              <table><thead><tr><th>PACKAGE / CHARGE</th><th>RECIPIENT</th><th>DETAILS</th><th className="igo-numeric">MVR</th></tr></thead>
                <tbody>{(i.lines || []).map((l, k) => <tr key={l.id || l.packageId || k}>
                  <td>{l.kind === 'charge' ? 'Extra charge' : (l.packageId || 'Delivery')}</td><td>{l.customer || '—'}</td><td>{l.description || l.area || '—'}</td><td className="igo-numeric">{money(l.amount).replace('MVR ', '')}</td>
                </tr>)}
                {!i.lines?.length && <tr><td colSpan="4">No line details recorded.</td></tr>}
                </tbody>
              </table>
            </section>
          ))}
          <h3 className="igo-ledger-payment-heading">CONFIRMED PAYMENTS AND COD OFFSETS</h3>
          <table className="igo-ledger-payment-history">
            <thead><tr><th>VERIFIED</th><th>REFERENCE / METHOD</th><th className="igo-numeric">AMOUNT (MVR)</th></tr></thead>
            <tbody>
              {payments.filter(p => p.status === 'confirmed').map(p => (
                <tr key={p.id}><td>{dateLabel(paymentDate(p))}</td><td>{p.reference || 'Bank transfer'}</td><td className="igo-numeric">{money(p.verifiedAmount || p.amount).replace('MVR ', '')}</td></tr>
              ))}
              {codForPrint.map(a => <tr key={a.settlementId + a.invoiceDbId}><td>{dateLabel(a.reviewedAt)}</td><td>Approved COD offset · {a.settlementId.slice(0,8)}</td><td className="igo-numeric">{money(a.amount).replace('MVR ', '')}</td></tr>)}
              {!payments.some(p => p.status === 'confirmed') && !codForPrint.length && <tr><td colSpan="3">No confirmed payments or COD offsets recorded.</td></tr>}
            </tbody>
          </table>
        </>
      )}
      <section className="igo-ledger-paper-bank">
        <h3>BANK TRANSFER DETAILS</h3>
        {accountName && accountNumber
          ? <><p>Account name:　<strong>{accountName}</strong></p><p>Account no.:　<strong>{accountNumber}</strong></p></>
          : <p>Contact iGO Delivery for bank transfer details.</p>}
      </section>
      <p className="igo-ledger-paper-note">Payments are credited only after confirmation. Any amount awaiting verification remains outstanding.</p>
      <footer className="igo-ledger-paper-footer">Thank you for choosing iGO MV. You order. I go.</footer>
    </article>
  );
}

function PrintModal({ doc, close }) {
  if (!doc || typeof document === 'undefined') return null;
  return createPortal(
    <div id="igo-statement-print-root" className="igo-statement-print-backdrop" role="dialog" aria-modal="true" aria-label="Invoice or statement preview">
      <div className="igo-ledger-print-actions">
        <strong>{doc.kind === 'invoice' ? 'Invoice preview' : 'Outstanding statement preview'}</strong>
        <div>
          <button type="button" onClick={() => window.print()}>Print / Save as PDF</button>
          <button type="button" onClick={close}>Close</button>
        </div>
      </div>
      <PrintableContent {...doc} />
    </div>,
    document.body
  );
}

function InvoiceDetail({ invoice, payments, codInvoiceAllocations = [], isAdmin, canManageDueDates, liveMode, onDueDateChanged, openPrint }) {
  const [date, setDate] = useState(invoice.dueDate || '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const associated = registeredPayments(payments, invoice);
  const codForInvoice = codInvoiceAllocations.filter(a => a.invoiceDbId === invoice.dbId);
  useEffect(() => setDate(invoice.dueDate || ''), [invoice.dueDate, invoice.id]);
  async function saveDate() {
    if (!invoice.dbId || !liveMode) return;
    setSaving(true); setNotice('');
    try {
      await saveInvoiceDueDate(invoice.dbId, date || null);
      setNotice('Due date updated.');
      await onDueDateChanged?.();
    } catch (e) { setNotice(e.message || 'Could not update due date.'); }
    finally { setSaving(false); }
  }
  return (
    <details className="igo-ledger-invoice-row">
      <summary>
        <span className="igo-ledger-invoice-main"><strong>{invoice.id}</strong><small>{dateLabel(invoice.createdAt)} · {invoice.lines?.length || 0} item(s)</small></span>
        <span className={'igo-ledger-status igo-ledger-status-' + balanceStatus(invoice).toLowerCase().replaceAll(' ', '-')}>{balanceStatus(invoice)}</span>
        <strong className="igo-ledger-invoice-value">{money(balance(invoice))}<small>outstanding</small></strong>
        <span aria-hidden="true" className="igo-ledger-chevron">⌄</span>
      </summary>
      <div className="igo-ledger-expanded">
        <div className="igo-ledger-detail-metrics">
          <span>Invoice total <strong>{money(invoice.amount)}</strong></span>
          <span>Confirmed paid <strong>{money(invoice.paidAmount)}</strong></span>
          <span>Due date <strong>{dateLabel(invoice.dueDate)}</strong></span>
        </div>
        <h4>Deliveries and extra charges</h4>
        <div className="igo-ledger-scroll"><table><thead><tr><th>Delivery</th><th>Recipient</th><th>Destination / details</th><th>Fee</th></tr></thead>
          <tbody>{(invoice.lines || []).map((line, k) => <tr key={line.id || line.packageId || k}><td>{line.kind === 'charge' ? 'Extra charge' : (line.packageId || '—')}</td><td>{line.customer || '—'}</td><td>{line.description || line.area || '—'}</td><td>{money(line.amount)}</td></tr>)}
          {!invoice.lines?.length && <tr><td colSpan="4">No item details recorded.</td></tr>}</tbody>
        </table></div>
        <h4>Confirmed payments and COD offsets</h4>
        <div className="igo-ledger-scroll"><table><thead><tr><th>Date</th><th>Reference</th><th>Allocated amount</th></tr></thead><tbody>
          {associated.map(p => <tr key={p.id}><td>{dateLabel(paymentDate(p))}</td><td>{p.reference || 'Bank transfer'}</td><td>{amountApplied(p, invoice) == null ? 'Allocation not listed' : money(amountApplied(p, invoice))}</td></tr>)}
          {codForInvoice.map(a => <tr key={a.settlementId + a.invoiceDbId}><td>{dateLabel(a.reviewedAt)}</td><td>Approved COD offset · {a.settlementId.slice(0,8)}</td><td>{money(a.amount)}</td></tr>)}
          {!associated.length && !codForInvoice.length && <tr><td colSpan="3">No confirmed payment or COD offset linked to this invoice.</td></tr>}
        </tbody></table></div>
        {isAdmin && canManageDueDates && liveMode && <div className="igo-ledger-due-edit">
          <label>Payment due date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <button type="button" disabled={saving || date === (invoice.dueDate || '')} onClick={saveDate}>{saving ? 'Saving…' : 'Save due date'}</button>
          {notice && <small role="status">{notice}</small>}
        </div>}
        <button type="button" className="igo-ledger-outline-button" onClick={() => openPrint(invoice)}>Print / Save invoice as PDF</button>
      </div>
    </details>
  );
}

export default function PartnerInvoiceLedger({ invoices = [], payments = [], codInvoiceAllocations = [], partnerCredits = {}, accountName = '', accountNumber = '', workspace = 'Admin', liveMode = false, canManageDueDates = false, onDueDateChanged }) {
  const isAdmin = workspace === 'Admin';
  const [partners, setPartners] = useState([]);
  const [selectedPartner, setSelectedPartner] = useState('all');
  const [actualPartnerId, setActualPartnerId] = useState(null);
  const [filter, setFilter] = useState('outstanding');
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState('');
  const [printDoc, setPrintDoc] = useState(null);
  useEffect(() => {
    if (!liveMode || !supabase) return;
    let active = true;
    (async () => {
      try {
        if (isAdmin) {
          const { data, error } = await supabase.from('partners').select('id,name').order('name');
          if (error) throw error;
          if (active) setPartners(data || []);
        } else {
          const id = await getCurrentPartnerIdOptional();
          if (active) setActualPartnerId(id);
        }
      } catch (e) { if (active) setLoadError(e.message || 'Could not load partners.'); }
    })();
    return () => { active = false; };
  }, [isAdmin, liveMode, workspace]);

  const options = useMemo(() => {
    if (liveMode) return partners.map(p => ({ id: p.id, name: p.name }));
    const seen = new Set();
    return invoices.filter(i => !isVoid(i)).map(i => ({ id: i.partnerId || i.partner, name: i.partner || 'Partner' })).filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id); return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices, liveMode, partners]);

  const filteredInvoices = useMemo(() => {
    let selected = invoices.filter(i => !isVoid(i));
    if (isAdmin && selectedPartner !== 'all') selected = selected.filter(i => String(i.partnerId || i.partner) === selectedPartner);
    if (!isAdmin && liveMode && actualPartnerId) selected = selected.filter(i => i.partnerId === actualPartnerId);
    return selected;
  }, [invoices, isAdmin, selectedPartner, liveMode, actualPartnerId]);

  const partnerId = isAdmin ? (selectedPartner === 'all' ? null : selectedPartner) : actualPartnerId || filteredInvoices[0]?.partnerId || null;
  const partnerName = isAdmin
    ? (selectedPartner === 'all' ? 'All iGO partners' : options.find(p => String(p.id) === selectedPartner)?.name || filteredInvoices[0]?.partner || 'Selected partner')
    : filteredInvoices[0]?.partner || 'Your iGO account';

  const visiblePayments = payments.filter(p => partnerId == null || p.partnerId === partnerId);
  const visibleCodAllocations = codInvoiceAllocations.filter(a => partnerId == null || a.partnerId === partnerId);
  const totals = useMemo(() => {
    const outstanding = filteredInvoices.reduce((sum, i) => sum + balance(i), 0);
    const paid = filteredInvoices.reduce((sum, i) => sum + numeric(i.paidAmount), 0);
    const invoiced = filteredInvoices.reduce((sum, i) => sum + numeric(i.amount), 0);
    const overdue = filteredInvoices.filter(i => balanceStatus(i) === 'Overdue').reduce((sum, i) => sum + balance(i), 0);
    const pending = visiblePayments.filter(p => p.status === 'pending_verification').reduce((sum, p) => sum + numeric(p.reportedAmount ?? p.amount), 0);
    return { outstanding, paid, invoiced, overdue, pending, unpaidCount: filteredInvoices.filter(i => balance(i) > 0).length };
  }, [filteredInvoices, visiblePayments]);

  const listedInvoices = filteredInvoices.filter(i => {
    const s = balanceStatus(i);
    if (filter === 'outstanding' && balance(i) <= 0) return false;
    if (filter === 'paid' && s !== 'Paid') return false;
    if (filter === 'overdue' && s !== 'Overdue') return false;
    if (filter === 'partial' && !(numeric(i.paidAmount) > 0 && balance(i) > 0)) return false;
    if (filter === 'unpaid' && !(numeric(i.paidAmount) === 0 && balance(i) > 0)) return false;
    const term = search.trim().toLowerCase();
    const lines = i.lines || [];
    return !term || [i.id, i.partner, ...lines.map(line => line.packageId || ''), ...lines.map(line => line.customer || '')].join(' ').toLowerCase().includes(term);
  });

  const credit = partnerId ? numeric(partnerCredits[partnerId]) : 0;
  const exportStatement = () => {
    if (isAdmin && selectedPartner === 'all') { setLoadError('Choose a partner to download their statement.'); return; }
    setLoadError('');
    setPrintDoc({ kind: 'statement', partnerName, invoices: filteredInvoices, payments: visiblePayments, codInvoiceAllocations: visibleCodAllocations, credit, accountName, accountNumber });
  };
  const exportInvoice = (invoice) => setPrintDoc({ kind: 'invoice', partnerName: invoice.partner || partnerName, invoices: [invoice], payments: visiblePayments, codInvoiceAllocations: visibleCodAllocations, credit: 0, accountName, accountNumber });

  return (
    <section className="igo-ledger" aria-label={isAdmin ? 'Partner invoice balances and collections' : 'Your invoice balances and statement'}>
      <header className="igo-ledger-header">
        <div><span className="igo-ledger-overline">ACCOUNTS RECEIVABLE</span><h3>{isAdmin ? 'Partner balances' : 'Your invoice breakdown'}</h3><p>Outstanding balances reflect confirmed transfers and admin-approved COD offsets.</p></div>
        <button type="button" className="igo-ledger-statement-button" onClick={exportStatement} disabled={isAdmin && selectedPartner === 'all'}>Outstanding statement (PDF)</button>
      </header>
      {isAdmin && (
        <label className="igo-ledger-partner-picker">Select partner
          <select value={selectedPartner} onChange={e => { setSelectedPartner(e.target.value); setFilter('outstanding'); setSearch(''); setLoadError(''); }}>
            <option value="all">All partners · overall totals</option>
            {options.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {!isAdmin && <p className="igo-ledger-partner-label">Partner: <strong>{partnerName}</strong></p>}
      {loadError && <p className="igo-ledger-error" role="alert">{loadError}</p>}
      <div className="igo-ledger-summary">
        <div><small>Total outstanding</small><strong>{money(totals.outstanding)}</strong><span>{totals.unpaidCount} unpaid invoice(s)</span></div>
        <div><small>Total invoiced</small><strong>{money(totals.invoiced)}</strong><span>Excludes void invoices</span></div>
        <div><small>Amount settled</small><strong>{money(totals.paid)}</strong><span>Applied to invoices</span></div>
        <div><small>Overdue</small><strong>{money(totals.overdue)}</strong><span>Past recorded due date</span></div>
        <div><small>Transfers awaiting verification</small><strong>{money(totals.pending)}</strong><span>Not yet deducted</span></div>
        {partnerId && <div><small>Available partner credit</small><strong>{money(credit)}</strong><span>Separate from unpaid balance</span></div>}
      </div>
      <div className="igo-ledger-tools">
        <div className="igo-ledger-filters" role="group" aria-label="Filter invoices">
          {[['outstanding', 'Outstanding'], ['unpaid','Unpaid'], ['partial','Partially paid'], ['overdue','Overdue'], ['paid','Paid'], ['all','All']].map(([key,label]) => (
            <button type="button" key={key} className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
        <input type="search" aria-label="Search invoices, packages and recipients" placeholder="Search invoice / package" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="igo-ledger-invoices">
        {listedInvoices.map(invoice => <InvoiceDetail key={invoice.id} invoice={invoice} payments={visiblePayments} codInvoiceAllocations={visibleCodAllocations} isAdmin={isAdmin} canManageDueDates={canManageDueDates} liveMode={liveMode} onDueDateChanged={onDueDateChanged} openPrint={exportInvoice} />)}
        {!listedInvoices.length && <p className="igo-ledger-empty">No invoices match this selection.</p>}
      </div>
      <p className="igo-ledger-footnote">Payment transfers and COD offsets remain outstanding until confirmed by iGO. PDF statements open a print preview; choose “Save as PDF” in your device’s print options.</p>
      {printDoc && <PrintModal doc={printDoc} close={() => setPrintDoc(null)} />}
    </section>
  );
}
