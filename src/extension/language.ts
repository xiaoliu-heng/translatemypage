import { Settings } from '../shared/protocol';

function languageTag(raw: string): { language: string; script: string } {
  const parts = raw.trim().toLowerCase().replace(/_/g, '-').split('-');
  let script = parts.find(p => /^[a-z]{4}$/.test(p)) || '';
  if (parts[0] === 'zh' && !script) {
    if (parts.some(p => ['cn', 'sg'].includes(p))) script = 'hans';
    if (parts.some(p => ['tw', 'hk', 'mo'].includes(p))) script = 'hant';
  }
  return { language: parts[0], script };
}
export function sameLanguage(a: string, b: string): boolean {
  const left = languageTag(a), right = languageTag(b);
  return !!left.language && left.language !== 'auto' && left.language !== 'und' && left.language === right.language && left.script === right.script;
}
export function visibleText(text: string, protectedText: Record<string, string>): string {
  return text.replace(/⟦TMP:(?:(o|c|br):)?\d+⟧/g, (token: string, kind: string | undefined) => kind === 'br' ? '\n' : kind ? '' : protectedText[token] ?? token).replace(/\s+/g, ' ').trim();
}
export function identicalTranslation(source: string, translated: string, protectedText: Record<string, string>): boolean {
  return visibleText(source, protectedText) === visibleText(translated, protectedText);
}
export async function alreadyTargetLanguage(text: string, settings: Pick<Settings, 'sourceLanguage' | 'targetLanguage'>, hint = ''): Promise<boolean> {
  if (sameLanguage(settings.sourceLanguage, settings.targetLanguage)) return true;
  if (!chrome.i18n?.detectLanguage) return false;
  try {
    const result = await chrome.i18n.detectLanguage(text);
    const sorted = [...result.languages].sort((a, b) => b.percentage - a.percentage);
    const best = sorted[0];
    if (!best || best.percentage < 70 || sorted.slice(1).some(entry => entry.percentage >= 20)) return false;
    const detected = languageTag(best.language), local = languageTag(hint);
    // Short text needs agreement between the local detector and the element's language hint.
    if (!result.isReliable && (!local.language || local.language !== detected.language)) return false;
    if (sameLanguage(best.language, settings.targetLanguage)) return true;
    const target = languageTag(settings.targetLanguage);
    if (detected.language !== 'zh' || detected.script || target.language !== 'zh') return false;
    // Native Chromium reports both Chinese scripts as "zh". A known source/local script
    // must still convert when different; without script evidence, match the Chinese family.
    const source = languageTag(settings.sourceLanguage);
    const script = source.language === 'zh' && source.script ? source.script : local.language === 'zh' ? local.script : '';
    return !target.script || !script || script === target.script;
  } catch { return false; }
}
