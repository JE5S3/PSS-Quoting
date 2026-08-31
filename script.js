// ======================================
// PHASE SHIFT STUDIO — SUPABASE QUOTE ADMIN
// ======================================

// Safe browser-side values.
// Never place a service_role key, database password or Stripe secret key here.
const SUPABASE_URL = 'https://txvorfcyvxwmwpkctndg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wVhxl7xaz5GGeK5-mryMkw_hPDA904U';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const SETTINGS_KEY = 'pss_quote_settings_live_v1';

const money = n => `A$${Number(n || 0).toLocaleString('en-AU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

let quotes = [];
let customers = [];
let payments = [];
let currentUser = null;
let projectFilter = 'all';
let projectStageFilter = 'all';

const authScreen = document.getElementById('auth-screen');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const signoutBtn = document.getElementById('signout-btn');

const dialog = document.getElementById('quote-dialog');
const form = document.getElementById('quote-form');
const lineItems = document.getElementById('line-items');
const deleteBtn = document.getElementById('delete-quote-btn');
const cancelBtn = document.getElementById('cancel-quote-btn');
const duplicateBtn = document.getElementById('duplicate-quote-btn');
const createStripeLinkBtn = document.getElementById('create-stripe-link-btn');
const stripeLinkHelp = document.getElementById('stripe-link-help');
const customerPickerDialog = document.getElementById('customer-picker-dialog');
const customerPickerList = document.getElementById('customer-picker-list');
const customerPickerSearch = document.getElementById('customer-picker-search');
const settingsForm = document.getElementById('settings-form');

let settings = loadSettings();

function loadSettings() {
  const defaults = {
    businessName: 'Phase Shift Studio',
    email: 'jesse@phaseshiftstudio.com.au',
    abn: '',
    phone: '',
    address: 'Queensland, Australia',
    gstRate: 0,
    depositRate: 50,
    terms: "Quote valid for 30 days. Work commences once the agreed deposit has been received. Final balance is due on completion unless otherwise agreed in writing. By accepting this quote, the client grants Phase Shift Studio permission to display the completed public-facing website, screenshots, business name and other publicly available project visuals in Phase Shift Studio's portfolio, website, social media and promotional materials, unless otherwise agreed in writing. Confidential or non-public client information will not be displayed."
  };
  try {
    const saved = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    if (['hello@phaseshiftstudio.com', 'hello@phaseshiftstudio.com.au', 'jesse@phaseshiftstudio.com'].includes(
      String(saved.email || '').toLowerCase()
    )) {
      saved.email = defaults.email;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    }
    return saved;
  } catch {
    return defaults;
  }
}

function saveSettingsLocal() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function setLoading(on) {
  document.body.classList.toggle('loading', on);
}

function showAuth() {
  authScreen.classList.remove('hidden');
  document.body.classList.add('auth-locked');
}

function hideAuth() {
  authScreen.classList.add('hidden');
  document.body.classList.remove('auth-locked');
}

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginStatus.textContent = 'SIGNING IN…';

  const fd = new FormData(loginForm);
  const { error } = await db.auth.signInWithPassword({
    email: fd.get('email'),
    password: fd.get('password')
  });

  if (error) {
    loginStatus.textContent = error.message.toUpperCase();
    return;
  }

  loginStatus.textContent = '';
  loginForm.reset();
});

signoutBtn.addEventListener('click', async () => {
  await db.auth.signOut();
});

db.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;

  if (!currentUser) {
    quotes = [];
    customers = [];
    payments = [];
    showAuth();
    renderAll();
    return;
  }

  hideAuth();
  await loadLiveData();
});

async function boot() {
  const { data: { session } } = await db.auth.getSession();
  currentUser = session?.user || null;

  if (!currentUser) {
    showAuth();
    renderAll();
  } else {
    hideAuth();
    await loadLiveData();
  }
}

// -------------------------
// LIVE DATABASE
// -------------------------
async function loadLiveData() {
  if (!currentUser) return;

  setLoading(true);
  try {
    const [quotesResult, customersResult, paymentsResult] = await Promise.all([
      db
        .from('quotes')
        .select('*, quote_items(*)')
        .order('created_at', { ascending: false }),
      db
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false }),
      db
        .from('quote_payments')
        .select('*')
        .order('paid_at', { ascending: false })
    ]);

    if (quotesResult.error) throw quotesResult.error;
    if (customersResult.error) throw customersResult.error;
    if (paymentsResult.error) throw paymentsResult.error;

    payments = paymentsResult.data || [];
    quotes = (quotesResult.data || []).map(fromDbQuote).map(q => {
      const quotePayments = payments.filter(payment => payment.quote_id === q.id);
      return {
        ...q,
        payments: quotePayments,
        totalPaid: quotePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
      };
    });
    customers = customersResult.data || [];
    renderAll();
  } catch (error) {
    console.error('Load error:', error);
    alert(`Could not load Supabase data.\n\n${error.message}`);
  } finally {
    setLoading(false);
  }
}

function fromDbQuote(q) {
  const rawItems = (q.quote_items || [])
    .sort((a,b) => a.sort_order - b.sort_order)
    .map(i => ({
      id: i.id,
      description: i.description,
      qty: Number(i.quantity),
      rate: Number(i.rate),
      billingType: i.billing_type || (q.payment_plan === 'monthly' ? 'monthly' : 'upfront')
    }));
  const fallbackUpfront = q.payment_plan === 'monthly' ? 0 : Number(q.total || 0);
  const fallbackMonthly = q.payment_plan === 'monthly' ? Number(q.total || 0) : 0;

  return {
    id: q.id,
    quoteNumber: q.quote_number,
    customerId: q.customer_id,
    enquiryId: q.enquiry_id,
    clientName: q.client_name || '',
    contactName: q.client_contact_name || '',
    clientEmail: q.client_email || '',
    clientPhone: q.client_phone || '',
    paymentPlan: q.payment_plan || 'one_time',
    projectName: q.project_name,
    status: q.status,
    issueDate: q.issue_date || '',
    expiryDate: q.expiry_date || '',
    items: rawItems,
    subtotal: Number(q.subtotal),
    discount: Number(q.discount),
    gstRate: Number(q.gst_rate),
    gst: Number(q.gst_amount),
    total: Number(q.total),
    upfrontSubtotal: Number(q.upfront_subtotal ?? fallbackUpfront),
    upfrontTotal: Number(q.upfront_total ?? fallbackUpfront),
    monthlySubtotal: Number(q.monthly_subtotal ?? fallbackMonthly),
    monthlyTotal: Number(q.monthly_total ?? fallbackMonthly),
    depositRate: Number(q.deposit_rate),
    deposit: Number(q.deposit_amount),
    stripeUrl: q.stripe_payment_url || '',
    paidAmount: Number(q.paid_amount || 0),
    paidCurrency: (q.paid_currency || 'AUD').toUpperCase(),
    paidAt: q.paid_at || null,
    projectStatus: q.project_status || 'in_progress',
    codeLink: q.code_link || '',
    websiteLink: q.website_link || '',
    projectNotes: q.project_notes || '',
    notes: q.notes || '',
    terms: q.terms || '',
    aiGenerated: q.ai_generated,
    aiNotes: q.ai_notes || '',
    emailSubject: q.email_subject || '',
    emailMessage: q.email_message || '',
    sentAt: q.sent_at || null,
    acceptToken: q.accept_token || '',
    acceptedAt: q.accepted_at || null,
    acceptedBy: q.accepted_by || '',
    declinedAt: q.declined_at || null,
    declineReason: q.decline_reason || '',
    createdAt: q.created_at,
    updatedAt: q.updated_at
  };
}

function customerForQuote(q) {
  return customers.find(c => c.id === q.customerId) || null;
}

function enrichQuote(q) {
  const c = customerForQuote(q);
  return {
    ...q,
    clientName: q.clientName || c?.business_name || '',
    contactName: q.contactName || c?.contact_name || '',
    clientEmail: q.clientEmail || c?.email || '',
    clientPhone: q.clientPhone || c?.phone || ''
  };
}

async function upsertCustomer(quote) {
  const email = (quote.clientEmail || '').trim();
  const business = (quote.clientName || '').trim();

  let existing = null;
  if (email) {
    existing = customers.find(c => (c.email || '').toLowerCase() === email.toLowerCase());
  }
  if (!existing) {
    existing = customers.find(c => (c.business_name || '').toLowerCase() === business.toLowerCase());
  }

  const payload = {
    user_id: currentUser.id,
    business_name: business,
    contact_name: quote.contactName || null,
    email: email || null,
    phone: quote.clientPhone || null,
    updated_at: new Date().toISOString()
  };

  let result;
  if (existing) {
    result = await db
      .from('customers')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
  } else {
    result = await db
      .from('customers')
      .insert(payload)
      .select()
      .single();
  }

  if (result.error) throw result.error;
  return result.data;
}

async function saveQuoteToDb(quote) {
  if (!currentUser) throw new Error('Not signed in');

  const customer = await upsertCustomer(quote);

  const payload = {
    user_id: currentUser.id,
    customer_id: customer.id,
    enquiry_id: quote.enquiryId || null,
    quote_number: quote.quoteNumber,
    client_name: quote.clientName || null,
    client_contact_name: quote.contactName || null,
    client_email: quote.clientEmail || null,
    client_phone: quote.clientPhone || null,
    payment_plan: quote.paymentPlan || 'one_time',
    project_name: quote.projectName,
    status: quote.status,
    issue_date: quote.issueDate || null,
    expiry_date: quote.expiryDate || null,
    subtotal: quote.subtotal,
    discount: quote.discount,
    gst_rate: quote.gstRate,
    gst_amount: quote.gst,
    total: quote.total,
    upfront_subtotal: quote.upfrontSubtotal,
    upfront_total: quote.upfrontTotal,
    monthly_subtotal: quote.monthlySubtotal,
    monthly_total: quote.monthlyTotal,
    deposit_rate: quote.depositRate,
    deposit_amount: quote.deposit,
    stripe_payment_url: quote.stripeUrl || null,
    project_status: quote.projectStatus || 'in_progress',
    code_link: quote.codeLink || null,
    website_link: quote.websiteLink || null,
    project_notes: quote.projectNotes || null,
    notes: quote.notes || null,
    terms: quote.terms || null,
    ai_generated: Boolean(quote.aiGenerated),
    ai_notes: quote.aiNotes || null,
    email_subject: quote.emailSubject || null,
    email_message: quote.emailMessage || null,
    sent_at: quote.sentAt || null,
    updated_at: new Date().toISOString()
  };

  let quoteResult;
  if (quote.id) {
    quoteResult = await db
      .from('quotes')
      .update(payload)
      .eq('id', quote.id)
      .select()
      .single();
  } else {
    quoteResult = await db
      .from('quotes')
      .insert(payload)
      .select()
      .single();
  }

  if (quoteResult.error) throw quoteResult.error;
  const saved = quoteResult.data;

  if (quote.id) {
    const deleteResult = await db
      .from('quote_items')
      .delete()
      .eq('quote_id', saved.id);

    if (deleteResult.error) throw deleteResult.error;
  }

  if (quote.items.length) {
    const itemsPayload = quote.items.map((item, index) => ({
      quote_id: saved.id,
      description: item.description,
      quantity: item.qty,
      rate: item.rate,
      amount: item.qty * item.rate,
      billing_type: item.billingType === 'monthly' ? 'monthly' : 'upfront',
      sort_order: index
    }));

    const itemsResult = await db
      .from('quote_items')
      .insert(itemsPayload);

    if (itemsResult.error) throw itemsResult.error;
  }

  await loadLiveData();
  return saved.id;
}

async function deleteQuoteFromDb(id) {
  const { error } = await db.from('quotes').delete().eq('id', id);
  if (error) throw error;
  await loadLiveData();
}

async function deleteCustomerFromDb(id) {
  const customer = customers.find(c => c.id === id);
  if (!customer) return;

  const relatedCount = quotes.filter(q => q.customerId === id).length;
  const warning = relatedCount
    ? `This customer is linked to ${relatedCount} quote${relatedCount === 1 ? '' : 's'}. The quote snapshots will be kept, but the customer record will be removed. Continue?`
    : 'Delete this customer permanently?';

  if (!confirm(warning)) return;

  const { error } = await db.from('customers').delete().eq('id', id);
  if (error) throw error;
  await loadLiveData();
}

// -------------------------
// NAVIGATION
// -------------------------
document.querySelectorAll('.nav-item').forEach(btn =>
  btn.addEventListener('click', () => showView(btn.dataset.view))
);
document.querySelectorAll('[data-jump]').forEach(btn =>
  btn.addEventListener('click', () => showView(btn.dataset.jump))
);

function showView(view) {
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${view}`)
  );
  renderAll();
}

