// Run from any directory: node scripts/check-site.mjs
// Checks the static site's structure and local links without dependencies or a server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['index.html', ...['pages', 'posts'].flatMap(directory =>
  fs.readdirSync(path.join(root, directory))
    .filter(file => file.endsWith('.html'))
    .map(file => `${directory}/${file}`)
)];
const documents = new Map(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const failures = [];
let checkedLinks = 0;

function check(condition, file, message) {
  if (!condition) failures.push(`${file}: ${message}`);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1];
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(match => match[0]);
}

function hasExactPath(relativePath) {
  let directory = root;
  for (const component of relativePath.split('/').filter(Boolean)) {
    if (!fs.statSync(directory).isDirectory() || !fs.readdirSync(directory).includes(component)) return false;
    directory = path.join(directory, component);
  }
  return true;
}

for (const [file, html] of documents) {
  const meta = tags(html, 'meta');
  const getMeta = (name, key = 'name') => meta.filter(tag => attribute(tag, key) === name);
  const description = getMeta('description');
  const canonical = tags(html, 'link').filter(tag => attribute(tag, 'rel') === 'canonical');
  const expectedUrl = `https://zbzhou.com/${file === 'index.html' ? '' : file}`;

  check(/^<!DOCTYPE html>/i.test(html), file, 'Use the HTML5 doctype.');
  check(attribute(tags(html, 'html')[0] || '', 'lang') === 'en', file, 'Declare the page language.');
  check((html.match(/<title>[^<]+<\/title>/g) || []).length === 1, file, 'Provide one nonempty title.');
  check(description.length === 1 && Boolean(attribute(description[0], 'content')?.trim()), file, 'Provide one nonempty description.');
  check(canonical.length === 1 && attribute(canonical[0], 'href') === expectedUrl, file, 'Use the page-specific canonical URL.');
  check(getMeta('og:url', 'property').length === 1 && attribute(getMeta('og:url', 'property')[0], 'content') === expectedUrl, file, 'Match the sharing URL to the canonical URL.');
  check(getMeta('og:title', 'property').length === 1 && getMeta('og:description', 'property').length === 1, file, 'Provide social-sharing title and description.');
  check(getMeta('viewport').length === 1 && attribute(getMeta('viewport')[0], 'content') === 'width=device-width, initial-scale=1', file, 'Use the responsive viewport.');

  const mains = tags(html, 'main');
  check(mains.length === 1 && attribute(mains[0], 'id') === 'main-content', file, 'Provide one main-content landmark.');
  const mainContent = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1] || '';
  check(tags(mainContent, 'h1').length === 1, file, 'Keep the page title inside the main content.');
  check(tags(html, 'h1').length === 1, file, 'Provide exactly one h1.');
  check(tags(html, 'h1').every(tag => (attribute(tag, 'class') || '').split(/\s+/).includes('page__title')), file, 'Use the shared page-title class.');
  check(tags(html, 'a').some(tag => attribute(tag, 'href') === '#main-content' && (attribute(tag, 'class') || '').includes('skip-link')), file, 'Provide a skip-to-content link.');
  const current = tags(html, 'a').filter(tag => attribute(tag, 'aria-current'));
  check(current.length === 1 && attribute(current[0], 'aria-current') === (file.startsWith('posts/') ? 'true' : 'page'), file, 'Identify the current page or blog section.');
  check(tags(html, 'button').some(tag => attribute(tag, 'data-target') === '#site-nav' && attribute(tag, 'aria-controls') === 'site-nav'), file, 'Keep the mobile menu linked to site-nav.');
  check(tags(html, 'ul').filter(tag => attribute(tag, 'class') === 'nav navbar-nav').length === 1, file, 'Keep navigation links in one list.');

  let previousLevel = 0;
  for (const heading of html.matchAll(/<h([1-6])\b/g)) {
    const level = Number(heading[1]);
    check(level <= previousLevel + 1, file, `Heading level jumps from h${previousLevel} to h${level}.`);
    previousLevel = level;
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  check(new Set(ids).size === ids.length, file, 'IDs must be unique.');
  // Every image declares alt. Figures must describe themselves; the small logos beside
  // their own caption text are decorative and take alt="" so they are not read twice.
  for (const img of tags(html, 'img')) {
    const source = attribute(img, 'src');
    check(/\salt=("[^"]*"|'[^']*')/i.test(img), file, `Give the image ${source} an alt attribute.`);
    if (Number(attribute(img, 'width')) >= 200) {
      check(Boolean(attribute(img, 'alt')?.trim()), file, `Describe the informative image ${source}.`);
    }
  }

  const scripts = tags(html, 'script').map(tag => attribute(tag, 'src')).filter(Boolean);
  const jquery = scripts.findIndex(src => src.endsWith('/jquery.min.js'));
  const bootstrap = scripts.findIndex(src => src.endsWith('/bootstrap.min.js'));
  check(jquery >= 0 && bootstrap > jquery, file, 'Load jQuery before Bootstrap.');
  if (file.startsWith('pages/')) check(!scripts.some(src => src.includes('mathjax')), file, 'These index pages do not need MathJax.');
  if (scripts.some(src => src.includes('prism-core'))) {
    check(scripts.findIndex(src => src.includes('prism-core')) < scripts.findIndex(src => src.includes('prism-matlab')) && scripts.findIndex(src => src.includes('prism-matlab')) < scripts.findIndex(src => src.includes('prism-line-numbers')), file, 'Keep Prism core, MATLAB, and line numbers in order.');
    check(html.indexOf('themes/prism.min.css') < html.indexOf('/style.css'), file, 'Load Prism styles before site styles.');
  }

  for (const link of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const value = link[1].replace(/&amp;/g, '&');
    const url = new URL(value, `https://zbzhou.com/${file}`);
    if (url.origin !== 'https://zbzhou.com') continue;
    let target = decodeURIComponent(url.pathname).slice(1);
    if (!target || target.endsWith('/')) target += 'index.html';
    checkedLinks++;
    check(hasExactPath(target), file, `Missing local target or incorrect filename case: ${value}`);
    if (url.hash && documents.has(target)) {
      const id = decodeURIComponent(url.hash.slice(1));
      const targetIds = [...documents.get(target).matchAll(/\b(?:id|name)="([^"]+)"/g)].map(match => match[1]);
      check(targetIds.includes(id), file, `Missing fragment: ${value}`);
    }
  }
}

check(fs.readFileSync(path.join(root, 'styfiles/jquery.min.js'), 'utf8').includes('jQuery v1.12.4'), 'styfiles/jquery.min.js', 'Expected the real jQuery asset.');
check(fs.readFileSync(path.join(root, 'styfiles/bootstrap.min.js'), 'utf8').includes('Bootstrap v3.3.7'), 'styfiles/bootstrap.min.js', 'Expected the real Bootstrap asset.');

// Sharing cards, the feed link and the post date all live in the head of every page.
for (const [file, html] of documents) {
  const meta = tags(html, 'meta');
  const property = name => meta.filter(tag => attribute(tag, 'property') === name);
  check(property('og:image').length === 1 && attribute(property('og:image')[0], 'content') === 'https://zbzhou.com/media/og-card.png', file, 'Point the sharing card at the site image.');
  check(tags(html, 'link').some(tag => attribute(tag, 'type') === 'application/atom+xml'), file, 'Link the Atom feed.');
  if (file.startsWith('posts/')) {
    const published = property('article:published_time');
    check(published.length === 1 && attribute(published[0], 'content') === file.slice(6, 16), file, 'Match the publication date to the filename.');
  }
  // Inline maths uses \( \) everywhere; the dollar form is only in the MathJax config.
  const prose = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  check(!/\$[^$\n]{2,200}\$/.test(prose), file, 'Write inline maths with \\( and \\).');
}

// feed.xml and sitemap.xml are generated; regenerate with scripts/build-feed.mjs.
const feed = fs.readFileSync(path.join(root, 'feed.xml'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
for (const file of files) {
  const url = `https://zbzhou.com/${file === 'index.html' ? '' : file}`;
  check(sitemap.includes(`<loc>${url}</loc>`), 'sitemap.xml', `Missing page: ${file}. Run scripts/build-feed.mjs.`);
  if (file.startsWith('posts/')) check(feed.includes(`<id>${url}</id>`), 'feed.xml', `Missing post: ${file}. Run scripts/build-feed.mjs.`);
}
check((feed.match(/<entry>/g) || []).length === files.filter(file => file.startsWith('posts/')).length, 'feed.xml', 'Stale entry. Run scripts/build-feed.mjs.');
check(hasExactPath('404.html'), '404.html', 'Keep a custom not-found page for retired URLs.');
check(fs.readFileSync(path.join(root, 'robots.txt'), 'utf8').includes('Sitemap: https://zbzhou.com/sitemap.xml'), 'robots.txt', 'Advertise the sitemap.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} pages and ${checkedLinks} local links: metadata, headings, navigation, images, scripts, and fragments passed.`);
}
