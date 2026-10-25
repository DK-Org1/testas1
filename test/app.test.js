const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeApp } = require('../server');

test('komandos, konkursai, užduotys ir prenumeratos teisės', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testas1-'));
  const stripeCalls = [];
  const { server, db } = makeApp({
    database: path.join(directory, 'app.sqlite'),
    webhookSecret: 'whsec_test_only',
    stripePrice: 'price_test',
    stripeKey: 'sk_test_mock',
    baseUrl: 'https://example.test',
    stripeFetch: async (url, options) => {
      stripeCalls.push({ url, options });
      return { ok: true, json: async () => ({
        url: url.endsWith('/checkout/sessions') ?
          'https://checkout.stripe.com/test' : 'https://billing.stripe.com/test'
      }) };
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(route, method = 'GET', body, cookie, headers = {}) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = route === '/health' ? await response.text() :
      await response.json();
    return {
      status: response.status,
      data,
      cookie: response.headers.get('set-cookie')?.split(';')[0]
    };
  }

  assert.equal((await request('/health')).data, 'ok\n');
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await request('/api/tenders')).status, 401);
  const owner = await request('/api/register', 'POST', {
    name: 'Aistė', workspace: 'Komanda A', email: 'aiste@example.test',
    password: 'long-password-123'
  });
  assert.equal(owner.status, 201);
  const ownerCookie = owner.cookie;
  const orgId = (await request('/api/me', 'GET', undefined, ownerCookie)).data.organization.id;
  assert.equal((await request('/api/login', 'POST', {
    email: 'aiste@example.test', password: 'wrong-password'
  })).status, 401);

  const first = await request('/api/tenders', 'POST', {
    title: 'Pirmas pirkimas', buyer: 'Miesto savivaldybė', deadline: '2026-12-01'
  }, ownerCookie);
  assert.equal(first.status, 201);
  assert.equal((await request('/api/tenders/' + first.data.id, 'PATCH', {
    status: 'preparing'
  }, ownerCookie)).status, 200);
  for (let i = 2; i <= 3; i++) assert.equal((await request('/api/tenders',
    'POST', { title: 'Pirkimas ' + i }, ownerCookie)).status, 201);
  assert.equal((await request('/api/tenders', 'POST',
    { title: 'Ketvirtas' }, ownerCookie)).status, 402);
  const checkout = await request('/api/billing/checkout', 'POST', {}, ownerCookie);
  assert.equal(checkout.status, 200);
  assert.equal(checkout.data.url, 'https://checkout.stripe.com/test');
  assert.equal(new URLSearchParams(stripeCalls[0].options.body)
    .get('line_items[0][price]'), 'price_test');
  assert.equal(new URLSearchParams(stripeCalls[0].options.body)
    .get('client_reference_id'), orgId);

  const invite = await request('/api/invite', 'POST', {}, ownerCookie);
  assert.equal(invite.status, 200);
  const member = await request('/api/register', 'POST', {
    name: 'Jonas', email: 'jonas@example.test', password: 'another-password-123',
    inviteCode: invite.data.code
  });
  assert.equal(member.status, 201);
  assert.equal((await request('/api/invite', 'POST', {}, member.cookie)).status, 403);
  assert.equal((await request('/api/billing/checkout', 'POST', {}, member.cookie)).status, 403);
  assert.equal((await request('/api/tenders', 'GET', undefined, member.cookie)).data.tenders.length, 3);
  const task = await request('/api/tasks', 'POST', {
    tenderId: first.data.id, title: 'Parengti dokumentus', dueDate: '2026-11-20'
  }, member.cookie);
  assert.equal(task.status, 201);
  assert.equal((await request('/api/tasks', 'GET', undefined, ownerCookie)).data.tasks.length, 1);
  assert.equal((await request('/api/tasks/' + task.data.id, 'PATCH',
    { done: true }, member.cookie)).status, 200);

  const outsider = await request('/api/register', 'POST', {
    name: 'Rūta', workspace: 'Komanda B', email: 'ruta@example.test',
    password: 'third-password-123'
  });
  assert.equal(outsider.status, 201);
  assert.equal((await request('/api/tenders', 'GET', undefined, outsider.cookie)).data.tenders.length, 0);
  assert.equal((await request('/api/tenders/' + first.data.id, 'GET',
    undefined, outsider.cookie)).status, 404);
  assert.equal((await request('/api/tasks', 'POST', {
    tenderId: first.data.id, title: 'Svetima'
  }, outsider.cookie)).status, 404);

  async function webhook(event, valid = true) {
    const raw = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac('sha256', 'whsec_test_only')
      .update(timestamp + '.' + raw).digest('hex');
    const response = await fetch(base + '/api/stripe/webhook', {
      method: 'POST',
      headers: { 'Stripe-Signature': 't=' + timestamp + ',v1=' +
        (valid ? signature : '0'.repeat(64)) },
      body: raw
    });
    return response.status;
  }
  const paid = {
    type: 'checkout.session.completed',
    data: { object: {
      mode: 'subscription', client_reference_id: orgId,
      customer: 'cus_test', subscription: 'sub_test', payment_status: 'paid'
    } }
  };
  assert.equal(await webhook(paid, false), 400);
  assert.equal(await webhook(paid), 200);
  assert.equal((await request('/api/me', 'GET', undefined, ownerCookie)).data.organization.plan, 'pro');
  assert.equal((await request('/api/billing/checkout', 'POST', {}, ownerCookie)).status, 409);
  const portal = await request('/api/billing/portal', 'POST', {}, ownerCookie);
  assert.equal(portal.status, 200);
  assert.equal(new URLSearchParams(stripeCalls[1].options.body).get('customer'), 'cus_test');
  assert.equal((await request('/api/tenders', 'POST',
    { title: 'Ketvirtas' }, ownerCookie)).status, 201);
  assert.equal(await webhook({
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_test', customer: 'cus_test', status: 'canceled' } }
  }), 200);
  assert.equal((await request('/api/me', 'GET', undefined, ownerCookie)).data.organization.plan, 'free');
  assert.equal(await webhook({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_test', customer: 'cus_test', status: 'active',
      items: { data: [{ price: { id: 'price_unrelated' } }] } } }
  }), 200);
  assert.equal((await request('/api/me', 'GET', undefined, ownerCookie)).data.organization.plan, 'free');
  assert.equal((await request('/api/tenders', 'POST',
    { title: 'Penktas' }, ownerCookie)).status, 402);
  assert.equal((await request('/api/logout', 'POST', {}, ownerCookie)).status, 200);
  assert.equal((await request('/api/tenders', 'GET', undefined, ownerCookie)).status, 401);
});