// -------------------------
// QUOTE BUILDER
// -------------------------
document.getElementById('new-quote-btn').onclick = () => openQuote();
document.getElementById('new-quote-btn-2').onclick = () => openQuote();
document.getElementById('refresh-btn').onclick = loadLiveData;
document.getElementById('close-quote-dialog').onclick = () => dialog.close();

document.querySelectorAll('[data-collapsible-section]').forEach(section => {
  section.addEventListener('mouseenter', () => {
    section.open = true;
  });
  section.querySelector('summary')?.addEventListener('click', event => {
    if (event.target.closest('button, a, input, select, textarea')) event.stopPropagation();
  });
});

function escapeAttr(s='') {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

function makeItemRow(item={description:'', qty:1, rate:0, billingType:'upfront'}) {
  const billingType = item.billingType === 'monthly' ? 'monthly' : 'upfront';
  const row = document.createElement('div');
  row.className = 'line-item';
  row.innerHTML = `
    <label>DESCRIPTION<input class="item-desc" value="${escapeAttr(item.description)}" placeholder="Website design"></label>
    <label>TYPE<select class="item-billing"><option value="upfront"${billingType === 'upfront' ? ' selected' : ''}>UPFRONT</option><option value="monthly"${billingType === 'monthly' ? ' selected' : ''}>MONTHLY</option></select></label>
    <label>QTY<input class="item-qty" type="number" min="0" step="0.01" value="${item.qty ?? 1}"></label>
    <label>RATE<input class="item-rate" type="number" min="0" step="0.01" value="${item.rate ?? 0}"></label>
    <div class="item-total">${money((item.qty||0)*(item.rate||0))}</div>
    <button type="button" class="remove-item" aria-label="Remove item">×</button>`;

  row.querySelectorAll('input, select').forEach(i =>
    i.addEventListener('input', recalculate)
  );
  row.querySelector('.item-billing').addEventListener('change', recalculate);

  row.querySelector('.remove-item').onclick = () => {
    row.remove();
    if (!lineItems.children.length) addItem();
    recalculate();
  };

  lineItems.appendChild(row);
}

function addItem(item) {
  makeItemRow(item);
  recalculate();
}
document.getElementById('add-item-btn').onclick = () => addItem();

function nextQuoteNumber() {
  const nums = quotes
    .map(q => Number(String(q.quoteNumber || '').replace(/\D/g,'')))
    .filter(Boolean);

  return `PSS-${String((Math.max(0, ...nums) || 0) + 1).padStart(4,'0')}`;
}


function setPaymentPlan(plan) {
  const normalized = ['monthly', 'hybrid'].includes(plan) ? plan : 'one_time';
  form.elements.paymentPlan.value = normalized;
  recalculate();
}

document.getElementById('select-customer-btn').addEventListener('click', () => {
  renderCustomerPicker();
  customerPickerDialog.showModal();
});

document.getElementById('close-customer-picker').addEventListener('click', () => {
  customerPickerDialog.close();
});

customerPickerSearch.addEventListener('input', renderCustomerPicker);

function renderCustomerPicker() {
  const query = (customerPickerSearch.value || '').toLowerCase().trim();
  const list = customers.filter(c =>
    [c.business_name, c.contact_name, c.email, c.phone]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  );

  customerPickerList.innerHTML = list.length
    ? list.map(c => `
      <button type="button" class="customer-picker-option" data-pick-customer="${c.id}">
        <strong>${escapeHtml(c.business_name)}</strong>
        <span>${escapeHtml(c.contact_name || '')}${c.contact_name ? '<br>' : ''}${escapeHtml(c.email || 'No email')}<br>${escapeHtml(c.phone || 'No phone')}</span>
      </button>
    `).join('')
    : '<p style="padding:24px">NO MATCHING CUSTOMERS.</p>';

  customerPickerList.querySelectorAll('[data-pick-customer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = customers.find(x => x.id === btn.dataset.pickCustomer);
      if (!c) return;
      form.elements.clientName.value = c.business_name || '';
      form.elements.contactName.value = c.contact_name || '';
      form.elements.clientEmail.value = c.email || '';
      form.elements.clientPhone.value = c.phone || '';
      form.elements.emailTo.value = c.email || '';
      customerPickerDialog.close();
    });
  });
}


