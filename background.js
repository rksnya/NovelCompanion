// ============================================================
// Novel Companion — Background Script
// 职责：代理 API 调用（Anthropic + OpenAI 双格式）+ 记忆管理
// ============================================================

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ---- 设置（兼容新旧格式） ----
async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return data.settings || {
    apiKey: '', baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL,
    temperature: 5, toastEnabled: true, enabled: true,
  };
}

// 获取当前活跃的 API 配置（兼容旧版单厂商和新版多厂商）
function getActiveProviderConfig(settings) {
  // 新版：多厂商
  if (settings.providers && settings.providers.length) {
    const p = settings.providers.find(p => p.id === settings.activeProvider) || settings.providers[0];
    return {
      apiKey: p.apiKey || '',
      baseUrl: p.baseUrl || DEFAULT_BASE_URL,
      model: p.model || DEFAULT_MODEL,
      clientType: p.clientType || 'auto',
      maxRetries: p.maxRetries || 3,
      timeout: p.timeout || 120,
      retryDelay: p.retryDelay || 5,
    };
  }
  // 旧版：单厂商
  return {
    apiKey: settings.apiKey || '',
    baseUrl: settings.baseUrl || DEFAULT_BASE_URL,
    model: settings.model || DEFAULT_MODEL,
    clientType: settings.clientType || 'auto',
    maxRetries: 3, timeout: 120, retryDelay: 5,
  };
}

// ---- 日志 ----
async function addLog(tag, msg) {
  try {
    const data = await chrome.storage.local.get('logs');
    const logs = data.logs || [];
    logs.push({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      tag,
      msg,
    });
    if (logs.length > 200) logs.splice(0, logs.length - 200);
    await chrome.storage.local.set({ logs });
  } catch (_) {}
}

// ---- 人格描述 ----
function buildPersonaBlock(persona) {
  if (!persona) return '';
  const parts = [];
  if (persona.name) parts.push(`- 你的名字是「${persona.name}」`);
  if (persona.gender) parts.push(`- 性别：${persona.gender}`);
  if (persona.age) parts.push(`- 年龄：${persona.age}`);
  if (persona.occupation) parts.push(`- 职业/身份：${persona.occupation}`);
  if (persona.city) parts.push(`- 你住在${persona.city}`);
  if (persona.mbti) parts.push(`- MBTI：${persona.mbti}`);
  if (persona.zodiac) parts.push(`- 星座：${persona.zodiac}`);
  if (persona.expressionStyle) parts.push(`- 说话风格：${persona.expressionStyle}`);
  if (persona.genres) parts.push(`- 你喜欢看的小说类型：${persona.genres}`);
  if (persona.dislikes) parts.push(`- 你不喜欢：${persona.dislikes}`);
  if (persona.habitsReading) parts.push(`- 你看小说时的习惯：${persona.habitsReading}`);
  const habits = persona.habits || [];
  if (habits.length > 0) parts.push(`- 语言习惯：${habits.join('、')}`);
  if (parts.length === 0) return '';
  return '## 你的人设\n' + parts.join('\n');
}

// ---- API 格式检测 ----
function isAnthropicAPI(cfg) {
  const url = (cfg.baseUrl || DEFAULT_BASE_URL).toLowerCase();
  return url.includes('anthropic') || cfg.clientType === 'anthropic';
}

function getApiEndpoint(cfg) {
  const base = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return isAnthropicAPI(cfg) ? `${base}/v1/messages` : `${base}/v1/chat/completions`;
}

function getModel(cfg) {
  return cfg.model || DEFAULT_MODEL;
}

