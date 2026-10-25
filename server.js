const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openStore } = require('./store');

const statuses = new Set(['new', 'evaluating', 'preparing', 'submitted', 'won', 'lost']);
const sessionDays = 14;

function problem(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function requiredText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    problem(400, label + ' privalomas (iki ' + max + ' simbolių).');
  }
  return value.trim();
}

function optionalText(value, label, max = 200) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) problem(400, 'Netinkamas laukas: ' + label);
  return value.trim();
}

function optionalDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value + 'T00:00:00Z'))) problem(400, 'Netinkama data.');
  return value;
}

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}

function passwordMatches(password, saved) {
  const [salt, digest] = saved.split(':');
  if (!salt || !digest) return false;
  const candidate = Buffer.from(passwordHash(password, salt).split(':')[1], 'hex');
  const expected = Buffer.from(digest, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const at = part.indexOf('=');
    return at < 0 ? ['', ''] : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
  }));
}

function makeApp(options = {}) {
  const db = openStore(options.database || process.env.DATABASE_PATH ||
    path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'testas1.sqlite'));
  const publicDir = path.join(__dirname, 'dist');
  const baseUrl = options.baseUrl || process.env.BASE_URL || '';
  const stripeKey = options.stripeKey ?? process.env.STRIPE_SECRET_KEY;
  const stripePrice = options.stripePrice ?? process.env.STRIPE_PRICE_ID;
  const webhookSecret = options.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
  const stripeFetch = options.stripeFetch || fetch;
  const secureCookie = baseUrl.startsWith('https://');

  function send(res, status, body, headers = {}) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    });
    res.end(data);
  }

  async function readBody(req, raw = false) {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 1024 * 1024) problem(413, 'Užklausa per didelė.');
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (raw) return buffer;
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      problem(415, 'Reikalingas JSON turinys.');
    }
    try {
      const value = JSON.parse(buffer.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      problem(400, 'Netinkamas JSON.');
    }
  }

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare(`
      SELECT u.id, u.org_id, u.name, u.email, u.role, o.name AS org_name,
             o.plan, o.subscription_status, o.stripe_customer_id
      FROM sessions s JOIN users u ON u.id = s.user_id
      JOIN organizations o ON o.id = u.org_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashToken(token), new Date().toISOString()) || null;
  }

  function mustUser(req) {
    const user = currentUser(req);
    if (!user) problem(401, 'Prisijunkite.');
    return user;
  }

  function mustOwner(user) {
    if (user.role !== 'owner') problem(403, 'Šį veiksmą gali atlikti tik administratorius.');
  }

  function setSession(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + sessionDays * 86400000).toISOString();
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), userId, expiry);
    res.setHeader('Set-Cookie', 'sid=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' +
      sessionDays * 86400 + (secureCookie ? '; Secure' : ''));
  }

  async function stripePost(endpoint, fields) {
    if (!stripeKey) problem(503, 'Stripe dar nesukonfigūruotas.');
    const response = await stripeFetch('https://api.stripe.com/v1/' + endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + stripeKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(fields)
    });
    const result = await response.json();
    if (!response.ok) problem(502, result.error?.message || 'Stripe užklausa nepavyko.');
    return result;
  }

  function verifyWebhook(payload, header) {
    if (!webhookSecret || !header) problem(400, 'Trūksta Stripe webhook parašo.');
    const parts = header.split(',').map(item => item.split('=', 2));
    const timestampText = parts.find(([key]) => key === 't')?.[1];
    const timestamp = Number(timestampText);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
      problem(400, 'Pasenęs Stripe webhook parašas.');
    }
    const expected = crypto.createHmac('sha256', webhookSecret)
      .update(timestampText + '.').update(payload).digest('hex');
    const valid = parts.filter(([key]) => key === 'v1').some(([, signature]) => {
      if (!/^[a-f0-9]{64}$/i.test(signature || '')) return false;
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    });
    if (!valid) {
      problem(400, 'Netinkamas Stripe webhook parašas.');
    }
  }

  function handleStripeEvent(event) {
    const data = event.data?.object;
    if (!data || !event.type) return;
    if (event.type === 'checkout.session.completed' && data.mode === 'subscription') {
      const orgId = data.client_reference_id || data.metadata?.org_id;
      if (orgId && data.customer && data.subscription) {
        db.prepare(`UPDATE organizations SET stripe_customer_id = ?,
          stripe_subscription_id = ?, subscription_status = ?, plan = ?
          WHERE id = ?`).run(data.customer, data.subscription,
          data.payment_status === 'paid' ? 'active' : 'incomplete',
          data.payment_status === 'paid' ? 'pro' : 'free', orgId);
      }
    }
    if (event.type.startsWith('customer.subscription.')) {
      const org = db.prepare(`SELECT id, stripe_subscription_id FROM organizations
        WHERE stripe_customer_id = ?`).get(data.customer);
      if (!org || org.stripe_subscription_id !== data.id) return;
      const prices = data.items?.data?.map(item => item.price?.id) || [];
      if (stripePrice && event.type !== 'customer.subscription.deleted' &&
          !prices.includes(stripePrice)) return;
      const status = data.status || 'canceled';
      db.prepare(`UPDATE organizations SET stripe_subscription_id = ?,
        subscription_status = ?, plan = ? WHERE id = ?`)
        .run(data.id, status, ['active', 'trialing'].includes(status) ? 'pro' : 'free', org.id);
    }
  }

  async function api(req, res, pathname) {
    const method = req.method;
    if (method === 'POST' && pathname === '/api/stripe/webhook') {
      const payload = await readBody(req, true);
      verifyWebhook(payload, req.headers['stripe-signature']);
      let event;
      try { event = JSON.parse(payload.toString('utf8')); }
      catch { problem(400, 'Netinkamas webhook turinys.'); }
      handleStripeEvent(event);
      return send(res, 200, { received: true });
    }

    if (method === 'GET' && pathname === '/api/me') {
      const user = currentUser(req);
      return send(res, 200, {
        user: user && { id: user.id, name: user.name, email: user.email, role: user.role },
        organization: user && {
          id: user.org_id, name: user.org_name, plan: user.plan,
          subscriptionStatus: user.subscription_status
        },
        billingConfigured: Boolean(stripeKey && stripePrice && webhookSecret && baseUrl)
      });
    }

    if (method === 'POST' && pathname === '/api/register') {
      const body = await readBody(req);
      const name = requiredText(body.name, 'Vardas', 100);
      const email = requiredText(body.email, 'El. paštas', 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problem(400, 'Netinkamas el. paštas.');
      if (typeof body.password !== 'string' || body.password.length < 10 ||
          body.password.length > 200) problem(400, 'Slaptažodis turi būti 10–200 simbolių.');
      const inviteCode = optionalText(body.inviteCode, 'Pakvietimo kodas', 100);
      const workspace = inviteCode ? '' : requiredText(body.workspace, 'Komandos pavadinimas', 100);
      const now = new Date().toISOString();
      const userId = crypto.randomUUID();
      try {
        db.transaction(() => {
          let orgId;
          let role;
          if (inviteCode) {
            const org = db.prepare(`SELECT id FROM organizations
              WHERE invite_hash = ? AND invite_expires_at > ?`)
              .get(hashToken(inviteCode), now);
            if (!org) problem(400, 'Pakvietimo kodas negalioja.');
            orgId = org.id;
            role = 'member';
            db.prepare('UPDATE organizations SET invite_hash = NULL, invite_expires_at = NULL WHERE id = ?')
              .run(orgId);
          } else {
            orgId = crypto.randomUUID();
            role = 'owner';
            db.prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)')
              .run(orgId, workspace, now);
          }
          db.prepare(`INSERT INTO users (id, org_id, email, password_hash, name, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(userId, orgId, email, passwordHash(body.password), name, role, now);
        })();
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') problem(409, 'Šis el. paštas jau naudojamas.');
        throw error;
      }
      setSession(res, userId);
      return send(res, 201, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/login') {
      const body = await readBody(req);
      const email = requiredText(body.email, 'El. paštas', 254).toLowerCase();
      const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
      if (typeof body.password !== 'string' || !user ||
          !passwordMatches(body.password, user.password_hash)) {
        problem(401, 'Neteisingas el. paštas arba slaptažodis.');
      }
      setSession(res, user.id);
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/logout') {
      const token = parseCookies(req.headers.cookie).sid;
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' +
        (secureCookie ? '; Secure' : ''));
      return send(res, 200, { ok: true });
    }

    const user = mustUser(req);
    if (method === 'GET' && pathname === '/api/members') {
      return send(res, 200, { members: db.prepare(
        'SELECT id, name, email, role FROM users WHERE org_id = ? ORDER BY created_at'
      ).all(user.org_id) });
    }
    if (method === 'POST' && pathname === '/api/invite') {
      mustOwner(user);
      const code = crypto.randomBytes(18).toString('base64url');
      db.prepare('UPDATE organizations SET invite_hash = ?, invite_expires_at = ? WHERE id = ?')
        .run(hashToken(code), new Date(Date.now() + 7 * 86400000).toISOString(), user.org_id);
      return send(res, 200, { code, expiresInDays: 7 });
    }
    if (method === 'GET' && pathname === '/api/tenders') {
      return send(res, 200, { tenders: db.prepare(`
        SELECT t.*, (SELECT COUNT(*) FROM tasks WHERE tender_id = t.id) AS task_count,
          (SELECT COUNT(*) FROM tasks WHERE tender_id = t.id AND done = 1) AS tasks_done
        FROM tenders t WHERE t.org_id = ? ORDER BY
          CASE WHEN t.deadline IS NULL THEN 1 ELSE 0 END, t.deadline, t.created_at DESC
      `).all(user.org_id) });
    }
    if (method === 'POST' && pathname === '/api/tenders') {
      const body = await readBody(req);
      const tender = {
        id: crypto.randomUUID(),
        title: requiredText(body.title, 'Pavadinimas'),
        buyer: optionalText(body.buyer, 'Perkančioji organizacija'),
        reference: optionalText(body.reference, 'Pirkimo numeris', 100),
        description: optionalText(body.description, 'Pastabos', 3000),
        deadline: optionalDate(body.deadline),
        status: body.status || 'new',
        value: body.valueEur === '' || body.valueEur == null ? null : Number(body.valueEur)
      };
      if (!statuses.has(tender.status)) problem(400, 'Netinkama būsena.');
      if (tender.value !== null && (!Number.isFinite(tender.value) || tender.value < 0 ||
          tender.value > 1e12)) problem(400, 'Netinkama vertė.');
      db.transaction(() => {
        const org = db.prepare('SELECT plan FROM organizations WHERE id = ?').get(user.org_id);
        const count = db.prepare('SELECT COUNT(*) AS n FROM tenders WHERE org_id = ?')
          .get(user.org_id).n;
        if (org.plan !== 'pro' && count >= 3) problem(402, 'Nemokamas planas leidžia iki 3 konkursų.');
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO tenders
          (id, org_id, title, buyer, reference, value_eur, deadline, status, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(tender.id, user.org_id, tender.title, tender.buyer, tender.reference,
            tender.value, tender.deadline, tender.status, tender.description, now, now);
      })();
      return send(res, 201, { id: tender.id });
    }

    const tenderMatch = pathname.match(/^\/api\/tenders\/([a-f0-9-]{36})$/);
    if (tenderMatch) {
      const tender = db.prepare('SELECT * FROM tenders WHERE id = ? AND org_id = ?')
        .get(tenderMatch[1], user.org_id);
      if (!tender) problem(404, 'Konkursas nerastas.');
      if (method === 'GET') return send(res, 200, { tender });
      if (method === 'DELETE') {
        db.prepare('DELETE FROM tenders WHERE id = ? AND org_id = ?').run(tender.id, user.org_id);
        return send(res, 200, { ok: true });
      }
      if (method === 'PATCH') {
        const body = await readBody(req);
        const next = {
          title: body.title === undefined ? tender.title : requiredText(body.title, 'Pavadinimas'),
          buyer: body.buyer === undefined ? tender.buyer : optionalText(body.buyer, 'Organizacija'),
          reference: body.reference === undefined ? tender.reference :
            optionalText(body.reference, 'Pirkimo numeris', 100),
          description: body.description === undefined ? tender.description :
            optionalText(body.description, 'Pastabos', 3000),
          deadline: body.deadline === undefined ? tender.deadline : optionalDate(body.deadline),
          status: body.status === undefined ? tender.status : body.status,
          value: body.valueEur === undefined ? tender.value_eur :
            body.valueEur === '' || body.valueEur == null ? null : Number(body.valueEur)
        };
        if (!statuses.has(next.status)) problem(400, 'Netinkama būsena.');
        if (next.value !== null && (!Number.isFinite(next.value) || next.value < 0 ||
            next.value > 1e12)) problem(400, 'Netinkama vertė.');
        db.prepare(`UPDATE tenders SET title = ?, buyer = ?, reference = ?, value_eur = ?,
          deadline = ?, status = ?, description = ?, updated_at = ? WHERE id = ? AND org_id = ?`)
          .run(next.title, next.buyer, next.reference, next.value, next.deadline,
            next.status, next.description, new Date().toISOString(), tender.id, user.org_id);
        return send(res, 200, { ok: true });
      }
    }

    if (method === 'GET' && pathname === '/api/tasks') {
      return send(res, 200, { tasks: db.prepare(`
        SELECT tasks.* FROM tasks JOIN tenders ON tenders.id = tasks.tender_id
        WHERE tasks.org_id = ? AND tenders.org_id = ?
        ORDER BY tasks.done, tasks.due_date, tasks.created_at
      `).all(user.org_id, user.org_id) });
    }
    if (method === 'POST' && pathname === '/api/tasks') {
      const body = await readBody(req);
      const tender = db.prepare('SELECT id FROM tenders WHERE id = ? AND org_id = ?')
        .get(body.tenderId, user.org_id);
      if (!tender) problem(404, 'Konkursas nerastas.');
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO tasks (id, org_id, tender_id, title, due_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, user.org_id, tender.id,
        requiredText(body.title, 'Užduoties pavadinimas'), optionalDate(body.dueDate),
        new Date().toISOString());
      return send(res, 201, { id });
    }
    const taskMatch = pathname.match(/^\/api\/tasks\/([a-f0-9-]{36})$/);
    if (taskMatch) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?')
        .get(taskMatch[1], user.org_id);
      if (!task) problem(404, 'Užduotis nerasta.');
      if (method === 'DELETE') {
        db.prepare('DELETE FROM tasks WHERE id = ? AND org_id = ?').run(task.id, user.org_id);
        return send(res, 200, { ok: true });
      }
      if (method === 'PATCH') {
        const body = await readBody(req);
        const title = body.title === undefined ? task.title :
          requiredText(body.title, 'Užduoties pavadinimas');
        const dueDate = body.dueDate === undefined ? task.due_date : optionalDate(body.dueDate);
        const done = body.done === undefined ? task.done : Number(body.done === true);
        db.prepare('UPDATE tasks SET title = ?, due_date = ?, done = ? WHERE id = ? AND org_id = ?')
          .run(title, dueDate, done, task.id, user.org_id);
        return send(res, 200, { ok: true });
      }
    }

    if (method === 'POST' && pathname === '/api/billing/checkout') {
      mustOwner(user);
      if (!stripePrice || !webhookSecret || !baseUrl) problem(503, 'Stripe dar nesukonfigūruotas.');
      if (user.plan === 'pro') problem(409, 'Pro planas jau aktyvus.');
      const fields = {
        mode: 'subscription',
        'line_items[0][price]': stripePrice,
        'line_items[0][quantity]': '1',
        client_reference_id: user.org_id,
        'metadata[org_id]': user.org_id,
        success_url: baseUrl.replace(/\/$/, '') + '/?billing=success',
        cancel_url: baseUrl.replace(/\/$/, '') + '/?billing=cancel'
      };
      if (user.stripe_customer_id) fields.customer = user.stripe_customer_id;
      else fields.customer_email = user.email;
      const session = await stripePost('checkout/sessions', fields);
      return send(res, 200, { url: session.url });
    }
    if (method === 'POST' && pathname === '/api/billing/portal') {
      mustOwner(user);
      if (!baseUrl || !user.stripe_customer_id) problem(400, 'Prenumerata nerasta.');
      const session = await stripePost('billing_portal/sessions', {
        customer: user.stripe_customer_id,
        return_url: baseUrl.replace(/\/$/, '') + '/'
      });
      return send(res, 200, { url: session.url });
    }
    problem(404, 'Maršrutas nerastas.');
  }

  async function handler(req, res) {
    try {
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url, 'http://' + host);
      if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('ok\n');
      }
      if (url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
          const allowedOrigin = baseUrl ? new URL(baseUrl).origin : 'http://' + host;
          if (req.headers.origin !== allowedOrigin) problem(403, 'Netinkama užklausos kilmė.');
        }
        return await api(req, res, url.pathname);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') problem(405, 'Metodas nepalaikomas.');
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const filename = path.resolve(publicDir, relative);
      if (!filename.startsWith(publicDir + path.sep) || !fs.existsSync(filename) ||
          !fs.statSync(filename).isFile()) problem(404, 'Puslapis nerastas.');
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[path.extname(filename)] ||
        'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime + '; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(filename).pipe(res);
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) send(res, error.status || 500,
        { error: error.status ? error.message : 'Serverio klaida.' });
      else res.end();
    }
  }

  const server = http.createServer(handler);
  return { server, db };
}

if (require.main === module) {
  const { server } = makeApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => console.log('testas1 listening on ' + port));
}

module.exports = { makeApp };
