import { AppError, fingerprint, Segment } from '../shared/protocol';
import { formatTokens, sameFormat } from '../shared/formatting';
export const OWN = 'data-tmp-owned';
const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption,dt,dd';
const SKIP = `script,style,noscript,pre,textarea,input,select,button,form,nav,footer,[contenteditable]:not([contenteditable="false"]),[translate="no"],[aria-hidden="true"],[hidden],[${OWN}]`;
const ATOMIC = 'code,kbd,samp,math,.katex,.MathJax';
const INLINE = new Set('a strong b em i u s del ins mark small sub sup span abbr cite q time bdi bdo var dfn ruby rt rp'.split(' '));
const MATH = new Set('math mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd semantics annotation'.split(' '));
const MATH_ATTRS = new Set('display mathvariant mathsize mathcolor mathbackground scriptlevel displaystyle stretchy symmetric largeop movablelimits fence separator accent accentunder lspace rspace linethickness bevelled notation columnalign rowalign columnspacing rowspacing rowspan columnspan'.split(' '));
const TYPOGRAPHY = 'font-family font-size font-weight font-style font-stretch font-variant font-feature-settings font-variation-settings font-kerning font-optical-sizing line-height letter-spacing word-spacing color text-align text-indent text-transform text-rendering text-orientation white-space word-break overflow-wrap hyphens tab-size direction writing-mode'.split(' ');
const INLINE_STYLE = [...TYPOGRAPHY, ...'display vertical-align text-decoration-line text-decoration-color text-decoration-style text-decoration-thickness text-underline-offset text-underline-position text-emphasis-style text-emphasis-color text-shadow -webkit-text-fill-color -webkit-text-stroke-width -webkit-text-stroke-color background-color background-image background-size background-position background-repeat border-top border-right border-bottom border-left border-radius padding-top padding-right padding-bottom padding-left margin-top margin-right margin-bottom margin-left box-shadow box-decoration-break opacity unicode-bidi'.split(' ')];
type Template = { source?: Element; literal?: string; newline?: boolean };
type Capture = Pick<Segment, 'text' | 'protected' | 'sourceHash'> & { templates: Map<string, Template> };