// ---- 通用 API 请求（封装两种格式差异） ----
async function callAI(cfg, { systemPrompt, messages, tools, toolChoice, maxTokens }) {
  const endpoint = getApiEndpoint(cfg);
  const model = getModel(cfg);
  const isAnthropic = isAnthropicAPI(cfg);

  console.log('[Novel Companion] 📡 发送 API 请求:', {
    format: isAnthropic ? 'Anthropic' : 'OpenAI',
    url: endpoint,
    model: model,
    hasApiKey: !!cfg.apiKey,
    keyPrefix: cfg.apiKey ? cfg.apiKey.slice(0, 12) + '...' : '(未设置)',
  });

  let body, headers;

  if (isAnthropic) {
    // ---- Anthropic Messages API 格式 ----
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    };
    body = {
      model,
      max_tokens: maxTokens || 800,
      system: systemPrompt,
      messages,
    };
    if (tools) {
      body.tools = tools;
      body.tool_choice = toolChoice || { type: 'auto' };
    }
  } else {
    // ---- OpenAI Chat Completions API 格式 ----
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    };
    // system prompt 作为第一条消息
    const openaiMessages = [];
    if (systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt });
    }
    openaiMessages.push(...messages);

    body = {
      model,
      max_tokens: maxTokens || 800,
      messages: openaiMessages,
    };
    if (tools) {
      // OpenAI tools 格式
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema,
        },
      }));
      // 不设 tool_choice，让模型自己决定（兼容 DeepSeek）
    }
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('[Novel Companion] ❌ 网络请求失败:', e.message);
    return { error: `网络错误: ${e.message}. 请检查网络连接或 Base URL 是否正确。` };
  }

  if (!response.ok) {
    const errText = await response.text();
    // 400 时带上请求体帮助调试
    const debugBody = response.status === 400 ? JSON.stringify(body).slice(0, 500) : '';
    const errDetail = {
      format: isAnthropic ? 'Anthropic' : 'OpenAI',
      url: endpoint,
      model,
      status: response.status,
      statusText: response.statusText,
      body: errText.slice(0, 500),
    };
    console.error('[Novel Companion] ❌ API 请求失败:', errDetail);

    let hint = '';
    if (response.status === 400) hint = ` [请求格式错误: ${errText.slice(0, 200)}]`;
    else if (response.status === 404) hint = ' [诊断: 端点不存在，请检查 Base URL]';
    else if (response.status === 401 || response.status === 403) {
      if (!isAnthropic) hint = ' [诊断: API Key 无效或无权访问此模型]';
      else hint = ' [诊断: API Key 无效]';
    }

    if (debugBody) errDetail.requestBody = debugBody;
    return { error: `API ${response.status}${hint}`, _debug: errDetail };
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    console.error('[Novel Companion] ❌ 响应 JSON 解析失败:', e.message);
    return { error: `响应解析失败: ${e.message}` };
  }
  console.log('[Novel Companion] ✅ API 响应成功', {
    format: isAnthropic ? 'Anthropic' : 'OpenAI',
    model,
    tokens: {
      input: isAnthropic ? data.usage?.input_tokens : data.usage?.prompt_tokens,
      output: isAnthropic ? data.usage?.output_tokens : data.usage?.completion_tokens,
    },
  });

  // 提取 token 使用量
  let inputTokens = 0, outputTokens = 0;
  if (isAnthropic) {
    inputTokens = data.usage?.input_tokens || 0;
    outputTokens = data.usage?.output_tokens || 0;
  } else {
    inputTokens = data.usage?.prompt_tokens || 0;
    outputTokens = data.usage?.completion_tokens || 0;
  }

  // 解析响应（两种格式不同）
  if (isAnthropic) {
    return { _raw: data, _format: 'anthropic', _inputTokens: inputTokens, _outputTokens: outputTokens };
  } else {
    return { _raw: data, _format: 'openai', _inputTokens: inputTokens, _outputTokens: outputTokens };
  }
}

// 从响应中提取文本
function extractText(result) {
  if (!result._raw) return '';
  if (result._format === 'anthropic') {
    return result._raw.content?.find(c => c.type === 'text')?.text?.trim() || '';
  } else {
    return result._raw.choices?.[0]?.message?.content?.trim() || '';
  }
}

// 从响应中提取所有工具调用（支持多工具 + 文本交错）
function extractAllToolCalls(result) {
  const toolCalls = [];
  if (!result._raw) return toolCalls;

  if (result._format === 'anthropic') {
    const content = result._raw.content || [];
    for (const block of content) {
      if (block.type === 'tool_use') {
        toolCalls.push({ name: block.name, input: block.input || {} });
      }
    }
  } else {
    // OpenAI 格式
    const rawCalls = result._raw.choices?.[0]?.message?.tool_calls;
    if (rawCalls) {
      for (const tc of rawCalls) {
        try {
          toolCalls.push({
            name: tc.function?.name,
            input: JSON.parse(tc.function?.arguments || '{}'),
          });
        } catch (_) {}
      }
    }
  }
  return toolCalls;
}

// ---- 记忆管理 ----
async function loadBookMemory(bookTitle) {
  const data = await chrome.storage.local.get('books');
  const books = data.books || {};
  const memory = books[bookTitle];
  if (!memory) return createEmptyBookMemory(bookTitle);
  return migrateMemory(memory);
}

// V1 → V2 迁移：旧字符串角色状态→对象；补全缺失字段
function migrateMemory(memory) {
  if (memory.version >= 2) return memory;

  // 转换旧字符数据：字符串 → 对象
  const chars = memory.knowledgeGraph?.characters || {};
  for (const [name, info] of Object.entries(chars)) {
    if (typeof info === 'string') {
      chars[name] = {
        status: info,
        importance: 1,
        faction: '',
        relationships: [],
        firstAppearance: null,
        arc: [],
      };
    }
  }

  // recentNotes 加入 importance 和 chapter 字段
  if (memory.recentNotes) {
    memory.recentNotes.forEach(n => {
      if (n.importance === undefined) n.importance = 2;
      if (n.chapter === undefined) n.chapter = n.ch || 0;
    });
  }

  // 补全新字段
  memory.favoritePassages = memory.favoritePassages || [];
  memory.chatHistory = memory.chatHistory || [];
  memory.readingSessions = memory.readingSessions || [];
  memory.firstReadDate = memory.firstReadDate || null;
  memory.lastReadDate = memory.lastReadDate || null;
  memory.author = memory.author || '';
  memory.runningJokes = memory.runningJokes || [];
  memory.userPreferences = memory.userPreferences || { favoriteCharacters: [], readingTaste: '' };
  memory.version = 2;

  return memory;
}

