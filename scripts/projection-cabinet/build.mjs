import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const data = new URL('./data/', import.meta.url);
const root = fileURLToPath(new URL('../../public/projection-cabinet/', import.meta.url));
const [catalog, images, routes, runtimeConfig] = await Promise.all(
  ['catalog', 'assets', 'routes', 'config'].map(async key => JSON.parse(await readFile(new URL(key + '.json', data), 'utf8')))
);
const routesById = new Set(routes.map(route => route.id));
assert.equal(routesById.size, routes.length, 'Duplicate cabinet route');
assert.equal(catalog.films.length, catalog.formats.length * catalog.industries.length);
for (const film of catalog.films) {
  assert.ok(routesById.has('film/' + film.slug) && routesById.has('view/' + film.slug), film.slug);
  assert.equal(film.poster, images[film.id]);
}
const generated = '// Generated from data/ by npm run build.\n' +
  Object.entries({ catalog, images, runtimeConfig }).map(([key, value]) =>
    'const ' + key + ' = ' + JSON.stringify(value, null, 2) + ';').join('\n') + '\n';
for (const edition of ['site', 'site-web']) {
  const destination = path.join(root, edition, 'js', 'content.generated.js');
  if (process.argv.includes('--check')) {
    assert.equal((await readFile(destination, 'utf8')).replaceAll('\r\n', '\n'), generated, 'Run npm run cabinet:build in the lounge repo');
  } else {
    await writeFile(destination, generated);
  }
}

async function files(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name), prefix + entry.name + '/') : prefix + entry.name));
  return paths.flat().sort();
}
const tv = path.join(root, 'site'), web = path.join(root, 'site-web');
const [tvFiles, webFiles] = await Promise.all([files(tv), files(web)]);
assert.deepEqual(webFiles, [...tvFiles, 'css/web.css'].sort(), 'Edition files are out of sync');
for (const asset of Object.values(images)) assert.ok(tvFiles.includes(asset), 'Missing ' + asset);
for (const file of tvFiles) {
  const [a, b] = await Promise.all([tv, web].map(dir => readFile(path.join(dir, file))));
  if (file === 'index.html') {
    const html = b.toString('utf8');
    const extraSheet = '<link rel="stylesheet" href="css/web.css">';
    assert.equal([...html.matchAll(/<link rel="stylesheet"[^>]+>/g)].at(-1)?.[0], extraSheet);
    const normalize = text => text.replace(/\r\n/g, '\n').split('\n').filter(line => line.trim() !== extraSheet).join('\n');
    assert.equal(normalize(html), normalize(a.toString('utf8')), 'Edition entry documents have drifted');
    for (const [, resource] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) assert.ok(webFiles.includes(resource), 'Missing entry resource: ' + resource);
    assert.deepEqual([...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]), [
      'vendor/gsap.min.js', 'vendor/CustomEase.min.js', 'vendor/SplitText.min.js', 'js/content.generated.js',
      'js/cabinet.js', 'js/sound.js', 'js/templates.js', 'js/integrations.js', 'js/optics.js',
      'js/start.js', 'js/fx/main.js',
    ], 'Cabinet script order has changed');
    assert.match(html, /<script type="module" src="js\/fx\/main\.js"/);
  } else {
    assert.ok(a.equals(b), 'Edition mismatch: ' + file);
    assert.ok(!a.subarray(0, 100).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1'), 'Unhydrated file: ' + file);
  }
}
console.log('Cabinet verified:', tvFiles.length, 'display files,', webFiles.length, 'web files,', routesById.size, 'routes.');
