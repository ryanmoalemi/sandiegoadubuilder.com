# Contributor notes

## Headings and publishing

H1s must plainly describe the page, never slogans. Fact-check all AI-assisted text, including titles, meta descriptions, alt text, and schema, before publishing. Never bump review dates without an actual re-check.

## Section order

Put the most engaging block directly under the intro or hero. Use this order when the page has them:

1. Photos and galleries, with each caption and disclaimer kept on the same image
2. Interactive tools, including the cost calculator
3. Comparison tables
4. The main answer

Order everything else from most interesting to least interesting. End with methodology, then disclosures, then notes, then source lists, then fine print.

Move existing sections. Do not rewrite or delete copy to change the order. The full hero title must stay above the fold on desktop and mobile.

On `adu-handbook.html`, leave the jump nav and the embedded handbook where they are. An open change adds the City versus County comparison in that spot, directly above the embed.

## Google Analytics

Every public HTML page must include the Google tag `G-2QP9M28W4W` copied from `index.html`, placed first in `<head>`, and no other `G-` ID. `node scripts/check-site.mjs` fails if any public HTML page is missing `G-2QP9M28W4W` or contains a different `G-` ID.