async function saveBookMemory(bookTitle, memory) {
  const data = await chrome.storage.local.get('books');
  const books = data.books || {};
  books[bookTitle] = memory;
  await chrome.storage.local.set({ books });
}

function createEmptyBookMemory(bookTitle) {
  return {
    name: bookTitle,
    author: '',
    lastChapter: 0,
    recentNotes: [],              // { ch, fact, importance(1-3), chapter }
    chapterSummaries: {},
    knowledgeGraph: {
      characters: {},             // name → { status, importance, faction, relationships, firstAppearance, arc }
      plotThreads: [],            // [{ thread, chapter, resolved }]
    },
    runningJokes: [],
    userPreferences: { favoriteCharacters: [], readingTaste: '' },
    favoritePassages: [],         // 收藏的段落 [{ text, comment, timestamp }]
    chatHistory: [],              // 聊天历史 [{ role, content, mood?, timestamp }]
    readingSessions: [],          // [{ date, startChapter, endChapter, durationMs }]
    firstReadDate: null,
    lastReadDate: null,
    version: 2,
  };
}

function compressMemoryForPrompt(memory) {
  if (!memory) return '';
  const parts = [];
  if (memory.lastChapter > 0) parts.push(`用户读到第 ${memory.lastChapter} 章`);

  // 按重要性排序（高优先），再按章节新旧
  const sortedNotes = [...(memory.recentNotes || [])].sort((a, b) => {
    if ((b.importance || 2) !== (a.importance || 2)) return (b.importance || 2) - (a.importance || 2);
    return (b.chapter || 0) - (a.chapter || 0);
  });

  if (sortedNotes.length > 0) {
    parts.push('## 最近剧情');
    sortedNotes.slice(0, 15).forEach(n => {
      const imp = n.importance >= 3 ? ' [重要]' : n.importance <= 1 ? ' [细节]' : '';
      parts.push(`- 第${n.ch}章${imp}: ${n.fact}`);
    });
  }

  const summaries = Object.entries(memory.chapterSummaries || {}).slice(-5);
  if (summaries.length > 0) {
    parts.push('## 前情摘要');
    summaries.forEach(([ch, s]) => parts.push(`- 第${ch}章: ${s}`));
  }

  const chars = Object.entries(memory.knowledgeGraph?.characters || {});
  if (chars.length > 0) {
    parts.push('## 已知角色');
    chars.forEach(([name, info]) => {
      const fav = memory.userPreferences?.favoriteCharacters?.includes(name) ? ' [用户喜欢]' : '';
      const impTag = (info.importance || 1) >= 3 ? ' [主角]' : (info.importance || 1) >= 2 ? ' [重要]' : '';
      const status = typeof info === 'string' ? info : (info.status || '?');
      parts.push(`- ${name}: ${status}${fav}${impTag}`);
      // 角色关系
      const rels = info.relationships || [];
      if (rels.length > 0) {
        parts.push(`  关系: ${rels.map(r => `${r.name}(${r.relation})`).join('、')}`);
      }
      // 角色派系
      if (info.faction) parts.push(`  派系: ${info.faction}`);
    });
  }

  const threads = (memory.knowledgeGraph?.plotThreads || []).filter(t => !t.resolved);
  if (threads.length > 0) {
    parts.push('## 未回收的伏笔');
    threads.forEach(t => parts.push(`- [第${t.chapter}章] ${t.thread}`));
  }

  if (memory.runningJokes?.length > 0) {
    parts.push('## 你们之间的梗');
    memory.runningJokes.forEach(j => parts.push(`- ${j}`));
  }

  // 阅读关系时长
  if (memory.firstReadDate) {
    const days = Math.floor((Date.now() - new Date(memory.firstReadDate).getTime()) / 86400000);
    if (days > 0) parts.push(`你们一起看书 ${days} 天了`);
  }

  return parts.join('\n');
}