function defaultEmailMessage(q = {}) {
  const name = (q.contactName || q.clientName || '').trim();
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const project = q.projectName ? ` for ${q.projectName}` : '';

  return `${greeting}

Thanks for discussing your project with Phase Shift Studio.

Please find the quote${project} below. If you have any questions or would like any adjustments, simply reply to this email.

Regards,
Phase Shift Studio`;
}

function updateEmailSendState(sentAt) {
  const el = document.getElementById('email-send-state');
  if (!el) return;

  if (sentAt) {
    const date = new Date(sentAt);
    el.textContent = `SENT ${date.toLocaleString('en-AU')}`;
    el.classList.add('sent');
  } else {
    el.textContent = 'NOT SENT';
    el.classList.remove('sent');
  }
}

form.elements.clientEmail.addEventListener('input', () => {
  form.elements.emailTo.value = form.elements.clientEmail.value;
});

form.elements.projectName.addEventListener('input', () => {
  const quoteNumber = form.elements.id.value
    ? quotes.find(q => q.id === form.elements.id.value)?.quoteNumber
    : null;
  const generatedPrefix = quoteNumber
    ? `Phase Shift Studio Quote ${quoteNumber}`
    : 'Phase Shift Studio Quote ';
  if (!form.elements.emailSubject.value || form.elements.emailSubject.value.startsWith(generatedPrefix)) {
    form.elements.emailSubject.value = defaultEmailSubject({
      quoteNumber: quoteNumber || form.elements.emailSubject.value.match(/PSS-\d+/)?.[0] || nextQuoteNumber(),
      projectName: form.elements.projectName.value
    });
  }
});

function openQuote(id=null) {
  form.reset();
  lineItems.innerHTML = '';
  form.elements.id.value = '';

  document.getElementById('quote-form-title').textContent = id ? 'EDIT QUOTE' : 'NEW QUOTE';
  const base = id ? quotes.find(x => x.id === id) : null;
  if (id && !base) {
    alert('That quote could not be found. Refresh the page and try again.');
    return;
  }
  const q = base ? enrichQuote(base) : null;
  deleteBtn.hidden = !id || ['ACCEPTED', 'PAID', 'CANCELLED'].includes(q?.status);
  cancelBtn.hidden = !canCancelQuote(q);
  duplicateBtn.hidden = !id;
  updateStripeLinkState(q);

  if (id) {
    form.elements.id.value = q.id;
    form.elements.clientName.value = q.clientName || '';
    form.elements.contactName.value = q.contactName || '';
    form.elements.clientEmail.value = q.clientEmail || '';
    form.elements.clientPhone.value = q.clientPhone || '';
    form.elements.projectName.value = q.projectName || '';
    form.elements.status.value = q.status || 'DRAFT';
    form.elements.issueDate.value = q.issueDate || '';
    form.elements.expiryDate.value = q.expiryDate || '';
    form.elements.discount.value = q.discount || 0;
    form.elements.depositRate.value = q.depositRate ?? settings.depositRate;
    form.elements.stripeUrl.value = q.stripeUrl || '';
    form.elements.notes.value = q.notes || '';
    form.elements.terms.value = q.terms || settings.terms;
    form.elements.emailTo.value = q.clientEmail || '';
    form.elements.emailSubject.value = q.emailSubject || defaultEmailSubject(q);
    form.elements.emailMessage.value = q.emailMessage || defaultEmailMessage(q);
    updateEmailSendState(q.sentAt);
    setPaymentPlan(q.paymentPlan || 'one_time');
    q.items.forEach(addItem);
  } else {
    form.elements.issueDate.value = todayISO();
    form.elements.expiryDate.value = addDays(todayISO(), 30);
    form.elements.depositRate.value = settings.depositRate;
    form.elements.terms.value = settings.terms;
    const newNumber = nextQuoteNumber();
    form.elements.emailSubject.value = defaultEmailSubject({ quoteNumber: newNumber });
    form.elements.emailMessage.value = defaultEmailMessage({ quoteNumber: newNumber });
    updateEmailSendState(null);
    setPaymentPlan('one_time');
    addItem({
      description: 'Custom website design + development',
      qty: 1,
      rate: 1250,
      billingType: 'upfront'
    });
  }

  recalculate();
  dialog.showModal();
}

function defaultEmailSubject(q = {}) {
  const quoteNumber = q.quoteNumber || nextQuoteNumber();
  const project = (q.projectName || '').trim();
  return `Phase Shift Studio Quote ${quoteNumber}${project ? ` — ${project}` : ''}`;
}

