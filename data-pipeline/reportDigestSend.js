// data-pipeline/reportDigestSend.js
//
// Turns the digest's send marker into a CI signal.
//
// The digest step runs with continue-on-error and every skip path inside the
// builder returns cleanly, so a digest that quietly stopped reaching
// subscribers looked exactly like one that worked: a green run and a
// committed HTML file. The file proves the digest was BUILT; it never proved
// anyone received it.
//
// Exits non-zero only when a send we INTENDED did not land. Deliberate skips
// (stale data, dry run, nothing worth mailing) are correct behaviour and stay
// quiet.
const fs = require('fs');
const path = require('path');

const marker = path.join(__dirname, 'raw', 'digest-status.json');
const summary = process.env.GITHUB_STEP_SUMMARY;
const say = (line) => {
  console.log(line);
  if (summary) { try { fs.appendFileSync(summary, `${line}\n`); } catch { /* not fatal */ } }
};

if (!fs.existsSync(marker)) {
  say('- Digest: **no status recorded** - the build never reached a send decision.');
  process.exit(1);
}

let s;
try {
  s = JSON.parse(fs.readFileSync(marker, 'utf8'));
} catch (err) {
  say(`- Digest: **unreadable status marker** (${err.message})`);
  process.exit(1);
}

if (s.deliberate) {
  say(`- Digest: **not sent, on purpose** - ${s.reason}`);
  process.exit(0);
}

const failed = Number(s.failed) || 0;
const list = s.list || {};
say(`- Digest: **sent to ${s.sent}** of ${s.recipients} recipient(s)${failed ? `, ${failed} failed` : ''}`);

// The subscriber list is reported SEPARATELY from the mail count, because
// "sent to 1 recipient" reads the same whether the list is healthy and small
// or was never read at all - and in the second case the owner keeps getting
// the mail every morning, so nothing ever looks wrong.
if (list.read) {
  const key = list.keyPrivileged === false
    ? ` - but SUPABASE_SERVICE_KEY is a **${list.keyKind}**, which RLS blocks from reading this table`
    : '';
  say(`- Subscribers: **${list.subscribers}** read from digest_subscribers${key}`);
} else if (list.configured) {
  say(`- Subscribers: **NOT READ** - ${list.problem || 'unknown error'}. Only DIGEST_TO was mailed.`);
} else {
  say('- Subscribers: **NOT READ** - SUPABASE_URL / SUPABASE_SERVICE_KEY are not set on this run. Only DIGEST_TO was mailed.');
}

if (s.sandboxSender) {
  say("- Sender: **Resend sandbox (`onboarding@resend.dev`)** - only the Resend account owner can receive. Every other subscriber is rejected 403.");
} else if (s.transport) {
  say(`- Sender: ${s.transport}`);
}

const problems = [];
if (s.sandboxSender) problems.push('DIGEST_FROM is the Resend sandbox sender, which can only reach the account owner');
if (!s.sent) problems.push('nobody received it');
if (failed) problems.push(`${failed} send(s) failed`);
if (!list.read) problems.push(`the subscriber list was never read (${list.problem || 'not configured'})`);
if (list.read && list.keyPrivileged === false) {
  problems.push(`SUPABASE_SERVICE_KEY is a ${list.keyKind}, which cannot read digest_subscribers`);
} else if (list.read && list.subscribers === 0) {
  // Not necessarily broken - the table may simply be empty - but it is worth
  // surfacing, because "nobody signed up" and "we cannot read the list" are
  // the same observation until someone checks.
  problems.push('digest_subscribers returned zero rows (table empty, or unreadable)');
}

if (problems.length) {
  console.error(`Digest delivery is not healthy: ${problems.join('; ')}. ${JSON.stringify(s)}`);
  process.exit(1);
}