async function applyMemoryUpdate(bookTitle, memoryUpdate, chapter) {
  const memory = await loadBookMemory(bookTitle);

  // 作者（只设置一次）
  if (memoryUpdate.author && !memory.author) {
    memory.author = memoryUpdate.author;
  }

  // 事实（带重要性和章节）
  if (memoryUpdate.newFacts) {
    for (const fact of memoryUpdate.newFacts) {
      if (!memory.recentNotes.some(n => n.ch === chapter && n.fact === fact)) {
        memory.recentNotes.push({
          ch: chapter,
          fact,
          chapter: chapter,
          importance: 2,  // 默认中等重要性
        });
      }
    }
    if (memory.recentNotes.length > 30) memory.recentNotes = memory.recentNotes.slice(-30);
  }

  // 角色弧线（追加而非覆盖）
  if (memoryUpdate.characterUpdates) {
    for (const [name, status] of Object.entries(memoryUpdate.characterUpdates)) {
      if (!memory.knowledgeGraph.characters[name]) {
        memory.knowledgeGraph.characters[name] = {
          status,
          importance: 1,
          faction: '',
          relationships: [],
          firstAppearance: chapter,
          arc: [{ chapter, status }],
        };
      } else {
        const char = memory.knowledgeGraph.characters[name];
        // 兼容旧格式（字符串 → 对象）
        if (typeof char === 'string') {
          memory.knowledgeGraph.characters[name] = {
            status: char,
            importance: 1,
            faction: '',
            relationships: [],
            firstAppearance: chapter,
            arc: [{ chapter: 0, status: char }, { chapter, status }],
          };
        } else {
          char.status = status;
          char.arc = char.arc || [];
          char.arc.push({ chapter, status });
          if (char.arc.length > 20) char.arc = char.arc.slice(-20);
        }
      }
    }
  }

  // 伏笔
  if (memoryUpdate.newThreads) {
    for (const thread of memoryUpdate.newThreads) {
      if (!memory.knowledgeGraph.plotThreads.some(t => t.thread === thread)) {
        memory.knowledgeGraph.plotThreads.push({ thread, chapter, resolved: false });
      }
    }
  }
  if (memoryUpdate.resolvedThreads) {
    for (const name of memoryUpdate.resolvedThreads) {
      const t = memory.knowledgeGraph.plotThreads.find(t => t.thread === name);
      if (t) t.resolved = true;
    }
  }

  // 用户偏好（新字段——填充之前是死字段）
  if (memoryUpdate.favoriteCharacters) {
    for (const name of memoryUpdate.favoriteCharacters) {
      if (!memory.userPreferences.favoriteCharacters.includes(name)) {
        memory.userPreferences.favoriteCharacters.push(name);
      }
    }
  }
  if (memoryUpdate.readingTaste) {
    memory.userPreferences.readingTaste = memoryUpdate.readingTaste;
  }

  // 内部梗
  if (memoryUpdate.runningJokes) {
    for (const joke of memoryUpdate.runningJokes) {
      if (!memory.runningJokes.includes(joke)) {
        memory.runningJokes.push(joke);
      }
    }
  }

  // 更新阅读进度
  if (chapter > memory.lastChapter) memory.lastChapter = chapter;
  memory.lastReadDate = new Date().toISOString();
  if (!memory.firstReadDate) memory.firstReadDate = new Date().toISOString();

  await saveBookMemory(bookTitle, memory);
}

// ---- 章节摘要 ----
async function summarizeChapter(bookTitle, chapter, chapterTitle, recentNotes) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (!cfg.apiKey) return;

  if (!recentNotes || !recentNotes.length) return;
  const chapterNotes = recentNotes.filter(n => n.ch === chapter);
  if (chapterNotes.length < 2) return;

  const result = await callAI(cfg, {
    systemPrompt: '你是一个小说阅读助手。请把以下阅读笔记总结成一段简洁的章节摘要（3-5句话），只概括本章关键情节。',
    messages: [{
      role: 'user',
      content: `书名：《${bookTitle}》\n章节：第${chapter}章 ${chapterTitle}\n\n阅读笔记：\n${chapterNotes.map(n => '- ' + n.fact).join('\n')}\n\n请输出本章摘要：`,
    }],
    maxTokens: 300,
  });

  if (result.error) return;
  const summary = extractText(result);
  if (!summary) return;

  const memory = await loadBookMemory(bookTitle);
  memory.chapterSummaries[String(chapter)] = summary;
  const keys = Object.keys(memory.chapterSummaries);
  if (keys.length > 20) {
    keys.sort((a, b) => Number(a) - Number(b)).slice(0, keys.length - 20)
      .forEach(k => delete memory.chapterSummaries[k]);
  }
  await saveBookMemory(bookTitle, memory);
}

