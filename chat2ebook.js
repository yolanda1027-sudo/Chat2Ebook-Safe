import { saveSettingsDebounced } from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";
import { getPresetManager } from "../../../preset-manager.js";


const extensionName = "chat2ebook";

// 固定随扩展发布的本地依赖：不在运行时执行第三方 CDN 代码。
const LIB_SOURCES = {
    jszip: [new URL('./vendor/jszip-3.10.1.min.js', import.meta.url).href],
    showdown: [new URL('./vendor/showdown-2.1.0.min.js', import.meta.url).href]
};

const defaultSettings = {
    title: "Chat2Ebook", author: "", exportStart: 0, exportEnd: 99999,
    exportUser: false, exportAI: true, hideAIName: true, chapterSplit: 1,
    allowExternalImages: false, exportReasoning: false, exportSwipes: false, extrasDisplay: 'popup'
};

let settings = {};
let dependenciesLoaded = false;
let lastSystemUser = ""; 

// ==========================================
// 1. 基础工具
// ==========================================
async function loadScriptChain(id, urls) {
    if (document.getElementById(id)) return Promise.resolve();
    return new Promise(async (resolve, reject) => {
        for (const url of urls) {
            try {
                await new Promise((res, rej) => {
                    const script = document.createElement('script');
                    script.id = id; script.src = url; script.onload = res;
                    script.onerror = () => { document.head.removeChild(script); rej(); };
                    document.head.appendChild(script);
                });
                resolve(); return;
            } catch (e) { continue; }
        }
        reject(`All sources failed for ${id}`);
    });
}

async function loadDependencies() {
    if (dependenciesLoaded) return;
    if (window.JSZip && window.showdown) { dependenciesLoaded = true; return; }
    toastr.info('正在加载本地导出组件...', 'Chat2Ebook Safe');
    try {
        await Promise.all([
            window.JSZip ? Promise.resolve() : loadScriptChain('c2e-zip', LIB_SOURCES.jszip),
            window.showdown ? Promise.resolve() : loadScriptChain('c2e-showdown', LIB_SOURCES.showdown)
        ]);
        dependenciesLoaded = true;
        toastr.success('导出引擎就绪');
    } catch (error) { toastr.error('组件加载失败'); }
}

function downloadFile(content, filename, mimeType) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function getContextCompat() {
    try { if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) return SillyTavern.getContext(); } catch(e) {}
    if (typeof getContext === 'function') return getContext();
    if (typeof characters !== 'undefined' && typeof this_chid !== 'undefined') return { characters: characters, characterId: this_chid, chat: window.chat };
    return null;
}

function getSTUserName() {
    const ctx = getContextCompat();
    return (ctx && ctx.name1) ? ctx.name1 : "User";
}

function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeFilename(value, fallback) {
    const cleaned = String(value ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 120);
    return cleaned || fallback;
}

function isSafeHref(value) {
    const v = String(value || '').trim();
    return /^(?:https?:|mailto:|#)/i.test(v);
}

function isSafeImage(value) {
    const v = String(value || '').trim();
    return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v)
        || (settings.allowExternalImages && /^https:\/\/[^\s]+$/i.test(v));
}

function sanitizeCssUrls(value) {
    return String(value || '').replace(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (whole, dq, sq, bare) => {
        const url = String(dq ?? sq ?? bare ?? '').trim();
        if (!isSafeImage(url)) return 'none';
        return `url("${url.replace(/[\\"]/g, '\\$&')}")`;
    });
}

function sanitizeStyle(value) {
    let v = sanitizeCssUrls(value);
    if (/expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding/i.test(v)) return '';
    return v.slice(0, 4000);
}

function sanitizeStylesheet(value) {
    let v = String(value || '').slice(0, 50000);
    // EPUB 可保留本地 CSS 排版与动画，但不得自动请求外部资源或使用旧式可执行 CSS。
    v = v.replace(/@import[\s\S]*?;/gi, '');
    v = sanitizeCssUrls(v);
    v = v.replace(/(?:expression|image-set|-webkit-image-set)\s*\([^)]*\)/gi, 'none');
    v = v.replace(/(?:behavior|-moz-binding)\s*:[^;}]+;?/gi, '');
    return v;
}

// 保留常见排版，但移除可执行内容、自动联网资源和危险 URL。
// 允许保留的 HTML 标签（状态栏、装饰栏等美化会用到）。
const ALLOWED_TAGS = new Set([
    'p', 'br', 'span', 'div', 'b', 'i', 'em', 'strong', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'small', 'big', 'mark',
    'q', 'cite', 'abbr', 'dfn', 'code', 'pre', 'kbd', 'samp', 'var', 'tt', 'blockquote', 'details', 'summary',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'img', 'a', 'font', 'center', 'ruby', 'rb', 'rt', 'rp', 'wbr', 'time', 'label', 'bdi', 'bdo',
    'section', 'article', 'header', 'footer', 'aside', 'nav', 'main', 'figure', 'figcaption', 'style'
]);
// 已知的 HTML 标签但不安全或无法用于 EPUB：保留为标签，随后在 cleanHtml 中整段删除（与之前的行为一致）。
const REMOVED_TAGS = new Set([
    'script', 'link', 'meta', 'title', 'object', 'embed', 'iframe', 'frame', 'frameset', 'svg', 'math', 'canvas', 'form',
    'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'base', 'audio', 'video', 'source', 'track',
    'template', 'noscript', 'head', 'html', 'body', 'dialog', 'picture', 'map', 'area', 'param'
]);

