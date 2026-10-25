const REPORT_TEMPLATE = '/templates/iGO_Monthly_and_Annual_Financial_Report.xlsx';
const CATEGORIES = [
  'Delivery fees', 'Service revenue', 'Partner services', 'Other income',
  'Driver payouts', 'Fuel', 'Vehicle maintenance', 'Salaries & wages',
  'Rent & utilities', 'Supplies', 'Bank charges', 'Marketing', 'Insurance', 'Other expense',
];
const DIRECT_COSTS = new Set(['Driver payouts', 'Fuel', 'Vehicle maintenance']);

const dateKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};
const monthStart = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}-01`;
const monthEnd = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(Date.UTC(year, month + 1, 0)).getUTCDate()).padStart(2, '0')}`;
const excelSerial = (key) => key ? Math.floor(Date.parse(`${key}T00:00:00Z`) / 86400000) + 25569 : null;
const toMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

function categoryForExpense(category = '') {
  const label = String(category).toLowerCase();
  if (/fuel|petrol/.test(label)) return 'Fuel';
  if (/vehicle|maintenance|repair/.test(label)) return 'Vehicle maintenance';
  if (/salary|wage/.test(label)) return 'Salaries & wages';
  if (/rent|utilit/.test(label)) return 'Rent & utilities';
  if (/suppl/.test(label)) return 'Supplies';
  if (/bank|fee/.test(label)) return 'Bank charges';
  if (/market/.test(label)) return 'Marketing';
  if (/insur/.test(label)) return 'Insurance';
  return 'Other expense';
}