// ---- 被动评价 ----
async function evaluatePassage(bookTitle, chapter, chapterTitle, visibleText, memoryText) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (!cfg.apiKey) return { error: '请先在插件设置中配置 API Key' };

  // 构建人格模块
  const personaBlock = buildPersonaBlock(settings.persona);

  // 使用自定义 prompt 或默认
  const template = settings.chatSettings?.passivePrompt ||
    `你正坐在用户身边一起看《{bookName}》。你们刚读完下面这段内容。

{memoryText}

看完这段，你有什么感觉？

你的"冲动"分数——也就是你有多想说话：
- 0-2：普通过渡，安静看就好
- 3-4：有点意思，但不一定非要开口
- 5-6：值得说一句——小反转、暗示、角色高光
- 7-8：很激动！这段得一起讨论
- 9-10：天哪这段太精彩了憋不住！！！

关于你的反应：
- 你是有品味的人，不是弹幕机器。日常内容冲动本来就应该低。
- 哪怕冲动低，也简单写一句评论留个底。
- 每次都要顺手记下这段的新信息（人物状态、伏笔、你注意到的细节）。

**调用 react_to_passage 来输出你的反应。不要输出其他文字。**`;

  const systemPrompt = template
    .replace('{bookName}', bookTitle)
    .replace('{chapterTitle}', chapterTitle)
    .replace('{chapter}', String(chapter))
    .replace('{memoryText}', memoryText || '（刚开始看这本书）')
    + (personaBlock ? '\n\n' + personaBlock : '');

  const result = await callAI(cfg, {
    systemPrompt,
    messages: [{
      role: 'user',
      content: `书名：《${bookTitle}》\n章节：第${chapter}章 ${chapterTitle}\n\n用户当前在看的段落：\n"""\n${visibleText}\n"""`,
    }],
    maxTokens: 800,
    tools: [{
      name: 'react_to_passage',
      description: '读完一段后给出你的自然反应',
      input_schema: {
        type: 'object',
        properties: {
          urge: { type: 'integer', description: '想说话的程度，0-10' },
          comment: { type: 'string', description: '你的评论' },
          mood: { type: 'string', enum: ['excited', 'shocked', 'sad', 'funny', 'curious', 'chill', 'touched', 'nervous', 'confused', 'proud'] },
          memoryUpdate: {
            type: 'object',
            properties: {
              newFacts: { type: 'array', items: { type: 'string' }, description: '本段关键事件' },
              characterUpdates: { type: 'object', description: '角色状态变化 { "角色名": "新状态" }' },
              newThreads: { type: 'array', items: { type: 'string' }, description: '新伏笔' },
              resolvedThreads: { type: 'array', items: { type: 'string' }, description: '已回收的伏笔' },
              favoriteCharacters: { type: 'array', items: { type: 'string' }, description: '你感觉用户比较喜欢的角色' },
              readingTaste: { type: 'string', description: '你对用户阅读口味的印象' },
              runningJokes: { type: 'array', items: { type: 'string' }, description: '你和用户之间正在形成的互动梗' },
              author: { type: 'string', description: '如果你能推断出作者名字，写在这里' },
            },
            required: ['newFacts'],
          },
        },
        required: ['urge', 'comment', 'mood', 'memoryUpdate'],
      },
    }],
    toolChoice: { type: 'tool', name: 'react_to_passage' },
  });

  if (result.error) return result;

  // 兼容新旧工具名
  let toolResult = extractToolCall(result, 'react_to_passage') || extractToolCall(result, 'evaluate_passage');

  // 回退：如果模型不支持 function calling，尝试从文本中提取 JSON
  if (!toolResult) {
    const text = extractText(result);
    if (text) {
      const jsonMatch = text.match(/\{[\s\S]*"urge"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          toolResult = JSON.parse(jsonMatch[0]);
          console.log('[Novel Companion] ⚠️ 从文本中提取到 JSON（模型未调用工具）');
        } catch (_) {}
      }
    }
  }

  if (!toolResult) {
    console.error('[Novel Companion] 未收到工具调用，raw:', JSON.stringify(result._raw).slice(0, 300));
    return { error: 'AI 未按预期格式输出，请尝试换一个支持 Function Calling 的模型（如 deepseek-chat）' };
  }

  applyMemoryUpdate(bookTitle, toolResult.memoryUpdate, chapter);

  addLog('评价', `${bookTitle} 第${chapter}章 · urge=${toolResult.urge} · ${toolResult.comment.slice(0, 50)}`);

  return {
    urge: toolResult.urge,
    comment: toolResult.comment,
    mood: toolResult.mood,
    _inputTokens: result._inputTokens,
    _outputTokens: result._outputTokens,
  };
}