// 白名单以外的标签（例如 <writing_style:japanese>、<user_input>）以及单独出现的 < 转成文字显示，不当作标签解析。
function escapeUnknownTags(html) {
    return String(html ?? '').replace(/<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>|</g, token => {
        if (token === '<') return '&lt;';
        if (token.startsWith('<!--')) return token;
        const name = (token.match(/^<\/?([^\s\/>]+)/) || [])[1] || '';
        const lower = name.toLowerCase();
        if (!name.includes(':') && (ALLOWED_TAGS.has(lower) || REMOVED_TAGS.has(lower))) return token;
        return token.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    });
}

// XML 不允许的控制字符会让整页解析失败。
function stripInvalidXmlChars(value) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

// 以 XML 规则输出：<br/> 自闭合、&nbsp; 输出为实际字符、单独的 & < > 自动转义。
function serializeXhtml(root) {
    const serializer = new XMLSerializer();
    return Array.from(root.childNodes)
        .map(node => serializer.serializeToString(node))
        .join('')
        .replace(/(<[A-Za-z][^>]*?) xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '$1');
}

function cleanHtml(htmlContent, mode = 'epub') {
    // template 的内容不会进入活动文档，清理完成前不触发脚本或资源加载。
    const template = document.createElement('template');
    template.innerHTML = escapeUnknownTags(stripInvalidXmlChars(htmlContent || ''));
    const root = template.content;
    
    for (const styleElement of root.querySelectorAll('style')) {
        const safeCss = sanitizeStylesheet(styleElement.textContent);
        safeCss.trim() ? styleElement.textContent = safeCss : styleElement.remove();
    }

    const badTags = root.querySelectorAll([...REMOVED_TAGS].join(', '));
    for (let i = 0; i < badTags.length; i++) {
        badTags[i].remove();
    }

    // 保险：仍不在白名单内的元素（理论上不会出现）改成文字，保留其内容。
    for (const element of [...root.querySelectorAll('*')]) {
        if (!element.isConnected && !root.contains(element)) continue;
        const tag = element.localName;
        if (ALLOWED_TAGS.has(tag)) continue;
        const frag = document.createDocumentFragment();
        frag.append(document.createTextNode(`<${tag}>`), ...element.childNodes, document.createTextNode(`</${tag}>`));
        element.replaceWith(frag);
    }

    // 注释里的 "--" 在 XML 中不合法，直接移除。
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(c => c.remove());
    
    const allElements = root.querySelectorAll('*');
    for (const element of allElements) {
        for (const attr of [...element.attributes]) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'srcdoc' || name === 'id') {
                element.removeAttribute(attr.name);
            } else if (name === 'href' && !isSafeHref(attr.value)) {
                element.removeAttribute(attr.name);
            } else if ((name === 'src' || name === 'srcset') && (element.tagName !== 'IMG' || !isSafeImage(attr.value))) {
                element.removeAttribute(attr.name);
            } else if (name === 'style') {
                const safe = sanitizeStyle(attr.value);
                safe ? element.setAttribute('style', safe) : element.removeAttribute('style');
            } else if (!['href', 'src', 'alt', 'title', 'style', 'class', 'width', 'height', 'colspan', 'rowspan', 'align'].includes(name)) {
                element.removeAttribute(attr.name);
            }
        }
        if (element.tagName === 'A' && element.hasAttribute('href')) element.setAttribute('rel', 'noopener noreferrer');
    }

    if (mode === 'txt') {
        const textHolder = document.createElement('div');
        textHolder.appendChild(root.cloneNode(true));
        return textHolder.innerText.trim();
    }
    return serializeXhtml(root).trim();
}

// ==========================================
// 2. 核心：正则引擎
// ==========================================

function normalizeScript(script) {
    const pattern = script.regex || script.findRegex || script.find_regex || "";
    let replace = "";
    if (script.replaceString !== undefined) replace = script.replaceString;
    else if (script.replace_string !== undefined) replace = script.replace_string;
    else if (script.replacement !== undefined) replace = script.replacement;
    const flags = script.regexOptions || script.regexFlags || 'g';
    
    let finalPattern = pattern;
    let finalFlags = flags;
    if (typeof pattern === 'string' && pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        const match = pattern.match(/^\/(.*?)\/([gimsuy]*)$/);
        if (match) { finalPattern = match[1]; finalFlags = match[2] || flags; }
    }

    let placement = script.placement || [];
    if (!placement.length && script.source) {
        if (script.source.user_input) placement.push(1);
        if (script.source.ai_output) placement.push(2);
    }

    return {
        ...script,
        _name: script.scriptName || script.script_name || "Unknown",
        _pattern: finalPattern,
        _replace: replace,
        _flags: finalFlags,
        _placement: placement,
        _original: pattern,
        _minDepth: script.minDepth !== undefined ? script.minDepth : null,
        _maxDepth: script.maxDepth !== undefined ? script.maxDepth : null
    };
}

