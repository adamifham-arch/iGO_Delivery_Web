import { useState } from 'react';

const currency = (value) =>
  'MVR ' + Number(value || 0).toLocaleString('en-MV', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const maldivesDate = (date) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return get('year') + '-' + get('month') + '-' + get('day');
};

const dayKey = (value) => {
  if (!value) return '';
  const text = String(value);
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text)) return text;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return maldivesDate(date);
};

const timed = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleTimeString([], { timeZone: 'Indian/Maldives', hour: 'numeric', minute: '2-digit' });
};

const packageAmount = (item) =>
  Number(item.fee ?? item.delivery_fee ?? item.deliveryFee ?? 0);

const invoicePaid = (invoice, payments) => {
  if (invoice.paidAmount != null) return Number(invoice.paidAmount || 0);
  return (payments || [])
    .filter((payment) => payment.status === 'confirmed')
    .reduce((sum, payment) => {
      const allocation = payment.allocations?.find(
        (item) => item.invoiceId === invoice.id
      );
      return sum + Number(
        allocation?.amount ||
        (payment.invoiceId === invoice.id ? payment.amount : 0)
      );
    }, 0);
};

const createReport = ({ date, openingBalance, actualClosing, packages, invoices, payments, expenses, withdrawals }) => {
  const packageRows = packages || [];
  const delivered = packageRows.filter((item) => dayKey(item.deliveredAt) === date);
  const registered = packageRows.filter((item) => dayKey(item.createdAt || item.addedAt) === date);
  const pickedUp = packageRows.filter((item) => dayKey(item.pickedUpAt) === date);
  const failed = packageRows.filter((item) => dayKey(item.failedAttemptAt || item.failedAt) === date);
  const openRegistered = registered.filter((item) => !['delivered', 'failed', 'returned', 'cancelled'].includes(String(item.status || '').toLowerCase()));
  const deliveryEvents = [
    ...registered.map((item) => ({ item, time: item.createdAt || item.addedAt, type: 'Registered' })),
    ...pickedUp.map((item) => ({ item, time: item.pickedUpAt, type: 'Picked up' })),
    ...delivered.map((item) => ({ item, time: item.deliveredAt, type: 'Delivered' })),
    ...failed.map((item) => ({ item, time: item.failedAttemptAt || item.failedAt, type: 'Failed attempt' })),
  ].map(({ item, time, type }) => ({
    time,
    type,
    reference: item.displayId || item.id || item.packageNumber || 'Package',
    customer: item.customer || item.customer_name || 'Customer',
    partner: item.partnerName || item.partner || 'Partner',
    driver: item.driver || '—',
    status: item.status || '—',
    fee: type === 'Delivered' ? packageAmount(item) : 0,
  })).sort((left, right) => new Date(left.time || 0) - new Date(right.time || 0));
  const invoiceRows = (invoices || []).filter((item) => dayKey(item.createdAt || item.generatedAt) === date).map((item) => {
    const paid = invoicePaid(item, payments);
    return { ...item, paid, due: Math.max(0, Number(item.amount || 0) - paid) };
  });
  const receiptRows = (payments || []).filter((item) =>
    item.status === 'confirmed' && dayKey(item.transferDate || item.verifiedAt || item.submittedAt) === date
  );
  const expenseRows = (expenses || []).filter((item) =>
    dayKey(item.expense_date || item.date) === date
  );
  const withdrawalRows = (withdrawals || []).filter((item) =>
    item.status === 'paid' && dayKey(item.paid_at || item.paidAt || item.updated_at || item.reviewedAt || item.requestedAt) === date
  );
  const pendingWithdrawals = (withdrawals || []).filter((item) =>
    ['pending', 'approved'].includes(String(item.status || '').toLowerCase()) &&
    dayKey(item.requestedAt || item.requested_at) === date
  );
  const pendingPayments = (payments || []).filter((item) =>
    ['pending', 'submitted', 'under_review'].includes(String(item.status || '').toLowerCase()) &&
    dayKey(item.submittedAt || item.submitted_at) === date
  );
  const cashIn = receiptRows.reduce((sum, item) => sum + Number(item.verifiedAmount ?? item.amount ?? 0), 0);
  const expenseOut = expenseRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const withdrawalOut = withdrawalRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalOut = expenseOut + withdrawalOut;
  const netMovement = cashIn - totalOut;
  const opening = openingBalance === '' ? null : Number(openingBalance);
  const actual = actualClosing === '' ? null : Number(actualClosing);
  const expectedClosing = opening == null ? null : opening + netMovement;
  const variance = expectedClosing == null || actual == null ? null : actual - expectedClosing;
  const activity = [
    ...receiptRows.map((item) => ({
      time: item.transferDate || item.verifiedAt || item.submittedAt,
      type: 'Partner payment received',
      reference: item.reference || item.id || 'Payment',
      party: item.partner || 'Partner',
      details: item.invoiceId || 'Confirmed payment',
      incoming: Number(item.verifiedAmount ?? item.amount ?? 0),
      outgoing: 0,
    })),
    ...withdrawalRows.map((item) => ({
      time: item.paid_at || item.paidAt || item.updated_at || item.reviewedAt || item.requestedAt,
      type: 'Driver withdrawal paid',
      reference: item.id || 'Withdrawal',
      party: item.driver || 'Driver',
      details: item.payment_reference || item.paymentReference || 'Paid',
      incoming: 0,
      outgoing: Number(item.amount || 0),
    })),
    ...expenseRows.map((item) => ({
      time: item.expense_date || item.date,
      type: 'Business expense paid',
      reference: item.reference || item.id || 'Expense',
      party: item.paid_to || item.paidTo || 'Supplier',
      details: [item.category, item.description].filter(Boolean).join(' · '),
      incoming: 0,
      outgoing: Number(item.amount || 0),
    })),
  ].sort((left, right) => new Date(left.time || 0) - new Date(right.time || 0));
  return {
    date,
    registered,
    pickedUp,
    deliveryEvents,
    delivered,
    failed,
    openRegistered,
    feesEarned: delivered.reduce((sum, item) => sum + packageAmount(item), 0),
    invoiceRows,
    invoiceDue: invoiceRows.reduce((sum, item) => sum + item.due, 0),
    receiptRows,
    pendingPayments,
    pendingWithdrawals,
    cashIn,
    expenseRows,
    expenseOut,
    withdrawalRows,
    withdrawalOut,
    totalOut,
    netMovement,
    opening,
    actual,
    expectedClosing,
    variance,
    activity,
  };
};

