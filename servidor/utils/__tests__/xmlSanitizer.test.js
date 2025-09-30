const test = require('node:test');
const assert = require('node:assert');

const {
  escapeXml,
  sanitizeXmlAttribute,
  sanitizeXmlContent,
  sanitizeXmlText,
} = require('../xmlSanitizer');

test('sanitizeXmlText removes control, NBSP, zero-width chars and escapes XML entities', () => {
  const input = "  Foo\u0001\u00a0Bar\u200b & Baz\nQu\u2028x  ";
  const result = sanitizeXmlText(input);
  assert.strictEqual(result, 'Foo Bar &amp; Baz Qu x');
});

test('sanitizeXmlAttribute delegates to sanitizeXmlText', () => {
  const input = '  Valor\u00a0"especial"  ';
  assert.strictEqual(sanitizeXmlAttribute(input), 'Valor &quot;especial&quot;');
});

test('sanitizeXmlContent normalizes whitespace and strips forbidden characters', () => {
  const input = "\ufeff<?xml version=\"1.0\"?>\r\n<NFe>\u200b\n  <infNFe>\u00a0</infNFe>\n</NFe>\r\n";
  const result = sanitizeXmlContent(input);
  assert.strictEqual(result, '<?xml version="1.0"?>\n<NFe>\n  <infNFe> </infNFe>\n</NFe>');
});

test('escapeXml escapes special characters without additional normalization', () => {
  assert.strictEqual(escapeXml('A & B < C > "D"'), 'A &amp; B &lt; C &gt; &quot;D&quot;');
});
