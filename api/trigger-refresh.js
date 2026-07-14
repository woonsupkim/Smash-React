// Vercel serverless function. Validates an admin password, then triggers a
// whitelisted GitHub Action via the workflow_dispatch API, instead of running
// the pipeline inline here - Vercel functions have execution time limits
// that a full ~50-player refresh (300+ sequential API calls) can exceed,
// while GitHub Actions runs have no such constraint.
//
// Requires these Vercel environment variables:
//   ADMIN_PASSWORD        - password the /admin page asks for
//   GITHUB_DISPATCH_TOKEN - a GitHub PAT (fine-grained, scoped to this repo,
//                           with "Actions: write" + "Contents: write")
const OWNER = 'woonsupkim';
const REPO = 'Smash-React';

// Only these workflows are dispatchable from the web - never accept a raw
// filename from the client.
const WORKFLOWS = {
  refresh: {
    file: 'refresh-data.yml',
    message: 'Refresh triggered. It runs in the background and takes a few minutes - check the Actions tab on GitHub for progress.',
  },
  retune: {
    file: 'retune-weights.yml',
    message: 'Retune triggered. If the weights change, a pull request will appear on GitHub for your review in a minute or two.',
  },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { password, workflow = 'refresh' } = req.body || {};
  const target = WORKFLOWS[workflow];
  if (!target) {
    res.status(400).json({ error: `Unknown workflow: ${workflow}` });
    return;
  }
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Server misconfigured: missing GITHUB_DISPATCH_TOKEN' });
    return;
  }

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${target.file}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (!ghRes.ok) {
      const text = await ghRes.text();
      res.status(502).json({ error: `GitHub dispatch failed: ${ghRes.status} ${text}` });
      return;
    }

    res.status(200).json({ ok: true, message: target.message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