function updateStripeLinkState(q = null) {
  if (!createStripeLinkBtn || !stripeLinkHelp) return;
  const blocked = q && ['CANCELLED', 'DECLINED', 'PAID'].includes(q.status);
  createStripeLinkBtn.disabled = Boolean(blocked);
  createStripeLinkBtn.textContent = q?.stripeUrl ? 'REFRESH LINK →' : 'CREATE LINK →';
  stripeLinkHelp.textContent = blocked
    ? 'Payment links cannot be created for cancelled, declined or fully paid quotes.'
    : 'Creates a secure AUD link automatically. Deposits are collected first; after payment is recorded, refresh the link to collect the remaining balance.';
}

function canCancelQuote(q) {
  if (!q || !['DRAFT', 'SENT'].includes(q.status)) return false;
  if (q.acceptedAt || q.paidAt) return false;
  if (Number(q.paidAmount || 0) > 0 || Number(q.totalPaid || 0) > 0) return false;
  return !(q.payments || []).length;
}

function collectItems() {
  return [...lineItems.querySelectorAll('.line-item')]
    .map(row => ({
      description: row.querySelector('.item-desc').value.trim(),
      billingType: row.querySelector('.item-billing')?.value === 'monthly' ? 'monthly' : 'upfront',
      qty: Number(row.querySelector('.item-qty').value || 0),
      rate: Number(row.querySelector('.item-rate').value || 0)
    }))
    .filter(i => i.description || i.rate);
}

function paymentPlanFromTotals(upfrontTotal, monthlyTotal) {
  if (monthlyTotal > 0 && upfrontTotal <= 0) return 'monthly';
  return 'one_time';
}

function totalsFrom(items, discount, gstRate, depositRate) {
  const upfrontSubtotal = items
    .filter(i => i.billingType !== 'monthly')
    .reduce((s,i) => s + (i.qty * i.rate), 0);
  const monthlySubtotal = items
    .filter(i => i.billingType === 'monthly')
    .reduce((s,i) => s + (i.qty * i.rate), 0);
  const disc = Math.min(Number(discount || 0), upfrontSubtotal);
  const upfrontTaxable = Math.max(0, upfrontSubtotal - disc);
  const gst = upfrontTaxable * (Number(gstRate || 0) / 100);
  const upfrontTotal = upfrontTaxable + gst;
  const monthlyTotal = monthlySubtotal;
  const deposit = upfrontTotal * (Number(depositRate || 0) / 100);
  const paymentPlan = paymentPlanFromTotals(upfrontTotal, monthlyTotal);

  return {
    subtotal: upfrontSubtotal,
    discount: disc,
    gst,
    total: upfrontTotal || monthlyTotal,
    upfrontSubtotal,
    upfrontTotal,
    monthlySubtotal,
    monthlyTotal,
    deposit,
    paymentPlan
  };
}

function recalculate() {
  const t = totalsFrom(
    collectItems(),
    form.elements.discount.value,
    0,
    form.elements.depositRate.value
  );

  form.elements.paymentPlan.value = t.paymentPlan;
  document.getElementById('calc-subtotal').textContent = money(t.upfrontSubtotal);
  document.getElementById('calc-discount').textContent = `-${money(t.discount)}`;
  document.getElementById('calc-total').textContent = money(t.upfrontTotal);
  document.getElementById('calc-deposit').textContent = money(t.deposit);
  document.getElementById('calc-monthly-total').textContent = `${money(t.monthlyTotal)} / MO`;

  [...lineItems.querySelectorAll('.line-item')].forEach(row => {
    row.querySelector('.item-total').textContent = money(
      Number(row.querySelector('.item-qty').value || 0) *
      Number(row.querySelector('.item-rate').value || 0)
    ) + (row.querySelector('.item-billing')?.value === 'monthly' ? ' / MO' : '');
  });
}

['discount','depositRate'].forEach(name =>
  form.elements[name].addEventListener('input', recalculate)
);

function formToQuote() {
  const fd = new FormData(form);
  const id = fd.get('id') || null;
  const existing = id ? quotes.find(q => q.id === id) : null;
  const items = collectItems();
  const totals = totalsFrom(
    items,
    fd.get('discount'),
    0,
    fd.get('depositRate')
  );
  const paymentPlan = totals.paymentPlan;

  return {
    id,
    quoteNumber: existing?.quoteNumber || nextQuoteNumber(),
    enquiryId: existing?.enquiryId || null,
    clientName: fd.get('clientName').trim(),
    contactName: fd.get('contactName').trim(),
    clientEmail: fd.get('clientEmail').trim(),
    clientPhone: fd.get('clientPhone').trim(),
    projectName: fd.get('projectName').trim(),
    status: fd.get('status'),
    paymentPlan,
    issueDate: fd.get('issueDate'),
    expiryDate: fd.get('expiryDate'),
    items,
    discount: Number(fd.get('discount') || 0),
    gstRate: 0,
    projectStatus: existing?.projectStatus || 'in_progress',
    depositRate: Number(fd.get('depositRate') || 0),
    stripeUrl: fd.get('stripeUrl').trim(),
    notes: fd.get('notes').trim(),
    terms: fd.get('terms').trim(),
    emailSubject: fd.get('emailSubject').trim(),
    emailMessage: fd.get('emailMessage').trim(),
    sentAt: existing?.sentAt || null,
    aiGenerated: existing?.aiGenerated || false,
    aiNotes: existing?.aiNotes || '',
    ...totals
  };
}