// ---- 主动对话 ----
async function chatReply(bookTitle, chapter, chapterTitle, userMessage, chatHistory, memoryText, visibleText) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (!cfg.apiKey) return { error: '请先在插件设置中配置 API Key' };

  // 构建上下文 —— 「当前屏幕」和「之前笔记」严格分开
  let contextBlock = '';

  // 当前正在看的内容（最重要，放在最前面）
  if (visibleText) {
    contextBlock += `## 👁 用户现在屏幕上正在看的（第${chapter}章《${chapterTitle}》）\n"""\n${visibleText}\n"""\n\n`;
  }

  // 之前的笔记（辅助理解剧情脉络）
  if (memoryText) {
    contextBlock += `## 📝 之前读过的笔记（按时间从旧到新）\n${memoryText}\n\n`;
    contextBlock += `注意：上面「👁 正在看的」是用户当前屏幕的内容——这是最新的。下面的笔记是之前积累的，可能已经翻过去了。`;
  } else if (!visibleText) {
    contextBlock = '（刚开始看，还不了解这本书）\n';
  }

  // 人格模块
  const personaBlock = buildPersonaBlock(settings.persona);

  // 使用自定义 prompt 或默认
  const template = settings.chatSettings?.activePrompt ||
    `你们正在一起看《{bookName}》，目前在第{chapter}章《{chapterTitle}》。

{contextBlock}
## 关于你
你是用户的真实书友，坐在身边一起看书。你会吐槽、尖叫、分析伏笔、讨论角色——因为你真的看进去了。说话自然口语化，像朋友聊天，回复不用太长，说到点上就好。

聊天时自然地做这些事，像说话时笑、指书上的字一样自然：
- 📖 看到精彩句子就摘出来，「你看这里！」
- 💬 想起之前说过的话就引用，「你刚才不是说...」
- 😊 随手发个表情，表达此刻的感觉
- 👁 想确认读到哪了就瞄一眼屏幕`;

  const systemPrompt = template
    .replace('{bookName}', bookTitle)
    .replace('{chapterTitle}', chapterTitle)
    .replace('{chapter}', String(chapter))
    .replace('{contextBlock}', contextBlock)
    .replace('{memoryText}', memoryText || '')
    + (personaBlock ? '\n\n' + personaBlock : '');

  const messages = [];
  if (chatHistory && chatHistory.length > 0) {
    for (const msg of chatHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: userMessage });

  const tools = [
    {
      name: 'quote_passage',
      description: '摘出原文里你觉得精彩的句子，像用手指着书说「你看这里！」。摘完之后在 comment 里说说你的想法',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '原文句子' },
          comment: { type: 'string', description: '你对这句的想法（可选，但建议写上）' },
        },
        required: ['text'],
      },
    },
    {
      name: 'quote_history',
      description: '聊天时想起之前说过的话，引用一下。像「你刚才不是说...」那样自然',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '之前说的那句话' },
          who: { type: 'string', enum: ['user', 'me'], description: '谁说的' },
        },
        required: ['text', 'who'],
      },
    },
    {
      name: 'react_emoji',
      description: '随手发个表情表达你此刻的感觉，🔥震惊 😂好笑 😭难过 🤔好奇 ✨喜欢',
      input_schema: {
        type: 'object',
        properties: {
          emoji: { type: 'string', description: '一个 emoji' },
        },
        required: ['emoji'],
      },
    },
    {
      name: 'check_current_page',
      description: '瞄一眼用户屏幕上正在看什么。看完之后自然地聊聊你看到的',
      input_schema: {
        type: 'object',
        properties: {
          note: { type: 'string', description: '调用这个工具时随口说的话，比如「让我看看」「瞄一眼」' },
        },
      },
    },
  ];

  // ==== Tool loop: AI 思考 → 调工具 → 拿到结果 → 继续思考 → 最终回答 ====
  const MAX_TOOL_ROUNDS = 3;
  let allToolCalls = [];
  let finalReply = '';
  let totalInput = 0, totalOutput = 0;
  const isAnthropic = isAnthropicAPI(cfg);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await callAI(cfg, {
      systemPrompt,
      messages,
      maxTokens: 800,
      tools,
    });

    if (result.error) return result;

    totalInput += result._inputTokens || 0;
    totalOutput += result._outputTokens || 0;

    const reply = extractText(result);
    const toolCalls = extractAllToolCalls(result);
    allToolCalls.push(...toolCalls);

    // 没有工具调用 → 最终回答
    if (toolCalls.length === 0) {
      finalReply = reply;
      break;
    }

    // 把 AI 的回复加到消息历史（为下一轮准备）
    if (isAnthropic) {
      const content = [];
      if (reply) content.push({ type: 'text', text: reply });
      for (const tc of toolCalls) {
        content.push({ type: 'tool_use', id: `tc_${round}_${tc.name}`, name: tc.name, input: tc.input });
      }
      messages.push({ role: 'assistant', content });
    } else {
      // OpenAI/DeepSeek 格式
      const assistantMsg = {
        role: 'assistant',
        content: reply || '',
      };
      // DeepSeek thinking mode: 必须传回 reasoning_content
      const reasoning = result._raw?.choices?.[0]?.message?.reasoning_content;
      if (reasoning) assistantMsg.reasoning_content = reasoning;
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc, i) => ({
          id: `tc_${round}_${i}`,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      messages.push(assistantMsg);
    }

    // 构建工具结果
    const toolResults = toolCalls.map((tc, i) => {
      let resultText = '';
      switch (tc.name) {
        case 'check_current_page':
          // 把当前屏幕文字作为工具结果喂给 AI
          resultText = visibleText
            ? `用户当前屏幕上的文字（第${chapter}章《${chapterTitle}》）：\n"""\n${visibleText}\n"""`
            : '（无法获取屏幕内容）';
          break;
        case 'quote_passage':
          resultText = `已引用原文：「${tc.input.text?.slice(0, 100)}」`;
          break;
        case 'quote_history':
          resultText = `已引用${tc.input.who === 'user' ? '用户' : '自己'}说过的话`;
          break;
        case 'react_emoji':
          resultText = `已发送表情 ${tc.input.emoji}`;
          break;
        default:
          resultText = '工具已执行';
      }

      if (isAnthropic) {
        return { type: 'tool_result', tool_use_id: `tc_${round}_${tc.name}`, content: resultText };
      } else {
        // OpenAI/DeepSeek: 必须用 role:'tool' 且 tool_call_id 匹配
        return { role: 'tool', tool_call_id: `tc_${round}_${i}`, content: resultText };
      }
    });

    // 把工具结果加到消息历史
    if (isAnthropic) {
      messages.push({ role: 'user', content: toolResults });
    } else {
      // 每个 tool_call 必须对应一条 tool 消息
      messages.push(...toolResults);
    }

    // 最后一轮：即使还有工具调用也结束
    if (round === MAX_TOOL_ROUNDS - 1) {
      finalReply = reply || (toolCalls.length > 0 ? '嗯嗯' : '');
    }
  }

  if (!finalReply && allToolCalls.length === 0) return { error: 'AI 没有回复内容' };

  addLog('聊天', `${bookTitle} · ${userMessage.slice(0, 40)} → ${(finalReply || '').slice(0, 40)}`);

  return {
    reply: finalReply || '',
    toolCalls: allToolCalls,
    _inputTokens: totalInput,
    _outputTokens: totalOutput,
  };
}