function buildLedger({ invoices = [], payments = [], expenses = [], withdrawals = [], packages = [] }) {
  const invoiceById = new Map();
  for (const invoice of invoices) {
    invoiceById.set(String(invoice.id), invoice);
    if (invoice.dbId) invoiceById.set(String(invoice.dbId), invoice);
  }
  const allocationsByInvoice = new Map();
  const unallocatedPayments = [];
  const confirmedPayments = payments.filter((payment) => payment.status === 'confirmed');

  for (const payment of confirmedPayments) {
    const paidDate = dateKey(payment.transferDate || payment.verifiedAt || payment.submittedAt);
    let allocations = Array.isArray(payment.allocations) ? payment.allocations : [];
    if (!allocations.length && payment.invoiceId) {
      const id = String(payment.invoiceId);
      if (invoiceById.has(id)) allocations = [{ invoiceId: id, amount: Number(payment.amount || 0) }];
    }
    if (!allocations.length) {
      unallocatedPayments.push({ payment, paidDate });
      continue;
    }
    for (const allocation of allocations) {
      const invoiceId = String(allocation.invoiceId || allocation.id || '');
      const invoice = invoiceById.get(invoiceId);
      const amount = Number(allocation.amount || 0);
      if (!invoice || amount <= 0) continue;
      const item = { payment, paidDate, invoice, amount };
      if (!allocationsByInvoice.has(invoiceId)) allocationsByInvoice.set(invoiceId, []);
      allocationsByInvoice.get(invoiceId).push(item);
    }
  }

  const ledger = [];
  const invoicesForBalances = [];
  for (const invoice of invoices) {
    const invoiceDate = dateKey(invoice.recognizedAt || invoice.createdAt) || dateKey(invoice.periodStart) || dateKey(new Date());
    const invoiceTotal = Math.max(0, Number(invoice.amount || 0));
    const items = allocationsByInvoice.get(String(invoice.id)) || [];
    const paymentTotal = items.reduce((sum, item) => sum + item.amount, 0);
    let recognizedRemaining = 0;

    for (const item of items) {
      const recognizedAmount = Math.max(0, Math.min(item.amount, invoiceTotal - recognizedRemaining));
      recognizedRemaining += recognizedAmount;
      ledger.push({
        date: invoiceDate, type: 'Income', category: 'Delivery fees',
        description: `Invoice payment · ${invoice.id}`,
        counterparty: item.payment.partner || invoice.partner || 'Partner',
        reference: item.payment.reference || item.payment.id || invoice.id,
        dueDate: '', status: 'Paid', cashDate: item.paidDate,
        amount: recognizedAmount, packages: 0, notes: '',
      });
    }

    const paidAmountWithoutHistory = Math.max(0, Math.min(invoiceTotal, Number(invoice.paidAmount || 0)) - paymentTotal);
    if (paidAmountWithoutHistory > 0) {
      ledger.push({
        date: invoiceDate, type: 'Income', category: 'Delivery fees',
        description: `Paid invoice amount · ${invoice.id}`,
        counterparty: invoice.partner || 'Partner', reference: invoice.id,
        dueDate: '', status: 'Paid', cashDate: '', amount: paidAmountWithoutHistory,
        packages: 0, notes: 'Payment date is not available in the finance records.',
      });
    }

    const outstanding = Math.max(0, invoiceTotal - Math.max(paymentTotal, Number(invoice.paidAmount || 0)));
    if (outstanding > 0) {
      ledger.push({
        date: invoiceDate, type: 'Income', category: 'Delivery fees',
        description: `Unpaid invoice balance · ${invoice.id}`,
        counterparty: invoice.partner || 'Partner', reference: invoice.id,
        dueDate: '', status: 'Open', cashDate: '', amount: outstanding, packages: 0,
        notes: 'Due date is not recorded in the finance system.',
      });
    }
    invoicesForBalances.push({ invoiceDate, amount: invoiceTotal, items, paidAmount: Number(invoice.paidAmount || 0) });
  }

  for (const { payment, paidDate } of unallocatedPayments) {
    const amount = Number(payment.amount || 0);
    if (amount <= 0) continue;
    ledger.push({
      date: paidDate, type: 'Income', category: 'Other income',
      description: 'Confirmed payment without invoice allocation',
      counterparty: payment.partner || 'Partner', reference: payment.reference || payment.id || '',
      dueDate: '', status: 'Paid', cashDate: paidDate, amount, packages: 0,
      notes: 'No invoice allocation was available for this payment.',
    });
  }

  for (const expense of expenses) {
    const date = dateKey(expense.date || expense.expense_date);
    const amount = Number(expense.amount || 0);
    if (!date || amount <= 0) continue;
    const category = categoryForExpense(expense.category);
    ledger.push({
      date, type: 'Expense', category,
      description: expense.description || expense.category || 'Business expense',
      counterparty: expense.paidTo || expense.paid_to || '',
      reference: expense.reference || expense.id || '', dueDate: '',
      status: 'Paid', cashDate: date, amount, packages: 0, notes: '',
    });
  }

  for (const payout of withdrawals.filter((item) => item.status === 'paid')) {
    const date = dateKey(payout.paid_at || payout.reviewedAt || payout.requestedAt);
    const amount = Number(payout.amount || 0);
    if (!date || amount <= 0) continue;
    ledger.push({
      date, type: 'Expense', category: 'Driver payouts',
      description: 'Driver withdrawal', counterparty: payout.driver || 'Driver',
      reference: payout.id || '', dueDate: '', status: 'Paid', cashDate: date,
      amount, packages: 0, notes: '',
    });
  }

  for (const item of packages.filter((pkg) => pkg.status === 'Delivered')) {
    const date = dateKey(item.deliveredAt || item.delivered_at);
    if (!date) continue;
    ledger.push({
      date, type: 'Income', category: 'Delivery fees', description: 'Delivered package',
      counterparty: item.partnerName || item.partner || '', reference: item.id || '',
      dueDate: '', status: 'Open', cashDate: '', amount: 0, packages: 1, notes: '',
    });
  }

  ledger.sort((a, b) => a.date.localeCompare(b.date));
  return { ledger, invoicesForBalances };
}