async function requestStripePaymentLink(quoteId, action = 'create') {
  const { data, error } = await db.functions.invoke('create-stripe-link', {
    body: { quoteId, action }
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Stripe could not create the payment link.');
  return data;
}

async function createStripePaymentLink() {
  if (!currentUser) {
    alert('You must be signed in to create a Stripe payment link.');
    return;
  }

  const quote = formToQuote();
  if (['CANCELLED', 'DECLINED', 'PAID'].includes(quote.status)) {
    alert('Payment links cannot be created for cancelled, declined or fully paid quotes.');
    return;
  }
  if (!quote.clientName || !quote.projectName || !quote.items.length) {
    alert('Add the client, project and at least one line item before creating the payment link.');
    return;
  }
  if (quote.total <= 0) {
    alert('The quote total must be greater than A$0.00.');
    return;
  }

  const oldText = createStripeLinkBtn.textContent;
  createStripeLinkBtn.disabled = true;
  createStripeLinkBtn.textContent = 'CREATING…';

  try {
    const savedId = await saveQuoteToDb(quote);
    const result = await requestStripePaymentLink(savedId);
    form.elements.id.value = savedId;
    form.elements.stripeUrl.value = result.url;
    await loadLiveData();
    updateStripeLinkState(quotes.find(item => item.id === savedId) || { stripeUrl: result.url });
    alert(`${result.label} link created for ${money(result.amount)} AUD.`);
  } catch (error) {
    console.error('Create Stripe link error:', error);
    alert(`Could not create the Stripe payment link.\n\n${error.message}`);
  } finally {
    createStripeLinkBtn.disabled = false;
    if (createStripeLinkBtn.textContent === 'CREATING…') createStripeLinkBtn.textContent = oldText;
  }
}

createStripeLinkBtn.addEventListener('click', createStripePaymentLink);

form.addEventListener('submit', async e => {
  e.preventDefault();
  const saveButton = form.querySelector('button[type="submit"]');
  const oldText = saveButton.innerHTML;
  saveButton.disabled = true;
  saveButton.innerHTML = 'SAVING…';

  try {
    await saveQuoteToDb(formToQuote());
    dialog.close();
    showView('quotes');
  } catch (error) {
    console.error(error);
    alert(`Could not save quote.\n\n${error.message}`);
  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = oldText;
  }
});

deleteBtn.onclick = async () => {
  const id = form.elements.id.value;
  if (!id) return;

  const quote = quotes.find(item => item.id === id);
  if (quote && ['ACCEPTED', 'PAID', 'CANCELLED'].includes(quote.status)) {
    alert('Accepted, paid and cancelled quotes are permanent business records and cannot be deleted.');
    return;
  }

  if (!confirm('Delete this quote permanently?')) return;

  try {
    await deleteQuoteFromDb(id);
    dialog.close();
  } catch (error) {
    alert(`Could not delete quote.\n\n${error.message}`);
  }
};

cancelBtn.onclick = async () => {
  const id = form.elements.id.value;
  const quote = quotes.find(item => item.id === id);

  if (!canCancelQuote(quote)) {
    alert('This quote cannot be cancelled because it has been accepted or has a payment recorded.');
    return;
  }

  if (!confirm('Cancel this quote? This will keep the quote for your records but prevent the client from accepting or paying it.')) return;

  try {
    const { data: current, error: readError } = await db
      .from('quotes')
      .select('status, accepted_at, paid_at, paid_amount')
      .eq('id', id)
      .single();

    if (readError) throw readError;

    const { count: paymentCount, error: paymentError } = await db
      .from('quote_payments')
      .select('id', { count: 'exact', head: true })
      .eq('quote_id', id);

    if (paymentError) throw paymentError;
    if (
      !['DRAFT', 'SENT'].includes(current.status) ||
      current.accepted_at ||
      current.paid_at ||
      Number(current.paid_amount || 0) > 0 ||
      Number(paymentCount || 0) > 0
    ) {
      throw new Error('The quote changed or a payment was recorded before cancellation.');
    }

    let update = db
      .from('quotes')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', current.status)
      .is('accepted_at', null)
      .is('paid_at', null);

    update = current.paid_amount == null
      ? update.is('paid_amount', null)
      : update.eq('paid_amount', 0);

    const { data, error } = await update
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('The quote changed or a payment was recorded before cancellation.');

    let stripeWarning = '';
    try {
      await requestStripePaymentLink(id, 'deactivate');
    } catch (stripeError) {
      console.error('Stripe link deactivation error:', stripeError);
      stripeWarning = '\n\nThe quote was cancelled, but Stripe could not confirm that its direct payment link was disabled. Check the link in Stripe before relying on the cancellation.';
    }

    await loadLiveData();
    dialog.close();
    showView('quotes');
    if (stripeWarning) alert(stripeWarning.trim());
  } catch (error) {
    console.error('Cancel quote error:', error);
    alert(`Could not cancel quote.\n\n${error.message}`);
  }
};


duplicateBtn.onclick = async () => {
  const source = formToQuote();
  if (!source.id) return;

  const duplicate = {
    ...source,
    id: null,
    quoteNumber: nextQuoteNumber(),
    status: 'DRAFT',
    issueDate: todayISO(),
    expiryDate: addDays(todayISO(), 30),
    stripeUrl: '',
    aiGenerated: false,
    aiNotes: ''
  };

  try {
    const newId = await saveQuoteToDb(duplicate);
    dialog.close();
    openQuote(newId);
  } catch (error) {
    console.error(error);
    alert(`Could not duplicate quote.\n\n${error.message}`);
  }
};


async function sendQuoteEmail() {
  if (!currentUser) {
    alert('You must be signed in to send a quote.');
    return;
  }

  const quote = formToQuote();
  if (quote.status === 'CANCELLED') {
    alert('Cancelled quotes cannot be sent.');
    return;
  }
  const to = (form.elements.emailTo.value || quote.clientEmail || '').trim();
  const subject = (form.elements.emailSubject.value || defaultEmailSubject(quote)).trim();
  const message = (form.elements.emailMessage.value || '').trim();

  if (!to) {
    alert('Enter a client email address before sending.');
    form.elements.emailTo.focus();
    return;
  }

  if (!message) {
    alert('Add a message to accompany the quote.');
    form.elements.emailMessage.focus();
    return;
  }

  const button = document.getElementById('send-quote-email-btn');
  const oldHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = 'SENDING…';

  try {
    const savedId = await saveQuoteToDb({
      ...quote,
      emailSubject: subject,
      emailMessage: message
    });

    let generatedStripeUrl = quote.stripeUrl;
    if (!generatedStripeUrl && quote.total > 0) {
      const link = await requestStripePaymentLink(savedId);
      generatedStripeUrl = link.url;
      form.elements.stripeUrl.value = generatedStripeUrl;
      await loadLiveData();
    }

    const savedBase = quotes.find(q => q.id === savedId);
    const savedQuote = {
      ...(savedBase ? enrichQuote(savedBase) : quote),
      stripeUrl: generatedStripeUrl || savedBase?.stripeUrl || ''
    };

    const { data, error } = await db.functions.invoke('send-quote', {
      body: {
        to,
        clientName: savedQuote.contactName || savedQuote.clientName || '',
        quoteNumber: savedQuote.quoteNumber,
        projectName: savedQuote.projectName,
        total: pricingLabel(savedQuote),
        paymentPlan: savedQuote.paymentPlan || 'one_time',
        subject,
        message,

        // V2.4: link the email to the public client quote page.
        acceptToken: savedQuote.acceptToken || '',
        quoteUrlBase: new URL('quote.html', window.location.href).href,

        // V2.3: full quote data is sent to the Edge Function so the PDF can
        // be generated server-side. No PDF library is loaded into the admin page.
        quote: {
          status: savedQuote.status || 'DRAFT',
          clientBusiness: savedQuote.clientName || '',
          clientContact: savedQuote.contactName || '',
          clientEmail: savedQuote.clientEmail || '',
          issueDate: savedQuote.issueDate || '',
          expiryDate: savedQuote.expiryDate || '',
          items: (savedQuote.items || []).map(item => ({
            description: item.description || '',
            billingType: item.billingType === 'monthly' ? 'monthly' : 'upfront',
            qty: Number(item.qty || 0),
            rate: Number(item.rate || 0),
            amount: Number(item.qty || 0) * Number(item.rate || 0)
          })),
          subtotal: Number(savedQuote.subtotal || 0),
          discount: Number(savedQuote.discount || 0),
          gstRate: Number(savedQuote.gstRate || 0),
          gst: Number(savedQuote.gst || 0),
          total: Number(savedQuote.total || 0),
          upfrontSubtotal: Number(savedQuote.upfrontSubtotal || 0),
          upfrontTotal: Number(savedQuote.upfrontTotal || 0),
          monthlySubtotal: Number(savedQuote.monthlySubtotal || 0),
          monthlyTotal: Number(savedQuote.monthlyTotal || 0),
          depositRate: Number(savedQuote.depositRate || 0),
          deposit: Number(savedQuote.deposit || 0),
          notes: savedQuote.notes || '',
          terms: savedQuote.terms || '',
          stripeUrl: savedQuote.stripeUrl || '',
          business: {
            name: settings.businessName || 'Phase Shift Studio',
            email: settings.email || '',
            abn: settings.abn || '',
            phone: settings.phone || '',
            address: settings.address || 'Queensland, Australia'
          }
        }
      }
    });

    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Email could not be sent.');

    const sentAt = new Date().toISOString();

    const { error: updateError } = await db
      .from('quotes')
      .update({
        status: 'SENT',
        email_subject: subject,
        email_message: message,
        sent_at: sentAt,
        updated_at: sentAt
      })
      .eq('id', savedId);

    if (updateError) throw updateError;

    await loadLiveData();

    form.elements.id.value = savedId;
    form.elements.status.value = 'SENT';
    updateEmailSendState(sentAt);

    alert(`Quote ${savedQuote.quoteNumber} was sent successfully to ${to}.`);
  } catch (error) {
    console.error('Send quote email error:', error);
    alert(`Could not send quote email.\n\n${error.message}`);
  } finally {
    button.disabled = false;
    button.innerHTML = oldHtml;
  }
}

document.getElementById('send-quote-email-btn').addEventListener('click', sendQuoteEmail);

// -------------------------
// DASHBOARD / LISTS
// -------------------------
function renderAll() {
  renderStats();
  renderRecent();
  renderQuotes();
  renderProjects();
  renderCustomers();
  fillSettings();
}

function renderStats() {
  const live = quotes.filter(q => !['DECLINED', 'CANCELLED'].includes(q.status));
  const sum = list => list.reduce((s,q) => s + Number(q.total || 0), 0);

  document.getElementById('stat-total').textContent = money(sum(live));
  document.getElementById('stat-pending').textContent =
    money(sum(quotes.filter(q => q.status === 'SENT')));
  document.getElementById('stat-accepted').textContent =
    money(sum(quotes.filter(q => ['ACCEPTED','PAID'].includes(q.status))));
  document.getElementById('stat-count').textContent = quotes.length;
}

function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[m]));
}

