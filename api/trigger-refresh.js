// Vercel serverless function. Validates an admin password, then triggers
// the "Refresh player stats" GitHub Action (.github/workflows/refresh-data.yml)
// via the workflow_dispatch API, instead of running the pipeline inline here
// - Vercel functions have execution time limits that a full ~50-player
// refresh (300+ sequential API calls) can exceed, while GitHub Actions runs
// have no such constraint.
//
// Requires these Vercel environment variables:
//   ADMIN_PASSWORD        - password the Home page button asks for
//   GITHUB_DISPATCH_TOKEN - a GitHub PAT (fine-grained, scoped to this repo,
//                           with "Actions: write" + "Contents: write")
const OWNER = 'woonsupkim';
const REPO = 'Smash-React';
const WORKFLOW_FILE = 'refresh-data.yml';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { password } = req.body || {};
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
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
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

    res.status(200).json({
      ok: true,
      message: 'Refresh triggered. It runs in the background and takes a few minutes - check the Actions tab on GitHub for progress.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
