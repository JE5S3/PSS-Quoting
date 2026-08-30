const SUPABASE_URL = 'https://txvorfcyvxwmwpkctndg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wVhxl7xaz5GGeK5-mryMkw_hPDA904U';

const money = n => `A$${Number(n || 0).toLocaleString('en-AU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;

const params = new URLSearchParams(location.search);
const token = params.get('token') || '';

const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const quoteView = document.getElementById('quote-view');
let currentQuote = null;

function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[m]));
}

async function callQuoteClient(action, extra={}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/quote-client`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY
    },
    body: JSON.stringify({ action, token, ...extra })
  });

  let data = null;
  try { data = await response.json(); } catch {}

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Quote service returned ${response.status}`);
  }

  return data;
}

function showError(message) {
  loadingState.classList.add('hidden');
  quoteView.classList.add('hidden');
  errorState.classList.remove('hidden');
  document.getElementById('error-message').textContent = message;
}

function renderQuote(q) {
  currentQuote = q;
  loadingState.classList.add('hidden');
  errorState.classList.add('hidden');
  quoteView.classList.remove('hidden');

  document.getElementById('quote-type').textContent =
    q.paymentPlan === 'monthly' ? '[ MONTHLY QUOTE ]' : '[ QUOTE ]';

  document.getElementById('quote-number').textContent = q.quoteNumber;
  document.getElementById('project-name').textContent = q.projectName || '';
  document.getElementById('client-business').textContent = q.clientBusiness || '';
  document.getElementById('client-contact').textContent = q.clientContact || '';
  document.getElementById('client-email').textContent = q.clientEmail || '';
  document.getElementById('issue-date').textContent = `ISSUED ${q.issueDate || '—'}`;
  document.getElementById('expiry-date').textContent = `VALID UNTIL ${q.expiryDate || '—'}`;
  document.getElementById('payment-plan').textContent =
    `PAYMENT PLAN ${q.paymentPlan === 'monthly' ? 'MONTHLY' : 'SINGLE PAYMENT'}`;

  const business = q.business || {};
  document.getElementById('business-meta').innerHTML = [
    escapeHtml(business.email || ''),
    business.abn ? `ABN ${escapeHtml(business.abn)}` : '',
    escapeHtml(business.address || '')
  ].filter(Boolean).join('<br>');

  const unit = q.paymentPlan === 'monthly' ? ' / month' : '';
  document.getElementById('quote-items').innerHTML = (q.items || []).map(item => `
    <tr>
      <td>${escapeHtml(item.description || '')}</td>
      <td>${Number(item.qty || 0)}</td>
      <td>${money(item.rate)}${unit}</td>
      <td>${money(item.amount)}${unit}</td>
    </tr>
  `).join('');

  const rows = [
    ['Subtotal', money(q.subtotal)],
    q.discount ? ['Discount', `-${money(q.discount)}`] : null,
    q.gstRate ? [`GST (${q.gstRate}%)`, money(q.gst)] : null,
    [q.paymentPlan === 'monthly' ? 'MONTHLY TOTAL' : 'TOTAL', money(q.total) + unit, true],
    q.paymentPlan !== 'monthly' && q.depositRate
      ? [`Deposit (${q.depositRate}%)`, money(q.deposit)]
      : null
  ].filter(Boolean);

  document.getElementById('quote-totals').innerHTML = rows.map(([label,value,grand]) => `
    <div class="total-row${grand ? ' grand' : ''}">
      <span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');

  document.getElementById('quote-notes').textContent =
    q.notes || 'As outlined in the agreed project scope.';
  document.getElementById('quote-terms').textContent = q.terms || '';

  renderStatus(q);
}