function getTextGenPresetScripts() {
    try {
        const manager = getPresetManager('openai');
        if (!manager) return [];
        const currentName = manager.getSelectedPresetName();
        if (!currentName) return [];
        
        const listData = manager.getPresetList();
        const presets = listData.presets;
        const nameMap = listData.preset_names;
        let presetObj = null;

        if (Array.isArray(nameMap)) {
            const idx = nameMap.indexOf(currentName);
            if (idx !== -1) presetObj = presets[idx];
        } else {
            const idx = nameMap[currentName];
            if (idx !== undefined) presetObj = presets[idx];
        }

        if (presetObj && presetObj.extensions && Array.isArray(presetObj.extensions.regex_scripts)) {
            console.log(`📦 [API] 成功提取预设 [${currentName}] 的 ${presetObj.extensions.regex_scripts.length} 个绑定正则`);
            return presetObj.extensions.regex_scripts.map(s => ({ ...s, _source: `Preset: ${currentName}` }));
        }
    } catch (e) { console.error(e); }
    return [];
}

// JS-Slash-Runner / TavernHelper 当前脚本的“区域”正则。
// 这些正则不会出现在全局、角色卡或预设设置中，需要通过 TavernHelper 读取。
function getScopedRegexScripts() {
    try {
        const helper = window.TavernHelper || window.tavernHelper;
        if (!helper || typeof helper.getTavernRegexes !== 'function') return [];
        const all = helper.getTavernRegexes({}) || [];
        if (!Array.isArray(all)) return [];
        return all
            .filter(s => s && ['scoped', 'script', 'local'].includes(String(s.scope || '').toLowerCase()))
            .map(s => ({ ...s, _source: 'Scoped' }));
    } catch (e) {
        console.warn('[Chat2Ebook Safe] 无法读取区域正则：', e);
        return [];
    }
}

function getAllRegexScripts() {
    let allScripts = [];
    const globalSettings = (typeof window !== 'undefined' && window.extension_settings) ? window.extension_settings : extension_settings;
    if (globalSettings) {
        if (Array.isArray(globalSettings.regex)) {
            allScripts = allScripts.concat(globalSettings.regex.map(s => ({...s, _source: 'Global'})));
        } else if (Array.isArray(globalSettings.regex_scripts)) {
            allScripts = allScripts.concat(globalSettings.regex_scripts.map(s => ({...s, _source: 'Global_Old'})));
        }
    }

    const ctx = getContextCompat();
    let charId = ctx ? ctx.characterId : (typeof this_chid !== 'undefined' ? this_chid : undefined);
    const charList = (ctx && ctx.characters) ? ctx.characters : (typeof characters !== 'undefined' ? characters : null);
    if (charId !== undefined && charList && charList[charId] && charList[charId].data?.extensions?.regex_scripts) {
        allScripts = allScripts.concat(charList[charId].data.extensions.regex_scripts.map(s => ({...s, _source: 'Character'})));
    }

    const presetScripts = getTextGenPresetScripts();
    allScripts = allScripts.concat(presetScripts);

    const scopedScripts = getScopedRegexScripts();
    allScripts = allScripts.concat(scopedScripts);

    let normalized = allScripts.map(normalizeScript);
    const active = normalized.filter(s => !s.disabled && s.enabled !== false && s._pattern);
    return active;
}

function applyScript(text, script, debugMode = false) {
    try {
        if (!script._pattern || script._pattern.length > 1000) return text;
        // 拒绝常见的嵌套量词，降低第三方角色卡正则造成页面冻结的概率。
        if (/\([^)]*[+*][^)]*\)[+*{]/.test(script._pattern)) return text;
        const re = new RegExp(script._pattern, script._flags);
        const newText = text.replace(re, script._replace);
        if (debugMode && newText !== text) {
            console.log(`%c   ⚡ [HIT] ${script._name}`, 'color: #0f0; font-weight: bold');
        }
        return newText;
    } catch (e) { return text; }
}

