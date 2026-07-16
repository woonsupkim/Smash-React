// src/pages/Legal.js
//
// Terms, Privacy, and Responsible Use - one shared layout, three routes.
// Plain-language on purpose: these pages exist to set honest expectations
// (informational tool, not betting advice), disclose what's collected
// (analytics only), and point anyone at risk to help.
import React from 'react';
import { Link } from 'react-router-dom';
import './Legal.css';

function LegalShell({ eyebrow, title, updated, children }) {
  return (
    <div className="legal-page">
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="legal-title">{title}</h1>
      <p className="legal-updated">Last updated {updated}</p>
      {children}
    </div>
  );
}

export function Terms() {
  return (
    <LegalShell eyebrow="LEGAL" title="Terms of Use" updated="July 12, 2026">
      <h2>What Smash is</h2>
      <p>
        Smash is a statistical analysis and simulation tool for professional tennis.
        It estimates match outcomes from public match data using point-by-point
        match modeling, surface-specific form ratings, and world rankings. All output is
        a probability estimate, not a statement of fact and not a guarantee of any
        outcome.
      </p>

      <h2>Not betting or financial advice</h2>
      <p>
        Nothing on this site is betting, investment, or financial advice. Comparisons
        against bookmaker odds exist to measure the model's quality, not to recommend
        wagers. If you choose to bet, you do so entirely at your own risk and subject
        to the laws of your jurisdiction. See our <Link to="/disclaimer">Responsible
        Use</Link> page.
      </p>

      <h2>Accuracy and availability</h2>
      <p>
        We publish our full graded track record, including misses, and we do not edit
        or remove past predictions. Even so, the data pipeline depends on third-party
        sources and may contain errors, gaps, or delays. The service is provided "as
        is", without warranties of any kind, and may change or be unavailable at any
        time.
      </p>

      <h2>Acceptable use</h2>
      <p>
        You may use the site for personal, non-commercial purposes. Automated
        scraping, republishing our data or predictions commercially, and attempts to
        disrupt the service are not permitted without prior written consent.
      </p>

      <h2>Intellectual property</h2>
      <p>
        The model, site design, and generated content are ours. Player names,
        results, and rankings are factual public data belonging to no one; ATP and
        WTA are trademarks of their respective owners, and this site is not
        affiliated with or endorsed by either tour.
      </p>
    </LegalShell>
  );
}

export function Privacy() {
  return (
    <LegalShell eyebrow="LEGAL" title="Privacy Policy" updated="July 12, 2026">
      <h2>What we collect</h2>
      <p>
        Smash has no user accounts and collects no personal information directly. We
        use two analytics services to understand aggregate usage: Google Analytics
        and Vercel Web Analytics. These record standard usage signals (pages
        visited, approximate region, device type) and may set cookies.
      </p>

      <h2>What we don't do</h2>
      <p>
        We do not sell data, run advertising, or share usage information with third
        parties beyond the analytics providers named above. We never ask for payment
        details, identity documents, or betting account information.
      </p>

      <h2>Local storage</h2>
      <p>
        The site stores small preferences in your browser's local storage (for
        example, whether you've seen the intro animation). This data never leaves
        your device.
      </p>

      <h2>Your choices</h2>
      <p>
        Standard browser controls (blocking cookies, private browsing, content
        blockers) work fully with this site; no functionality depends on analytics
        being enabled.
      </p>
    </LegalShell>
  );
}

export function Disclaimer() {
  return (
    <LegalShell eyebrow="LEGAL" title="Responsible Use" updated="July 12, 2026">
      <h2>Probabilities, not promises</h2>
      <p>
        A 70% prediction loses 30% of the time. Our own track record shows the model
        is wrong on a meaningful share of matches, and we publish every miss. No
        statistical model, ours included, can reliably beat betting markets after
        fees over the long run.
      </p>

      <h2>If you bet</h2>
      <p>
        This site is not a bookmaker, does not accept wagers, and does not recommend
        bets. If you choose to gamble: only bet what you can afford to lose, set
        limits before you start, and never chase losses. Sports betting is illegal
        in some jurisdictions and age-restricted everywhere it is legal.
      </p>

      <h2>If gambling stops being fun</h2>
      <p>
        Help is free and confidential. In the US, call or text the National Problem
        Gambling Helpline at <strong>1-800-GAMBLER</strong>. Elsewhere, GamCare
        (UK, <strong>0808 8020 133</strong>) and the international directory
        at <a href="https://www.gamblingtherapy.org" target="_blank" rel="noopener noreferrer">
        gamblingtherapy.org</a> can point you to local support.
      </p>
    </LegalShell>
  );
}