function summarizePeriod(ledger, invoicesForBalances, packages, start, end) {
  const inPeriod = (value) => value && value >= start && value <= end;
  const rows = ledger.filter((row) => inPeriod(row.date));
  const revenue = rows.filter((row) => row.type === 'Income').reduce((sum, row) => sum + row.amount, 0);
  const directDeliveryCosts = rows.filter((row) => row.type === 'Expense' && DIRECT_COSTS.has(row.category)).reduce((sum, row) => sum + row.amount, 0);
  const totalExpenses = rows.filter((row) => row.type === 'Expense').reduce((sum, row) => sum + row.amount, 0);
  const operatingExpenses = totalExpenses - directDeliveryCosts;
  const cashReceipts = ledger.filter((row) => row.type === 'Income' && row.status === 'Paid' && inPeriod(row.cashDate)).reduce((sum, row) => sum + row.amount, 0);
  const cashPayments = ledger.filter((row) => row.type === 'Expense' && row.status === 'Paid' && inPeriod(row.cashDate)).reduce((sum, row) => sum + row.amount, 0);
  const openReceivables = invoicesForBalances.reduce((sum, item) => {
    if (!item.invoiceDate || item.invoiceDate > end) return sum;
    const paymentsByEnd = item.items.filter((part) => part.paidDate && part.paidDate <= end).reduce((paid, part) => paid + part.amount, 0);
    return sum + Math.max(0, item.amount - Math.max(paymentsByEnd, item.paidAmount && end >= dateKey(new Date()) ? item.paidAmount : 0));
  }, 0);
  const packagesDelivered = packages.filter((pkg) => pkg.status === 'Delivered' && inPeriod(dateKey(pkg.deliveredAt || pkg.delivered_at))).length;
  const categoryTotals = Object.fromEntries(CATEGORIES.map((category) => [category,
    rows.filter((row) => row.category === category).reduce((sum, row) => sum + row.amount, 0),
  ]));
  return {
    revenue: toMoney(revenue), directDeliveryCosts: toMoney(directDeliveryCosts),
    grossProfit: toMoney(revenue - directDeliveryCosts), operatingExpenses: toMoney(operatingExpenses),
    totalExpenses: toMoney(totalExpenses), netProfit: toMoney(revenue - totalExpenses),
    cashReceipts: toMoney(cashReceipts), cashPayments: toMoney(cashPayments),
    netCashFlow: toMoney(cashReceipts - cashPayments), packagesDelivered,
    openReceivables: toMoney(openReceivables), openPayables: 0,
    overdueReceivables: 0, overduePayables: 0, categoryTotals,
  };
}

function setCellValue(doc, address, value) {
  const ns = doc.documentElement.namespaceURI;
  const cell = Array.from(doc.getElementsByTagNameNS(ns, 'c')).find((item) => item.getAttribute('r') === address);
  if (!cell) return;
  for (const child of Array.from(cell.childNodes)) {
    if (child.nodeType === 1 && ['f', 'v', 'is'].includes(child.localName)) cell.removeChild(child);
  }
  if (value === null || value === undefined || value === '') {
    cell.removeAttribute('t');
    return;
  }
  const stringValue = typeof value === 'string';
  if (stringValue) cell.setAttribute('t', 'str');
  else cell.removeAttribute('t');
  const v = doc.createElementNS(ns, 'x:v');
  v.textContent = stringValue ? value : String(value);
  cell.appendChild(v);
}

function getCellRef(column, row) {
  let n = column;
  let name = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return `${name}${row}`;
}

function populateTransactionSheet(doc, rows) {
  const ns = doc.documentElement.namespaceURI;
  const sheetData = doc.getElementsByTagNameNS(ns, 'sheetData')[0];
  const templateRow = Array.from(sheetData.getElementsByTagNameNS(ns, 'row')).find((row) => row.getAttribute('r') === '6');
  if (!templateRow) throw new Error('The workbook transaction template could not be read.');
  const existingRows = new Map(Array.from(sheetData.getElementsByTagNameNS(ns, 'row')).map((row) => [Number(row.getAttribute('r')), row]));
  const endRow = Math.max(505, rows.length + 5);
  for (let index = 0; index < rows.length; index++) {
    const rowNumber = index + 6;
    let row = existingRows.get(rowNumber);
    if (!row) {
      row = templateRow.cloneNode(true);
      row.setAttribute('r', String(rowNumber));
      for (const cell of Array.from(row.getElementsByTagNameNS(ns, 'c'))) {
        const ref = cell.getAttribute('r').replace(/\d+$/, String(rowNumber));
        cell.setAttribute('r', ref);
        for (const child of Array.from(cell.childNodes)) if (child.nodeType === 1) cell.removeChild(child);
        cell.removeAttribute('t');
      }
      sheetData.appendChild(row);
      existingRows.set(rowNumber, row);
    }
    const item = rows[index];
    const values = [excelSerial(item.date), item.type, item.category, item.description, item.counterparty, item.reference, excelSerial(item.dueDate), item.status, excelSerial(item.cashDate), toMoney(item.amount), Number(item.packages || 0), item.notes];
    for (let col = 1; col <= 12; col++) setCellValue(doc, getCellRef(col, rowNumber), values[col - 1]);
  }
  const dimension = doc.getElementsByTagNameNS(ns, 'dimension')[0];
  if (dimension) dimension.setAttribute('ref', `A1:O${endRow}`);
  for (const rule of Array.from(doc.getElementsByTagNameNS(ns, 'dataValidation'))) {
    if (rule.hasAttribute('sqref')) rule.setAttribute('sqref', rule.getAttribute('sqref').replace(/505/g, String(endRow)));
  }
}

