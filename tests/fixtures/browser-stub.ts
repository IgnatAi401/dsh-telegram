// Stands in for the browser libraries the DSH shell supplies to @deepseek-ai/dsh-client-ui-primitives
// (markdown, highlighting, icons, portals). The settings form model under test never uses them, but
// the bundle touches some at load, so every export is an inert value that can be called or read.
const inert: any = new Proxy(function inert() {}, {
  get: (_target, key) => key === Symbol.toPrimitive ? () => 0 : inert,
  apply: () => inert,
  construct: () => inert,
})

export default inert
export const { CODE_HIGHLIGHT_EXTENSIONS, attention, classifyCharacter, codes, constants, createCssVariablesTheme, createHighlighterCoreSync, createJavaScriptRegexEngine, createPortal, defaultJavaScriptRegexConstructor, factorySpace, fromMarkdown, gfm, gfmFromMarkdown, languageForPath, markdownLineEnding, math, mathFromMarkdown, normalizeUri, pathPartsOf, siAliexpress, siApple, siBaidu, siBilibili, siCsdn, siDuckduckgo, siEbay, siFacebook, siGithub, siGitlab, siGoogle, siInstagram, siJuejin, siMdnwebdocs, siNetflix, siNpm, siPypi, siQq, siQuora, siReddit, siSinaweibo, siSpotify, siStackoverflow, siTaobao, siTelegram, siTiktok, siV2ex, siWechat, siWhatsapp, siWikipedia, siX, siYcombinator, siYoutube, siZhihu, structuredPatch, types, unicodePunctuation } = new Proxy({}, { get: () => inert }) as Record<string, any>