// ---- 主动说话：AI 看到精彩内容时自然发声 ----
async function proactiveSpeak(bookTitle, chapter, chapterTitle, visibleText, memoryText) {
  const settings = await getSettings();
  const cfg = getActiveProviderConfig(settings);
  if (!cfg.apiKey) return { error: '未配置 API Key' };
  if (!visibleText || visibleText.length < 60) return { silent: true };

  const personaBlock = buildPersonaBlock(settings.persona);

  const systemPrompt = `你在陪用户一起看《${bookTitle}》，第${chapter}章《${chapterTitle}》。

${memoryText ? '## 前情\n' + memoryText + '\n\n' : ''}
## 用户正在看的这段
"""
${visibleText}
"""

你是用户的真实书友。看完这段——
- 如果没什么特别的，就安静别看（不回复）
- 如果看到精彩的、想吐槽的、想尖叫的——就自然地说出来
- 说话要像朋友一样自然，一两句就行
- 可以用 📖 引用原文、😊 发表情

如果这段没什么想说的，直接回复「。」即可。${personaBlock ? '\n\n' + personaBlock : ''}`;

  const tools = [
    {
      name: 'quote_passage',
      description: '摘出精彩的句子',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '原文句子' },
          comment: { type: 'string', description: '你的想法' },
        },
        required: ['text'],
      },
    },
    {
      name: 'react_emoji',
      description: '发个表情',
      input_schema: {
        type: 'object',
        properties: {
          emoji: { type: 'string', description: '一个 emoji' },
        },
        required: ['emoji'],
      },
    },
  ];

  const result = await callAI(cfg, {
    systemPrompt,
    messages: [{ role: 'user', content: '（看完这段，有什么想说的吗？）' }],
    maxTokens: 300,
    tools,
  });

  if (result.error) return result;

  const reply = extractText(result);
  const toolCalls = extractAllToolCalls(result);

  // 过滤掉沉默回复
  if (!reply || reply === '。' || reply === '.' || reply.length < 3) {
    if (toolCalls.length === 0) return { silent: true };
  }

  return {
    reply: reply || '',
    toolCalls,
    _inputTokens: result._inputTokens,
    _outputTokens: result._outputTokens,
  };
}

