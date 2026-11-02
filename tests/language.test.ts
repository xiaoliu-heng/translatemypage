import test from 'node:test';
import assert from 'node:assert/strict';
import { alreadyTargetLanguage, identicalTranslation, sameLanguage } from '../src/extension/language';

const settings = { sourceLanguage: 'auto', targetLanguage: 'zh-CN' };
function installDetector(result: chrome.i18n.LanguageDetectionResult) {
  let calls = 0;
  Object.assign(globalThis, { chrome: { i18n: { async detectLanguage() { calls++; return result; } } } });
  return () => calls;
}
test('ordinary locale variants match but known scripts remain distinct', () => {
  assert.equal(sameLanguage('en-US', 'en'), true);
  assert.equal(sameLanguage('pt-BR', 'pt-PT'), true);
  assert.equal(sameLanguage('zh-CN', 'zh-Hans'), true);
  assert.equal(sameLanguage('zh-TW', 'zh-CN'), false);
  assert.equal(sameLanguage('sr-Latn', 'sr-Cyrl'), false);
  assert.equal(sameLanguage('auto', 'auto'), false);
});
test('explicit matching source skips without invoking the detector', async () => {
  const calls = installDetector({ isReliable: false, languages: [] });
  assert.equal(await alreadyTargetLanguage('Already English.', { sourceLanguage: 'en-US', targetLanguage: 'en' }), true);
  assert.equal(calls(), 0);
});
test('reliable native generic Chinese respects script evidence without inventing a detector script', async () => {
  installDetector({ isReliable: true, languages: [{ language: 'zh', percentage: 100 }] });
  assert.equal(await alreadyTargetLanguage('中文正文。', settings), true);
  assert.equal(await alreadyTargetLanguage('中文正文。', settings, 'zh-CN'), true);
  assert.equal(await alreadyTargetLanguage('中文正文。', settings, 'zh-TW'), false);
  assert.equal(await alreadyTargetLanguage('中文正文。', { ...settings, sourceLanguage: 'zh-TW' }, 'zh-CN'), false);
  assert.equal(await alreadyTargetLanguage('中文正文。', { ...settings, targetLanguage: 'zh-TW' }, 'zh-Hant'), true);
});
test('foreign blocks do not inherit same-target skipping from document language', async () => {
  installDetector({ isReliable: true, languages: [{ language: 'en', percentage: 100 }] });
  assert.equal(await alreadyTargetLanguage('Foreign English paragraph.', settings, 'zh-CN'), false);
});
test('short text skips only when its detector language agrees with a same-target local language hint', async () => {
  installDetector({ isReliable: false, languages: [{ language: 'zh', percentage: 100 }] });
  assert.equal(await alreadyTargetLanguage('关于我们', settings, 'zh-CN'), true);
  assert.equal(await alreadyTargetLanguage('关于我们', settings), false);
  assert.equal(await alreadyTargetLanguage('關於我們', settings, 'zh-TW'), false);
  installDetector({ isReliable: false, languages: [{ language: 'en', percentage: 100 }] });
  assert.equal(await alreadyTargetLanguage('Features', { ...settings, targetLanguage: 'en' }, 'en-US'), true);
  assert.equal(await alreadyTargetLanguage('Features', settings, 'zh-CN'), false);
  installDetector({ isReliable: false, languages: [{ language: 'sr', percentage: 100 }] });
  assert.equal(await alreadyTargetLanguage('Hello', { ...settings, targetLanguage: 'en' }, 'en'), false);
});
test('unknown, unreliable, mixed and failed detection stay conservative', async () => {
  for (const result of [
    { isReliable: false, languages: [{ language: 'zh', percentage: 100 }] },
    { isReliable: true, languages: [{ language: 'und', percentage: 100 }] },
    { isReliable: true, languages: [{ language: 'zh', percentage: 75 }, { language: 'en', percentage: 25 }] },
    { isReliable: true, languages: [] },
  ]) {
    installDetector(result);
    assert.equal(await alreadyTargetLanguage('Potentially mixed content.', settings), false);
  }
  Object.assign(globalThis, { chrome: { i18n: { async detectLanguage() { throw new Error('Unavailable local detector'); } } } });
  assert.equal(await alreadyTargetLanguage('Content.', settings), false);
});
test('duplicate safeguard compares visible text, preserving literal marker content', () => {
  assert.equal(identicalTranslation('Read ⟦TMP:o:0⟧this⟦TMP:c:0⟧ ⟦TMP:1⟧', ' Read ⟦TMP:o:0⟧this⟦TMP:c:0⟧   ⟦TMP:1⟧ ', { '⟦TMP:1⟧': 'code()' }), true);
  assert.equal(identicalTranslation('Read this', '阅读这里', {}), false);
  assert.equal(identicalTranslation('Literal ⟦TMP:0⟧', 'Literal', { '⟦TMP:0⟧': '⟦TMP:o:99⟧' }), false);
});
