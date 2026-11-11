import { safePath, MAX_FILE_BYTES } from './filesystem.js';

// This is deliberately a small, reviewable XML-like language rather than a
// general-purpose XML implementation. File bodies are RAW source code: JSX
// angle brackets, entities and quotes must not be interpreted as XML.
function readOpenTag(source, index = 0) {
  const match = /^<([A-Za-z][\w-]*)\b([^>]*?)(\/?)>/.exec(source.slice(index));
  if (!match) throw new Error('Malformed XML opening tag.');
  const [, name, rawAttrs, selfClosing] = match;
  const attrs = {};
  const attrRe = /([A-Za-z][\w-]*)\s*=\s*(["'])(.*?)\2/g;
  let attrMatch;
  while ((attrMatch = attrRe.exec(rawAttrs))) attrs[attrMatch[1]] = attrMatch[3];
  return { name, attrs, selfClosing: Boolean(selfClosing), end: index + match[0].length };
}

// Recursive descent for an artifact tree. A <file> is a leaf containing raw
// code; <artifact> can recursively contain child elements.
export function parseXmlTree(xml) {
  let pos = 0;
  function whitespace() { while (/\s/.test(xml[pos] ?? '') && pos < xml.length) pos++; }
  function node() {
    whitespace();
    const tag = readOpenTag(xml, pos);
    pos = tag.end;
    if (tag.selfClosing) return { name: tag.name, attrs: tag.attrs, children: [], text: '' };
    const close = `</${tag.name}>`;
    if (tag.name === 'file' || tag.name === 'message') {
      const end = xml.indexOf(close, pos);
      if (end < 0) throw new Error(`Unclosed ${tag.name} element.`);
      const text = xml.slice(pos, end);
      pos = end + close.length;
      return { name: tag.name, attrs: tag.attrs, children: [], text };
    }
    const children = [];
    while (true) {
      whitespace();
      if (xml.startsWith(close, pos)) { pos += close.length; break; }
      if (pos >= xml.length) throw new Error(`Unclosed ${tag.name} element.`);
      children.push(node());
    }
    return { name: tag.name, attrs: tag.attrs, children, text: '' };
  }
  whitespace();
  const result = node();
  whitespace();
  if (pos !== xml.length) throw new Error('Extra content after XML element.');
  return result;
}

function nodeToAction(node) {
  if (!['file', 'delete', 'message'].includes(node.name)) throw new Error('Unknown artifact action.');
  if (node.name === 'message') return { type: 'message', content: node.text.trim() };
  if (!safePath(node.attrs.path)) throw new Error('Invalid generated path.');
  if (node.name === 'delete') return { type: 'delete', path: node.attrs.path };
  if (new TextEncoder().encode(node.text).length > MAX_FILE_BYTES) throw new Error('Generated file too large.');
  return { type: 'file', path: node.attrs.path, content: node.text.replace(/^\n/, '').replace(/\n\s*$/, '\n') };
}

// Feeding arbitrary text deltas yields each *complete* child action exactly
// once. Broken tags spanning several HTTP chunks are buffered safely.
export class StreamingArtifactParser {
  constructor() {
    this.buffer = '';
    this.started = false;
    this.finished = false;
    this.title = 'Untitled project';
  }
  push(chunk) {
    if (this.finished && chunk) throw new Error('Stream has already finished.');
    this.buffer += chunk;
    if (this.buffer.length > 650_000) throw new Error('AI output exceeds stream limit.');
    const actions = [];
    if (!this.started) {
      const match = /<artifact\b[^>]*>/.exec(this.buffer);
      if (!match) {
        if (this.buffer.length > 4000) throw new Error('No <artifact> tag in response.');
        return actions;
      }
      const parsed = readOpenTag(match[0]);
      this.title = parsed.attrs.title || this.title;
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.started = true;
    }
    while (true) {
      this.buffer = this.buffer.replace(/^\s+/, '');
      if (this.buffer.startsWith('</artifact>')) {
        this.buffer = this.buffer.slice('</artifact>'.length);
        this.finished = true;
        return actions;
      }
      const tagMatch = /^<(file|message|delete)\b[^>]*>/.exec(this.buffer);
      if (!tagMatch) {
        // Keep incomplete chunks such as "<fi" until more bytes arrive.
        if (this.buffer.startsWith('<') || this.buffer.length === 0) return actions;
        throw new Error('Unexpected content inside artifact.');
      }
      const name = tagMatch[1];
      let end;
      if (tagMatch[0].endsWith('/>')) end = tagMatch[0].length;
      else {
        const close = `</${name}>`;
        const closeAt = this.buffer.indexOf(close, tagMatch[0].length);
        if (closeAt < 0) return actions;
        end = closeAt + close.length;
      }
      const piece = this.buffer.slice(0, end);
      const parsed = parseXmlTree(piece);
      actions.push(nodeToAction(parsed));
      this.buffer = this.buffer.slice(end);
    }
  }
  finish() {
    this.push('');
    if (!this.started || !this.finished) throw new Error('Incomplete artifact. The AI response may have been cut off.');
  }
}

export function parseArtifact(xml) {
  const root = parseXmlTree(xml);
  if (root.name !== 'artifact') throw new Error('Expected <artifact> as root.');
  return { title: root.attrs.title ?? 'Untitled project', actions: root.children.map(nodeToAction) };
}
