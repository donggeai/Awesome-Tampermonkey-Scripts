// ==UserScript==
// @name         知识星球阅读模式增强器
// @namespace    https://github.com/donggeai/Awesome-Tampermonkey-Scripts
// @version      1.0.2
// @description  为知识星球提供纯净的阅读模式，隐藏侧边栏和导航栏，自动展开内容，保留用户信息显示，专注阅读体验
// @author       东哥说AI
// @match        https://wx.zsxq.com/group/*
// @grant        none
// @license      MIT
// @homepage     https://github.com/donggeai/Awesome-Tampermonkey-Scripts
// @supportURL   https://github.com/donggeai/Awesome-Tampermonkey-Scripts/issues
// ==/UserScript==

(function() {
    'use strict';

    // 配置选项
    const CONFIG = {
        buttonText: '📖 阅读模式',
        exitButtonText: '🔙 退出阅读',
        autoExpandDelay: 500, // 自动展开延迟时间(ms)
        scrollCheckInterval: 1000, // 滚动检查间隔(ms)
        storageKey: 'zsxq_reading_mode'
    };

    // 状态管理
    let isReadingMode = false;
    let scrollPosition = 0;
    let autoExpandTimer = null;
    let scrollCheckTimer = null;
    let readingButton = null;

    // CSS样式
    const styles = `
        .zsxq-reading-button {
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 9999;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 25px;
            padding: 12px 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
            user-select: none;
        }
        
        .zsxq-reading-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }
        
        .zsxq-reading-button:active {
            transform: translateY(0);
        }
        
        .zsxq-reading-mode {
            background: #f8f9fa !important;
        }
        
        .zsxq-reading-mode .group-list-container,
        .zsxq-reading-mode app-group-list,
        .zsxq-reading-mode .group-preview-wrapper,
        .zsxq-reading-mode app-group-info {
            display: none !important;
        }
        
        /* 隐藏页面顶部导航栏，但保留帖子中的用户信息 */
        .zsxq-reading-mode .app-header,
        .zsxq-reading-mode .group-header,
        .zsxq-reading-mode .top-nav,
        .zsxq-reading-mode .navigation-bar {
            display: none !important;
        }
        
        /* 确保帖子用户信息正常显示 */
        .zsxq-reading-mode .topic-container .header-container {
            display: block !important;
            padding: 15px 20px 10px 20px !important;
            border-bottom: 1px solid #f0f0f0 !important;
        }
        
        .zsxq-reading-mode .topic-container .header-container .author {
            display: flex !important;
            align-items: center !important;
        }
        
        .zsxq-reading-mode .topic-container .header-container .avatar {
            width: 40px !important;
            height: 40px !important;
            border-radius: 50% !important;
            margin-right: 12px !important;
        }
        
        .zsxq-reading-mode .topic-container .header-container .info {
            flex: 1 !important;
        }
        
        .zsxq-reading-mode .topic-container .header-container .role {
            font-weight: 600 !important;
            color: #333 !important;
            font-size: 14px !important;
            margin-bottom: 4px !important;
        }
        
        .zsxq-reading-mode .topic-container .header-container .date {
            color: #666 !important;
            font-size: 12px !important;
        }
        
        .zsxq-reading-mode .topic-flow-container {
            margin-left: 0 !important;
            margin-right: 0 !important;
            max-width: 1000px !important;
            margin: 0 auto !important;
            padding: 20px !important;
        }
        
        .zsxq-reading-mode .main-content-container {
            max-width: 100% !important;
            margin: 0 auto !important;
            padding-top: 20px !important;
        }
        
        /* 确保时间轴正确显示 */
        .zsxq-reading-mode .timeline-container {
            position: absolute !important;
            right: -40px !important;
        }
        
        .zsxq-reading-mode .topic-container {
            margin-bottom: 30px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
            overflow: hidden;
            position: relative !important;
        }
        
        .zsxq-reading-mode .talk-content-container .content {
            max-height: none !important;
            overflow: visible !important;
        }
        
        .zsxq-reading-mode .ellipsis,
        .zsxq-reading-mode .showAll {
            display: none !important;
        }
        
        .zsxq-reading-notification {
            position: fixed;
            bottom: 90px;
            right: 30px;
            background: rgba(34, 197, 94, 0.9);
            color: white;
            padding: 10px 16px;
            border-radius: 8px;
            font-size: 13px;
            z-index: 9998;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
        }
        
        .zsxq-reading-notification.show {
            opacity: 1;
            transform: translateX(0);
        }
    `;

    // 初始化样式
    function initStyles() {
        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);
    }

    // 创建阅读模式按钮
    function createReadingButton() {
        readingButton = document.createElement('button');
        readingButton.className = 'zsxq-reading-button';
        readingButton.textContent = CONFIG.buttonText;
        readingButton.addEventListener('click', toggleReadingMode);
        document.body.appendChild(readingButton);
    }

    // 显示通知
    function showNotification(message, duration = 2000) {
        const notification = document.createElement('div');
        notification.className = 'zsxq-reading-notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => document.body.removeChild(notification), 300);
        }, duration);
    }

    // 自动展开所有内容
    function autoExpandContent() {
        const expandButtons = document.querySelectorAll('.showAll');
        let expandedCount = 0;
        
        expandButtons.forEach(button => {
            if (button.style.display !== 'none' && button.offsetParent !== null) {
                button.click();
                expandedCount++;
            }
        });
        
        if (expandedCount > 0) {
            console.log(`[知识星球阅读模式] 自动展开了 ${expandedCount} 个内容`);
        }
        
        return expandedCount;
    }

    // 启动滚动监听
    function startScrollMonitoring() {
        if (scrollCheckTimer) {
            clearInterval(scrollCheckTimer);
        }
        
        scrollCheckTimer = setInterval(() => {
            if (isReadingMode) {
                autoExpandContent();
            }
        }, CONFIG.scrollCheckInterval);
    }

    // 停止滚动监听
    function stopScrollMonitoring() {
        if (scrollCheckTimer) {
            clearInterval(scrollCheckTimer);
            scrollCheckTimer = null;
        }
    }

    // 切换阅读模式
    function toggleReadingMode() {
        if (!isReadingMode) {
            enterReadingMode();
        } else {
            exitReadingMode();
        }
    }

    // 进入阅读模式
    function enterReadingMode() {
        // 保存当前滚动位置
        scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
        
        // 添加阅读模式样式
        document.body.classList.add('zsxq-reading-mode');
        
        // 更新按钮文本
        readingButton.textContent = CONFIG.exitButtonText;
        
        // 延迟展开内容，确保DOM更新完成
        setTimeout(() => {
            const expandedCount = autoExpandContent();
            if (expandedCount > 0) {
                showNotification(`已自动展开 ${expandedCount} 个内容`);
            }
            
            // 恢复滚动位置
            window.scrollTo(0, scrollPosition);
        }, CONFIG.autoExpandDelay);
        
        // 启动滚动监听
        startScrollMonitoring();
        
        isReadingMode = true;
        localStorage.setItem(CONFIG.storageKey, 'true');
        
        showNotification('已进入阅读模式 📖');
        console.log('[知识星球阅读模式] 已启用阅读模式');
    }

    // 退出阅读模式
    function exitReadingMode() {
        // 保存当前滚动位置
        scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
        
        // 移除阅读模式样式
        document.body.classList.remove('zsxq-reading-mode');
        
        // 更新按钮文本
        readingButton.textContent = CONFIG.buttonText;
        
        // 停止滚动监听
        stopScrollMonitoring();
        
        // 恢复滚动位置
        setTimeout(() => {
            window.scrollTo(0, scrollPosition);
        }, 100);
        
        isReadingMode = false;
        localStorage.setItem(CONFIG.storageKey, 'false');
        
        showNotification('已退出阅读模式 🔙');
        console.log('[知识星球阅读模式] 已退出阅读模式');
    }

    // 恢复上次的阅读模式状态
    function restoreReadingMode() {
        const savedState = localStorage.getItem(CONFIG.storageKey);
        if (savedState === 'true') {
            setTimeout(() => {
                enterReadingMode();
            }, 1000); // 延迟启动，确保页面加载完成
        }
    }

    // 页面加载完成后初始化
    function init() {
        // 等待页面主要内容加载
        const checkPageReady = setInterval(() => {
            const mainContent = document.querySelector('.topic-flow-container');
            if (mainContent) {
                clearInterval(checkPageReady);
                
                initStyles();
                createReadingButton();
                restoreReadingMode();
                
                console.log('[知识星球阅读模式] 脚本已初始化');
            }
        }, 500);
        
        // 10秒后停止检查，避免无限循环
        setTimeout(() => {
            clearInterval(checkPageReady);
        }, 10000);
    }

    // 页面卸载时清理
    window.addEventListener('beforeunload', () => {
        stopScrollMonitoring();
        if (autoExpandTimer) {
            clearTimeout(autoExpandTimer);
        }
    });

    // 监听页面变化（SPA路由）
    let currentUrl = location.href;
    const urlObserver = new MutationObserver(() => {
        if (location.href !== currentUrl) {
            currentUrl = location.href;
            if (location.href.includes('/group/')) {
                setTimeout(init, 1000);
            }
        }
    });
    
    urlObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 启动脚本
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();