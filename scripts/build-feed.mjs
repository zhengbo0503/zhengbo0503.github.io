// Run from any directory: node scripts/build-feed.mjs
// Regenerates feed.xml and sitemap.xml from the posts themselves, so neither can
// drift from the site. Run it after adding or renaming a post.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = 'https://zbzhou.com';
const author = 'Zhengbo Zhou';

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function escape(text) {
  return text.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The post files are the single source of truth for titles, dates and summaries.
const posts = fs.readdirSync(path.join(root, 'posts'))
  .filter(file => file.endsWith('.html'))
  .map(file => {
    const html = read(`posts/${file}`);
    const pick = (pattern, label) => {
      const match = html.match(pattern);
      if (!match) throw new Error(`posts/${file}: could not read the ${label}.`);
      return match[1].trim();
    };
    return {
      url: `${site}/posts/${file}`,
      title: pick(/<title>([^<]+)<\/title>/, 'title'),
      summary: pick(/<meta name="description" content="([^"]+)"/, 'description'),
      published: pick(/<meta property="article:published_time" content="([^"]+)"/, 'publication date'),
      // An "Update, <date>" line means the post changed after it was published.
      updated: [...html.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">/g)]
        .map(match => match[1]).sort().at(-1),
    };
  })
  .sort((a, b) => b.published.localeCompare(a.published) || b.url.localeCompare(a.url));

const newest = posts[0].updated;
const stamp = date => `${date}T00:00:00Z`;

const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escape(author)}</title>
  <subtitle>Research announcements and notes on numerical linear algebra, matrix computations, and MATLAB.</subtitle>
  <link href="${site}/feed.xml" rel="self"/>
  <link href="${site}/pages/blog-archive.html"/>
  <id>${site}/</id>
  <updated>${stamp(newest)}</updated>
  <author><name>${escape(author)}</name></author>
${posts.map(post => `  <entry>
    <title>${escape(post.title)}</title>
    <link href="${post.url}"/>
    <id>${post.url}</id>
    <published>${stamp(post.published)}</published>
    <updated>${stamp(post.updated)}</updated>
    <summary>${escape(post.summary)}</summary>
  </entry>`).join('\n')}
</feed>
`;

const pages = [
  { loc: `${site}/` },
  { loc: `${site}/pages/pubs.html` },
  { loc: `${site}/pages/talks.html` },
  { loc: `${site}/pages/blog-archive.html`, lastmod: newest },
  { loc: `${site}/pages/teaching.html` },
  ...posts.map(post => ({ loc: post.url, lastmod: post.updated })),
];

const sitemap = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(page => `  <url>
    <loc>${page.loc}</loc>${page.lastmod ? `
    <lastmod>${page.lastmod}</lastmod>` : ''}
  </url>`).join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(root, 'feed.xml'), feed);
fs.writeFileSync(path.join(root, 'sitemap.xml'), sitemap);
console.log(`Wrote feed.xml (${posts.length} entries) and sitemap.xml (${pages.length} URLs).`);