export function excluded(element: Element, extra = ''): boolean {
  if (element.closest(SKIP)) return true;
  if (extra) { try { if (element.closest(extra)) return true; } catch {} }
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return true;
  }
  return false;
}
function signature(element: Element): unknown {
  return [element.localName, element.namespaceURI, ...['href', 'target', 'rel', 'title', 'lang', 'dir'].map(a => element.getAttribute(a))];
}
function capture(element: Element): Capture {
  let text = '', formatId = 0, atomId = 0;
  const protect: Record<string, string> = {}, templates = new Map<string, Template>(), semantics: unknown[] = [];
  function atom(template: Template, value: string) {
    const token = `⟦TMP:${atomId++}⟧`;
    protect[token] = value; templates.set(token, template); text += token;
    if (template.source) semantics.push(signature(template.source));
  }
  function line(template: Template) {
    const token = `⟦TMP:br:${formatId++}⟧`; templates.set(token, template); text += token;
  }
  function literal(value: string) {
    let offset = 0;
    // A page may itself explain marker syntax. Escape it before introducing our own markers.
    for (const match of value.matchAll(/⟦TMP:[^⟧]*(?:⟧|$)/g)) {
      text += value.slice(offset, match.index); atom({ literal: match[0] }, match[0]); offset = match.index! + match[0].length;
    }
    text += value.slice(offset);
  }
  function visit(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || '', whiteSpace = getComputedStyle(node.parentElement || element).whiteSpace;
      if (/pre|break-spaces/.test(whiteSpace)) {
        const lines = value.split(/\r\n|\r|\n/);
        lines.forEach((part, i) => { if (i) line({ newline: true }); literal(whiteSpace === 'pre-line' ? part.replace(/[\t ]+/g, ' ') : part); });
      } else literal(value.replace(/[\t\r\n\f ]+/g, ' '));
      return;
    }
    if (!(node instanceof Element)) return;
    if (node !== element && (node.matches(SKIP) || node.matches(BLOCK))) return;
    if (node.matches(ATOMIC)) { atom({ source: node }, node.textContent || ''); return; }
    if (node.tagName === 'BR') { line({ source: node }); return; }
    const children = () => { for (const child of node.childNodes) visit(child); };
    if (node === element) { children(); return; }
    // Every inline element gets a local template, including spans with site-specific typography.
    // Nothing from that template (attributes, CSS or URLs) is sent to the model.
    const id = formatId++, token = `⟦TMP:o:${id}⟧`, start = text.length;
    text += token; templates.set(token, { source: node }); semantics.push(signature(node));
    children();
    if (text.length === start + token.length) { text = text.slice(0, start); templates.delete(token); }
    else text += `⟦TMP:c:${id}⟧`;
  }
  visit(element); text = text.trim();
  return { text, protected: protect, sourceHash: fingerprint(JSON.stringify([text, protect, semantics])), templates };
}
export function snapshot(element: Element): Pick<Segment, 'text' | 'protected' | 'sourceHash'> {
  const { text, protected: protect, sourceHash } = capture(element);
  return { text, protected: protect, sourceHash };
}
export function candidates(root: Element, extra = ''): Element[] {
  const nodes = [...(root.matches(BLOCK) ? [root] : []), ...root.querySelectorAll(BLOCK)];
  if (root.tagName === 'DIV' && !root.querySelector(`${BLOCK},div,section,article,main`) && (root.textContent?.trim().length || 0) >= 20) nodes.push(root);
  // Many documentation sites use plain leaf divs rather than paragraphs.
  for (const div of root.querySelectorAll('div')) {
    if (!div.querySelector(`${BLOCK},div,section,article,main`) && div.textContent && div.textContent.trim().length >= 20) nodes.push(div);
  }
  return nodes.filter(n => !excluded(n, extra) && !n.querySelector('table') && snapshot(n).text.length >= 2);
}
function copyStyle(source: Element, node: Element, properties: string[], inherit = false) {
  const style = inherit ? undefined : getComputedStyle(source), target = (node as HTMLElement).style;
  if (!target) return;
  target.setProperty('all', 'unset', 'important');
  for (const property of properties) {
    const value = inherit ? 'inherit' : style!.getPropertyValue(property);
    if (value) target.setProperty(property, value, 'important');
  }
}
function inlineClone(source: Element): Element {
  const name = source.localName.toLowerCase(), math = source.namespaceURI === 'http://www.w3.org/1998/Math/MathML' && MATH.has(name);
  const tag = INLINE.has(name) || ['code', 'kbd', 'samp', 'br'].includes(name) ? name : 'span';
  const node = math ? document.createElementNS(source.namespaceURI!, name) : document.createElement(tag);
  for (const attr of ['title', 'lang', 'dir']) if (source.hasAttribute(attr)) node.setAttribute(attr, source.getAttribute(attr)!);
  if (math) for (const attr of source.attributes) if (MATH_ATTRS.has(attr.name)) node.setAttribute(attr.name, attr.value);
  if (name === 'a') {
    // Only the original local link may be reused. Never read an attribute from model output.
    const href = source.getAttribute('href');
    try {
      const url = new URL(href || '', document.baseURI);
      if (href && ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) node.setAttribute('href', url.href);
    } catch {}
    if (source.getAttribute('target') === '_blank') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
  }
  copyStyle(source, node, INLINE_STYLE);
  return node;
}
function protectedClone(source: Element): Element {
  const node = inlineClone(source);
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) node.append(document.createTextNode(child.textContent || ''));
    else if (child instanceof Element && !child.matches(SKIP)) node.append(protectedClone(child));
  }
  return node;
}
export function appendTranslation(element: Element, text: string, protectedText: Record<string, string>): HTMLElement {
  const source = capture(element);
  if (!sameFormat(source.text, text) || JSON.stringify(source.protected) !== JSON.stringify(protectedText)) {
    throw new AppError('invalid_markers', '译文格式与当前原文不匹配，请重试该段落。');
  }
  const node = document.createElement('span'); node.setAttribute(OWN, 'translation'); node.className = 'tmp-translation';
  // Share the original block's box and typography, without repeating its padding, background,
  // list marker or table cell. Explicit inheritance defeats page-wide span styles and follows
  // responsive sizing, hover colors and font loading automatically.
  copyStyle(element, node, TYPOGRAPHY, true); node.style.setProperty('display', 'block', 'important');
  const stack: Element[] = [node]; let offset = 0;
  for (const token of formatTokens(text)) {
    stack.at(-1)!.append(document.createTextNode(text.slice(offset, token.offset))); offset = token.offset + token.raw.length;
    if (token.kind === 'c') { stack.pop(); continue; }
    const template = source.templates.get(token.raw)!;
    if (token.kind === 'o') { const child = inlineClone(template.source!); stack.at(-1)!.append(child); stack.push(child); }
    else if (token.kind === 'br') stack.at(-1)!.append(template.newline ? document.createTextNode('\n') : inlineClone(template.source!));
    else stack.at(-1)!.append(template.source ? protectedClone(template.source) : document.createTextNode(template.literal!));
  }
  node.append(document.createTextNode(text.slice(offset)));
  // Stay inside the actual paragraph/heading/list item/cell to inherit its complete context.
  // Direct list-item text belongs before any nested paragraphs or sublists.
  const nested = [...element.children].find(child => child.matches(`${BLOCK},ul,ol,table`));
  element.insertBefore(node, nested || null);
  return node;
}