// placement: 1 = 用户输入, 2 = AI 输出, 6 = 思维链（与 SillyTavern 正则的作用范围一致）
// plainText = true：正则处理后把 & < > 全部转义，内容里的任何标签都只当文字显示（用于思维链）。
function renderText(rawText, isUser, scripts, depth, debugMode = false, placement = null, plainText = false) {
    if (!rawText) return "";
    let text = rawText;
    
    if (debugMode) console.groupCollapsed(`📝 Msg (Depth: ${depth})`);

    scripts.forEach(script => {
        const p = script._placement;
        const target = placement ?? (isUser ? 1 : 2);
        const isTarget = (!p || p.length === 0) || p.includes(target);
        
        let depthMatch = true;
        if (script._minDepth !== null && depth < script._minDepth) depthMatch = false;
        if (script._maxDepth !== null && depth > script._maxDepth) depthMatch = false;

        if (isTarget && depthMatch) {
            text = applyScript(text, script, debugMode);
        }
    });

    if (plainText) text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const converter = new showdown.Converter({ simpleLineBreaks: true, strikethrough: true, emoji: true, tables: true, literalMidWordUnderscores: true });
    let html = converter.makeHtml(text);
    
    if (debugMode) console.groupEnd();
    return html;
}

function getProcessedData() {
    const ctx = getContextCompat();
    const fullChat = ctx ? ctx.chat : (window.chat || []);
    if (!fullChat || fullChat.length === 0) return [];

    const activeScripts = getAllRegexScripts();
    const start = Math.max(0, settings.exportStart);
    const end = Math.min(fullChat.length - 1, settings.exportEnd);
    let data = [];
    let debugCounter = 0;

    for (let i = start; i <= end; i++) {
        const rawMsg = fullChat[i];
        if (!rawMsg) continue;

        const depth = fullChat.length - 1 - i;
        const isUser = rawMsg.is_user;
        if (isUser && !settings.exportUser) continue;
        if (!isUser && !settings.exportAI) continue;

        const name = rawMsg.name || (isUser ? "You" : "AI");
        
        const isDebug = debugCounter < 3;
        const htmlContent = renderText(rawMsg.mes || "", isUser, activeScripts, depth, isDebug);
        if (isDebug) debugCounter++;

        // 思维链：SillyTavern 解析后存放在 extra.reasoning
        const rawReasoning = (settings.exportReasoning && rawMsg.extra && typeof rawMsg.extra.reasoning === 'string') ? rawMsg.extra.reasoning.trim() : "";
        const reasoningHtml = rawReasoning ? renderText(rawReasoning, isUser, activeScripts, depth, false, 6, true) : "";

        // 其他 swipe 版本：swipes 为全部版本文本，swipe_id 为当前显示的版本（即 mes），swipe_info[k].extra 存放各版本的思维链
        const alternates = [];
        if (settings.exportSwipes && Array.isArray(rawMsg.swipes) && rawMsg.swipes.length > 1) {
            const currentId = Number.isInteger(rawMsg.swipe_id) ? rawMsg.swipe_id : -1;
            const swipeInfo = Array.isArray(rawMsg.swipe_info) ? rawMsg.swipe_info : [];
            rawMsg.swipes.forEach((swipeText, k) => {
                if (k === currentId || typeof swipeText !== 'string' || !swipeText.trim()) return;
                if (currentId === -1 && swipeText === rawMsg.mes) return;
                const swipeExtra = swipeInfo[k] && swipeInfo[k].extra;
                const swipeReasoning = (settings.exportReasoning && swipeExtra && typeof swipeExtra.reasoning === 'string') ? swipeExtra.reasoning.trim() : "";
                alternates.push({
                    number: k + 1,
                    html: renderText(swipeText, isUser, activeScripts, depth, false),
                    reasoningHtml: swipeReasoning ? renderText(swipeReasoning, isUser, activeScripts, depth, false, 6, true) : ""
                });
            });
        }
        const swipeTotal = Array.isArray(rawMsg.swipes) ? rawMsg.swipes.length : 1;

        data.push({ index: i, speaker: name, isUser: isUser, html: htmlContent, reasoningHtml: reasoningHtml, alternates: alternates, swipeTotal: swipeTotal, text: rawMsg.mes || "" });
    }
    return data;
}

// [修复] 字数统计逻辑
function countTotalWords(data) { 
    let c = 0; 
    data.forEach(i => { 
        if (i.html) {
            // 使用 cleanHtml 提取纯文本长度，这样才能排除被正则隐藏的内容和HTML标签
            // 之前的 i.text 是 rawMsg，包含了所有隐藏内容
            c += cleanHtml(i.html, 'txt').length; 
        }
    }); 
    return c; 
}

// --- XHTML 校验与纯文字退路 ---
function isValidXhtml(xhtml) {
    try {
        const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
        return doc.getElementsByTagName('parsererror').length === 0;
    } catch (e) { return false; }
}

function textToParagraphs(text) {
    return String(text || '').split(/\n+/).map(line => line.trim()).filter(Boolean)
        .map(line => `<p>${escapeHtml(stripInvalidXmlChars(line))}</p>`).join('');
}