function pricingLabel(q) {
  const upfront = Number(q.upfrontTotal ?? (q.paymentPlan === 'monthly' ? 0 : q.total) ?? 0);
  const monthly = Number(q.monthlyTotal ?? (q.paymentPlan === 'monthly' ? q.total : 0) ?? 0);
  if (upfront > 0 && monthly > 0) return `${money(upfront)} + ${money(monthly)} / MO`;
  if (monthly > 0) return `${money(monthly)} / MO`;
  return money(upfront || q.total);
}

function planLabel(q) {
  const upfront = Number(q.upfrontTotal ?? (q.paymentPlan === 'monthly' ? 0 : q.total) ?? 0);
  const monthly = Number(q.monthlyTotal ?? (q.paymentPlan === 'monthly' ? q.total : 0) ?? 0);
  if (upfront > 0 && monthly > 0) return 'UPFRONT + MONTHLY';
  if (monthly > 0) return 'MONTHLY';
  return 'UPFRONT';
}

function quoteRow(q, includeDate=true) {
  const e = enrichQuote(q);

  return `<tr>
    <td><strong>${e.quoteNumber}</strong></td>
    <td>${escapeHtml(e.clientName || '—')}</td>
    <td>${escapeHtml(e.projectName)} <span class="plan-tag">${planLabel(e)}</span></td>
    ${includeDate ? `<td>${e.issueDate || '—'}</td>` : ''}
    <td><span class="status ${e.status}">${e.status}</span></td>
    <td><strong>${pricingLabel(e)}</strong></td>
    <td><button class="table-action" data-edit="${e.id}">OPEN →</button></td>
  </tr>`;
}

function renderRecent() {
  const body = document.getElementById('recent-body');
  const list = [...quotes]
    .sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0,5);

  body.innerHTML = list.length
    ? list.map(q => quoteRow(q, false)).join('')
    : '<tr class="empty-row"><td colspan="6">NO QUOTES YET — CREATE YOUR FIRST QUOTE.</td></tr>';
}

function renderQuotes() {
  const query = (document.getElementById('quote-search').value || '').toLowerCase();
  const status = document.getElementById('status-filter').value;

  const list = quotes.filter(q => {
    const e = enrichQuote(q);
    return (!status || e.status === status) &&
      [e.quoteNumber, e.clientName, e.projectName]
        .join(' ')
        .toLowerCase()
        .includes(query);
  });

  document.getElementById('quotes-body').innerHTML = list.length
    ? list.map(q => quoteRow(q, true)).join('')
    : '<tr class="empty-row"><td colspan="7">NO MATCHING QUOTES.</td></tr>';
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-edit]');
  if (!button) return;
  openQuote(button.dataset.edit);
});

document.getElementById('quote-search').addEventListener('input', renderQuotes);
document.getElementById('status-filter').addEventListener('change', renderQuotes);

function projectPaymentLabel(q) {
  if (Number(q.monthlyTotal || 0) > 0) return `${money(q.totalPaid)} PAID TO DATE`;
  if (q.totalPaid > 0) return `${money(q.totalPaid)} RECEIVED`;
  if (q.deposit > 0) return `${money(q.deposit)} DEPOSIT`;
  return pricingLabel(q);
}

function projectDetailRow(q) {
  const e = enrichQuote(q);
  const items = e.items.length
    ? `<ul>${e.items.map(item => `<li><span>${escapeHtml(item.description || 'Line item')}</span><strong>${item.qty} × ${money(item.rate)}</strong></li>`).join('')}</ul>`
    : '<p>No line-item job description was supplied.</p>';

  const paymentHistory = e.payments.length
    ? `<ul>${e.payments.map(payment => `<li><span>${new Date(payment.paid_at).toLocaleDateString('en-AU')} · ${escapeHtml(payment.event_type === 'invoice.paid' ? 'Stripe invoice' : 'Stripe payment')}</span><strong>${money(payment.amount)}</strong></li>`).join('')}</ul>`
    : '<p>No individual payment records yet.</p>';

  return `<tr class="project-detail" data-project-detail="${e.id}" hidden><td colspan="6">
    <div class="project-detail-grid">
      <section><span>JOB DESCRIPTION</span>${items}${e.notes ? `<p class="project-notes">${escapeHtml(e.notes)}</p>` : ''}</section>
      <section><span>CONTACT DETAILS</span><p><strong>${escapeHtml(e.contactName || e.clientName || '—')}</strong><br>${escapeHtml(e.clientEmail || 'No email')}<br>${escapeHtml(e.clientPhone || 'No phone')}</p></section>
      <section><span>PAYMENT DETAILS</span><p>Upfront total: <strong>${money(e.upfrontTotal || 0)}</strong><br>Monthly total: <strong>${money(e.monthlyTotal || 0)} / month</strong><br>Deposit quoted: <strong>${money(e.deposit || 0)}</strong><br>Total paid so far: <strong>${money(e.totalPaid || e.paidAmount || 0)}</strong><br>Payments received: <strong>${e.payments.length}</strong>${e.payments[0]?.paid_at || e.paidAt ? `<br>Latest payment: ${new Date(e.payments[0]?.paid_at || e.paidAt).toLocaleDateString('en-AU')}` : ''}</p><span>PAYMENT HISTORY</span>${paymentHistory}</section>
      <section class="project-edit-section"><span>PROJECT LINKS & NOTES</span><label>CODE LINK<input type="url" data-project-code value="${escapeAttr(e.codeLink)}" placeholder="https://github.com/..."></label><label>WEBSITE LINK<input type="url" data-project-website value="${escapeAttr(e.websiteLink)}" placeholder="https://..."></label><label>INTERNAL NOTES<textarea data-project-notes rows="4" placeholder="Project notes…">${escapeHtml(e.projectNotes)}</textarea></label><button class="project-save" type="button" data-save-project="${e.id}">SAVE PROJECT DETAILS</button></section>
    </div>
  </td></tr>`;
}

