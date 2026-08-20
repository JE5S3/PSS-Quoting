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

const money = n => new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD'
}).format(Number(n || 0));

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

let quotes = [];
let customers = [];
let currentUser = null;

const authScreen = document.getElementById('auth-screen');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const signoutBtn = document.getElementById('signout-btn');

const dialog = document.getElementById('quote-dialog');
const form = document.getElementById('quote-form');
const lineItems = document.getElementById('line-items');
const deleteBtn = document.getElementById('delete-quote-btn');
const settingsForm = document.getElementById('settings-form');

let settings = loadSettings();

function loadSettings() {
  const defaults = {
    businessName: 'Phase Shift Studio',
    email: 'hello@phaseshiftstudio.com',
    abn: '',
    phone: '',
    address: 'Queensland, Australia',
    gstRate: 10,
    depositRate: 50,
    terms: 'Quote valid for 14 days. Work commences once the agreed deposit has been received. Final balance is due on completion unless otherwise agreed in writing.'
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
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
    const [quotesResult, customersResult] = await Promise.all([
      db
        .from('quotes')
        .select('*, quote_items(*)')
        .order('created_at', { ascending: false }),
      db
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })
    ]);

    if (quotesResult.error) throw quotesResult.error;
    if (customersResult.error) throw customersResult.error;

    quotes = (quotesResult.data || []).map(fromDbQuote);
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
  return {
    id: q.id,
    quoteNumber: q.quote_number,
    customerId: q.customer_id,
    enquiryId: q.enquiry_id,
    clientName: q.customers?.business_name || '',
    contactName: '',
    clientEmail: '',
    clientPhone: '',
    projectName: q.project_name,
    status: q.status,
    issueDate: q.issue_date || '',
    expiryDate: q.expiry_date || '',
    items: (q.quote_items || [])
      .sort((a,b) => a.sort_order - b.sort_order)
      .map(i => ({
        id: i.id,
        description: i.description,
        qty: Number(i.quantity),
        rate: Number(i.rate)
      })),
    subtotal: Number(q.subtotal),
    discount: Number(q.discount),
    gstRate: Number(q.gst_rate),
    gst: Number(q.gst_amount),
    total: Number(q.total),
    depositRate: Number(q.deposit_rate),
    deposit: Number(q.deposit_amount),
    stripeUrl: q.stripe_payment_url || '',
    notes: q.notes || '',
    terms: q.terms || '',
    aiGenerated: q.ai_generated,
    aiNotes: q.ai_notes || '',
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
    clientName: c?.business_name || q.clientName || '',
    contactName: c?.contact_name || '',
    clientEmail: c?.email || '',
    clientPhone: c?.phone || ''
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
    project_name: quote.projectName,
    status: quote.status,
    issue_date: quote.issueDate || null,
    expiry_date: quote.expiryDate || null,
    subtotal: quote.subtotal,
    discount: quote.discount,
    gst_rate: quote.gstRate,
    gst_amount: quote.gst,
    total: quote.total,
    deposit_rate: quote.depositRate,
    deposit_amount: quote.deposit,
    stripe_payment_url: quote.stripeUrl || null,
    notes: quote.notes || null,
    terms: quote.terms || null,
    ai_generated: Boolean(quote.aiGenerated),
    ai_notes: quote.aiNotes || null,
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

function escapeAttr(s='') {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

function makeItemRow(item={description:'', qty:1, rate:0}) {
  const row = document.createElement('div');
  row.className = 'line-item';
  row.innerHTML = `
    <label>DESCRIPTION<input class="item-desc" value="${escapeAttr(item.description)}" placeholder="Website design"></label>
    <label>QTY<input class="item-qty" type="number" min="0" step="0.01" value="${item.qty ?? 1}"></label>
    <label>RATE<input class="item-rate" type="number" min="0" step="0.01" value="${item.rate ?? 0}"></label>
    <div class="item-total">${money((item.qty||0)*(item.rate||0))}</div>
    <button type="button" class="remove-item" aria-label="Remove item">×</button>`;

  row.querySelectorAll('input').forEach(i =>
    i.addEventListener('input', recalculate)
  );

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

function openQuote(id=null) {
  form.reset();
  lineItems.innerHTML = '';
  form.elements.id.value = '';

  document.getElementById('quote-form-title').textContent = id ? 'EDIT QUOTE' : 'NEW QUOTE';
  deleteBtn.hidden = !id;

  if (id) {
    const base = quotes.find(x => x.id === id);
    if (!base) return;

    const q = enrichQuote(base);
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
    form.elements.gstRate.value = q.gstRate ?? settings.gstRate;
    form.elements.depositRate.value = q.depositRate ?? settings.depositRate;
    form.elements.stripeUrl.value = q.stripeUrl || '';
    form.elements.notes.value = q.notes || '';
    form.elements.terms.value = q.terms || settings.terms;
    q.items.forEach(addItem);
  } else {
    form.elements.issueDate.value = todayISO();
    form.elements.expiryDate.value = addDays(todayISO(), 14);
    form.elements.gstRate.value = settings.gstRate;
    form.elements.depositRate.value = settings.depositRate;
    form.elements.terms.value = settings.terms;
    addItem({
      description: 'Custom website design + development',
      qty: 1,
      rate: 1250
    });
  }

  recalculate();
  dialog.showModal();
}

function collectItems() {
  return [...lineItems.querySelectorAll('.line-item')]
    .map(row => ({
      description: row.querySelector('.item-desc').value.trim(),
      qty: Number(row.querySelector('.item-qty').value || 0),
      rate: Number(row.querySelector('.item-rate').value || 0)
    }))
    .filter(i => i.description || i.rate);
}

function totalsFrom(items, discount, gstRate, depositRate) {
  const subtotal = items.reduce((s,i) => s + (i.qty * i.rate), 0);
  const disc = Math.min(Number(discount || 0), subtotal);
  const taxable = Math.max(0, subtotal - disc);
  const gst = taxable * (Number(gstRate || 0) / 100);
  const total = taxable + gst;
  const deposit = total * (Number(depositRate || 0) / 100);
  return { subtotal, discount: disc, gst, total, deposit };
}

function recalculate() {
  const t = totalsFrom(
    collectItems(),
    form.elements.discount.value,
    form.elements.gstRate.value,
    form.elements.depositRate.value
  );

  document.getElementById('calc-subtotal').textContent = money(t.subtotal);
  document.getElementById('calc-discount').textContent = `-${money(t.discount)}`;
  document.getElementById('calc-gst').textContent = money(t.gst);
  document.getElementById('calc-total').textContent = money(t.total);
  document.getElementById('calc-deposit').textContent = money(t.deposit);

  [...lineItems.querySelectorAll('.line-item')].forEach(row => {
    row.querySelector('.item-total').textContent = money(
      Number(row.querySelector('.item-qty').value || 0) *
      Number(row.querySelector('.item-rate').value || 0)
    );
  });
}

['discount','gstRate','depositRate'].forEach(name =>
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
    fd.get('gstRate'),
    fd.get('depositRate')
  );

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
    issueDate: fd.get('issueDate'),
    expiryDate: fd.get('expiryDate'),
    items,
    discount: Number(fd.get('discount') || 0),
    gstRate: Number(fd.get('gstRate') || 0),
    depositRate: Number(fd.get('depositRate') || 0),
    stripeUrl: fd.get('stripeUrl').trim(),
    notes: fd.get('notes').trim(),
    terms: fd.get('terms').trim(),
    aiGenerated: existing?.aiGenerated || false,
    aiNotes: existing?.aiNotes || '',
    ...totals
  };
}

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

  if (!confirm('Delete this quote permanently?')) return;

  try {
    await deleteQuoteFromDb(id);
    dialog.close();
  } catch (error) {
    alert(`Could not delete quote.\n\n${error.message}`);
  }
};