function buildPlainTextChapter(msgs, chapterTitle) {
    let out = `<h2 style="text-align:center;margin-bottom:1.5em;color:#555">${escapeHtml(chapterTitle)}</h2><p style="color:#a66;font-size:0.85em;">（本章含有无法解析的格式，已改为纯文字显示）</p><hr/>`;
    msgs.forEach(ch => {
        const label = (settings.hideAIName && !ch.isUser) ? '' : `<p><strong>${escapeHtml(ch.speaker)}:</strong></p>`;
        let block = label;
        if (ch.reasoningHtml) block += `<p>【思维链】</p>${textToParagraphs(cleanHtml(ch.reasoningHtml, 'txt'))}<p>【思维链结束】</p>`;
        block += textToParagraphs(cleanHtml(ch.html, 'txt'));
        (ch.alternates || []).forEach(alt => {
            block += `<p>【其他版本 ${alt.number} / ${ch.swipeTotal}】</p>`;
            if (alt.reasoningHtml) block += `<p>【思维链】</p>${textToParagraphs(cleanHtml(alt.reasoningHtml, 'txt'))}<p>【思维链结束】</p>`;
            block += textToParagraphs(cleanHtml(alt.html, 'txt'));
        });
        out += `<div style="margin-bottom:1.5em;">${block}</div>`;
    });
    return out;
}

