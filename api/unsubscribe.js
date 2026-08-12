// Vercel serverless function: digest unsubscribe.
//
// Serves two callers off one URL, which is what mail clients expect:
//
//   GET  /api/unsubscribe?t=<token>  - the visible "unsubscribe" link in the
//        email footer. Removes the address and renders a plain confirmation
//        page, so a person clicking it sees an answer rather than JSON.
//   POST /api/unsubscribe?t=<token>  - RFC 8058 one-click, which is what Gmail
//        and friends fire when someone uses the native unsubscribe button next
//        to the sender name. Must answer 200 quickly and without a body.
//
// It calls the digest_unsubscribe() SECURITY DEFINER function rather than
// touching the table, so this endpoint only needs the PUBLIC anon key: even if
// it leaked, it grants nothing beyond "delete the row matching a uuid you
// already hold". No service-role key lives here.
//
// Requires (already set for the site build):
//   REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY
// SUPABASE_URL / SUPABASE_ANON_KEY are accepted as fallbacks.

const URL_ENV = () => process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY_ENV = () => process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Minimal styled page, inlined: this is the one route a subscriber may reach
// with the SPA bundle uncached, and it must not depend on it.
function page({ title, body, ok }) {
  const accent = ok ? '#c6ff1c' : '#e05656';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title} · Smash</title></head>
<body style="margin:0;background:#0c0f14;color:#e8ebf2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:64px 20px;">
    <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8b93a7;">Smash</div>
    <h1 style="font-size:28px;line-height:1.2;margin:12px 0 14px;color:${accent};">${title}</h1>
    <p style="font-size:15px;line-height:1.6;color:#c7cdd9;margin:0 0 26px;">${body}</p>
    <a href="/" style="display:inline-block;background:#c6ff1c;color:#0c0f14;font-weight:700;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:8px;">Back to Smash</a>
  </div>
</body></html>`;
}

async function removeToken(token) {
  const url = URL_ENV();
  const key = KEY_ENV();
  if (!url || !key) throw new Error('Supabase is not configured for this deployment');
  const res = await fetch(`${url}/rest/v1/rpc/digest_unsubscribe`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`Supabase responded ${res.status}`);
  // The function returns a bare boolean: true when a row was actually removed.
  return (await res.json()) === true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Vercel populates req.query; fall back to parsing for safety.
  const token = String(
    (req.query && (req.query.t || req.query.token))
    || new URL(req.url, 'http://x').searchParams.get('t')
    || ''
  ).trim();

  const oneClick = req.method === 'POST';

  if (!UUID_RE.test(token)) {
    if (oneClick) { res.status(400).end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(400).send(page({
      title: 'That link is not valid',
      body: 'The unsubscribe link looks incomplete. Copy it straight from the email, or reply "stop" to any digest and it will be handled by hand.',
      ok: false,
    }));
    return;
  }

  try {
    const removed = await removeToken(token);
    if (oneClick) { res.status(200).end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(removed
      ? page({
        title: 'You are unsubscribed',
        body: 'That address has been removed from the Smash digest and will get no further emails. No hard feelings: the whole record stays public on the site whether you are subscribed or not.',
        ok: true,
      })
      // Already-used tokens land here. Same reassuring answer, because the
      // outcome the reader cares about is identical.
      : page({
        title: 'Already unsubscribed',
        body: 'That link has already been used, so the address is not on the list. You will not receive further emails.',
        ok: true,
      }));
  } catch (err) {
    if (oneClick) { res.status(500).end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(page({
      title: 'Could not unsubscribe',
      body: `Something went wrong at our end (${String(err.message)}). Reply "stop" to any digest and the address will be removed by hand.`,
      ok: false,
    }));
  }
};