// -------------------------
// DASHBOARD / LISTS
// -------------------------
function renderAll() {
  renderStats();
  renderRecent();
  renderQuotes();
  renderCustomers();
  fillSettings();
}

function renderStats() {
  const live = quotes.filter(q => q.status !== 'DECLINED');
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

function quoteRow(q, includeDate=true) {
  const e = enrichQuote(q);

  return `<tr>
    <td><strong>${e.quoteNumber}</strong></td>
    <td>${escapeHtml(e.clientName || '—')}</td>
    <td>${escapeHtml(e.projectName)}</td>
    ${includeDate ? `<td>${e.issueDate || '—'}</td>` : ''}
    <td><span class="status ${e.status}">${e.status}</span></td>
    <td><strong>${money(e.total)}</strong></td>
    <td><button class="table-action" data-edit="${e.id}">OPEN →</button></td>
  </tr>`;
}

function hookEditButtons() {
  document.querySelectorAll('[data-edit]').forEach(
    b => b.onclick = () => openQuote(b.dataset.edit)
  );
}

function renderRecent() {
  const body = document.getElementById('recent-body');
  const list = [...quotes]
    .sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0,5);

  body.innerHTML = list.length
    ? list.map(q => quoteRow(q, false)).join('')
    : '<tr class="empty-row"><td colspan="6">NO QUOTES YET — CREATE YOUR FIRST QUOTE.</td></tr>';

  hookEditButtons();
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

  hookEditButtons();
}

