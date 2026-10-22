// Only these opaque markers cross the model boundary. DOM, CSS and link targets stay on the page.
export const FORMAT_TOKEN = /⟦TMP:(?:(o|c|br):)?(\d+)⟧/g;
export interface FormatToken { raw: string; kind: 'o' | 'c' | 'br' | 'atom'; id: string; offset: number }
export function formatTokens(text: string): FormatToken[] {
  return [...text.matchAll(new RegExp(FORMAT_TOKEN))].map(m => ({ raw: m[0], kind: (m[1] || 'atom') as FormatToken['kind'], id: m[2], offset: m.index! }));
}
function structure(text: string): string[] | undefined {
  if (text.replace(new RegExp(FORMAT_TOKEN), '').includes('⟦TMP:')) return;
  const stack: string[] = [], seen = new Set<string>(), result: string[] = []; let line = 0;
  for (const t of formatTokens(text)) {
    if (seen.has(t.raw)) return;
    seen.add(t.raw);
    if (t.kind === 'c') {
      if (stack.pop() !== t.id) return;
    }
    result.push(`${t.raw}@${stack.join('/')}@${line}`);
    if (t.kind === 'o') stack.push(t.id);
    if (t.kind === 'br') line++;
  }
  if (stack.length) return;
  return result.sort();
}
export function sameFormat(source: string, translated: string): boolean {
  const a = structure(source), b = structure(translated);
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}
export function validSourceFormat(text: string, protectedText: Record<string, string>): boolean {
  if (!structure(text)) return false;
  return JSON.stringify(formatTokens(text).filter(t => t.kind === 'atom').map(t => t.raw).sort()) === JSON.stringify(Object.keys(protectedText).sort());
}
export function protectLiteralMarkers(value: string): { text: string; protected: Record<string, string> } {
  const protect: Record<string, string> = {};
  const text = value.replace(/⟦TMP:[^⟧]*(?:⟧|$)/g, literal => {
    const token = `⟦TMP:${Object.keys(protect).length}⟧`; protect[token] = literal; return token;
  });
  return { text, protected: protect };
}