function renderStatus(q) {
  document.getElementById('awaiting-response').classList.add('hidden');
  document.getElementById('accepted-state').classList.add('hidden');
  document.getElementById('declined-state').classList.add('hidden');
  document.getElementById('expired-state').classList.add('hidden');
  document.getElementById('cancelled-state').classList.add('hidden');

  if (q.status === 'CANCELLED') {
    document.getElementById('cancelled-state').classList.remove('hidden');
    return;
  }

  if (q.expired && !['ACCEPTED','PAID'].includes(q.status)) {
    document.getElementById('expired-state').classList.remove('hidden');
    return;
  }

  if (['ACCEPTED','PAID'].includes(q.status)) {
    document.getElementById('accepted-state').classList.remove('hidden');

    const acceptedText = q.status === 'PAID'
      ? 'This quote has been accepted and payment has been recorded.'
      : `Accepted${q.acceptedBy ? ` by ${q.acceptedBy}` : ''}${q.acceptedAt ? ` on ${new Date(q.acceptedAt).toLocaleString('en-AU')}` : ''}.`;

    document.getElementById('accepted-copy').textContent = acceptedText;

    const stripeBtn = document.getElementById('stripe-payment-btn');
    const invoiceBtn = document.getElementById('stripe-invoice-btn');
    const note = document.getElementById('payment-note');

    invoiceBtn.classList.add('hidden');
    if (q.status === 'PAID' && q.invoiceUrl) {
      invoiceBtn.href = q.invoiceUrl;
      invoiceBtn.classList.remove('hidden');
    }

    if (q.status !== 'PAID' && q.stripeUrl) {
      const paymentUrl = new URL(q.stripeUrl);
      paymentUrl.searchParams.set('client_reference_id', q.quoteNumber);
      stripeBtn.href = paymentUrl.toString();
      stripeBtn.textContent =
        q.paymentPlan === 'monthly'
          ? 'START MONTHLY PAYMENT ↗'
          : q.deposit > 0
            ? `PAY DEPOSIT ${money(q.deposit)} ↗`
            : 'PAY NOW ↗';
      stripeBtn.classList.remove('hidden');
      note.classList.add('hidden');
    } else if (q.status !== 'PAID') {
      stripeBtn.classList.add('hidden');
      note.classList.remove('hidden');
    } else {
      stripeBtn.classList.add('hidden');
      note.classList.add('hidden');
    }
    return;
  }

  if (q.status === 'DECLINED') {
    document.getElementById('declined-state').classList.remove('hidden');
    return;
  }

  document.getElementById('awaiting-response').classList.remove('hidden');
}

document.getElementById('show-decline-btn').addEventListener('click', () => {
  document.getElementById('decline-box').classList.toggle('hidden');
});

document.getElementById('accept-btn').addEventListener('click', async () => {
  const name = document.getElementById('accepted-by').value.trim();
  const confirmed = document.getElementById('accept-confirm').checked;
  const btn = document.getElementById('accept-btn');

  if (!name) {
    alert('Please enter your full name.');
    return;
  }

  if (!confirmed) {
    alert('Please confirm that you accept the quote and its terms.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'ACCEPTING…';

  try {
    const result = await callQuoteClient('accept', { acceptedBy: name });
    renderQuote(result.quote);
  } catch (error) {
    alert(error.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'ACCEPT QUOTE <span>↗</span>';
  }
});

document.getElementById('decline-btn').addEventListener('click', async () => {
  const reason = document.getElementById('decline-reason').value.trim();
  const btn = document.getElementById('decline-btn');

  if (!confirm('Send this response to Phase Shift Studio?')) return;

  btn.disabled = true;
  btn.textContent = 'SENDING…';

  try {
    const result = await callQuoteClient('decline', { reason });
    renderQuote(result.quote);
  } catch (error) {
    alert(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'SEND RESPONSE';
  }
});

(async function boot() {
  if (!token) {
    showError('This quote link is missing its secure token.');
    return;
  }

  try {
    const result = await callQuoteClient('get');
    renderQuote(result.quote);
  } catch (error) {
    showError(error.message);
  }
})();
