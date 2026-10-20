import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = readFileSync(new URL('./link-cleaner.html', import.meta.url), 'utf8');
const source = html.match(/<script id="cleaner-core">([\s\S]*?)<\/script>/)[1];
const { cleanLink, cleanBatch } = runInNewContext(source + '\n({ cleanLink, cleanBatch })', { URL });

test('removes known tracking while retaining functional parameters and fragment', () => {
  const result = cleanLink('https://example.com/read?id=42&utm_source=email&fbclid=abc#chapter');
  assert.equal(result.url, 'https://example.com/read?id=42#chapter');
  assert.equal(result.removed.join(','), 'utm_source,fbclid');
});
test('keeps video id, timestamp, search, source and ref', () => {
  assert.equal(cleanLink('https://www.youtube.com/watch?v=abc&t=90&ref=home&source=web&utm_medium=share').url,
    'https://www.youtube.com/watch?v=abc&t=90&ref=home&source=web');
});
test('preserves byte representation of retained query fields', () => {
  assert.equal(cleanLink('https://EXAMPLE.com:443/a%2fb?q=a%20b&x=%2f&x=two+words&utm_source=x#%2f').url,
    'https://EXAMPLE.com:443/a%2fb?q=a%20b&x=%2f&x=two+words#%2f');
});
test('removes repeated, encoded and case-insensitive tracker names', () => {
  const result = cleanLink('https://example.com/?UTM_Source=a&%75tm_medium=b&gclid=c&gclid=d');
  assert.equal(result.url, 'https://example.com/');
  assert.equal(result.removed.length, 4);
});
test('leaves hash routes and tracking-looking path text intact', () => {
  assert.equal(cleanLink('https://example.com/utm_source=x#/page?utm_source=y').url,
    'https://example.com/utm_source=x#/page?utm_source=y');
});
test('preserves unrecognised and malformed parameter names', () => {
  assert.equal(cleanLink('https://example.com/?%ZZ=x&utm_source=y&custom=ok').url,
    'https://example.com/?%ZZ=x&custom=ok');
});
test('keeps signed, token and expiring URLs untouched', () => {
  for (const key of ['signature', 'sig', 'token', 'access_token', 'auth_key', 'expires', 'Policy', 'X-Amz-Signature', 'X-Goog-Credential', 'se', 'api_key']) {
    const url = 'https://example.com/file?utm_source=email&' + key + '=demo';
    assert.equal(cleanLink(url).url, url);
    assert.equal(cleanLink(url).protected, true);
  }
});
test('rejects executable and non-web schemes, relative URLs and credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/test', '/relative', 'example.com', 'https://u:p@example.com', 'https:example.com', 'https:///example.com', 'https://example.com/a b', 'not a link']) {
    assert.ok(cleanLink(url).error, url);
    assert.equal(cleanLink(url).url, url);
  }
});
test('unmodified URLs stay byte-for-byte unchanged including empty query', () => {
  for (const url of ['https://EXAMPLE.com:443/path?', 'https://example.com/#hi', 'http://example.com:8080', 'https://example.com/?q=中文']) {
    assert.equal(cleanLink(url).url, url);
  }
});
test('processing twice produces identical output', () => {
  const once = cleanLink('https://example.com/?utm_source=mail&a=1&fbclid=x').url;
  assert.equal(cleanLink(once).url, once);
});
test('batch handles CRLF, blank lines and errors independently', () => {
  const result = cleanBatch('  https://example.com/?utm_source=x  \r\n\r\nnot-a-url\r\nhttps://example.org/?id=3');
  assert.equal(result.length, 3);
  assert.equal(result[0].url, 'https://example.com/');
  assert.ok(result[1].error);
  assert.equal(result[2].url, 'https://example.org/?id=3');
});
test('allows 200 links and refuses 201 without partial processing', () => {
  assert.equal(cleanBatch(Array(200).fill('https://example.com').join('\n')).length, 200);
  assert.throws(() => cleanBatch(Array(201).fill('https://example.com').join('\n')), /200/);
});
test('empty input produces no results', () => {
  assert.equal(cleanBatch(' \n\r\n').length, 0);
});
