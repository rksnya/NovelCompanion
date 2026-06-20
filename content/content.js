// ============================================================
// Novel Companion — 主控脚本
// 交互模型：右下角按钮 → 点击打开对话 → 面板持久到刷新
// ============================================================

(function () {
  'use strict';

  // 等待依赖模块加载
  let Extractor, ChatUI;
  function waitForModules(retries = 50) {
    if (window.__NovelExtractor && window.__NovelChatUI) {
      Extractor = window.__NovelExtractor;
      ChatUI = window.__NovelChatUI;
      return Promise.resolve();
    }
    if (retries <= 0) return Promise.reject(new Error('模块加载超时'));
    return new Promise(r => setTimeout(r, 100)).then(() => waitForModules(retries - 1));
  }

  // ---- 状态 ----
  const State = {
    active: false,           // 是否已初始化
    panelOpen: false,        // 面板是否展开
    bookTitle: '',
    chapterTitle: '',
    chapter: 0,
    memoryText: '',          // 压缩后的记忆文本
    chatHistory: [],         // 当前会话对话 [{role, content, mood?, timestamp}]
    temperature: 5,
    personaName: '',
  };

  // ---- 初始化 ----
  async function init() {
    if (State._initializing || State.active) return;
    State._initializing = true;

    // 1. 加载设置
    const settings = await sendToBackground('GET_SETTINGS');
    if (!settings.enabled) {
      console.log('[Novel Companion] 🔌 插件已关闭，跳过');
      State._initializing = false;
      return;
    }

    State.temperature = settings.temperature || 5;
    State.personaName = settings.persona?.name || '';

    // 2. 获取当前阅读位置，并合并到已有的书名（避免同一本书被拆成多个条目）
    const ctx = Extractor.getReadingContext();
    const rawTitle = ctx.bookTitle || document.title || '未知书名';
    State.bookTitle = await mergeBookTitle(rawTitle);
    State.chapterTitle = ctx.chapterTitle || '';
    State.chapter = ctx.chapter || 0;

    // 3. 初始化 UI —— 只渲染右下角气泡按钮
    ChatUI.init(State.temperature);
    ChatUI.setBookInfo(State.bookTitle, State.chapterTitle);
    ChatUI.setTemperature(State.temperature);
    if (State.personaName) ChatUI.setPersonaName(State.personaName);

    // 4. 绑定回调
    ChatUI.onSendMessage((text) => handleUserMessage(text));
    ChatUI.onTemperatureChange((val) => {
      State.temperature = val;
      saveSettings();
    });

    // 5. 气泡点击 → 打开面板（加载历史或开始新对话）
    ChatUI.onBubbleClick(() => openChatPanel());

    // 6. 收藏段落
    ChatUI.onFavoritePassage((data) => {
      if (data.favorited) {
        sendToBackground('SAVE_FAVORITE_PASSAGE', {
          bookTitle: State.bookTitle,
          passage: data,
        });
      } else {
        sendToBackground('REMOVE_FAVORITE_PASSAGE', {
          bookTitle: State.bookTitle,
          text: data.text,
        });
      }
    });

    // 7. 启动静默阅读追踪（不调用 AI，只记录读了什么）
    startReadingTracker();

    State.active = true;
    State._initializing = false;
    console.log('[Novel Companion] ✅ 就绪 📖', {
      book: State.bookTitle,
      chapter: State.chapterTitle,
    });
  }

  // ---- 静默阅读追踪（不调 AI，纯本地记录） ----
  function startReadingTracker() {
    let _readTexts = new Set();
    let _saveTimer = null;
    let _scrollTimer = null;
    let _lastUrl = window.location.href;
    let _lastChapter = State.chapterTitle;
    const SAVE_INTERVAL = 15000;

    // 设置：自动刷新延迟（默认 5 秒，0=禁用）
    async function getAutoRefreshDelay() {
      try {
        const s = await sendToBackground('GET_SETTINGS');
        return s.autoRefreshDelay ?? 5;
      } catch (_) { return 5; }
    }

    const observer = new IntersectionObserver((entries) => {
      let hasNew = false;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const text = (entry.target.textContent || '').trim();
          if (text.length > 40 && !_readTexts.has(text.slice(0, 100))) {
            _readTexts.add(text.slice(0, 100));
            hasNew = true;
          }
        }
      }
      if (hasNew) scheduleSave();
    }, { threshold: 0.4 });

    function observeBlocks() {
      const blocks = Extractor._findAllTextBlocks();
      for (const block of blocks) {
        if (block.el) observer.observe(block.el);
      }
    }

    function scheduleSave() {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(saveReadProgress, SAVE_INTERVAL);
    }

    async function saveReadProgress() {
      if (_readTexts.size === 0) return;
      const texts = [..._readTexts].slice(-5);
      _readTexts = new Set();

      const ctx = Extractor.getReadingContext();
      const chapter = ctx.chapter || State.chapter;

      const facts = texts.map(t => t.slice(0, 100));
      try {
        await sendToBackground('APPLY_MEMORY_UPDATE', {
          bookTitle: State.bookTitle,
          chapter,
          memoryUpdate: { newFacts: facts },
        });
      } catch (_) {}

      // 检测章节变化 → 立即刷新
      if (ctx.chapterTitle && ctx.chapterTitle !== _lastChapter) {
        _lastChapter = ctx.chapterTitle;
        State.chapterTitle = ctx.chapterTitle;
        State.chapter = ctx.chapter || State.chapter;
        ChatUI.setBookInfo(State.bookTitle, State.chapterTitle);
        console.log('[Novel Companion] 📖 章节变化:', ctx.chapterTitle);
        // 章节变了，立即再捕获一批
        saveCurrentSnapshot();
      }
    }

    // 立即捕获当前快照（用于翻页/换章）
    async function saveCurrentSnapshot() {
      const ctx = Extractor.getReadingContext();
      if (!ctx.visibleText || ctx.visibleText.length < 40) return;
      const line = ctx.visibleText.split(/[\n。！？]/)[0]?.slice(0, 100) || ctx.visibleText.slice(0, 100);
      try {
        await sendToBackground('APPLY_MEMORY_UPDATE', {
          bookTitle: State.bookTitle,
          chapter: ctx.chapter || State.chapter,
          memoryUpdate: { newFacts: [line] },
        });
      } catch (_) {}
    }

    // ---- 滚动停顿自动刷新 ----
    let _proactiveTimer = null;
    let _lastProactiveText = '';  // 避免对同一段文字反复触发

    async function onScrollPause() {
      const delay = await getAutoRefreshDelay();
      clearTimeout(_scrollTimer);

      // 快照保存（短延迟）
      if (delay > 0) {
        _scrollTimer = setTimeout(async () => {
          const ctx = Extractor.getReadingContext();
          if (ctx.visibleText && ctx.visibleText.length > 60) {
            saveCurrentSnapshot();
          }
          if (ctx.chapterTitle && ctx.chapterTitle !== _lastChapter) {
            _lastChapter = ctx.chapterTitle;
            State.chapterTitle = ctx.chapterTitle;
            State.chapter = ctx.chapter || State.chapter;
            ChatUI.setBookInfo(State.bookTitle, State.chapterTitle);
          }
        }, delay * 1000);
      }

      // AI 主动说话（更长延迟，默认 8 秒）
      const proactiveDelay = await getProactiveDelay();
      if (proactiveDelay <= 0) return;
      clearTimeout(_proactiveTimer);
      _proactiveTimer = setTimeout(async () => {
        const ctx = Extractor.getReadingContext();
        if (!ctx.visibleText || ctx.visibleText.length < 80) return;

        // 去重：和上次触发的内容相似就不重复
        const overlap = trigramOverlap(_lastProactiveText, ctx.visibleText);
        if (overlap > 0.6) return;
        _lastProactiveText = ctx.visibleText;

        console.log('[Novel Companion] 🤔 检查 AI 是否想说话...');
        try {
          const result = await sendToBackground('PROACTIVE_SPEAK', {
            bookTitle: State.bookTitle,
            chapter: ctx.chapter || State.chapter,
            chapterTitle: ctx.chapterTitle || State.chapterTitle,
            visibleText: ctx.visibleText,
            memoryText: State.memoryText,
          });

          if (result.silent) {
            console.log('[Novel Companion] 🤫 AI 选择安静');
            return;
          }

          if (result.reply || (result.toolCalls || []).length > 0) {
            console.log('[Novel Companion] 💬 AI 主动说话:', result.reply?.slice(0, 60));
            ChatUI.showProactiveComment(result.reply, result.toolCalls || []);
            if (result._inputTokens) ChatUI.addTokenUsage(result._inputTokens, result._outputTokens || 0);
          }
        } catch (_) {}
      }, proactiveDelay * 1000);
    }

    async function getProactiveDelay() {
      try {
        const s = await sendToBackground('GET_SETTINGS');
        return s.proactiveDelay ?? 8;
      } catch (_) { return 8; }
    }

    function trigramOverlap(a, b) {
      if (!a || !b) return 0;
      const trigrams = s => { const set = new Set(); for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3)); return set; };
      const sa = trigrams(a.slice(0, 500)), sb = trigrams(b.slice(0, 500));
      if (sb.size === 0) return 0;
      let o = 0; for (const t of sa) { if (sb.has(t)) o++; }
      return o / Math.max(sa.size, sb.size);
    }

    window.addEventListener('scroll', onScrollPause, { passive: true });

    // ---- URL 变化 → 立即刷新 ----
    function checkURLChange() {
      if (window.location.href !== _lastUrl) {
        _lastUrl = window.location.href;
        console.log('[Novel Companion] 🔗 页面跳转，立即捕获');
        // 等 DOM 稳定后捕获
        setTimeout(async () => {
          observeBlocks();
          saveCurrentSnapshot();
          const ctx = Extractor.getReadingContext();
          if (ctx.bookTitle) {
            State.bookTitle = await mergeBookTitle(ctx.bookTitle);
            ChatUI.setBookInfo(State.bookTitle, ctx.chapterTitle);
          }
        }, 1500);
      }
    }
    // 劫持 pushState/replaceState
    const _push = history.pushState, _replace = history.replaceState;
    history.pushState = function(...a) { _push.apply(this, a); checkURLChange(); };
    history.replaceState = function(...a) { _replace.apply(this, a); checkURLChange(); };
    window.addEventListener('popstate', checkURLChange);
    setInterval(checkURLChange, 3000);  // 兜底轮询（有些网站不用 history API）

    // 初始观察
    observeBlocks();

    // DOM 变化 → 重新观察
    let _mutationTimer = null;
    const mutationObserver = new MutationObserver(() => {
      clearTimeout(_mutationTimer);
      _mutationTimer = setTimeout(async () => {
        observeBlocks();
        checkURLChange();
      }, 2000);
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('beforeunload', () => {
      if (_readTexts.size > 0) saveReadProgress();
    });

    State._readingTracker = { observer, mutationObserver, saveReadProgress };
  }

  // ---- 点击气泡 → 打开聊天面板 ----
  async function openChatPanel() {
    if (State.panelOpen) return;

    ChatUI._setExpanded(true);
    State.panelOpen = true;
    ChatUI.setStatus('reading', '📖 正在阅读...');

    // 1. 刷新阅读上下文（用户可能翻页了）
    const ctx = Extractor.getReadingContext();
    if (ctx.bookTitle) State.bookTitle = await mergeBookTitle(ctx.bookTitle);
    if (ctx.chapterTitle) {
      State.chapterTitle = ctx.chapterTitle;
      State.chapter = ctx.chapter || 0;
    }
    ChatUI.setBookInfo(State.bookTitle, State.chapterTitle);

    // 2. 加载本书记忆 + 聊天历史（force reload 拿到静默追踪器最新笔记）
    try {
      const memory = await sendToBackground('LOAD_MEMORY', {
        bookTitle: State.bookTitle,
      });
      const result = await sendToBackground('COMPRESS_MEMORY', { memory });
      State.memoryText = result.text || compressMemoryFallback(memory);

      // 恢复聊天历史
      const savedHistory = memory.chatHistory || [];
      if (savedHistory.length > 0) {
        console.log(`[Novel Companion] 📜 加载了 ${savedHistory.length} 条历史消息`);
        // 在面板中渲染历史消息
        for (const msg of savedHistory) {
          ChatUI.addMessage(msg.role, msg.content, msg.mood, { silent: true });
        }
        State.chatHistory = savedHistory.slice(-50);
        // 显示继续阅读提示
        const lastMsg = savedHistory[savedHistory.length - 1];
        const daysAgo = lastMsg?.timestamp
          ? Math.floor((Date.now() - new Date(lastMsg.timestamp).getTime()) / 86400000)
          : null;
        const agoText = daysAgo > 0 ? `（${daysAgo} 天前）` : '';
        ChatUI.addMessage('ai', `你回来啦！我们继续看《${State.bookTitle}》吧~ ${agoText}`, 'chill', { silent: true });
      } else {
        // 新对话：发送一条问候
        ChatUI.addMessage('ai', `嗨！我们一起看《${State.bookTitle}》吧～看到精彩的地方随时跟我聊！`, 'chill', { silent: true });
      }
    } catch (e) {
      console.warn('[Novel Companion] 加载记忆失败:', e);
      ChatUI.addMessage('ai', `嗨！我们一起看《${State.bookTitle}》吧～`, 'chill', { silent: true });
    }
  }

  // ---- 保存当前阅读上下文为笔记（替代被动评价的记忆积累） ----
  async function captureReadingContext() {
    const ctx = Extractor.getReadingContext();
    if (!ctx.visibleText || ctx.visibleText.length < 60) return;

    // 提取第一句作为摘要
    const firstLine = ctx.visibleText.split(/[\n。！？]/)[0]?.slice(0, 80) || ctx.visibleText.slice(0, 80);

    try {
      await sendToBackground('APPLY_MEMORY_UPDATE', {
        bookTitle: State.bookTitle,
        chapter: ctx.chapter || State.chapter,
        memoryUpdate: {
          newFacts: [firstLine],
        },
      });
      // 刷新内存文本给下次对话用
      refreshMemory();
    } catch (_) {}
  }

  // ---- 主动对话 ----
  async function handleUserMessage(text) {
    if (!text.trim()) return;

    ChatUI.setLoading(true);

    // 1. 抓取用户当前屏幕（最新的阅读位置）
    const ctx = Extractor.getReadingContext();

    // 2. 更新章节信息（用户可能翻页了）
    if (ctx.chapterTitle && ctx.chapterTitle !== State.chapterTitle) {
      State.chapterTitle = ctx.chapterTitle;
      State.chapter = ctx.chapter || State.chapter;
      ChatUI.setBookInfo(State.bookTitle, State.chapterTitle);
    }

    // 3. 先刷新记忆（包含静默追踪器积累的最新笔记），确保 AI 看到最新进度
    await refreshMemory();

    // 4. 保存当前段落为笔记（异步，不阻塞聊天）
    captureReadingContext();

    try {
      const result = await sendToBackground('CHAT_MESSAGE', {
        bookTitle: State.bookTitle,
        chapter: State.chapter,
        chapterTitle: State.chapterTitle,
        userMessage: text,
        chatHistory: State.chatHistory.slice(-20),
        memoryText: State.memoryText,
        visibleText: ctx.visibleText,
      });

      console.log('[Novel Companion] 💬 用户:', text.slice(0, 80));
      console.log('[Novel Companion] 📤 上下文:', {
        book: State.bookTitle,
        chapter: State.chapterTitle,
        historyLen: State.chatHistory.length,
        visibleLen: ctx.visibleText?.length || 0,
      });

      if (result.error) {
        const debugInfo = result._debug
          ? '\n\n--- 调试 ---\nURL: ' + result._debug.url
            + '\nModel: ' + result._debug.model
            + '\nStatus: ' + result._debug.status
          : '';
        ChatUI.addMessage('ai', '唔…出了点问题：' + result.error + debugInfo);
        ChatUI.setLoading(false);
        return;
      }

      if (result._inputTokens) {
        ChatUI.addTokenUsage(result._inputTokens, result._outputTokens || 0);
      }
      console.log('[Novel Companion] 📥 AI:', result.reply?.slice(0, 80),
        result.toolCalls?.length ? `+ ${result.toolCalls.length} 个工具调用` : '');

      // 渲染 AI 文字回复
      if (result.reply) {
        ChatUI.addMessage('ai', result.reply);
      }

      // 渲染工具调用结果
      const toolCalls = result.toolCalls || [];
      for (const tc of toolCalls) {
        switch (tc.name) {
          case 'quote_passage':
            ChatUI.addQuotedPassage(tc.input.text, tc.input.comment);
            break;
          case 'quote_history':
            ChatUI.addQuotedHistory(tc.input.text, tc.input.who);
            break;
          case 'react_emoji':
            ChatUI.addEmojiReaction(tc.input.emoji);
            break;
          case 'check_current_page':
            // AI 调了查看屏幕 → 工具循环在 background 已完成，这里只更新 UI
            {
              const freshCtx = Extractor.getReadingContext();
              if (freshCtx.visibleText) {
                ChatUI.addSystemNote('查看屏幕', 'check-page');
                State.chapterTitle = freshCtx.chapterTitle || State.chapterTitle;
                State.chapter = freshCtx.chapter || State.chapter;
                ChatUI.setBookInfo(State.bookTitle, State.chapterTitle);
                captureReadingContext();
              }
            }
            break;
        }
      }

      // 保存对话历史（内存 + 存储）
      const userMsg = { role: 'user', content: text, timestamp: new Date().toISOString() };
      const aiMsg = { role: 'assistant', content: result.reply, toolCalls, timestamp: new Date().toISOString() };
      State.chatHistory.push(userMsg, aiMsg);

      if (State.chatHistory.length > 100) {
        State.chatHistory = State.chatHistory.slice(-50);
      }

      // 持久化聊天历史到存储
      persistChatHistory();

      // 每 5 轮刷新记忆
      const userMsgs = State.chatHistory.filter(m => m.role === 'user');
      if (userMsgs.length % 5 === 0) {
        refreshMemory();
      }

      ChatUI.setLoading(false);
    } catch (e) {
      console.error('[Novel Companion] 对话异常:', e);
      ChatUI.addMessage('ai', '网络好像不太对…等会再试试？');
      ChatUI.setLoading(false);
    }
  }

  // ---- 持久化聊天历史 ----
  async function persistChatHistory() {
    try {
      await sendToBackground('SAVE_CHAT_HISTORY', {
        bookTitle: State.bookTitle,
        chatHistory: State.chatHistory.slice(-50),
      });
    } catch (e) {
      // 静默失败
    }
  }

  // ---- 记忆刷新 ----
  async function refreshMemory() {
    try {
      const memory = await sendToBackground('LOAD_MEMORY', {
        bookTitle: State.bookTitle,
      });
      const result = await sendToBackground('COMPRESS_MEMORY', { memory });
      State.memoryText = result.text || compressMemoryFallback(memory);
    } catch (e) {
      // 静默失败
    }
  }

  // ---- 开关切换（来自 popup） ----
  function handleToggle(enabled) {
    if (enabled && !State.active) {
      console.log('[Novel Companion] 🔌 插件已开启');
      init();
    } else if (!enabled && State.active) {
      console.log('[Novel Companion] 🔌 插件已关闭');
      teardown();
    }
  }

  function teardown() {
    State.active = false;
    State.panelOpen = false;
    // 清理阅读追踪器
    if (State._readingTracker) {
      State._readingTracker.observer.disconnect();
      State._readingTracker.mutationObserver.disconnect();
      State._readingTracker.saveReadProgress();
    }
    const host = document.getElementById('__novel_companion_host');
    if (host) host.remove();
    ChatUI._host = null;
    ChatUI._shadow = null;
  }

  // ---- 工具 ----
  function sendToBackground(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response || {});
        }
      });
    });
  }

  // 标准化书名
  function normalizeTitle(title) {
    let t = title.trim();
    t = t.replace(/^[「『""]/, '').replace(/[」』""]$/, '');
    t = t.replace(/[！!」』】〗]+$/, '');
    t = t.replace(/\s*\[.*?\]$/i, '');
    t = t.replace(/[の的]系列作品$/, '').replace(/系列小説$/, '').replace(/系列小说$/, '');
    t = t.replace(/[の的]小説$/, '');
    t = t.replace(/^#\d+\s*[,，.．\s]*/, '');
    t = t.replace(/\s*[-—–]\s*[^\-—–]{1,20}$/, '');
    return t.trim();
  }

  // 字符 trigram 相似度
  function trigramSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.9;
    const makeTrigrams = (s) => {
      const set = new Set();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));  // bigram 对中文更友好
      return set;
    };
    const sa = makeTrigrams(a);
    const sb = makeTrigrams(b);
    if (sa.size === 0 || sb.size === 0) return 0;
    let overlap = 0;
    for (const t of sa) { if (sb.has(t)) overlap++; }
    return overlap / Math.max(sa.size, sb.size);
  }

  // 检查 storage 中是否有相似书名，有则合并
  async function mergeBookTitle(rawTitle) {
    const normalized = normalizeTitle(rawTitle);
    if (!normalized || normalized.length < 2) return rawTitle;

    try {
      // 精确匹配 normalize 后的名字
      const exact = await sendToBackground('LOAD_MEMORY', { bookTitle: normalized });
      if (exact && exact.name && ((exact.chatHistory || []).length > 0 || exact.lastChapter > 0)) return exact.name;

      // 遍历所有书，找最相似的
      const allData = await sendToBackground('LIST_BOOKS');
      const books = allData?.books || {};
      let bestMatch = null;
      let bestScore = 0;

      for (const [name] of Object.entries(books)) {
        if (!name || name === '未知书名') continue;
        const normName = normalizeTitle(name);
        const score = trigramSimilarity(normalized, normName);
        if (score > bestScore) { bestScore = score; bestMatch = name; }
      }

      // 阈值 0.25：bigram 重叠 25% 即可视为同一本
      if (bestMatch && bestScore >= 0.25) {
        console.log(`[Novel Companion] 🔗 合并书名: "${rawTitle}" → "${bestMatch}" (相似度 ${(bestScore*100).toFixed(0)}%)`);
        return bestMatch;
      }
    } catch (_) {}

    return rawTitle;
  }

  function compressMemoryFallback(memory) {
    if (!memory) return '';
    const parts = [];
    if (memory.lastChapter > 0) parts.push(`读到第 ${memory.lastChapter} 章`);
    const notes = (memory.recentNotes || []).slice(-5);
    if (notes.length > 0) {
      parts.push('最近剧情：');
      notes.forEach(n => parts.push(`  [${n.ch}章] ${n.fact}`));
    }
    return parts.join('\n');
  }

  function saveSettings() {
    sendToBackground('SAVE_SETTINGS', {
      settings: { temperature: State.temperature },
    });
  }

  // ---- 监听 popup 消息 ----
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE') {
      handleToggle(message.enabled);
    }
  });

  // ---- 监听 storage 变化 ----
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      const oldEnabled = changes.settings.oldValue?.enabled;
      const newEnabled = changes.settings.newValue?.enabled;
      if (oldEnabled !== newEnabled) {
        handleToggle(newEnabled);
      }
      if (changes.settings.newValue?.temperature !== undefined &&
          changes.settings.newValue.temperature !== State.temperature) {
        State.temperature = changes.settings.newValue.temperature;
        ChatUI.setTemperature(State.temperature);
      }
    }
  });

  // ---- 启动 ----
  waitForModules()
    .then(init)
    .catch((e) => console.error('[Novel Companion] 启动失败:', e));
})();
