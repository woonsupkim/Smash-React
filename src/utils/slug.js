// src/utils/slug.js
//
// One slugify for every SEO-facing URL (rivalry pages, sitemap, share
// links). MUST stay byte-identical to the pipeline's copy in
// data-pipeline/buildShareAssets.js and buildSitemap.js.
export const slugify = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
