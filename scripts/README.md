# Running the product page generator

Run this any time you add a new product or edit an existing one's price,
stock, description, image, or active status in Supabase.

## Steps

1. Open a terminal (PowerShell or Git Bash both work).
2. Go to the repo root:
   ```
   cd D:\AcionaCo
   ```
3. Run:
   ```
   node scripts/generate-product-pages.mjs
   ```
4. Check the output — it lists the pages written/deleted and confirms
   `sitemap.xml` was updated. No errors should appear.
5. Review what changed and push:
   ```
   git status
   git add product-*.html sitemap.xml
   git commit -m "Update product pages"
   git push
   ```

## What it does

- Fetches every product where `active = true` from Supabase.
- Writes one `product-<slug>.html` page per product at the repo root
  (deleting any stale ones first).
- Pulls in the matching `wiki-*.html` page's chemical-identifiers table,
  research-topics list, and storage info, if that product has a `wiki_url`
  set.
- Rewrites `sitemap.xml` to match.

## Requirements

- Node.js installed (no `npm install` needed — zero dependencies).
- Internet access (it fetches live data from Supabase).

Full details: `docs/SEO_PRODUCT_PAGES.md` (local-only doc, not in this
public repo).