// --- Exports ---
async function exportEPUB() {
    if (!window.JSZip || !window.showdown) { await loadDependencies(); if(!window.JSZip) return; }
    const chaptersData = getProcessedData();
    if (!chaptersData.length) return toastr.warning('无内容');
    const zip = new JSZip();
    const title = settings.title || "Chat2Ebook";
    const author = settings.author || "SillyTavern";
    const safeTitle = escapeHtml(title);
    const safeAuthor = escapeHtml(author);
    const uuid = `urn:uuid:${Date.now()}`;
    const dateStr = new Date().toLocaleString();
    const totalWords = countTotalWords(chaptersData);
    const splitCount = settings.chapterSplit > 0 ? settings.chapterSplit : 1;
    const estimatedChapters = Math.ceil(chaptersData.length / splitCount);
    
    const fixXHTML = (html) => {
        if (!html) return "";
        return html.replace(/<br\s*\/?>/gi, "<br />").replace(/<hr\s*\/?>/gi, "<hr />").replace(/<img([^>]*)>/gi, (m,c)=>c.trim().endsWith('/')?m:`<img${c} />`);
    };

    const buildReasoningBlock = (reasoningHtml) => {
        if (!reasoningHtml) return '';
        const safeReasoning = fixXHTML(cleanHtml(reasoningHtml, 'epub'));
        if (!safeReasoning.trim()) return '';
        return `<div class="reasoning" style="margin:0 0 0.8em 0;padding:0.5em 0.8em;border-left:3px solid #999;background:#f4f4f4;color:#666;font-size:0.9em;line-height:1.5;"><p style="margin:0 0 0.3em 0;font-weight:bold;">💭 思维链</p>${safeReasoning}</div>`;
    };

    const usePopup = settings.extrasDisplay !== 'inline';

    const coverXhtml = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title><style>body{text-align:center;margin-top:30%;font-family:sans-serif;}</style></head><body><h1 style="font-size:2.5em;margin-bottom:0.5em;">${safeTitle}</h1><p style="font-size:1.5em;color:#555;">${safeAuthor}</p></body></html>`;
    const infoXhtml = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Info</title><style>body{padding:10%;font-family:sans-serif;line-height:1.8;}</style></head><body><h2 style="border-bottom:1px solid #ccc;padding-bottom:10px;">书籍信息</h2><p><strong>书名：</strong> ${safeTitle}</p><p><strong>作者：</strong> ${safeAuthor}</p><p><strong>章节数：</strong> 共 ${estimatedChapters} 章 (${chaptersData.length} 条对话)</p><p><strong>总字数：</strong> 约 ${totalWords} 字</p><p><strong>导出时间：</strong> ${escapeHtml(dateStr)}</p><p><strong>生成工具：</strong> Chat2Ebook Safe</p></body></html>`;
    let currentMsgs = [];
    let chapterIndex = 1;
    const chapterFiles = [];
    const failedChapters = [];
    
    for (let i = 0; i < chaptersData.length; i++) {
        currentMsgs.push(chaptersData[i]);
        if (currentMsgs.length >= splitCount || i === chaptersData.length - 1) {
            let bodyContent = '';
            const chapterTitle = `第 ${chapterIndex} 章`;
            if (splitCount > 1 || chapterIndex === 1) bodyContent += `<h2 style="text-align:center;margin-bottom:1.5em;color:#555">${chapterTitle}</h2><hr/>`;
            let notesContent = '';
            currentMsgs.forEach(ch => {
                const color = ch.isUser ? "#2c3e50" : "#800000";
                let speakerLabel = `<strong style="color:${color};display:block;margin-bottom:0.2em;">${escapeHtml(ch.speaker)}:</strong>`;
                if (settings.hideAIName && !ch.isUser) speakerLabel = '';
                const safeHtml = fixXHTML(cleanHtml(ch.html, 'epub'));
                const msgId = `m${ch.index}`;
                const reasoningBlock = buildReasoningBlock(ch.reasoningHtml);
                let swipeBlocks = '';
                (ch.alternates || []).forEach(alt => {
                    const altHtml = fixXHTML(cleanHtml(alt.html, 'epub'));
                    if (!altHtml.trim()) return;
                    swipeBlocks += `<div class="swipe" style="margin:1em 0 0 0;padding:0.6em 0.8em;border:1px dashed #b0a080;border-radius:4px;background:#fbf8f0;"><p style="margin:0 0 0.4em 0;font-size:0.85em;font-weight:bold;color:#8a6d3b;">🔀 其他版本 ${alt.number} / ${ch.swipeTotal}</p>${buildReasoningBlock(alt.reasoningHtml)}<div class="text" style="line-height:1.6;">${altHtml}</div></div>`;
                });

                if (usePopup) {
                    // 弹窗模式：正文只留一行小链接，内容放进章节末尾的 EPUB3 脚注（支持的阅读器会以弹窗显示）
                    const links = [];
                    const addNote = (noteId, label, inner) => {
                        links.push(`<a epub:type="noteref" role="doc-noteref" href="#${noteId}" style="text-decoration:none;color:#8a6d3b;">${label}</a>`);
                        notesContent += `<aside epub:type="footnote" role="doc-footnote" id="${noteId}" style="margin:1.5em 0;"><p style="margin:0 0 0.4em 0;"><a href="#${msgId}" style="font-size:0.85em;color:#888;text-decoration:none;">↩ 返回正文（第 ${ch.index} 楼）</a></p>${inner}</aside>`;
                    };
                    if (reasoningBlock) addNote(`r${ch.index}`, '💭 思维链', reasoningBlock);
                    if (swipeBlocks) addNote(`s${ch.index}`, `🔀 其他版本（${ch.alternates.length}）`, swipeBlocks);
                    const linkBar = links.length ? `<p class="extras" style="margin:0.4em 0 0 0;font-size:0.85em;">${links.join('　')}</p>` : '';
                    bodyContent += `<div class="msg" id="${msgId}" style="margin-bottom:1.5em;">${speakerLabel}<div class="text" style="line-height:1.6;">${safeHtml}</div>${linkBar}</div>`;
                } else {
                    bodyContent += `<div class="msg" id="${msgId}" style="margin-bottom:1.5em;">${speakerLabel}${reasoningBlock}<div class="text" style="line-height:1.6;">${safeHtml}</div>${swipeBlocks}</div>`;
                }
            });
            if (notesContent) bodyContent += `<hr style="margin-top:3em;"/><section class="notes" style="font-size:0.95em;">${notesContent}</section>`;
            const wrapPage = (content) => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN"><head><meta charset="utf-8"/><title>${safeTitle}</title><style>body{font-family:sans-serif;padding:5%;}img{max-width:100%;}</style></head><body>${content}</body></html>`;
            let xhtml = wrapPage(bodyContent);
            if (!isValidXhtml(xhtml)) {
                // 保险：这一页仍无法按 XHTML 解析时，整页退回纯文字版本，避免阅读器显示红框并截断内容。
                xhtml = wrapPage(buildPlainTextChapter(currentMsgs, chapterTitle));
                failedChapters.push(chapterIndex);
            }
            chapterFiles.push({ id: `ch${chapterIndex}`, title: chapterTitle, filename: `chapter${chapterIndex}.xhtml`, content: xhtml });
            currentMsgs = [];
            chapterIndex++;
        }
    }
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.folder("META-INF").file("container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    const oebps = zip.folder("OEBPS");
    oebps.file("cover.xhtml", coverXhtml);
    oebps.file("info.xhtml", infoXhtml);
    let manifest = `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="info" href="info.xhtml" media-type="application/xhtml+xml"/>`;
    let spine = `<itemref idref="cover"/><itemref idref="info"/>`;
    let navList = `<li><a href="cover.xhtml">封面</a></li><li><a href="info.xhtml">信息页</a></li>`;
    let navMap = `<navPoint id="nav_cover" playOrder="0"><navLabel><text>封面</text></navLabel><content src="cover.xhtml"/></navPoint><navPoint id="nav_info" playOrder="0"><navLabel><text>信息页</text></navLabel><content src="info.xhtml"/></navPoint>`;
    chapterFiles.forEach((ch, idx) => {
        manifest += `<item id="${ch.id}" href="${ch.filename}" media-type="application/xhtml+xml"/>`;
        spine += `<itemref idref="${ch.id}"/>`;
        navList += `<li><a href="${ch.filename}">${ch.title}</a></li>`;
        navMap += `<navPoint id="nav${idx+1}" playOrder="${idx+1}"><navLabel><text>${ch.title}</text></navLabel><content src="${ch.filename}"/></navPoint>`;
        oebps.file(ch.filename, ch.content);
    });
    const opf = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta><dc:title>${safeTitle}</dc:title><dc:creator>${safeAuthor}</dc:creator><dc:language>zh-CN</dc:language><dc:identifier id="BookID">${uuid}</dc:identifier></metadata><manifest>${manifest}</manifest><spine toc="ncx">${spine}</spine></package>`;
    oebps.file("content.opf", opf);
    oebps.file("nav.xhtml", `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN"><head><meta charset="utf-8"/><title>${safeTitle}</title></head><body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>${navList}</ol></nav></body></html>`);
    oebps.file("toc.ncx", `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uuid}"/></head><docTitle><text>${safeTitle}</text></docTitle><navMap>${navMap}</navMap></ncx>`);
    zip.generateAsync({ type: "blob" }).then(c => downloadFile(c, `${safeFilename(title, 'Chat2Ebook')}.epub`, "application/epub+zip"));
    toastr.success(`EPUB 导出成功`);
    if (failedChapters.length) toastr.warning(`第 ${failedChapters.join('、')} 章有格式问题，已用纯文字导出`);
}

function exportTXT() {
    if (!window.showdown) { loadDependencies().then(exportTXT); return; }
    const data = getProcessedData();
    if (!data.length) return toastr.warning('无内容');
    const dateStr = new Date().toLocaleString();
    const totalWords = countTotalWords(data);
    const estimatedChapters = Math.ceil(data.length / (settings.chapterSplit || 1));
    const separator = "=".repeat(30);
    let text = `\n${separator}\n      ${settings.title}\n      By ${settings.author}\n${separator}\n\n【书籍信息】\n书名：${settings.title}\n作者：${settings.author}\n章节数：共 ${estimatedChapters} 章 (${data.length} 条对话)\n总字数：约 ${totalWords} 字\n导出时间：${dateStr}\n生成工具：Chat2Ebook\n\n${separator}\n【正文开始】\n\n`;
    
    data.forEach(ch => {
        let label = (settings.hideAIName && !ch.isUser) ? "" : `${ch.speaker}:\n`;
        const cleanContent = cleanHtml(ch.html, 'txt');
        const reasoningText = ch.reasoningHtml ? cleanHtml(ch.reasoningHtml, 'txt').trim() : "";
        const reasoningPart = reasoningText ? `【思维链】\n${reasoningText}\n【思维链结束】\n\n` : "";
        let swipePart = "";
        (ch.alternates || []).forEach(alt => {
            const altText = cleanHtml(alt.html, 'txt').trim();
            if (!altText) return;
            const altReasoning = alt.reasoningHtml ? cleanHtml(alt.reasoningHtml, 'txt').trim() : "";
            swipePart += `\n\n【其他版本 ${alt.number} / ${ch.swipeTotal}】\n${altReasoning ? `【思维链】\n${altReasoning}\n【思维链结束】\n\n` : ""}${altText}`;
        });
        text += `${label}${reasoningPart}${cleanContent}${swipePart}\n\n${'-'.repeat(20)}\n\n`;
    });
    downloadFile(text, `${safeFilename(settings.title, 'Chat2Ebook')}.txt`, 'text/plain');
    toastr.success('TXT 导出成功');
}

// UI
function updateUI() {
    $('#c2e-title').val(settings.title);
    $('#c2e-author').val(settings.author);
    $('#c2e-start').val(settings.exportStart);
    $('#c2e-end').val(settings.exportEnd);
    $('#c2e-chapter-split').val(settings.chapterSplit);
    $('#c2e-user').prop('checked', settings.exportUser);
    $('#c2e-ai').prop('checked', settings.exportAI);
    $('#c2e-hide-ai-name').prop('checked', settings.hideAIName);
    $('#c2e-external-images').prop('checked', settings.allowExternalImages);
    $('#c2e-reasoning').prop('checked', settings.exportReasoning);
    $('#c2e-swipes').prop('checked', settings.exportSwipes);
    $('#c2e-extras-display').val(settings.extrasDisplay === 'inline' ? 'inline' : 'popup');
    updateTotalFloors();
}
function getTotalFloors() { const ctx = getContextCompat(); return (ctx && ctx.chat) ? ctx.chat.length : 0; }

function updateTotalFloors() { 
    $('#c2e-total-count').text(`共 ${getTotalFloors()} 条记录`); 
    const currentUser = getSTUserName();
    if (currentUser !== lastSystemUser) {
        if (settings.author === lastSystemUser || settings.author === "SillyTavern User") {
            settings.author = currentUser;
            $('#c2e-author').val(currentUser);
            saveSettingsDebounced();
        }
        lastSystemUser = currentUser;
    }
}

function createUI() {
    const html = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>📖 Chat2Ebook：所见即所得</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content">
            <div class="c2e-panel">
                <div id="c2e-total-count" style="text-align:center; margin-bottom:15px; background:rgba(0,0,0,0.2); padding:8px; border-radius:4px; font-size:0.9em;">统计中...</div>
                <div class="c2e-grid"><div class="c2e-input-group"><label>书名</label><input type="text" id="c2e-title" class="text_pole"></div><div class="c2e-input-group"><label>作者</label><input type="text" id="c2e-author" class="text_pole" placeholder="默认使用用户名"></div></div>
                <div class="c2e-grid"><div class="c2e-input-group"><label>起始楼层</label><input type="number" id="c2e-start" class="text_pole"></div><div class="c2e-input-group"><label>结束楼层</label><input type="number" id="c2e-end" class="text_pole"></div></div>
                <div class="c2e-grid"><div class="c2e-input-group"><label>EPUB 分章 (每章楼层数)</label><input type="number" id="c2e-chapter-split" class="text_pole" placeholder="默认 1"></div><div class="c2e-input-group"><label>EPUB 思维链/swipe 显示</label><select id="c2e-extras-display" class="text_pole"><option value="popup">弹窗（点链接查看）</option><option value="inline">直接展开</option></select></div></div>
                <div class="c2e-vertical-group">
                    <label class="c2e-checkbox-label"><span class="fa-solid fa-user" style="width:16px; text-align:center;"></span><input type="checkbox" id="c2e-user"> 包含用户</label>
                    <label class="c2e-checkbox-label"><span class="fa-solid fa-robot" style="width:16px; text-align:center;"></span><input type="checkbox" id="c2e-ai"> 包含 AI</label>
                    <label class="c2e-checkbox-label" style="color:#ffaaaa;"><span class="fa-solid fa-eye-slash" style="width:16px; text-align:center;"></span><input type="checkbox" id="c2e-hide-ai-name"> 隐藏 AI 名</label>
                    <label class="c2e-checkbox-label"><span class="fa-solid fa-lightbulb" style="width:16px; text-align:center;"></span><input type="checkbox" id="c2e-reasoning"> 包含思维链</label>
                    <label class="c2e-checkbox-label"><span class="fa-solid fa-shuffle" style="width:16px; text-align:center;"></span><input type="checkbox" id="c2e-swipes"> 包含其他 swipe 版本</label>
                    <label class="c2e-checkbox-label"><span class="fa-solid fa-image" style="width:16px; text-align:center;"></span><input type="checkbox" id="c2e-external-images"> 允许 HTTPS 外部图片（会连接图片网站）</label>
                </div>
                <hr class="c2e-divider">
                <div class="c2e-section-title">安全导出格式</div>
                <div class="c2e-btn-group"><div id="btn-epub" class="c2e-btn btn-primary">📱 EPUB</div><div id="btn-txt" class="c2e-btn btn-txt">📄 TXT</div></div>
            </div>
        </div>
    </div>`;
    $('#extensions_settings').append(html);
    $('#c2e-title').on('input', function(){ settings.title = $(this).val(); saveSettingsDebounced(); });
    $('#c2e-author').on('input', function(){ settings.author = $(this).val(); saveSettingsDebounced(); });
    $('#c2e-start').on('change', function(){ settings.exportStart = Number($(this).val()); saveSettingsDebounced(); });
    $('#c2e-end').on('change', function(){ settings.exportEnd = Number($(this).val()); saveSettingsDebounced(); });
    $('#c2e-chapter-split').on('change', function(){ settings.chapterSplit = Number($(this).val()); saveSettingsDebounced(); });
    $('#c2e-user').on('change', function(){ settings.exportUser = $(this).prop('checked'); saveSettingsDebounced(); });
    $('#c2e-ai').on('change', function(){ settings.exportAI = $(this).prop('checked'); saveSettingsDebounced(); });
    $('#c2e-hide-ai-name').on('change', function(){ settings.hideAIName = $(this).prop('checked'); saveSettingsDebounced(); });
    $('#c2e-external-images').on('change', function(){ settings.allowExternalImages = $(this).prop('checked'); saveSettingsDebounced(); });
    $('#c2e-reasoning').on('change', function(){ settings.exportReasoning = $(this).prop('checked'); saveSettingsDebounced(); });
    $('#c2e-extras-display').on('change', function(){ settings.extrasDisplay = $(this).val(); saveSettingsDebounced(); });
    $('#c2e-swipes').on('change', function(){ settings.exportSwipes = $(this).prop('checked'); saveSettingsDebounced(); });
    $('#btn-epub').click(exportEPUB);
    $('#btn-txt').click(exportTXT);
    setInterval(updateTotalFloors, 2000);
}

jQuery(async () => {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    settings = Object.assign({}, defaultSettings, extension_settings[extensionName]);
    const ctx = getContextCompat();
    
    // 初始化默认值
    if (!settings.title || settings.title === "Chat Export") settings.title = (ctx && ctx.name2) ? ctx.name2 : "Chat2Ebook";
    
    // 初始化作者名
    lastSystemUser = getSTUserName();
    if (!settings.author || settings.author === "SillyTavern User") settings.author = lastSystemUser;

    createUI();
    updateUI();
    loadDependencies();
    console.log('[Chat2Ebook] V0.0.2 Loaded');
});