export function DayEndReport({ packages = [], invoices = [], payments = [], expenses = [], withdrawals = [] }) {
  const [date, setDate] = useState(() => maldivesDate(new Date()));
  const [openingBalance, setOpeningBalance] = useState('');
  const [actualClosing, setActualClosing] = useState('');
  const [report, setReport] = useState(null);

  const generate = (event) => {
    event.preventDefault();
    if (!date) return;
    setReport({
      ...createReport({ date, openingBalance, actualClosing, packages, invoices, payments, expenses, withdrawals }),
      generatedAt: new Date().toISOString(),
    });
  };

  const printReport = () => {
    const body = document.body;
    const previousReport = body.getAttribute('data-print-report');
    let cleanupTimer;
    const cleanup = () => {
      if (cleanupTimer) window.clearTimeout(cleanupTimer);
      if (previousReport == null) body.removeAttribute('data-print-report');
      else body.setAttribute('data-print-report', previousReport);
      window.removeEventListener('afterprint', cleanup);
    };
    body.setAttribute('data-print-report', 'day-end');
    window.addEventListener('afterprint', cleanup, { once: true });
    window.requestAnimationFrame(() => window.print());
    cleanupTimer = window.setTimeout(cleanup, 60000);
  };

  const exportCsv = () => {
    if (!report) return;
    const rows = [
      ['Section', 'Metric', 'Count', 'Amount MVR', 'Reference', 'Party or customer', 'Details', 'Time'],
      ['Delivery', 'Packages registered', report.registered.length, '', '', '', '', ''],
      ['Delivery', 'Picked up', report.pickedUp.length, '', '', '', '', ''],
      ['Delivery', 'Delivered', report.delivered.length, report.feesEarned.toFixed(2), '', '', '', ''],
      ['Delivery', 'Failed attempts', report.failed.length, '', '', '', '', ''],
      ['Delivery', 'Registered today still open', report.openRegistered.length, '', '', '', '', ''],
      ['Finance', 'Invoices generated', report.invoiceRows.length, report.invoiceRows.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2), '', '', '', ''],
      ['Finance', 'Invoice balance due', '', report.invoiceDue.toFixed(2), '', '', '', ''],
      ['Follow-up', 'Payment requests awaiting confirmation', report.pendingPayments.length, '', '', '', '', ''],
      ['Follow-up', 'Withdrawal requests awaiting payment', report.pendingWithdrawals.length, '', '', '', '', ''],
      ['Cash movement', 'Confirmed partner payments received', report.receiptRows.length, report.cashIn.toFixed(2), '', '', '', ''],
      ['Cash movement', 'Driver withdrawals paid', report.withdrawalRows.length, report.withdrawalOut.toFixed(2), '', '', '', ''],
      ['Cash movement', 'Business expenses recorded as paid', report.expenseRows.length, report.expenseOut.toFixed(2), '', '', '', ''],
      ['Cash movement', 'Net recorded cash movement', '', report.netMovement.toFixed(2), '', '', '', ''],
      ['Reconciliation', 'Opening balance', '', report.opening == null ? '' : report.opening.toFixed(2), '', '', '', ''],
      ['Reconciliation', 'Expected closing balance', '', report.expectedClosing == null ? '' : report.expectedClosing.toFixed(2), '', '', '', ''],
      ['Reconciliation', 'Actual closing balance', '', report.actual == null ? '' : report.actual.toFixed(2), '', '', '', ''],
      ['Reconciliation', 'Difference (actual minus expected)', '', report.variance == null ? '' : report.variance.toFixed(2), '', '', '', ''],
      ...report.deliveryEvents.map((item) => [
        'Delivery activity', item.type, '', item.fee.toFixed(2), item.reference, item.customer, item.partner + ' · ' + item.driver + ' · ' + item.status, timed(item.time),
      ]),
      ...report.activity.map((item) => [
        'Activity', item.type, '', (item.incoming || item.outgoing).toFixed(2),
        item.reference, item.party, item.details, timed(item.time),
      ]),
    ];
    const escape = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const content = rows.map((row) => row.map(escape).join(',')).join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'igo-day-end-' + report.date + '.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="day-end-report finance-report-print day-end-report-print">
      <h3>Day-end report</h3>
      <p>Daily delivery activity and recorded cash movement. Generate after the day’s records have been entered.</p>
      <form onSubmit={generate} className="finance-report-controls no-print">
        <label>Business date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Opening bank balance (MVR)<input type="number" min="0" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} placeholder="Optional" /></label>
        <label>Actual closing bank balance (MVR)<input type="number" min="0" step="0.01" value={actualClosing} onChange={(event) => setActualClosing(event.target.value)} placeholder="Optional" /></label>
        <button type="submit">Generate report</button>
      </form>
      {report && (
        <div className="day-end-report-output">
          <p className="finance-report-meta">Business date: {report.date} · Generated {new Date(report.generatedAt).toLocaleString([], { timeZone: 'Indian/Maldives' })}</p>
          <h4>Delivery summary</h4>
          <div className="stats-grid finance-report-totals">
            <article className="stat-card"><span>Packages registered</span><strong>{report.registered.length}</strong></article>
            <article className="stat-card"><span>Picked up</span><strong>{report.pickedUp.length}</strong></article>
            <article className="stat-card"><span>Delivered</span><strong>{report.delivered.length}</strong><small>Fees earned: {currency(report.feesEarned)}</small></article>
            <article className="stat-card"><span>Failed attempts</span><strong>{report.failed.length}</strong></article>
            <article className="stat-card"><span>Still open from today</span><strong>{report.openRegistered.length}</strong></article>
            <article className="stat-card"><span>Invoices generated</span><strong>{report.invoiceRows.length}</strong><small>Balance due: {currency(report.invoiceDue)}</small></article>
          </div>
          <h4>Cash movement</h4>
          <div className="stats-grid finance-report-totals">
            <article className="stat-card"><span>Confirmed money received</span><strong>{currency(report.cashIn)}</strong><small>{report.receiptRows.length} payment(s)</small></article>
            <article className="stat-card"><span>Driver withdrawals paid</span><strong>{currency(report.withdrawalOut)}</strong><small>{report.withdrawalRows.length} payout(s)</small></article>
            <article className="stat-card"><span>Business expenses</span><strong>{currency(report.expenseOut)}</strong><small>{report.expenseRows.length} recorded as paid</small></article>
            <article className="stat-card"><span>Net recorded cash movement</span><strong>{currency(report.netMovement)}</strong><small>Received minus paid withdrawals and expenses</small></article>
          </div>
          <h4>Needs follow-up</h4>
          <div className="stats-grid finance-report-totals">
            <article className="stat-card"><span>Unpaid balance on invoices generated today</span><strong>{currency(report.invoiceDue)}</strong><small>{report.invoiceRows.filter((item) => item.due > 0).length} invoice(s)</small></article>
            <article className="stat-card"><span>Payment requests awaiting confirmation</span><strong>{report.pendingPayments.length}</strong></article>
            <article className="stat-card"><span>Withdrawal requests awaiting payment</span><strong>{report.pendingWithdrawals.length}</strong></article>
            <article className="stat-card"><span>Packages registered today still open</span><strong>{report.openRegistered.length}</strong></article>
          </div>
          <section className="day-end-reconciliation">
            <h4>Bank reconciliation</h4>
            {report.expectedClosing == null || report.actual == null ? (
              <p>Enter both balances before generating the report to compare the expected and actual closing balance.</p>
            ) : (
              <p>Expected closing: <strong>{currency(report.expectedClosing)}</strong> · Actual closing: <strong>{currency(report.actual)}</strong> · Difference: <strong>{currency(Math.abs(report.variance))} {report.variance > 0 ? 'over' : report.variance < 0 ? 'short' : 'balanced'}</strong></p>
            )}
            <p>Expected closing balance is opening balance plus recorded money received, less withdrawals and expenses. Compare it with the bank statement; this report does not connect to the bank.</p>
          </section>
          <div className="finance-report-actions no-print">
            <button type="button" onClick={printReport}>Print report</button>
            <button type="button" onClick={exportCsv}>Export CSV</button>
          </div>
          <details open>
            <summary>Delivery activity · {report.deliveryEvents.length} events</summary>
            <div className="finance-report-table-wrap">
              <table className="finance-report-table">
                <thead><tr><th>Time</th><th>Event</th><th>Package</th><th>Customer</th><th>Partner</th><th>Driver</th><th>Fee earned</th><th>Current status</th></tr></thead>
                <tbody>
                  {report.deliveryEvents.length ? report.deliveryEvents.map((item, index) => (
                    <tr key={item.reference + '-' + item.type + '-' + index}><td>{timed(item.time)}</td><td>{item.type}</td><td>{item.reference}</td><td>{item.customer}</td><td>{item.partner}</td><td>{item.driver}</td><td>{item.fee ? currency(item.fee) : '—'}</td><td>{item.status}</td></tr>
                  )) : <tr><td colSpan="8">No package activity was recorded for this date.</td></tr>}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>Finance activity · {report.activity.filter((item) => item.type !== 'Delivery fee earned').length} records</summary>
            <div className="finance-report-table-wrap">
              <table className="finance-report-table">
                <thead><tr><th>Time</th><th>Type</th><th>Reference</th><th>Partner or payee</th><th>Details</th><th>Money in</th><th>Money out</th></tr></thead>
                <tbody>
                  {report.activity.filter((item) => item.type !== 'Delivery fee earned').length ? report.activity.filter((item) => item.type !== 'Delivery fee earned').map((item, index) => (
                    <tr key={item.reference + '-' + index}><td>{timed(item.time)}</td><td>{item.type}</td><td>{item.reference}</td><td>{item.party}</td><td>{item.details || '—'}</td><td>{item.incoming ? currency(item.incoming) : '—'}</td><td>{item.outgoing ? currency(item.outgoing) : '—'}</td></tr>
                  )) : <tr><td colSpan="7">No confirmed receipts or paid expenses and withdrawals for this date.</td></tr>}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>Invoices generated · {report.invoiceRows.length}</summary>
            <div className="finance-report-table-wrap">
              <table className="finance-report-table">
                <thead><tr><th>Invoice</th><th>Partner</th><th>Invoice total</th><th>Paid</th><th>Balance due</th><th>Status</th></tr></thead>
                <tbody>
                  {report.invoiceRows.length ? report.invoiceRows.map((invoice) => (
                    <tr key={invoice.id}><td>{invoice.id}</td><td>{invoice.partner || 'Partner'}</td><td>{currency(invoice.amount)}</td><td>{currency(invoice.paid)}</td><td>{currency(invoice.due)}</td><td>{invoice.due <= 0 ? 'Paid' : invoice.paid > 0 ? 'Partially paid' : 'Unpaid'}</td></tr>
                  )) : <tr><td colSpan="6">No invoices generated on this date.</td></tr>}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