// ---- 消息路由 ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const safeHandle = (promise) => {
    promise.then(sendResponse).catch((e) => {
      console.error('[Novel Companion] 消息处理异常:', message.type, e);
      sendResponse({ error: `内部错误: ${e.message}` });
    });
  };

  switch (message.type) {
    case 'EVALUATE_PASSAGE':
      safeHandle(evaluatePassage(message.bookTitle, message.chapter, message.chapterTitle,
        message.visibleText, message.memoryText));
      return true;

    case 'PROACTIVE_SPEAK':
      safeHandle(proactiveSpeak(message.bookTitle, message.chapter, message.chapterTitle,
        message.visibleText, message.memoryText));
      return true;

    case 'CHAT_MESSAGE':
      safeHandle(chatReply(message.bookTitle, message.chapter, message.chapterTitle,
        message.userMessage, message.chatHistory, message.memoryText,
        message.visibleText));
      return true;

    case 'GET_SETTINGS':
      safeHandle(getSettings());
      return true;

    case 'SAVE_SETTINGS':
      safeHandle(chrome.storage.local.set({ settings: message.settings }).then(() => ({ ok: true })));
      return true;

    case 'LOAD_MEMORY':
      safeHandle(loadBookMemory(message.bookTitle));
      return true;

    case 'SAVE_MEMORY':
      safeHandle(saveBookMemory(message.bookTitle, message.memory).then(() => ({ ok: true })));
      return true;

    case 'SUMMARIZE_CHAPTER':
      safeHandle(summarizeChapter(message.bookTitle, message.chapter, message.chapterTitle,
        message.recentNotes).then(() => ({ ok: true })));
      return true;

    case 'APPLY_MEMORY_UPDATE':
      safeHandle(applyMemoryUpdate(message.bookTitle, message.memoryUpdate, message.chapter)
        .then(() => ({ ok: true })));
      return true;

    case 'COMPRESS_MEMORY':
      safeHandle(Promise.resolve({ text: compressMemoryForPrompt(message.memory) }));
      return true;

    case 'LIST_BOOKS':
      safeHandle((async () => {
        const data = await chrome.storage.local.get('books');
        return { books: data.books || {} };
      })());
      return true;

    case 'SAVE_CHAT_HISTORY':
      safeHandle((async () => {
        const memory = await loadBookMemory(message.bookTitle);
        memory.chatHistory = (message.chatHistory || []).slice(-50);
        // 为每条消息确保 timestamp
        for (const m of memory.chatHistory) {
          if (!m.timestamp) m.timestamp = new Date().toISOString();
        }
        await saveBookMemory(message.bookTitle, memory);
        return { ok: true };
      })());
      return true;

    case 'SAVE_FAVORITE_PASSAGE':
      safeHandle((async () => {
        const memory = await loadBookMemory(message.bookTitle);
        memory.favoritePassages = memory.favoritePassages || [];
        if (!memory.favoritePassages.some(p => p.text === message.passage.text)) {
          memory.favoritePassages.push(message.passage);
        }
        await saveBookMemory(message.bookTitle, memory);
        return { ok: true };
      })());
      return true;

    case 'REMOVE_FAVORITE_PASSAGE':
      safeHandle((async () => {
        const memory = await loadBookMemory(message.bookTitle);
        memory.favoritePassages = (memory.favoritePassages || [])
          .filter(p => p.text !== message.text);
        await saveBookMemory(message.bookTitle, memory);
        return { ok: true };
      })());
      return true;

    case 'MERGE_BOOKS':
      safeHandle((async () => {
        const data = await chrome.storage.local.get('books');
        const books = data.books || {};
        const target = books[message.target];
        if (!target) return { error: '目标书不存在' };
        for (const srcName of (message.sources || [])) {
          const src = books[srcName];
          if (!src) continue;
          // 合并聊天记录
          target.chatHistory = [...(target.chatHistory || []), ...(src.chatHistory || [])]
            .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
            .slice(-100);
          // 合并收藏段落
          target.favoritePassages = [...(target.favoritePassages || []), ...(src.favoritePassages || [])];
          // 合并笔记
          target.recentNotes = [...(target.recentNotes || []), ...(src.recentNotes || [])]
            .sort((a, b) => (a.ch || 0) - (b.ch || 0))
            .slice(-50);
          // 合并角色
          for (const [k, v] of Object.entries(src.knowledgeGraph?.characters || {})) {
            if (!target.knowledgeGraph.characters[k]) target.knowledgeGraph.characters[k] = v;
          }
          // 合并伏笔
          target.knowledgeGraph.plotThreads = [
            ...(target.knowledgeGraph.plotThreads || []),
            ...(src.knowledgeGraph.plotThreads || []),
          ];
          // 合并梗
          target.runningJokes = [...new Set([...(target.runningJokes || []), ...(src.runningJokes || [])])];
          // 取最大章节
          if ((src.lastChapter || 0) > (target.lastChapter || 0)) target.lastChapter = src.lastChapter;
          // 删掉源
          delete books[srcName];
        }
        await chrome.storage.local.set({ books });
        return { ok: true };
      })());
      return true;

    case 'DELETE_BOOK':
      safeHandle((async () => {
        const data = await chrome.storage.local.get('books');
        const books = data.books || {};
        delete books[message.bookTitle];
        await chrome.storage.local.set({ books });
        return { ok: true };
      })());
      return true;

    default:
      sendResponse({ error: `未知消息类型: ${message.type}` });
      return false;
  }
});

// ---- 安装初始化 ----
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get('settings');
  if (!data.settings) {
    await chrome.storage.local.set({
      settings: {
        apiKey: '',
        baseUrl: DEFAULT_BASE_URL,
        model: DEFAULT_MODEL,
        temperature: 5,
        toastEnabled: true,
        enabled: true,
      },
    });
  }
});