function renderProjects() {
  const body = document.getElementById('projects-body');
  if (!body) return;
  const list = quotes.filter(q => q.status === 'PAID')
    .filter(q => projectFilter === 'all' || (projectFilter === 'monthly' ? Number(q.monthlyTotal || 0) > 0 : Number(q.upfrontTotal || q.total || 0) > 0))
    .filter(q => projectStageFilter === 'all' || q.projectStatus === projectStageFilter)
    .sort((a,b) => (b.paidAt || b.updatedAt || '').localeCompare(a.paidAt || a.updatedAt || ''));

  body.innerHTML = list.length ? list.map(q => {
    const e = enrichQuote(q);
    return `<tr><td><strong>${escapeHtml(e.projectName || 'Untitled project')}</strong><br><small>${escapeHtml(e.quoteNumber)}</small></td><td>${escapeHtml(e.clientName || '—')}</td><td><span class="plan-tag">${planLabel(e)}</span></td><td><strong>${projectPaymentLabel(e)}</strong></td><td><select class="project-stage stage-${e.projectStatus}" data-project-stage="${e.id}" aria-label="Project status for ${escapeAttr(e.projectName)}"><option value="in_progress"${e.projectStatus === 'in_progress' ? ' selected' : ''}>IN PROGRESS</option><option value="built"${e.projectStatus === 'built' ? ' selected' : ''}>BUILT</option><option value="ongoing"${e.projectStatus === 'ongoing' ? ' selected' : ''}>ON GOING</option><option value="posted"${e.projectStatus === 'posted' ? ' selected' : ''}>POSTED</option></select></td><td><button class="table-action" data-toggle-project="${e.id}" aria-expanded="false">OPEN →</button></td></tr>${projectDetailRow(e)}`;
  }).join('') : '<tr class="empty-row"><td colspan="6">NO PAID PROJECTS IN THIS VIEW.</td></tr>';

  document.querySelectorAll('[data-toggle-project]').forEach(btn => btn.addEventListener('click', () => {
    const detail = document.querySelector(`[data-project-detail="${btn.dataset.toggleProject}"]`);
    const opening = detail.hidden;
    detail.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
    btn.textContent = opening ? 'CLOSE ↑' : 'OPEN →';
  }));

  document.querySelectorAll('[data-project-stage]').forEach(select => select.addEventListener('change', async () => {
    const previous = quotes.find(q => q.id === select.dataset.projectStage)?.projectStatus || 'in_progress';
    const next = select.value;
    select.disabled = true;
    try {
      const { error } = await db.from('quotes').update({ project_status: next, updated_at: new Date().toISOString() }).eq('id', select.dataset.projectStage);
      if (error) throw error;
      const quote = quotes.find(q => q.id === select.dataset.projectStage);
      if (quote) quote.projectStatus = next;
      renderProjects();
    } catch (error) {
      select.value = previous;
      select.disabled = false;
      alert(`Could not update project status.\n\n${error.message}`);
    }
  }));

  document.querySelectorAll('[data-save-project]').forEach(button => button.addEventListener('click', async () => {
    const detail = button.closest('.project-detail');
    const payload = {
      code_link: detail.querySelector('[data-project-code]').value.trim() || null,
      website_link: detail.querySelector('[data-project-website]').value.trim() || null,
      project_notes: detail.querySelector('[data-project-notes]').value.trim() || null,
      updated_at: new Date().toISOString()
    };
    button.disabled = true;
    button.textContent = 'SAVING…';
    try {
      const { error } = await db.from('quotes').update(payload).eq('id', button.dataset.saveProject);
      if (error) throw error;
      const quote = quotes.find(q => q.id === button.dataset.saveProject);
      if (quote) {
        quote.codeLink = payload.code_link || '';
        quote.websiteLink = payload.website_link || '';
        quote.projectNotes = payload.project_notes || '';
      }
      button.textContent = 'SAVED';
      setTimeout(() => { button.disabled = false; button.textContent = 'SAVE PROJECT DETAILS'; }, 1200);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'SAVE PROJECT DETAILS';
      alert(`Could not save project details.\n\n${error.message}`);
    }
  }));
}

document.querySelectorAll('[data-project-filter]').forEach(btn => btn.addEventListener('click', () => {
  projectFilter = btn.dataset.projectFilter;
  document.querySelectorAll('[data-project-filter]').forEach(filterBtn => filterBtn.classList.toggle('active', filterBtn === btn));
  renderProjects();
}));

document.querySelectorAll('[data-stage-filter]').forEach(btn => btn.addEventListener('click', () => {
  projectStageFilter = btn.dataset.stageFilter;
  document.querySelectorAll('[data-stage-filter]').forEach(filterBtn => filterBtn.classList.toggle('active', filterBtn === btn));
  renderProjects();
}));

function renderCustomers() {
  document.getElementById('customer-grid').innerHTML = customers.length
    ? customers.map(c => {
        const related = quotes.filter(q => q.customerId === c.id);
        const total = related.reduce((s,q) => s + Number(q.total || 0), 0);

        return `<article class="customer-card">
          <span>${related.length} QUOTE${related.length === 1 ? '' : 'S'}</span>
          <h3>${escapeHtml(c.business_name)}</h3>
          <p>
            ${escapeHtml(c.contact_name || '')}${c.contact_name ? '<br>' : ''}
            ${escapeHtml(c.email || 'No email')}<br>
            ${escapeHtml(c.phone || 'No phone')}<br>
            <strong>${money(total)}</strong> quoted
          </p>
          <div class="customer-card-actions">
            <button class="customer-delete" type="button" data-delete-customer="${c.id}">DELETE CUSTOMER</button>
          </div>
        </article>`;
      }).join('')
    : '<p>No customers yet.</p>';

  document.querySelectorAll('[data-delete-customer]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await deleteCustomerFromDb(btn.dataset.deleteCustomer);
      } catch (error) {
        alert(`Could not delete customer.\n\n${error.message}`);
      }
    });
  });
}

// -------------------------
// SETTINGS
// -------------------------
function fillSettings() {
  for (const [k,v] of Object.entries(settings)) {
    if (settingsForm.elements[k]) settingsForm.elements[k].value = v ?? '';
  }
}

settingsForm.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(settingsForm);
  settings = Object.fromEntries(fd.entries());
  settings.gstRate = 0;
  settings.depositRate = Number(settings.depositRate);
  saveSettingsLocal();

  const status = document.getElementById('settings-status');
  status.textContent = 'SETTINGS SAVED.';
  setTimeout(() => status.textContent = '', 1800);
});