function serialize(doc) {
  return new XMLSerializer().serializeToString(doc);
}

function writePeriodCells(monthDoc, annualDoc, reportMonth, model) {
  const [yearText, monthText] = reportMonth.split('-');
  const selectedYear = Number(yearText);
  const selectedMonth = Number(monthText) - 1;
  const selected = summarizePeriod(model.ledger, model.invoicesForBalances, model.packages, monthStart(selectedYear, selectedMonth), monthEnd(selectedYear, selectedMonth));
  const previous = selectedMonth === 0
    ? summarizePeriod(model.ledger, model.invoicesForBalances, model.packages, monthStart(selectedYear - 1, 11), monthEnd(selectedYear - 1, 11))
    : summarizePeriod(model.ledger, model.invoicesForBalances, model.packages, monthStart(selectedYear, selectedMonth - 1), monthEnd(selectedYear, selectedMonth - 1));
  const lastYear = summarizePeriod(model.ledger, model.invoicesForBalances, model.packages, monthStart(selectedYear - 1, selectedMonth), monthEnd(selectedYear - 1, selectedMonth));
  setCellValue(monthDoc, 'B2', excelSerial(monthStart(selectedYear, selectedMonth)));
  const metricKeys = ['revenue', 'directDeliveryCosts', 'grossProfit', 'operatingExpenses', 'totalExpenses', 'netProfit', 'cashReceipts', 'cashPayments', 'netCashFlow', 'packagesDelivered', 'openReceivables', 'openPayables', 'overdueReceivables', 'overduePayables'];
  metricKeys.forEach((key, index) => {
    const row = index + 6;
    const cur = selected[key];
    const prev = previous[key];
    const ly = lastYear[key];
    setCellValue(monthDoc, `B${row}`, cur);
    setCellValue(monthDoc, `C${row}`, prev);
    setCellValue(monthDoc, `D${row}`, ly);
    setCellValue(monthDoc, `E${row}`, toMoney(cur - prev));
    setCellValue(monthDoc, `F${row}`, toMoney(cur - ly));
  });
  setCellValue(monthDoc, 'B21', null);
  CATEGORIES.forEach((category, index) => setCellValue(monthDoc, `B${index + 26}`, selected.categoryTotals[category]));
  setCellValue(monthDoc, 'A20', 'Overdue balances are shown as zero because due dates are not recorded in the admin finance data. Closing cash is blank because no opening cash balance is maintained here.');
  setCellValue(monthDoc, 'A23', 'Revenue uses invoice dates. Cash flow uses confirmed payment and paid-cost dates. Direct delivery costs include driver payouts, fuel, and vehicle maintenance.');

  setCellValue(annualDoc, 'B2', selectedYear);
  const yearMonths = Array.from({ length: 12 }, (_, index) => summarizePeriod(model.ledger, model.invoicesForBalances, model.packages, monthStart(selectedYear, index), monthEnd(selectedYear, index)));
  const annualKeys = ['revenue', 'directDeliveryCosts', 'grossProfit', 'operatingExpenses', 'totalExpenses', 'netProfit', 'cashReceipts', 'cashPayments', 'netCashFlow', 'packagesDelivered'];
  yearMonths.forEach((summary, monthIndex) => annualKeys.forEach((key, metricIndex) => setCellValue(annualDoc, `${getCellRef(metricIndex + 2, monthIndex + 7)}`, summary[key])));
  const annual = summarizePeriod(model.ledger, model.invoicesForBalances, model.packages, `${selectedYear}-01-01`, `${selectedYear}-12-31`);
  annualKeys.forEach((key, index) => setCellValue(annualDoc, `${getCellRef(index + 2, 19)}`, annual[key]));
  setCellValue(annualDoc, 'B22', annual.openReceivables);
  setCellValue(annualDoc, 'B23', annual.openPayables);
  setCellValue(annualDoc, 'B24', annual.overdueReceivables);
  setCellValue(annualDoc, 'B25', annual.overduePayables);
  setCellValue(annualDoc, 'B26', null);
  setCellValue(annualDoc, 'M17', 'Due dates and opening cash balances are not stored in the admin finance data; overdue metrics show zero and closing cash is blank. For formal annual statements, confirm accounting and filing requirements with your accountant.');

  const priorYear = summarizePeriod(model.ledger, model.invoicesForBalances, model.packages, `${selectedYear - 1}-01-01`, `${selectedYear - 1}-12-31`);
  const compareKeys = ['revenue', 'directDeliveryCosts', 'grossProfit', 'operatingExpenses', 'totalExpenses', 'netProfit', 'cashReceipts', 'cashPayments', 'packagesDelivered'];
  compareKeys.forEach((key, index) => {
    const row = index + 7;
    const currentValue = annual[key];
    const priorValue = priorYear[key];
    setCellValue(annualDoc, `N${row}`, currentValue);
    setCellValue(annualDoc, `O${row}`, priorValue);
    setCellValue(annualDoc, `P${row}`, toMoney(currentValue - priorValue));
    setCellValue(annualDoc, `Q${row}`, priorValue === 0 ? '' : (currentValue - priorValue) / Math.abs(priorValue));
  });
}

