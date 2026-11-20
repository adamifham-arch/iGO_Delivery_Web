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

function PrintableContent({ kind, partnerName, invoices, payments, credit }) {
  const unpaid = invoices.filter(i => !isVoid(i) && balance(i) > 0);
  const shown = kind === 'invoice' ? invoices : unpaid;
  const totalInvoiced = shown.reduce((a, x) => a + numeric(x.amount), 0);
  const totalPaid = shown.reduce((a, x) => a + numeric(x.paidAmount), 0);
  const totalBalance = shown.reduce((a, x) => a + balance(x), 0);
  const printDate = dateLabel(nowMaldivesDate());
  const single = kind === 'invoice' ? shown[0] : null;
  return (
    <article className="igo-ledger-print-sheet">
      <header className="igo-ledger-paper-header">
        <div className="igo-ledger-paper-brand"><strong>i<span>GO</span></strong><small>YOU ORDER. I GO.</small></div>
        <div><strong>{kind === 'invoice' ? 'DELIVERY INVOICE' : 'OUTSTANDING STATEMENT'}</strong><small>{single?.id || 'Partner account statement'}</small></div>
      </header>
      <section className="igo-ledger-paper-meta">
        <div><small>ISSUED TO</small><strong>{partnerName || 'iGO partner'}</strong></div>
        <div><small>{kind === 'invoice' ? 'INVOICE DATE' : 'STATEMENT DATE'}</small><strong>{dateLabel(single?.createdAt || nowMaldivesDate())}</strong></div>
        <div><small>PAYMENT DUE</small><strong>{kind === 'invoice' ? dateLabel(single?.dueDate) : 'As per individual invoices'}</strong></div>
      </section>
      <h3>{kind === 'invoice' ? 'Delivery details' : 'Unpaid invoice breakdown'}</h3>
      {shown.length === 0 && <p>No unpaid invoices are recorded for this partner.</p>}
      {shown.map(i => (
        <section className="igo-ledger-paper-invoice" key={i.id}>
          <div className="igo-ledger-paper-invoice-head">
            <strong>{i.id}</strong>
            <span>{dateLabel(i.createdAt)} · {balanceStatus(i)} · Due: {dateLabel(i.dueDate)}</span>
          </div>
          <table>
            <thead><tr><th>Delivery / item</th><th>Recipient</th><th>Description</th><th className="igo-numeric">Amount (MVR)</th></tr></thead>
            <tbody>
              {(i.lines || []).map((l, k) => (
                <tr key={l.id || l.packageId || k}>
                  <td>{l.kind === 'charge' ? 'Extra charge' : (l.packageId || 'Delivery')}</td>
                  <td>{l.customer || '—'}</td>
                  <td>{l.description || l.area || 'Delivery service'}</td>
                  <td className="igo-numeric">{money(l.amount).replace('MVR ', '')}</td>
                </tr>
              ))}
              {(!i.lines || i.lines.length === 0) && <tr><td colSpan="4">Invoice line items are not available.</td></tr>}
            </tbody>
          </table>
          <div className="igo-ledger-paper-figures">
            <span>Invoiced: <strong>{money(i.amount)}</strong></span>
            <span>Paid: <strong>{money(i.paidAmount)}</strong></span>
            <span>Outstanding: <strong>{money(balance(i))}</strong></span>
          </div>
        </section>
      ))}
      <section className="igo-ledger-paper-total">
        <div><span>Total invoiced</span><strong>{money(totalInvoiced)}</strong></div>
        <div><span>Already settled</span><strong>{money(totalPaid)}</strong></div>
        <div className="igo-ledger-total-emphasis"><span>{kind === 'invoice' ? 'Balance due' : 'Total outstanding'}</span><strong>{money(totalBalance)}</strong></div>
        {kind === 'statement' && credit > 0 && <div><span>Available partner credit (separate)</span><strong>{money(credit)}</strong></div>}
      </section>
      {kind === 'statement' && (
        <>
          <h3>Confirmed payment history</h3>
          <table>
            <thead><tr><th>Verified date</th><th>Reference</th><th className="igo-numeric">Received (MVR)</th></tr></thead>
            <tbody>
              {payments.filter(p => p.status === 'confirmed').map(p => (
                <tr key={p.id}>
                  <td>{dateLabel(paymentDate(p))}</td><td>{p.reference || '—'}</td><td className="igo-numeric">{money(p.verifiedAmount || p.amount).replace('MVR ', '')}</td>
                </tr>
              ))}
              {!payments.some(p => p.status === 'confirmed') && <tr><td colSpan="3">No confirmed payments recorded.</td></tr>}
            </tbody>
          </table>
        </>
      )}
      <footer className="igo-ledger-paper-footer">
        <strong>iGO DELIVERY</strong>
        <span>This statement reflects recorded invoices and confirmed payments only. Transfers awaiting verification do not reduce amounts due.</span>
      </footer>
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

function InvoiceDetail({ invoice, payments, isAdmin, liveMode, onDueDateChanged, openPrint }) {
  const [date, setDate] = useState(invoice.dueDate || '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const associated = registeredPayments(payments, invoice);
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
        <h4>Confirmed payment history</h4>
        <div className="igo-ledger-scroll"><table><thead><tr><th>Date</th><th>Reference</th><th>Allocated amount</th></tr></thead><tbody>
          {associated.map(p => <tr key={p.id}><td>{dateLabel(paymentDate(p))}</td><td>{p.reference || '—'}</td><td>{amountApplied(p, invoice) == null ? 'Allocation not listed' : money(amountApplied(p, invoice))}</td></tr>)}
          {!associated.length && <tr><td colSpan="3">No confirmed payment linked to this invoice.</td></tr>}
        </tbody></table></div>
        {isAdmin && liveMode && <div className="igo-ledger-due-edit">
          <label>Payment due date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <button type="button" disabled={saving || date === (invoice.dueDate || '')} onClick={saveDate}>{saving ? 'Saving…' : 'Save due date'}</button>
          {notice && <small role="status">{notice}</small>}
        </div>}
        <button type="button" className="igo-ledger-outline-button" onClick={() => openPrint(invoice)}>Print / Save invoice as PDF</button>
      </div>
    </details>
  );
}

export default function PartnerInvoiceLedger({ invoices = [], payments = [], partnerCredits = {}, workspace = 'Admin', liveMode = false, onDueDateChanged }) {
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
    return !term || [i.id, i.partner, ...i.lines.map(line => line.packageId || ''), ...i.lines.map(line => line.customer || '')].join(' ').toLowerCase().includes(term);
  });

  const credit = partnerId ? numeric(partnerCredits[partnerId]) : 0;
  const exportStatement = () => {
    if (isAdmin && selectedPartner === 'all') { setLoadError('Choose a partner to download their statement.'); return; }
    setLoadError('');
    setPrintDoc({ kind: 'statement', partnerName, invoices: filteredInvoices, payments: visiblePayments, credit });
  };
  const exportInvoice = (invoice) => setPrintDoc({ kind: 'invoice', partnerName: invoice.partner || partnerName, invoices: [invoice], payments: visiblePayments, credit: 0 });

  return (
    <section className="igo-ledger" aria-label={isAdmin ? 'Partner invoice balances and collections' : 'Your invoice balances and statement'}>
      <header className="igo-ledger-header">
        <div><span className="igo-ledger-overline">ACCOUNTS RECEIVABLE</span><h3>{isAdmin ? 'Partner balances' : 'Your invoice breakdown'}</h3><p>Unpaid balances are based on confirmed payments only.</p></div>
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
        {listedInvoices.map(invoice => <InvoiceDetail key={invoice.id} invoice={invoice} payments={visiblePayments} isAdmin={isAdmin} liveMode={liveMode} onDueDateChanged={onDueDateChanged} openPrint={exportInvoice} />)}
        {!listedInvoices.length && <p className="igo-ledger-empty">No invoices match this selection.</p>}
      </div>
      <p className="igo-ledger-footnote">Payment submissions awaiting admin verification remain outstanding until confirmed. PDF statements open a print preview; choose “Save as PDF” in your device’s print options.</p>
      {printDoc && <PrintModal doc={printDoc} close={() => setPrintDoc(null)} />}
    </section>
  );
}
