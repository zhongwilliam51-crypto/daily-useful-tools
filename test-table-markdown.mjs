import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./table-markdown.html', import.meta.url), 'utf8');
const core = html.match(/<script id="table-markdown-core">([\s\S]*?)<\/script>/)[1];
const {parseTableText: parse, makeMarkdown: format} = runInNewContext(core + '\n({parseTableText, makeMarkdown})');
const plain = rows => Array.from(rows, row => Array.from(row));

test('produces a GFM header, delimiter and rows in their original order', () => {
  assert.equal(format(parse('事项\t数量\n米\t2\n面\t3\n')),
    '| 事项 | 数量 |\n| --- | --- |\n| 米 | 2 |\n| 面 | 3 |');
});

test('preserves trailing, leading and whole-row empty cells', () => {
  assert.deepEqual(plain(parse('A\tB\tC\n\t中\t\n\t\t\n')),
    [['A', 'B', 'C'], ['', '中', ''], ['', '', '']]);
});

test('reads spreadsheet quotes, embedded tabs and CRLF', () => {
  assert.deepEqual(plain(parse('标题\t备注\r\n"甲 ""乙"""\t"上行\t间隔\r\n下行"\r\n')),
    [['标题', '备注'], ['甲 "乙"', '上行 间隔\n下行']]);
  assert.deepEqual(plain(parse('标题\r""\r长"引号')),
    [['标题'], [''], ['长"引号']]);
});

test('keeps quoted newline and trims outer horizontal space', () => {
  assert.equal(format(parse(' 标题 \n"  甲\n乙  "')), '| 标题 |\n| --- |\n| 甲<br>乙 |');
});

test('escapes delimiters, backslashes, HTML and common inline syntax', () => {
  const rows = [['标题', '值'], ['\\| <img> &amp;', '![图](x) **粗体** ~~线~~ x_y \x60代码\x60']];
  const markdown = format(rows);
  assert.equal(markdown, '| 标题 | 值 |\n| --- | --- |\n| &#92;&#124; &lt;img&gt; &amp;amp; | !\\[图\\](x) \\*\\*粗体\\*\\* \\~\\~线\\~\\~ x\\_y \\\x60代码\\\x60 |');
  assert.ok(markdown.split('\n').every(row => row.split('|').length === 4));
});

test('reports extra and missing cells with row numbers', () => {
  assert.throws(() => parse('A\tB\nx'), /第 2 行有 1 列/);
  assert.throws(() => parse('A\tB\nx\ty\nz\tq\tr'), /第 3 行有 3 列/);
});

test('rejects broken quoted cells without dropping content', () => {
  assert.throws(() => parse('A\tB\nx\t"unfinished'), /第 2 行的引号没有闭合/);
  assert.throws(() => parse('A\tB\nx\t"done"tail'), /第 2 行的引号后/);
});

test('requires at least one nonempty heading and rejects NUL', () => {
  for (const value of ['', ' \t\r\n', '\t\nx\ty', '""\nx']) {
    assert.throws(() => parse(value), /表头/);
  }
  assert.throws(() => parse('A\nx\0'), /空字符/);
});

test('accepts the exact row, column and input size limits', () => {
  const fullRow = Array(20).fill('x').join('\t');
  assert.equal(parse(Array(200).fill(fullRow).join('\n')).length, 200);
  assert.throws(() => parse(Array(201).fill(fullRow).join('\n')), /200 行/);
  assert.throws(() => parse(fullRow + '\tx'), /20 列/);
  assert.equal(parse('x'.repeat(50000))[0][0].length, 50000);
  assert.throws(() => parse('x'.repeat(50001)), /过长/);
});
