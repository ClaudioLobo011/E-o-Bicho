'use strict';

const CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const NBSP_REGEX = /\u00A0/g;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060\uFEFF]/g;
const LINE_BREAK_REGEX = /\r\n?/g;
const LINE_SEPARATOR_REGEX = /[\u2028\u2029]/g;

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const normalizeWhitespace = (value) => {
  if (value == null) {
    return '';
  }
  let normalized = String(value);
  normalized = normalized.replace(LINE_BREAK_REGEX, '\n');
  normalized = normalized.replace(LINE_SEPARATOR_REGEX, '\n');
  normalized = normalized.replace(CONTROL_CHARS_REGEX, '');
  normalized = normalized.replace(NBSP_REGEX, ' ');
  normalized = normalized.replace(ZERO_WIDTH_REGEX, '');
  return normalized;
};

const sanitizeXmlText = (value) => {
  if (value == null) {
    return '';
  }
  let normalized = normalizeWhitespace(value);
  normalized = normalized.trim();
  normalized = normalized.replace(/[ \t\f\v]+/g, ' ');
  normalized = normalized.replace(/\s*\n\s*/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ');
  return escapeXml(normalized);
};

const sanitizeXmlAttribute = (value) => sanitizeXmlText(value);

const sanitizeXmlContent = (xml) => {
  if (xml == null) {
    return '';
  }
  let normalized = normalizeWhitespace(xml);
  // Remove trailing spaces at end of lines
  normalized = normalized.replace(/[ \t]+\n/g, '\n');
  // Collapse multiple blank lines
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  // Trim leading/trailing blank lines
  normalized = normalized.replace(/^\s+|\s+$/g, '');
  // Remove any editing characters (spaces, tabs, newlines) between tags
  normalized = normalized.replace(/>\s+</g, '><');
  return normalized;
};

module.exports = {
  escapeXml,
  normalizeWhitespace,
  sanitizeXmlAttribute,
  sanitizeXmlContent,
  sanitizeXmlText,
};