export function buildFinancialWorkbookModel(data) {
  const { ledger, invoicesForBalances } = buildLedger(data);
  return { ledger, invoicesForBalances, packages: data.packages || [] };
}

export function summarizeFinancialPeriod(model, start, end) {
  return summarizePeriod(model.ledger, model.invoicesForBalances, model.packages, start, end);
}

export async function downloadFinancialReportWorkbook({ reportMonth, ...data }) {
  if (!/^\d{4}-\d{2}$/.test(reportMonth || '')) throw new Error('Choose a report month first.');
  if (!window.JSZip) throw new Error('The Excel export library did not load. Reload the page and try again.');
  const response = await fetch(REPORT_TEMPLATE);
  if (!response.ok) throw new Error('Could not load the financial report template.');
  const workbookZip = await window.JSZip.loadAsync(await response.arrayBuffer());
  const model = buildFinancialWorkbookModel(data);
  const [monthlyXml, annualXml, transactionXml] = await Promise.all([
    workbookZip.file('xl/worksheets/sheet1.xml').async('string'),
    workbookZip.file('xl/worksheets/sheet2.xml').async('string'),
    workbookZip.file('xl/worksheets/sheet3.xml').async('string'),
  ]);
  const parser = new DOMParser();
  const monthlyDoc = parser.parseFromString(monthlyXml, 'application/xml');
  const annualDoc = parser.parseFromString(annualXml, 'application/xml');
  const transactionDoc = parser.parseFromString(transactionXml, 'application/xml');
  if ([monthlyDoc, annualDoc, transactionDoc].some((doc) => doc.getElementsByTagName('parsererror').length)) throw new Error('The financial report template could not be read.');
  writePeriodCells(monthlyDoc, annualDoc, reportMonth, model);
  populateTransactionSheet(transactionDoc, model.ledger);
  setCellValue(transactionDoc, 'A2', 'This exported workbook is a snapshot of finance records available when the report was generated. The transaction detail is included for traceability.');
  setCellValue(transactionDoc, 'A3', 'Income is recognized on invoice dates. Confirmed payments and paid costs use their actual dates for cash flow. Direct delivery costs are driver payouts, fuel, and vehicle maintenance.');
  setCellValue(transactionDoc, 'A4', 'Invoice due dates and opening cash balances are not stored in the admin finance data. Overdue balances show zero and closing cash is blank.');
  workbookZip.file('xl/worksheets/sheet1.xml', serialize(monthlyDoc));
  workbookZip.file('xl/worksheets/sheet2.xml', serialize(annualDoc));
  workbookZip.file('xl/worksheets/sheet3.xml', serialize(transactionDoc));
  const blob = await workbookZip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `iGO_Financial_Report_${reportMonth}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { model, selectedSummary: summarizePeriod(model.ledger, model.invoicesForBalances, model.packages, `${reportMonth}-01`, monthEnd(Number(reportMonth.slice(0, 4)), Number(reportMonth.slice(5, 7)) - 1)) };
}
