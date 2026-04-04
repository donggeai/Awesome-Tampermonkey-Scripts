// ==UserScript==
// @name         钉钉AI听记导出神器 (DingTalk AI Transcript Exporter)
// @namespace    https://github.com/awesome-tampermonkey
// @version      1.0.0
// @description  一键导出钉钉AI听记的转写内容、AI纪要和章节信息，支持Markdown、HTML、TXT格式导出和复制
// @author       东哥说AI
// @match        https://shanji.dingtalk.com/app/transcribes/*
// @grant        none
// @license      MIT
// @downloadURL  https://github.com/donggeai/Awesome-Tampermonkey-Scripts/blob/master/DingTalkTranscriptExporter/DingTalkTranscriptExporter.user.js
// @updateURL    https://github.com/donggeai/Awesome-Tampermonkey-Scripts/blob/master/DingTalkTranscriptExporter/DingTalkTranscriptExporter.user.js
// ==/UserScript==

(function() {
    'use strict';

    // 配置常量
    const CONFIG = {
        BUTTON_STYLE: `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            background: linear-gradient(135deg, #1677ff 0%, #0958d9 100%);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 12px 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(22, 119, 255, 0.4);
            transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `,
        MODAL_STYLE: `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10001;
            display: flex;
            justify-content: center;
            align-items: center;
        `,
        MODAL_CONTENT_STYLE: `
            background: white;
            border-radius: 12px;
            padding: 30px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `
    };

    // 工具函数
    const utils = {
        // 获取听记标题
        getTitle() {
            const breadcrumb = document.querySelector('.fm-split-panel');
            if (breadcrumb) {
                const rootArea = document.querySelector('title');
                if (rootArea) return rootArea.textContent.trim();
            }
            const titleEl = document.title;
            return titleEl || '钉钉AI听记';
        },

        // 延时函数
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        // 查找转写区域的真正滚动容器
        // 钉钉AI听记使用虚拟滚动，真正的滚动容器是
        // .fm-transcribe-text__variable-size-list 的第一个子div（无class，overflowY: scroll）
        findScrollContainer() {
            // 方法1：从已知的外层容器找到内部滚动div
            const outerContainer = document.querySelector('.fm-transcribe-text__variable-size-list');
            if (outerContainer && outerContainer.children.length > 0) {
                const firstChild = outerContainer.children[0];
                if (firstChild && getComputedStyle(firstChild).overflowY === 'scroll') {
                    return firstChild;
                }
            }

            // 方法2：从段落元素向上查找可滚动的父容器
            const paragraphItem = document.querySelector('.fm-paragraph-item');
            if (paragraphItem) {
                let el = paragraphItem.parentElement;
                while (el) {
                    const style = getComputedStyle(el);
                    if (el.scrollHeight > el.clientHeight + 10 &&
                        (style.overflowY === 'auto' || style.overflowY === 'scroll')) {
                        return el;
                    }
                    el = el.parentElement;
                }
            }

            return null;
        },

        // 获取转写内容（支持虚拟滚动）
        async getTranscriptContent() {
            const scrollContainer = this.findScrollContainer();

            if (!scrollContainer) {
                return this.getTranscriptContentFallback();
            }

            // 检查是否需要滚动（内容高度大于可见高度）
            if (scrollContainer.scrollHeight <= scrollContainer.clientHeight + 10) {
                return this.getTranscriptContentFallback();
            }

            const originalScrollTop = scrollContainer.scrollTop;
            let allContent = new Map();

            try {
                // 滚动到顶部开始收集
                scrollContainer.scrollTop = 0;
                await this.sleep(300);

                // 持续向下滚动直到底部，不设上限（参考腾讯会议脚本的做法）
                let lastScrollTop = -1;

                while (scrollContainer.scrollTop !== lastScrollTop) {
                    lastScrollTop = scrollContainer.scrollTop;

                    // 收集当前可见的段落
                    this.collectParagraphs(allContent);

                    // 向下滚动一屏
                    scrollContainer.scrollTop += scrollContainer.clientHeight;
                    await this.sleep(100); // 等待虚拟滚动渲染新内容
                }

                // 到底后最后再收集一次确保不漏
                this.collectParagraphs(allContent);

                // 恢复原始滚动位置
                scrollContainer.scrollTop = originalScrollTop;

                // 按时间排序返回（支持 HH:MM:SS 和 MM:SS 格式）
                const result = Array.from(allContent.values());
                result.sort((a, b) => {
                    const toSeconds = (t) => {
                        const parts = t.split(':').map(Number);
                        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
                        if (parts.length === 2) return parts[0] * 60 + parts[1];
                        return 0;
                    };
                    return toSeconds(a.time) - toSeconds(b.time);
                });
                return result;

            } catch (error) {
                console.error('获取转写内容时出错:', error);
                scrollContainer.scrollTop = originalScrollTop;
                return this.getTranscriptContentFallback();
            }
        },

        // 收集当前DOM中可见的所有段落内容
        collectParagraphs(contentMap) {
            const items = document.querySelectorAll('.fm-paragraph-item');
            items.forEach(item => {
                const speakerEl = item.querySelector('.fm-speaker-name-widget-v2__name');
                const timeEl = item.querySelector('.fm-paragraph-title__time');
                const contentEl = item.querySelector('.fm-paragraph-editor__content');

                if (speakerEl && contentEl && contentEl.textContent.trim()) {
                    const speaker = speakerEl.textContent.trim();
                    const time = timeEl ? timeEl.textContent.trim() : '';
                    const text = contentEl.textContent.trim();
                    // 使用 时间+发言人+内容前30字符 作为去重键
                    const key = `${time}_${speaker}_${text.substring(0, 30)}`;

                    if (!contentMap.has(key)) {
                        contentMap.set(key, { speaker, time, text });
                    }
                }
            });
        },

        // 降级方法：获取当前可见的转写内容（不滚动）
        getTranscriptContentFallback() {
            const allContent = new Map();
            this.collectParagraphs(allContent);
            return Array.from(allContent.values());
        },

        // 点击指定文本的Tab并等待内容就绪
        async switchTab(keyword) {
            const tabs = document.querySelectorAll('[role="tab"]');
            let targetTab = null;
            tabs.forEach(tab => {
                // 使用 includes 匹配关键词，避免空格类型（普通空格/不间断空格）不一致的问题
                if (tab.textContent.includes(keyword)) {
                    targetTab = tab;
                }
            });

            if (targetTab && targetTab.getAttribute('aria-selected') !== 'true') {
                targetTab.click();
                await this.sleep(300);
            }
        },

        // 获取AI纪要内容（保留格式的Markdown转换）
        async getAISummaryContent() {
            // 切换到AI纪要Tab（使用关键词匹配，兼容不间断空格）
            await this.switchTab('纪要');

            // 等待DOM渲染就绪
            let editorContent = null;
            for (let i = 0; i < 10; i++) {
                editorContent = document.querySelector('.fm-full-text-summary__content .tiptap-editor-content');
                if (editorContent) break;
                await this.sleep(200);
            }

            if (!editorContent) return null;

            // 趁AI纪要Tab激活，缓存元信息供后续格式化使用
            this._cachedMeta = null; // 清除旧缓存，让 getMetaInfo 重新从DOM读取
            this._cachedMeta = this.getMetaInfo();

            return {
                html: editorContent.innerHTML,
                markdown: this.htmlToMarkdown(editorContent),
                imageUrl: this.getAISummaryImage()
            };
        },

        // 获取AI纪要图片URL
        getAISummaryImage() {
            const img = document.querySelector('.fm-cover-img');
            if (img && img.tagName === 'IMG') {
                return img.src;
            }
            // 可能图片在 tiptap 编辑器内
            const editorImg = document.querySelector('.tiptap-editor-content img.fm-cover-img');
            if (editorImg) {
                return editorImg.src;
            }
            return '';
        },

        // HTML转Markdown（保留标题、列表、加粗等格式）
        htmlToMarkdown(container) {
            let md = '';
            const children = container.children;

            for (let i = 0; i < children.length; i++) {
                const el = children[i];
                md += this.elementToMarkdown(el, 0);
            }

            return md.replace(/\n{3,}/g, '\n\n').trim();
        },

        // 单个元素转Markdown
        elementToMarkdown(el, depth) {
            const tagName = el.tagName.toLowerCase();

            // 跳过 ProseMirror 分隔符
            if (el.classList.contains('ProseMirror-separator') ||
                el.classList.contains('ProseMirror-trailingBreak')) {
                return '';
            }

            switch (tagName) {
                case 'h1': return `# ${this.getInlineMarkdown(el)}\n\n`;
                case 'h2': return `## ${this.getInlineMarkdown(el)}\n\n`;
                case 'h3': return `### ${this.getInlineMarkdown(el)}\n\n`;
                case 'h4': return `#### ${this.getInlineMarkdown(el)}\n\n`;
                case 'h5': return `##### ${this.getInlineMarkdown(el)}\n\n`;
                case 'h6': return `###### ${this.getInlineMarkdown(el)}\n\n`;

                case 'p': {
                    // 跳过包含封面图片的段落（由外部单独处理，避免重复）
                    const img = el.querySelector('img.fm-cover-img');
                    if (img) {
                        return '';
                    }
                    const text = this.getInlineMarkdown(el);
                    return text ? `${text}\n\n` : '';
                }

                case 'blockquote': {
                    // AI洞察特殊处理
                    if (el.classList.contains('fm-ai-insight')) {
                        let content = '';
                        for (let child of el.children) {
                            const childMd = this.elementToMarkdown(child, depth);
                            content += childMd.split('\n').map(line => line ? `> ${line}` : '>').join('\n') + '\n';
                        }
                        return content + '\n';
                    }
                    // 普通引用块
                    let content = '';
                    for (let child of el.children) {
                        content += this.elementToMarkdown(child, depth);
                    }
                    return content.split('\n').map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
                }

                case 'ul': {
                    let items = '';
                    for (let child of el.children) {
                        if (child.tagName.toLowerCase() === 'li') {
                            items += this.listItemToMarkdown(child, depth, '-');
                        }
                    }
                    return depth === 0 ? items + '\n' : items;
                }

                case 'ol': {
                    let items = '';
                    let index = 1;
                    for (let child of el.children) {
                        if (child.tagName.toLowerCase() === 'li') {
                            items += this.listItemToMarkdown(child, depth, `${index}.`);
                            index++;
                        }
                    }
                    return depth === 0 ? items + '\n' : items;
                }

                case 'br':
                    return '\n';

                case 'img': {
                    // 封面图片由外部单独处理，这里跳过避免重复
                    return '';
                }

                default: {
                    // 通用处理：递归子元素
                    let content = '';
                    for (let child of el.children) {
                        content += this.elementToMarkdown(child, depth);
                    }
                    return content || (el.textContent.trim() ? el.textContent.trim() + '\n' : '');
                }
            }
        },

        // 列表项转Markdown（支持嵌套）
        listItemToMarkdown(li, depth, prefix) {
            const indent = '  '.repeat(depth);
            let result = '';

            // 获取直接文本内容（不含子列表）
            let textParts = [];
            let subLists = [];

            for (let child of li.children) {
                const tag = child.tagName.toLowerCase();
                if (tag === 'ul' || tag === 'ol') {
                    subLists.push(child);
                } else if (tag === 'p') {
                    textParts.push(this.getInlineMarkdown(child));
                } else {
                    const text = this.getInlineMarkdown(child);
                    if (text) textParts.push(text);
                }
            }

            // 如果没有子元素，直接取文本
            if (textParts.length === 0 && subLists.length === 0) {
                textParts.push(this.getInlineMarkdown(li));
            }

            result += `${indent}${prefix} ${textParts.join(' ')}\n`;

            // 处理子列表
            for (let subList of subLists) {
                result += this.elementToMarkdown(subList, depth + 1);
            }

            return result;
        },

        // 获取内联Markdown（处理加粗、斜体等）
        getInlineMarkdown(el) {
            let result = '';
            for (let node of el.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    result += node.textContent;
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const tag = node.tagName.toLowerCase();
                    // 跳过 ProseMirror 辅助元素
                    if (node.classList.contains('ProseMirror-separator') ||
                        node.classList.contains('ProseMirror-trailingBreak')) {
                        continue;
                    }
                    if (tag === 'strong' || tag === 'b') {
                        result += `**${this.getInlineMarkdown(node)}**`;
                    } else if (tag === 'em' || tag === 'i') {
                        result += `*${this.getInlineMarkdown(node)}*`;
                    } else if (tag === 'code') {
                        result += `\`${node.textContent}\``;
                    } else if (tag === 'a') {
                        result += `[${node.textContent}](${node.href})`;
                    } else if (tag === 'br') {
                        result += '\n';
                    } else if (tag === 'img') {
                        // 封面图片由外部处理，跳过
                    } else {
                        result += this.getInlineMarkdown(node);
                    }
                }
            }
            return result;
        },

        // 获取章节内容
        async getChaptersContent() {
            // 切换到章节Tab
            await this.switchTab('章节');

            // 等待DOM渲染就绪
            let items = null;
            for (let i = 0; i < 10; i++) {
                items = document.querySelectorAll('.fm-chapter-summary-item.read-only');
                if (items.length > 0) break;
                await this.sleep(200);
            }

            const chapters = [];
            if (!items) return chapters;

            items.forEach(item => {
                const timeEl = item.querySelector('.fm-chapter-summary-item__title-time span');
                const titleEl = item.querySelector('.fm-chapter-summary-item__title-text [role="editable-div"]');
                const contentEl = item.querySelector('.fm-chapter-summary-item__content textarea');

                if (titleEl) {
                    chapters.push({
                        time: timeEl ? timeEl.textContent.trim() : '',
                        title: titleEl.textContent.trim(),
                        content: contentEl ? contentEl.value : ''
                    });
                }
            });

            return chapters;
        },

        // 获取AI纪要的元信息（主题、时间、参与人）
        // 注意：依赖AI纪要DOM，应在AI纪要Tab激活时调用
        getMetaInfo() {
            // 优先使用缓存（在 getAISummaryContent 中设置）
            if (this._cachedMeta) return this._cachedMeta;

            const editorContent = document.querySelector('.fm-full-text-summary__content .tiptap-editor-content');
            if (!editorContent) return { topic: '', time: '', participants: '' };

            const blockquote = editorContent.querySelector('blockquote');
            if (!blockquote) return { topic: '', time: '', participants: '' };

            const text = blockquote.textContent;
            const topicMatch = text.match(/主题[:：]\s*(.+?)(?:\n|时间)/);
            const timeMatch = text.match(/时间[:：]\s*(.+?)(?:\n|参与人)/);
            const participantsMatch = text.match(/参与人[:：]\s*(.+)/);

            return {
                topic: topicMatch ? topicMatch[1].trim() : '',
                time: timeMatch ? timeMatch[1].trim() : '',
                participants: participantsMatch ? participantsMatch[1].trim() : ''
            };
        },

        // ============ 格式化方法 ============

        // 格式化转写为Markdown
        formatTranscriptAsMarkdown(transcripts) {
            const title = this.getTitle();
            const meta = this.getMetaInfo();
            const exportTime = new Date().toLocaleString('zh-CN');

            let md = `# ${title}\n\n`;
            if (meta.time) md += `**录制时间**: ${meta.time}\n`;
            md += `**导出时间**: ${exportTime}\n`;
            md += `**内容类型**: 转写内容\n`;
            if (meta.participants) md += `**参与人**: ${meta.participants}\n`;
            md += `\n---\n\n## 转写内容\n\n`;

            transcripts.forEach(item => {
                md += `**${item.speaker}**${item.time ? ` (${item.time})` : ''}\n\n`;
                md += `${item.text}\n\n`;
            });

            return md;
        },

        // 格式化AI纪要为Markdown
        formatSummaryAsMarkdown(summary) {
            const title = this.getTitle();
            const exportTime = new Date().toLocaleString('zh-CN');

            let md = `# ${title} - AI纪要\n\n`;
            md += `**导出时间**: ${exportTime}\n\n---\n\n`;

            if (summary.imageUrl) {
                md += `![AI听记可视化摘要](${summary.imageUrl})\n\n`;
            }

            md += summary.markdown;

            return md;
        },

        // 格式化章节为Markdown
        formatChaptersAsMarkdown(chapters) {
            const title = this.getTitle();
            const meta = this.getMetaInfo();
            const exportTime = new Date().toLocaleString('zh-CN');

            let md = `# ${title} - 章节\n\n`;
            if (meta.time) md += `**录制时间**: ${meta.time}\n`;
            md += `**导出时间**: ${exportTime}\n`;
            md += `\n---\n\n`;

            chapters.forEach((chapter, index) => {
                md += `## ${index + 1}. ${chapter.title}`;
                if (chapter.time) md += ` (${chapter.time})`;
                md += `\n\n`;
                if (chapter.content) {
                    md += `${chapter.content}\n\n`;
                }
            });

            return md;
        },

        // 格式化全部内容为Markdown
        formatAllAsMarkdown(transcripts, summary, chapters) {
            const title = this.getTitle();
            const meta = this.getMetaInfo();
            const exportTime = new Date().toLocaleString('zh-CN');

            let md = `# ${title}\n\n`;
            if (meta.time) md += `**录制时间**: ${meta.time}\n`;
            md += `**导出时间**: ${exportTime}\n`;
            if (meta.participants) md += `**参与人**: ${meta.participants}\n`;
            md += `\n---\n\n`;

            // AI纪要部分
            if (summary) {
                md += `# AI纪要\n\n`;
                if (summary.imageUrl) {
                    md += `![AI听记可视化摘要](${summary.imageUrl})\n\n`;
                }
                md += summary.markdown;
                md += `\n\n---\n\n`;
            }

            // 章节部分
            if (chapters && chapters.length > 0) {
                md += `# 章节概要\n\n`;
                chapters.forEach((chapter, index) => {
                    md += `## ${index + 1}. ${chapter.title}`;
                    if (chapter.time) md += ` (${chapter.time})`;
                    md += `\n\n`;
                    if (chapter.content) md += `${chapter.content}\n\n`;
                });
                md += `---\n\n`;
            }

            // 转写内容部分
            if (transcripts && transcripts.length > 0) {
                md += `# 转写内容\n\n`;
                transcripts.forEach(item => {
                    md += `**${item.speaker}**${item.time ? ` (${item.time})` : ''}\n\n`;
                    md += `${item.text}\n\n`;
                });
            }

            return md;
        },

        // 清理AI纪要的原始HTML（去除编辑器残留和重复图片）
        cleanSummaryHTML(rawHTML) {
            const div = document.createElement('div');
            div.innerHTML = rawHTML;

            // 移除 ProseMirror 编辑器辅助元素
            div.querySelectorAll('.ProseMirror-separator, .ProseMirror-trailingBreak').forEach(el => el.remove());

            // 移除封面图片（由外部单独以受控样式添加，避免重复）
            div.querySelectorAll('img.fm-cover-img').forEach(el => {
                // 如果图片在 <p> 中且 <p> 只剩空内容，移除整个 <p>
                const parent = el.parentElement;
                el.remove();
                if (parent && parent.tagName === 'P' && !parent.textContent.trim()) {
                    parent.remove();
                }
            });

            // 移除空的尾部 <p>（只含 <br> 或空白）
            const allP = div.querySelectorAll('p');
            allP.forEach(p => {
                if (!p.textContent.trim() && !p.querySelector('img')) {
                    p.remove();
                }
            });

            return div.innerHTML;
        },

        // 格式化为HTML
        formatAsHTML(transcripts, summary, chapters) {
            const title = this.getTitle();
            const meta = this.getMetaInfo();
            const exportTime = new Date().toLocaleString('zh-CN');

            let html = `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n`;
            html += `    <meta charset="UTF-8">\n`;
            html += `    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n`;
            html += `    <title>${title}</title>\n`;
            html += `    <style>\n`;
            html += `        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.8; max-width: 900px; margin: 0 auto; padding: 20px; color: #333; }\n`;
            html += `        .header { border-bottom: 2px solid #1677ff; padding-bottom: 20px; margin-bottom: 30px; }\n`;
            html += `        .header h1 { color: #1677ff; }\n`;
            html += `        .section { margin-bottom: 40px; }\n`;
            html += `        .section h2 { color: #1677ff; border-bottom: 1px solid #e8e8e8; padding-bottom: 10px; }\n`;
            html += `        .transcript-item { margin-bottom: 16px; padding: 12px 16px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #1677ff; }\n`;
            html += `        .speaker { font-weight: bold; color: #1677ff; }\n`;
            html += `        .time { color: #999; font-size: 0.9em; margin-left: 8px; }\n`;
            html += `        .chapter { margin-bottom: 24px; padding: 16px; background: #f0f5ff; border-radius: 8px; }\n`;
            html += `        .chapter h3 { color: #0958d9; margin-top: 0; }\n`;
            html += `        .chapter-time { color: #999; font-size: 0.85em; }\n`;
            html += `        .summary-img { max-width: 100%; border-radius: 8px; margin: 16px 0; }\n`;
            html += `        blockquote { border-left: 4px solid #1677ff; padding-left: 16px; margin-left: 0; color: #555; background: #f6f8fa; padding: 12px 16px; border-radius: 4px; }\n`;
            html += `        .fm-cover-img { max-width: 100%; border-radius: 8px; margin: 16px 0; }\n`;
            html += `        .ProseMirror-separator, .ProseMirror-trailingBreak { display: none; }\n`;
            html += `        .fm-ai-insight { border-left-color: #faad14; background: #fffbe6; }\n`;
            html += `        .fm-ai-insight h6 { color: #d48806; margin: 0 0 8px 0; }\n`;
            html += `    </style>\n</head>\n<body>\n`;

            html += `    <div class="header">\n`;
            html += `        <h1>${title}</h1>\n`;
            if (meta.time) html += `        <p><strong>录制时间</strong>: ${meta.time}</p>\n`;
            html += `        <p><strong>导出时间</strong>: ${exportTime}</p>\n`;
            if (meta.participants) html += `        <p><strong>参与人</strong>: ${meta.participants}</p>\n`;
            html += `    </div>\n`;

            // AI纪要
            if (summary) {
                html += `    <div class="section">\n`;
                html += `        <h2>AI 纪要</h2>\n`;
                if (summary.imageUrl) {
                    html += `        <img src="${summary.imageUrl}" alt="AI听记可视化摘要" class="summary-img">\n`;
                }
                html += `        ${this.cleanSummaryHTML(summary.html)}\n`;
                html += `    </div>\n`;
            }

            // 章节
            if (chapters && chapters.length > 0) {
                html += `    <div class="section">\n`;
                html += `        <h2>章节概要</h2>\n`;
                chapters.forEach((chapter, index) => {
                    html += `        <div class="chapter">\n`;
                    html += `            <h3>${index + 1}. ${chapter.title}`;
                    if (chapter.time) html += ` <span class="chapter-time">(${chapter.time})</span>`;
                    html += `</h3>\n`;
                    if (chapter.content) html += `            <p>${chapter.content}</p>\n`;
                    html += `        </div>\n`;
                });
                html += `    </div>\n`;
            }

            // 转写内容
            if (transcripts && transcripts.length > 0) {
                html += `    <div class="section">\n`;
                html += `        <h2>转写内容</h2>\n`;
                transcripts.forEach(item => {
                    html += `        <div class="transcript-item">\n`;
                    html += `            <span class="speaker">${item.speaker}</span>`;
                    if (item.time) html += `<span class="time">(${item.time})</span>`;
                    html += `\n            <p>${item.text}</p>\n`;
                    html += `        </div>\n`;
                });
                html += `    </div>\n`;
            }

            html += `</body>\n</html>`;
            return html;
        },

        // 格式化为TXT
        formatAsTXT(transcripts, summary, chapters) {
            const title = this.getTitle();
            const meta = this.getMetaInfo();
            const exportTime = new Date().toLocaleString('zh-CN');

            let txt = `${title}\n${'='.repeat(40)}\n\n`;
            if (meta.time) txt += `录制时间: ${meta.time}\n`;
            txt += `导出时间: ${exportTime}\n`;
            if (meta.participants) txt += `参与人: ${meta.participants}\n`;
            txt += `\n`;

            // AI纪要（纯文本版本）
            if (summary) {
                txt += `${'─'.repeat(40)}\nAI 纪要\n${'─'.repeat(40)}\n\n`;
                // 使用纯文本版
                const editorContent = document.querySelector('.fm-full-text-summary__content .tiptap-editor-content');
                if (editorContent) {
                    txt += editorContent.textContent.trim();
                }
                txt += `\n\n`;
            }

            // 章节
            if (chapters && chapters.length > 0) {
                txt += `${'─'.repeat(40)}\n章节概要\n${'─'.repeat(40)}\n\n`;
                chapters.forEach((chapter, index) => {
                    txt += `${index + 1}. ${chapter.title}`;
                    if (chapter.time) txt += ` (${chapter.time})`;
                    txt += `\n`;
                    if (chapter.content) txt += `   ${chapter.content}\n`;
                    txt += `\n`;
                });
            }

            // 转写内容
            if (transcripts && transcripts.length > 0) {
                txt += `${'─'.repeat(40)}\n转写内容\n${'─'.repeat(40)}\n\n`;
                transcripts.forEach(item => {
                    txt += `[${item.speaker}]${item.time ? ` (${item.time})` : ''}\n`;
                    txt += `${item.text}\n\n`;
                });
            }

            return txt;
        },

        // 下载文件
        downloadFile(content, filename, mimeType) {
            const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        // 复制到剪贴板
        async copyToClipboard(text) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (e) {
                // 降级方法
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                const result = document.execCommand('copy');
                document.body.removeChild(textarea);
                return result;
            }
        }
    };

    // UI管理器
    const uiManager = {
        // 创建导出按钮
        createExportButton() {
            const btn = document.createElement('button');
            btn.textContent = '📤 导出听记';
            btn.style.cssText = CONFIG.BUTTON_STYLE;
            btn.id = 'dingtalk-export-btn';

            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'translateY(-2px)';
                btn.style.boxShadow = '0 6px 20px rgba(22, 119, 255, 0.5)';
            });

            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'translateY(0)';
                btn.style.boxShadow = '0 4px 15px rgba(22, 119, 255, 0.4)';
            });

            btn.addEventListener('click', () => this.showExportModal());

            document.body.appendChild(btn);
        },

        // 显示导出弹窗
        showExportModal() {
            const modal = document.createElement('div');
            modal.id = 'dingtalk-export-modal';
            modal.style.cssText = CONFIG.MODAL_STYLE;

            modal.innerHTML = `
                <div style="${CONFIG.MODAL_CONTENT_STYLE}">
                    <h2 style="margin: 0 0 8px 0; color: #1677ff; font-size: 20px;">📤 导出钉钉AI听记</h2>
                    <p style="color: #999; font-size: 13px; margin: 0 0 20px 0;">选择要导出的内容和格式</p>

                    <div style="margin-bottom: 20px;">
                        <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #333;">导出内容</h3>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 6px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px;">
                                <input type="checkbox" name="exportContent" value="summary" checked> AI纪要
                            </label>
                            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 6px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px;">
                                <input type="checkbox" name="exportContent" value="chapters" checked> 章节
                            </label>
                            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 6px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px;">
                                <input type="checkbox" name="exportContent" value="transcript" checked> 转写
                            </label>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #333;">导出格式</h3>
                        <div style="display: flex; gap: 8px;">
                            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 6px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px;">
                                <input type="radio" name="exportFormat" value="markdown" checked> Markdown
                            </label>
                            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 6px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px;">
                                <input type="radio" name="exportFormat" value="html"> HTML
                            </label>
                            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 6px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px;">
                                <input type="radio" name="exportFormat" value="txt"> TXT
                            </label>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #333;">导出方式</h3>
                        <div style="display: flex; gap: 8px;">
                            <button id="dingtalk-export-download" style="
                                flex: 1; padding: 10px 16px; background: #1677ff; color: white;
                                border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;
                                transition: background 0.2s;">
                                📥 下载文件
                            </button>
                            <button id="dingtalk-export-copy" style="
                                flex: 1; padding: 10px 16px; background: white; color: #1677ff;
                                border: 1px solid #1677ff; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;
                                transition: background 0.2s;">
                                📋 复制内容
                            </button>
                        </div>
                    </div>

                    <div id="dingtalk-export-status" style="display: none; padding: 10px; border-radius: 6px; font-size: 13px; margin-bottom: 10px;"></div>

                    <div style="text-align: center; padding: 8px 0; margin-bottom: 10px; color: #999; font-size: 12px;">
                        💬 添加东哥微信 <span style="color: #1677ff; font-weight: 600;">donggeai02</span> 获取更多实用脚本
                    </div>

                    <button id="dingtalk-export-close" style="
                        width: 100%; padding: 8px; background: #f5f5f5; color: #666;
                        border: 1px solid #d9d9d9; border-radius: 6px; cursor: pointer; font-size: 13px;">
                        关闭
                    </button>
                </div>
            `;

            document.body.appendChild(modal);

            // 绑定事件
            modal.querySelector('#dingtalk-export-close').addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
            modal.querySelector('#dingtalk-export-download').addEventListener('click', () => this.handleExport('download'));
            modal.querySelector('#dingtalk-export-copy').addEventListener('click', () => this.handleExport('copy'));
        },

        // 显示状态消息
        showStatus(message, type = 'info') {
            const statusEl = document.querySelector('#dingtalk-export-status');
            if (!statusEl) return;

            const colors = {
                info: { bg: '#e6f4ff', color: '#1677ff', border: '#91caff' },
                success: { bg: '#f6ffed', color: '#52c41a', border: '#b7eb8f' },
                error: { bg: '#fff2f0', color: '#ff4d4f', border: '#ffccc7' },
                loading: { bg: '#fffbe6', color: '#faad14', border: '#ffe58f' }
            };

            const c = colors[type] || colors.info;
            statusEl.style.display = 'block';
            statusEl.style.background = c.bg;
            statusEl.style.color = c.color;
            statusEl.style.border = `1px solid ${c.border}`;
            statusEl.textContent = message;
        },

        // 处理导出
        async handleExport(mode) {
            const contentChecks = document.querySelectorAll('input[name="exportContent"]:checked');
            const formatRadio = document.querySelector('input[name="exportFormat"]:checked');

            if (contentChecks.length === 0) {
                this.showStatus('请至少选择一个导出内容', 'error');
                return;
            }

            const selectedContent = Array.from(contentChecks).map(c => c.value);
            const format = formatRadio ? formatRadio.value : 'markdown';

            this.showStatus('⏳ 正在收集数据...', 'loading');

            try {
                let transcripts = null;
                let summary = null;
                let chapters = null;

                // 收集选中的内容
                if (selectedContent.includes('transcript')) {
                    this.showStatus('⏳ 正在收集转写内容（可能需要滚动加载）...', 'loading');
                    transcripts = await utils.getTranscriptContent();
                }

                if (selectedContent.includes('summary')) {
                    this.showStatus('⏳ 正在收集AI纪要...', 'loading');
                    summary = await utils.getAISummaryContent();
                }

                if (selectedContent.includes('chapters')) {
                    this.showStatus('⏳ 正在收集章节信息...', 'loading');
                    chapters = await utils.getChaptersContent();
                }

                // 检查是否有内容
                const hasContent = (transcripts && transcripts.length > 0) || summary || (chapters && chapters.length > 0);
                if (!hasContent) {
                    this.showStatus('❌ 未能获取到任何内容，请确保页面已完全加载', 'error');
                    return;
                }

                // 格式化内容
                let content = '';
                const title = utils.getTitle();
                const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_');

                if (format === 'markdown') {
                    if (selectedContent.length === 1) {
                        if (selectedContent[0] === 'transcript') {
                            content = utils.formatTranscriptAsMarkdown(transcripts);
                        } else if (selectedContent[0] === 'summary') {
                            content = utils.formatSummaryAsMarkdown(summary);
                        } else if (selectedContent[0] === 'chapters') {
                            content = utils.formatChaptersAsMarkdown(chapters);
                        }
                    } else {
                        content = utils.formatAllAsMarkdown(transcripts, summary, chapters);
                    }
                } else if (format === 'html') {
                    content = utils.formatAsHTML(transcripts, summary, chapters);
                } else {
                    content = utils.formatAsTXT(transcripts, summary, chapters);
                }

                // 执行导出
                if (mode === 'download') {
                    const extensions = { markdown: 'md', html: 'html', txt: 'txt' };
                    const mimeTypes = { markdown: 'text/markdown', html: 'text/html', txt: 'text/plain' };
                    const ext = extensions[format];
                    const filename = `${safeTitle}.${ext}`;

                    utils.downloadFile(content, filename, mimeTypes[format]);
                    this.showStatus(`✅ 已下载文件: ${filename}`, 'success');
                } else {
                    const success = await utils.copyToClipboard(content);
                    this.showStatus(
                        success ? '✅ 已复制到剪贴板！' : '❌ 复制失败，请手动复制',
                        success ? 'success' : 'error'
                    );
                }

            } catch (error) {
                console.error('导出出错:', error);
                this.showStatus(`❌ 导出失败: ${error.message}`, 'error');
            }
        }
    };

    // 初始化
    function init() {
        // 等待页面加载完成
        const checkReady = setInterval(() => {
            const hasContent = document.querySelector('.fm-split-panel') ||
                             document.querySelector('.fm-paragraph-item') ||
                             document.querySelector('.fm-full-text-summary');

            if (hasContent) {
                clearInterval(checkReady);
                // 避免重复添加按钮
                if (!document.getElementById('dingtalk-export-btn')) {
                    uiManager.createExportButton();
                }
            }
        }, 500);

        // 超时保护
        setTimeout(() => clearInterval(checkReady), 30000);
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
