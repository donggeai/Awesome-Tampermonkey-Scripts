// ==UserScript==
// @name         腾讯会议转写纪要导出神器 (Tencent Meeting Transcript Exporter)
// @namespace    https://github.com/awesome-tampermonkey
// @version      1.1.2
// @description  一键导出腾讯会议录制视频和纯文字转写的内容和纪要，支持Markdown、HTML、TXT格式导出和复制
// @author       东哥说AI
// @match        https://meeting.tencent.com/cw/*
// @match        https://meeting.tencent.com/ct/*
// @grant        none
// @license      MIT
// @downloadURL  https://github.com/donggeai/Awesome-Tampermonkey-Scripts/blob/master/TencentMeetingTranscriptExporter/TencentMeetingTranscriptExporter.user.js
// @updateURL    https://github.com/donggeai/Awesome-Tampermonkey-Scripts/blob/master/TencentMeetingTranscriptExporter/TencentMeetingTranscriptExporter.user.js
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 12px 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
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

    let pendingTranscriptRead;

    // 工具函数
    const utils = {
        // 检测页面类型
        getPageType() {
            const url = window.location.href;
            if (url.includes('/cw/')) return 'recording'; // 录制视频页面
            if (url.includes('/ct/')) return 'transcript'; // 纯文字转写页面
            return 'unknown';
        },

        // 获取会议标题
        getMeetingTitle() {
            const titleElement = document.querySelector('.meeting-main-subject .subject') ||
                               document.querySelector('[class*="style_meeting-main-subject__"] [class*="style_subject__"]') ||
                               document.querySelector('.meeting-subject') ||
                               document.querySelector('.meeting-title');
            return titleElement ? titleElement.textContent.trim() : '腾讯会议转写';
        },
        
        // 获取录制时间
        getRecordingTime() {
            const timeElement = document.querySelector('.meeting-begin-time-in-date');
            if (timeElement) {
                const timeText = timeElement.textContent.trim();
                // 格式：2025/05/21 21:35:16
                return timeText;
            }
            return new Date().toLocaleString('zh-CN');
        },
        
        // 获取会议关键词/标签
        getMeetingKeywords() {
            const keywords = [];
            const topicElements = document.querySelectorAll('.topicTag .topicText');
            topicElements.forEach(element => {
                const keyword = element.textContent.trim();
                if (keyword) {
                    keywords.push(keyword);
                }
            });
            return keywords;
        },

        // 获取当前激活的Tab类型
        getCurrentTabType() {
            const pageType = this.getPageType();

            // 纯文字转写页面没有Tab，转写和纪要同时显示
            if (pageType === 'transcript') {
                return 'both'; // 表示同时包含转写和纪要
            }

            // 录制视频页面有Tab切换
            const activeTab = document.querySelector('.met-tabs__tabitem.is-active .tab');
            if (!activeTab) return 'transcript';

            const tabText = activeTab.textContent.trim();
            if (tabText.includes('转写')) return 'transcript';
            if (tabText.includes('纪要')) return 'summary';
            return 'transcript';
        },

        // 获取转写内容（支持虚拟滚动）
        async getTranscriptContent() {
            const transcriptList = document.querySelector('.minutes-module-paragraphs .minutes-module-list');

            // 新版录制页面与纯文字转写页面使用相同的转写列表。
            if (this.getPageType() === 'transcript' || transcriptList?.querySelector('.minutes-module-row')) {
                pendingTranscriptRead ??= this.getTranscriptContentFromRows(transcriptList).finally(() => {
                    pendingTranscriptRead = undefined;
                });
                return pendingTranscriptRead;
            }

            // 录制视频页面的原有逻辑
            // 查找虚拟滚动容器
            const scrollContainer = document.querySelector('.auto-meeting-minutes .minutes-module-list');
            if (!scrollContainer) {
                // 降级到原始方法
                return this.getTranscriptContentFallback();
            }
            
            const originalScrollTop = scrollContainer.scrollTop;
            let lastScrollTop = -1;
            let allContent = new Map(); // 使用Map避免重复
            
            try {
                // 滚动到顶部开始
                scrollContainer.scrollTop = 0;
                await this.sleep(200);
                
                // 持续滚动直到底部，收集所有内容
                while (scrollContainer.scrollTop !== lastScrollTop) {
                    lastScrollTop = scrollContainer.scrollTop;
                    
                    // 收集当前可见的转写内容
                    const currentElements = scrollContainer.querySelectorAll('.paragraph-module_detail-page-style__Lhz8l');
                    currentElements.forEach(element => {
                        const pidAttr = element.getAttribute('data-pid');
                        if (pidAttr && !allContent.has(pidAttr)) {
                            const timeElement = element.querySelector('.paragraph-module_p-start-time__QAWWl');
                            const speakerElement = element.querySelector('.paragraph-module_speaker-name__afSbd');
                            const textElement = element.querySelector('.paragraph-module_sentences__zK2oL');
                            
                            if (textElement && textElement.textContent.trim()) {
                                const time = timeElement ? timeElement.textContent.trim() : '';
                                const speaker = speakerElement ? speakerElement.textContent.trim() : '未知发言人';
                                const text = textElement.textContent.trim();
                                
                                allContent.set(pidAttr, {
                                    pid: parseInt(pidAttr),
                                    time,
                                    speaker,
                                    text
                                });
                            }
                        }
                    });
                    
                    // 向下滚动一屏
                    scrollContainer.scrollTop += scrollContainer.clientHeight;
                    await this.sleep(100); // 等待内容加载
                }
                
                // 恢复原始滚动位置
                scrollContainer.scrollTop = originalScrollTop;
                
                // 按pid排序并返回
                return Array.from(allContent.values()).sort((a, b) => a.pid - b.pid);
                
            } catch (error) {
                console.error('获取转写内容时出错:', error);
                // 恢复滚动位置
                scrollContainer.scrollTop = originalScrollTop;
                // 降级到原始方法
                return this.getTranscriptContentFallback();
            }
        },
        
        // 降级方法：获取当前可见的转写内容
        getTranscriptContentFallback() {
            const transcriptElements = document.querySelectorAll('.auto-meeting-minutes .paragraph-module_detail-page-style__Lhz8l');
            let content = [];
            
            transcriptElements.forEach(element => {
                const timeElement = element.querySelector('.paragraph-module_p-start-time__QAWWl');
                const speakerElement = element.querySelector('.paragraph-module_speaker-name__afSbd');
                const textElement = element.querySelector('.paragraph-module_sentences__zK2oL');
                
                if (textElement && textElement.textContent.trim()) {
                    const time = timeElement ? timeElement.textContent.trim() : '';
                    const speaker = speakerElement ? speakerElement.textContent.trim() : '未知发言人';
                    const text = textElement.textContent.trim();
                    
                    content.push({
                        time,
                        speaker,
                        text
                    });
                }
            });
            
            return content;
        },

        // 从转写列表采集段落（支持虚拟滚动）
        async getTranscriptContentFromRows(scrollContainer) {
            // 如果没有滚动容器或内容不需要滚动，直接获取可见内容
            if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
                return this.getVisibleTranscriptRows(scrollContainer || document);
            }

            const originalScrollTop = scrollContainer.scrollTop;
            const allContent = new Map();
            let stalledAttempts = 0;

            try {
                scrollContainer.scrollTop = 0;
                await this.sleep(200);

                while (true) {
                    const currentRows = scrollContainer.querySelectorAll('.minutes-module-row');
                    currentRows.forEach(row => {
                        const entry = this.readTranscriptRow(row);
                        if (!entry) return;
                        const { pid, time, speaker, text } = entry;
                        const key = pid ?? JSON.stringify([time, speaker, text]);
                        if (!allContent.has(key)) {
                            allContent.set(key, entry);
                        }
                    });

                    const { scrollTop, clientHeight, scrollHeight } = scrollContainer;
                    if (scrollTop + clientHeight >= scrollHeight - 1) break;

                    scrollContainer.scrollTop = scrollTop + clientHeight;
                    await this.sleep(100);

                    // 切到逐字稿时，播放器可能短暂把列表拉回当前播放位置。
                    if (scrollContainer.scrollTop > scrollTop) {
                        stalledAttempts = 0;
                    } else if (++stalledAttempts >= 15) {
                        throw new Error('转写列表无法继续滚动');
                    }
                }

                const contentArray = Array.from(allContent.values());
                return contentArray.sort((a, b) => {
                    if (a.pid !== null && b.pid !== null) return a.pid - b.pid;
                    return a.time.localeCompare(b.time);
                });

            } finally {
                scrollContainer.scrollTop = originalScrollTop;
            }
        },

        readTranscriptRow(row) {
            const text = row.querySelector('.minutes-module-sentences, .paragraph-module_sentences__zK2oL')?.textContent.trim();
            if (!text) return null;

            const paragraph = row.querySelector('.minutes-module-paragraph[data-pid]') || row.querySelector('[data-pid]');
            const pidAttr = row.getAttribute('data-pid') || paragraph?.getAttribute('data-pid');
            const pid = parseInt(pidAttr, 10);
            const speaker = row.querySelector('[class*="paragraph-module_speaker-name__"]')?.textContent.trim() || '未知发言人';
            const time = row.querySelector('.minutes-module-p-start-time')?.textContent.trim() ||
                         row.querySelector('.minutes-module-name-time')?.textContent.match(/\d+:\d{2}(?::\d{2})?/)?.[0] || '';
            return { pid: Number.isNaN(pid) ? null : pid, time, speaker, text };
        },

        getVisibleTranscriptRows(root) {
            return Array.from(root.querySelectorAll('.minutes-module-row'), row => this.readTranscriptRow(row)).filter(Boolean);
        },

        // 延时函数
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        // 获取纪要内容
        getSummaryContent() {
            const pageType = this.getPageType();

            // 纯文字转写页面使用不同的选择器
            if (pageType === 'transcript') {
                const summaryContainer = document.querySelector('.aisummary-container .summary-content-wrap');
                if (!summaryContainer) return null;

                const summaryElements = summaryContainer.querySelectorAll('h4, p, li');
                let content = [];

                summaryElements.forEach(element => {
                    const text = element.textContent.trim();
                    if (text && text.length > 0) {
                        const tagName = element.tagName.toLowerCase();
                        content.push({
                            type: tagName,
                            text: text
                        });
                    }
                });

                return content;
            }

            // 录制视频页面的原有逻辑
            const summaryContainer = document.querySelector('.summary-content-wrap');
            if (!summaryContainer) return null;

            const summaryElements = summaryContainer.querySelectorAll('h4, p, li, div[contenteditable="true"]');
            let content = [];

            summaryElements.forEach(element => {
                const text = element.textContent.trim();
                if (text && text.length > 0) {
                    const tagName = element.tagName.toLowerCase();
                    content.push({
                        type: tagName,
                        text: text
                    });
                }
            });

            return content;
        },

        // 格式化为Markdown
        formatAsMarkdown(data, type) {
            const title = this.getMeetingTitle();
            const recordingTime = this.getRecordingTime();
            const keywords = this.getMeetingKeywords();
            const exportTime = new Date().toLocaleString('zh-CN');
            
            let markdown = `# ${title}\n\n`;
            markdown += `**录制时间**: ${recordingTime}\n`;
            markdown += `**导出时间**: ${exportTime}\n`;
            markdown += `**内容类型**: ${type === 'transcript' ? '转写内容' : '会议纪要'}\n`;
            
            // 添加关键词标签
            if (keywords.length > 0) {
                markdown += `**会议关键词**: ${keywords.join('、')}\n`;
            }
            markdown += `\n`;
            
            if (type === 'transcript' && Array.isArray(data)) {
                markdown += `## 转写内容\n\n`;
                data.forEach(item => {
                    markdown += `### ${item.speaker}${item.time ? ` (${item.time})` : ''}\n\n`;
                    markdown += `${item.text}\n\n`;
                });
            } else if (type === 'summary' && Array.isArray(data)) {
                markdown += `## 会议纪要\n\n`;
                data.forEach(item => {
                    if (item.type === 'h4') {
                        markdown += `### ${item.text}\n\n`;
                    } else if (item.type === 'li') {
                        markdown += `- ${item.text}\n`;
                    } else {
                        markdown += `${item.text}\n\n`;
                    }
                });
            }
            
            return markdown;
        },

        // 格式化为HTML
        formatAsHTML(data, type) {
            const title = this.getMeetingTitle();
            const recordingTime = this.getRecordingTime();
            const keywords = this.getMeetingKeywords();
            const exportTime = new Date().toLocaleString('zh-CN');
            
            let html = `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n`;
            html += `    <meta charset="UTF-8">\n`;
            html += `    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n`;
            html += `    <title>${title}</title>\n`;
            html += `    <style>\n`;
            html += `        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }\n`;
            html += `        .header { border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 30px; }\n`;
            html += `        .transcript-item { margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; }\n`;
            html += `        .speaker { font-weight: bold; color: #2c3e50; }\n`;
            html += `        .time { color: #7f8c8d; font-size: 0.9em; }\n`;
            html += `        .content { margin-top: 8px; }\n`;
            html += `        .keywords { margin: 10px 0; }\n`;
            html += `        .keyword-tag { display: inline-block; background: #e3f2fd; color: #1976d2; padding: 4px 8px; margin: 2px; border-radius: 4px; font-size: 0.9em; }\n`;
            html += `    </style>\n</head>\n<body>\n`;
            
            html += `    <div class="header">\n`;
            html += `        <h1>${title}</h1>\n`;
            html += `        <p><strong>录制时间</strong>: ${recordingTime}</p>\n`;
            html += `        <p><strong>导出时间</strong>: ${exportTime}</p>\n`;
            html += `        <p><strong>内容类型</strong>: ${type === 'transcript' ? '转写内容' : '会议纪要'}</p>\n`;
            if (keywords.length > 0) {
                html += `        <div class="keywords">\n`;
                html += `            <strong>会议关键词</strong>: `;
                keywords.forEach(keyword => {
                    html += `<span class="keyword-tag">${keyword}</span>`;
                });
                html += `\n        </div>\n`;
            }
            html += `    </div>\n`;
            
            if (type === 'transcript' && Array.isArray(data)) {
                html += `    <h2>转写内容</h2>\n`;
                data.forEach(item => {
                    html += `    <div class="transcript-item">\n`;
                    html += `        <div class="speaker">${item.speaker}${item.time ? ` <span class="time">(${item.time})</span>` : ''}</div>\n`;
                    html += `        <div class="content">${item.text}</div>\n`;
                    html += `    </div>\n`;
                });
            } else if (type === 'summary' && Array.isArray(data)) {
                html += `    <h2>会议纪要</h2>\n`;
                data.forEach(item => {
                    if (item.type === 'h4') {
                        html += `    <h3>${item.text}</h3>\n`;
                    } else if (item.type === 'li') {
                        html += `    <li>${item.text}</li>\n`;
                    } else {
                        html += `    <p>${item.text}</p>\n`;
                    }
                });
            }
            
            html += `</body>\n</html>`;
            return html;
        },

        // 格式化为TXT
        formatAsTXT(data, type) {
            const title = this.getMeetingTitle();
            const recordingTime = this.getRecordingTime();
            const keywords = this.getMeetingKeywords();
            const exportTime = new Date().toLocaleString('zh-CN');
            
            let txt = `${title}\n`;
            txt += `${'='.repeat(title.length)}\n\n`;
            txt += `录制时间: ${recordingTime}\n`;
            txt += `导出时间: ${exportTime}\n`;
            txt += `内容类型: ${type === 'transcript' ? '转写内容' : '会议纪要'}\n`;
            
            // 添加关键词标签
            if (keywords.length > 0) {
                txt += `会议关键词: ${keywords.join('、')}\n`;
            }
            txt += `\n`;
            
            if (type === 'transcript' && Array.isArray(data)) {
                txt += `转写内容\n${'-'.repeat(10)}\n\n`;
                data.forEach(item => {
                    txt += `${item.speaker}${item.time ? ` (${item.time})` : ''}\n`;
                    txt += `${item.text}\n\n`;
                });
            } else if (type === 'summary' && Array.isArray(data)) {
                txt += `会议纪要\n${'-'.repeat(10)}\n\n`;
                data.forEach(item => {
                    if (item.type === 'h4') {
                        txt += `\n${item.text}\n${'-'.repeat(item.text.length)}\n`;
                    } else if (item.type === 'li') {
                        txt += `• ${item.text}\n`;
                    } else {
                        txt += `${item.text}\n\n`;
                    }
                });
            }
            
            return txt;
        },

        // 下载文件
        downloadFile(content, filename, type) {
            const mimeTypes = {
                'md': 'text/markdown',
                'html': 'text/html',
                'txt': 'text/plain'
            };
            
            const blob = new Blob([content], { type: mimeTypes[type] || 'text/plain' });
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
            } catch (err) {
                // 降级方案
                const textArea = document.createElement('textarea');
                textArea.value = text;
                document.body.appendChild(textArea);
                textArea.select();
                const success = document.execCommand('copy');
                document.body.removeChild(textArea);
                return success;
            }
        },

        // 显示提示消息
        showMessage(message, type = 'success') {
            const messageDiv = document.createElement('div');
            const colors = {
                'success': '#10b981',
                'error': '#ef4444',
                'info': '#3b82f6'
            };
            messageDiv.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                z-index: 10002;
                padding: 12px 20px;
                border-radius: 6px;
                color: white;
                font-weight: 600;
                font-size: 14px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                transition: all 0.3s ease;
                background: ${colors[type] || colors.success};
            `;
            messageDiv.textContent = message;
            document.body.appendChild(messageDiv);
            
            setTimeout(() => {
                messageDiv.style.opacity = '0';
                messageDiv.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (messageDiv.parentNode) {
                        messageDiv.parentNode.removeChild(messageDiv);
                    }
                }, 300);
            }, 3000);
        }
    };

    // 主要功能类
    class TencentMeetingExporter {
        constructor() {
            this.init();
        }

        init() {
            this.createExportButton();
        }

        createExportButton() {
            const button = document.createElement('button');
            button.textContent = '📝 导出转写/纪要';
            button.style.cssText = CONFIG.BUTTON_STYLE;
            
            button.addEventListener('mouseenter', () => {
                button.style.transform = 'translateY(-2px)';
                button.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
            });
            
            button.addEventListener('mouseleave', () => {
                button.style.transform = 'translateY(0)';
                button.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
            });
            
            button.addEventListener('click', () => {
                this.showExportModal();
            });
            
            document.body.appendChild(button);
        }

        showExportModal() {
            const modal = document.createElement('div');
            modal.style.cssText = CONFIG.MODAL_STYLE;

            const modalContent = document.createElement('div');
            modalContent.style.cssText = CONFIG.MODAL_CONTENT_STYLE;

            const currentTab = utils.getCurrentTabType();
            let tabName, modalHTML;

            // 纯文字转写页面同时包含转写和纪要
            if (currentTab === 'both') {
                modalHTML = `
                    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">导出转写/纪要</h2>
                    <p style="margin: 0 0 25px 0; color: #7f8c8d; line-height: 1.5;">选择要导出的内容类型和格式</p>

                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 25px;">
                        <button id="export-transcript-md" style="padding: 15px; border: 2px solid #3498db; background: white; color: #3498db; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">📄 导出转写(MD)</button>
                        <button id="export-summary-md" style="padding: 15px; border: 2px solid #e74c3c; background: white; color: #e74c3c; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">📋 导出纪要(MD)</button>
                        <button id="export-transcript-html" style="padding: 15px; border: 2px solid #f39c12; background: white; color: #f39c12; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">🌐 导出转写(HTML)</button>
                        <button id="export-summary-html" style="padding: 15px; border: 2px solid #9b59b6; background: white; color: #9b59b6; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">🌐 导出纪要(HTML)</button>
                        <button id="export-transcript-txt" style="padding: 15px; border: 2px solid #16a085; background: white; color: #16a085; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">📝 导出转写(TXT)</button>
                        <button id="copy-transcript-md" style="padding: 15px; border: 2px solid #8e44ad; background: white; color: #8e44ad; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">📋 复制转写(MD)</button>
                    </div>

                    <div style="text-align: center; padding: 8px 0; margin-bottom: 10px; color: #999; font-size: 12px;">
                        💬 添加东哥微信 <span style="color: #3498db; font-weight: 600;">donggeai02</span> 获取更多实用脚本
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button id="modal-close" style="padding: 10px 20px; border: 1px solid #bdc3c7; background: white; color: #7f8c8d; border-radius: 6px; cursor: pointer;">取消</button>
                    </div>
                `;
            } else {
                // 录制视频页面的原有逻辑
                tabName = currentTab === 'transcript' ? '转写内容' : '会议纪要';
                modalHTML = `
                    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">导出${tabName}</h2>
                    <p style="margin: 0 0 25px 0; color: #7f8c8d; line-height: 1.5;">选择导出格式，文件名将自动使用会议标题</p>

                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 25px;">
                        <button id="export-md" style="padding: 15px; border: 2px solid #3498db; background: white; color: #3498db; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">📄 Markdown</button>
                        <button id="export-html" style="padding: 15px; border: 2px solid #e74c3c; background: white; color: #e74c3c; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">🌐 HTML</button>
                        <button id="export-txt" style="padding: 15px; border: 2px solid #f39c12; background: white; color: #f39c12; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">📝 TXT</button>
                        <button id="copy-md" style="padding: 15px; border: 2px solid #9b59b6; background: white; color: #9b59b6; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">📋 复制Markdown</button>
                    </div>

                    <div style="text-align: center; padding: 8px 0; margin-bottom: 10px; color: #999; font-size: 12px;">
                        💬 添加东哥微信 <span style="color: #3498db; font-weight: 600;">donggeai02</span> 获取更多实用脚本
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button id="modal-close" style="padding: 10px 20px; border: 1px solid #bdc3c7; background: white; color: #7f8c8d; border-radius: 6px; cursor: pointer;">取消</button>
                    </div>
                `;
            }

            modalContent.innerHTML = modalHTML;
            
            // 添加按钮悬停效果
            const buttons = modalContent.querySelectorAll('button[id^="export-"], button[id^="copy-"]');
            buttons.forEach(btn => {
                btn.addEventListener('mouseenter', () => {
                    const color = btn.style.color;
                    btn.style.background = color;
                    btn.style.color = 'white';
                });
                btn.addEventListener('mouseleave', () => {
                    const borderColor = btn.style.borderColor;
                    btn.style.background = 'white';
                    btn.style.color = borderColor;
                });
            });

            // 绑定事件
            if (currentTab === 'both') {
                // 纯文字转写页面的事件绑定
                modalContent.querySelector('#export-transcript-md')?.addEventListener('click', () => this.exportContent('md', 'transcript'));
                modalContent.querySelector('#export-summary-md')?.addEventListener('click', () => this.exportContent('md', 'summary'));
                modalContent.querySelector('#export-transcript-html')?.addEventListener('click', () => this.exportContent('html', 'transcript'));
                modalContent.querySelector('#export-summary-html')?.addEventListener('click', () => this.exportContent('html', 'summary'));
                modalContent.querySelector('#export-transcript-txt')?.addEventListener('click', () => this.exportContent('txt', 'transcript'));
                modalContent.querySelector('#copy-transcript-md')?.addEventListener('click', () => this.copyContent('transcript'));
            } else {
                // 录制视频页面的原有事件绑定
                modalContent.querySelector('#export-md')?.addEventListener('click', () => this.exportContent('md'));
                modalContent.querySelector('#export-html')?.addEventListener('click', () => this.exportContent('html'));
                modalContent.querySelector('#export-txt')?.addEventListener('click', () => this.exportContent('txt'));
                modalContent.querySelector('#copy-md')?.addEventListener('click', () => this.copyContent());
            }
            modalContent.querySelector('#modal-close').addEventListener('click', () => this.closeModal(modal));
            
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal);
                }
            });
            
            modal.appendChild(modalContent);
            document.body.appendChild(modal);
        }

        async exportContent(format, contentType = null) {
            try {
                const currentTab = utils.getCurrentTabType();
                // 如果显式指定了内容类型，使用指定的类型；否则使用当前Tab类型
                const exportType = contentType || (currentTab === 'both' ? 'transcript' : currentTab);
                let data, content, filename;

                if (exportType === 'transcript') {
                    // 显示加载提示
                    utils.showMessage('正在获取转写内容，请稍候...', 'info');
                    
                    data = await utils.getTranscriptContent();
                    if (!data || data.length === 0) {
                        utils.showMessage('未找到转写内容，请确保页面已加载完成', 'error');
                        return;
                    }
                    
                    // 显示成功提示
                    utils.showMessage(`获取成功！共找到 ${data.length} 条转写记录`, 'success');
                } else {
                    data = utils.getSummaryContent();
                    if (!data || data.length === 0) {
                        utils.showMessage('未找到纪要内容，请确保页面已加载完成', 'error');
                        return;
                    }
                }
                
                const title = utils.getMeetingTitle();
                const recordingTime = utils.getRecordingTime();
                
                // 使用录制时间生成时间戳，如果获取不到则使用当前时间
                let timestamp;
                if (recordingTime) {
                    // 将录制时间格式从 "2025/05/21 21:35:16" 转换为 "20250521_213516"
                    timestamp = recordingTime.replace(/[\s\/\:]/g, '').replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1$2$3_$4$5$6');
                } else {
                    // 降级到使用当前时间
                    const now = new Date();
                    timestamp = now.getFullYear().toString() + 
                        (now.getMonth() + 1).toString().padStart(2, '0') + 
                        now.getDate().toString().padStart(2, '0') + '_' +
                        now.getHours().toString().padStart(2, '0') + 
                        now.getMinutes().toString().padStart(2, '0') + 
                        now.getSeconds().toString().padStart(2, '0');
                }
                
                const tabName = exportType === 'transcript' ? '转写' : '纪要';
                filename = `${title}_${tabName}_${timestamp}.${format}`;

                switch (format) {
                    case 'md':
                        content = utils.formatAsMarkdown(data, exportType);
                        break;
                    case 'html':
                        content = utils.formatAsHTML(data, exportType);
                        break;
                    case 'txt':
                        content = utils.formatAsTXT(data, exportType);
                        break;
                }
                
                utils.downloadFile(content, filename, format);
                utils.showMessage(`${format.toUpperCase()}文件导出成功！`);
                
                // 关闭模态框
                const modal = document.querySelector('div[style*="position: fixed"][style*="z-index: 10001"]');
                if (modal) this.closeModal(modal);
                
            } catch (error) {
                console.error('导出失败:', error);
                utils.showMessage('导出失败，请重试', 'error');
            }
        }

        async copyContent(contentType = null) {
            try {
                const currentTab = utils.getCurrentTabType();
                // 如果显式指定了内容类型，使用指定的类型；否则使用当前Tab类型
                const exportType = contentType || (currentTab === 'both' ? 'transcript' : currentTab);
                let data;

                if (exportType === 'transcript') {
                    // 显示加载提示
                    utils.showMessage('正在获取转写内容，请稍候...', 'info');

                    data = await utils.getTranscriptContent();
                    if (!data || data.length === 0) {
                        utils.showMessage('未找到转写内容，请确保页面已加载完成', 'error');
                        return;
                    }

                    // 显示成功提示
                    utils.showMessage(`获取成功！共找到 ${data.length} 条转写记录`, 'success');
                } else {
                    data = utils.getSummaryContent();
                    if (!data || data.length === 0) {
                        utils.showMessage('未找到纪要内容，请确保页面已加载完成', 'error');
                        return;
                    }
                }

                const content = utils.formatAsMarkdown(data, exportType);
                const success = await utils.copyToClipboard(content);

                if (success) {
                    utils.showMessage('Markdown内容已复制到剪贴板！');
                } else {
                    utils.showMessage('复制失败，请重试', 'error');
                }

                // 关闭模态框
                const modal = document.querySelector('div[style*="position: fixed"][style*="z-index: 10001"]');
                if (modal) this.closeModal(modal);
                
            } catch (error) {
                console.error('复制失败:', error);
                utils.showMessage('复制失败，请重试', 'error');
            }
        }

        closeModal(modal) {
            modal.style.opacity = '0';
            setTimeout(() => {
                if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
            }, 300);
        }
    }

    // 等待页面加载完成后初始化
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => new TencentMeetingExporter(), 2000);
            });
        } else {
            setTimeout(() => new TencentMeetingExporter(), 2000);
        }
    }

    init();

})();