// -------------------------
// QUOTE PREVIEW / PDF / STRIPE LINK
// -------------------------
const previewDialog = document.getElementById('preview-dialog');

function buildQuoteHtml(raw) {
  const q = raw.id ? enrichQuote(raw) : raw;
  const upfrontItems = (q.items || []).filter(i => i.billingType !== 'monthly');
  const monthlyItems = (q.items || []).filter(i => i.billingType === 'monthly');
  const hasUpfront = Number(q.upfrontTotal || 0) > 0 || upfrontItems.length > 0;
  const hasMonthly = Number(q.monthlyTotal || 0) > 0 || monthlyItems.length > 0;

  const payment = q.stripeUrl
    ? `<div class="payment-box"><strong>PAYMENT</strong><br>A secure Stripe payment link has been supplied with this quote.</div>`
    : '';

  return `
    <section class="print-sheet">
      <header class="print-head">
        <div class="print-brand">
          <span class="brand-mark">P/S</span>
          <div><strong>${escapeHtml(settings.businessName)}</strong><br><small>DESIGN // BUILD // LAUNCH</small></div>
        </div>
        <div class="print-meta">
          ${escapeHtml(settings.email)}<br>
          ${escapeHtml(settings.phone || '')}<br>
          ${settings.abn ? `ABN ${escapeHtml(settings.abn)}<br>` : ''}
          ${escapeHtml(settings.address || '')}
        </div>
      </header>

      <div class="quote-title">
        <div>
          <span class="section-label">[ ${hasUpfront && hasMonthly ? 'UPFRONT + MONTHLY QUOTE' : hasMonthly ? 'MONTHLY QUOTE' : 'QUOTE'} ]</span>
          <h2>${q.quoteNumber}</h2>
          <p>${escapeHtml(q.projectName)}</p>
        </div>
        <div>
          <p><strong>PREPARED FOR</strong><br>
          ${escapeHtml(q.clientName)}
          ${q.contactName ? `<br>${escapeHtml(q.contactName)}` : ''}
          ${q.clientEmail ? `<br>${escapeHtml(q.clientEmail)}` : ''}</p>
          <p><strong>ISSUED</strong> ${q.issueDate || '—'}<br>
          <strong>VALID UNTIL</strong> ${q.expiryDate || '—'}<br>
          <strong>PRICING</strong> ${planLabel(q)}</p>
        </div>
      </div>

      <table class="print-table">
        <thead><tr><th>DESCRIPTION</th><th>TYPE</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr></thead>
        <tbody>
          ${q.items.map(i => `
            <tr>
              <td>${escapeHtml(i.description)}</td>
              <td>${i.billingType === 'monthly' ? 'MONTHLY' : 'UPFRONT'}</td>
              <td>${i.qty}</td>
              <td>${money(i.rate)}${i.billingType === 'monthly' ? ' / month' : ''}</td>
              <td>${money(i.qty * i.rate)}${i.billingType === 'monthly' ? ' / month' : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>

      <div class="print-totals">
        ${hasUpfront ? `<div><span>Upfront subtotal</span><strong>${money(q.upfrontSubtotal ?? q.subtotal)}</strong></div>` : ''}
        ${q.discount ? `<div><span>Discount</span><strong>-${money(q.discount)}</strong></div>` : ''}
        ${q.gstRate ? `<div><span>GST (${q.gstRate}%)</span><strong>${money(q.gst)}</strong></div>` : ''}
        ${hasUpfront ? `<div class="total"><span>UPFRONT TOTAL</span><strong>${money(q.upfrontTotal ?? q.total)}</strong></div><div><span>Deposit (${q.depositRate}%)</span><strong>${money(q.deposit)}</strong></div>` : ''}
        ${hasMonthly ? `<div class="total monthly-print-total"><span>MONTHLY TOTAL</span><strong>${money(q.monthlyTotal || 0)} / month</strong></div>` : ''}
      </div>

      ${payment}

      <div class="print-notes">
        <div><h4>PROJECT NOTES</h4><p>${escapeHtml(q.notes || 'As outlined in the agreed project scope.')}</p></div>
        <div><h4>TERMS</h4><p>${escapeHtml(q.terms || settings.terms)}</p></div>
      </div>
    </section>`;
}

function previewQuote(raw) {
  const q = raw.id ? enrichQuote(raw) : raw;
  document.getElementById('quote-preview').innerHTML = buildQuoteHtml(q);

  const stripeBtn = document.getElementById('stripe-btn');
  stripeBtn.hidden = !q.stripeUrl;
  stripeBtn.href = q.stripeUrl || '#';
  previewDialog.dataset.currentQuoteId = q.id || '';
  previewDialog.showModal();
}

document.getElementById('preview-quote-btn').onclick = () => {
  previewQuote(formToQuote());
};

document.getElementById('close-preview').onclick = () => previewDialog.close();

document.getElementById('print-btn').onclick = () => {
  const quoteMarkup = document.getElementById('quote-preview').innerHTML;
  const printWindow = window.open('', '_blank', 'width=1000,height=800');

  if (!printWindow) {
    alert('Your browser blocked the PDF window. Allow pop-ups for this admin page and try again.');
    return;
  }

  const printCss = `
    *{box-sizing:border-box}
    body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}
    .print-sheet{max-width:900px;margin:0 auto;background:#fff;color:#111;padding:38px}
    .print-head{display:flex;justify-content:space-between;border-bottom:3px solid #111;padding-bottom:24px}
    .print-brand{display:flex;gap:12px;align-items:center}.brand-mark{display:grid;place-items:center;width:44px;height:44px;background:#e31b23;color:#fff;font-weight:900}
    .print-meta{text-align:right;font:10px/1.65 monospace}.section-label{font:10px monospace;color:#e31b23;letter-spacing:.08em}
    .quote-title{display:grid;grid-template-columns:1fr 1fr;gap:30px;padding:36px 0}.quote-title h2{font-size:48px;letter-spacing:-.06em;margin:0}.quote-title p{margin:6px 0;font-size:12px}
    .print-table{width:100%;border-collapse:collapse}.print-table th,.print-table td{padding:13px 8px;border-bottom:1px solid #ddd}.print-table th{font:9px monospace;text-align:left}
    .print-table td:nth-child(n+2),.print-table th:nth-child(n+2){text-align:right}
    .print-totals{width:420px;max-width:100%;margin:28px 0 0 auto}.print-totals div{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #ddd;font-size:12px}
    .print-totals .total{font-size:20px;font-weight:900;border-bottom:2px solid #111}
    .print-notes{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:42px;border-top:1px solid #111;padding-top:25px}.print-notes h4{font:9px monospace;color:#e31b23}.print-notes p{white-space:pre-wrap;font-size:11px;line-height:1.55}
    .payment-box{margin-top:28px;padding:18px;background:#f7f7f4;border-left:5px solid #e31b23;font-size:12px}
    @page{size:A4;margin:12mm}
    @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.print-sheet{padding:0;max-width:none}}
  `;

  printWindow.document.open();
  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Phase Shift Studio Quote</title>
  <style>${printCss}</style>
</head>
<body>
  ${quoteMarkup}
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.focus();
        window.print();
      }, 400);
    });
  <\/script>
</body>
</html>`);
  printWindow.document.close();
};

boot();