document.getElementById('quote-search').addEventListener('input', renderQuotes);
document.getElementById('status-filter').addEventListener('change', renderQuotes);

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
        </article>`;
      }).join('')
    : '<p>No customers yet.</p>';
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
  settings.gstRate = Number(settings.gstRate);
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

function previewQuote(raw) {
  const q = raw.id ? enrichQuote(raw) : raw;

  const payment = q.stripeUrl
    ? `<div class="payment-box"><strong>PAYMENT</strong><br>A secure Stripe payment link has been supplied with this quote.</div>`
    : '';

  document.getElementById('quote-preview').innerHTML = `
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
          <span class="section-label">[ QUOTE ]</span>
          <h2>${q.quoteNumber}</h2>
          <p>${escapeHtml(q.projectName)}</p>
        </div>
        <div>
          <p><strong>PREPARED FOR</strong><br>
          ${escapeHtml(q.clientName)}
          ${q.contactName ? `<br>${escapeHtml(q.contactName)}` : ''}
          ${q.clientEmail ? `<br>${escapeHtml(q.clientEmail)}` : ''}</p>
          <p><strong>ISSUED</strong> ${q.issueDate || '—'}<br>
          <strong>VALID UNTIL</strong> ${q.expiryDate || '—'}</p>
        </div>
      </div>

      <table class="print-table">
        <thead><tr><th>DESCRIPTION</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr></thead>
        <tbody>
          ${q.items.map(i => `
            <tr>
              <td>${escapeHtml(i.description)}</td>
              <td>${i.qty}</td>
              <td>${money(i.rate)}</td>
              <td>${money(i.qty * i.rate)}</td>
            </tr>`).join('')}
        </tbody>
      </table>

      <div class="print-totals">
        <div><span>Subtotal</span><strong>${money(q.subtotal)}</strong></div>
        ${q.discount ? `<div><span>Discount</span><strong>-${money(q.discount)}</strong></div>` : ''}
        <div><span>GST (${q.gstRate}%)</span><strong>${money(q.gst)}</strong></div>
        <div class="total"><span>TOTAL</span><strong>${money(q.total)}</strong></div>
        <div><span>Deposit (${q.depositRate}%)</span><strong>${money(q.deposit)}</strong></div>
      </div>

      ${payment}

      <div class="print-notes">
        <div><h4>PROJECT NOTES</h4><p>${escapeHtml(q.notes || 'As outlined in the agreed project scope.')}</p></div>
        <div><h4>TERMS</h4><p>${escapeHtml(q.terms || settings.terms)}</p></div>
      </div>
    </section>`;

  const stripeBtn = document.getElementById('stripe-btn');
  stripeBtn.hidden = !q.stripeUrl;
  stripeBtn.href = q.stripeUrl || '#';
  previewDialog.showModal();
}

document.getElementById('preview-quote-btn').onclick = () => {
  const draft = formToQuote();
  previewQuote(draft);
};

document.getElementById('close-preview').onclick = () => previewDialog.close();
document.getElementById('print-btn').onclick = () => window.print();

boot();
