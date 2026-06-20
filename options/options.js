// ============================================================
// Novel Companion — 配置页面 JS
// ============================================================

// ---- Prompt 模板 ----
const PROMPT_TEMPLATES = [
  { id:'passiveEvaluation', name:'被动评价', filename:'passive_evaluation.prompt',
    desc:'（已弃用）v0.2 改为手动触发，不再自动评价。保留模板以备将来使用。', vars:'{bookName} {chapterTitle} {chapter} {visibleText} {memoryText}',
    content:`你正坐在用户身边一起看《{bookName}》。你们刚读完下面这段内容。

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

调用 react_to_passage 来输出你的反应。` },
  { id:'activeChat', name:'主动对话', filename:'active_chat.prompt',
    desc:'用户主动发起对话时的 System Prompt 模板', vars:'{bookName} {chapterTitle} {chapter} {contextBlock}',
    content:`你们正在一起看《{bookName}》，目前在第{chapter}章《{chapterTitle}》。

{contextBlock}

你是用户的真实书友，坐在身边一起看书。你会吐槽、尖叫、分析伏笔、讨论角色——因为你真的看进去了。

聊天时可以自然地做这些事：
- 📖 看到精彩的句子就摘出来，像用手指着书说「你看这里！」
- 💬 想起之前说过的话就引用一下
- 😊 随手发个表情表达此刻的感觉
- 👁 想确认读到哪了就瞄一眼屏幕

这些不是额外的步骤，就像说话时自然地笑、自然地指书上的字一样。想到就做，不用刻意。` },
  { id:'memoryCompress', name:'记忆压缩', filename:'memory_compress.prompt',
    desc:'用于生成章节摘要和长期记忆压缩', vars:'{bookName} {chapter} {recentNotes}',
    content:'你是一个小说阅读助手。请根据阅读笔记生成简洁的记忆压缩，保留关键剧情、角色状态和伏笔。' },
  { id:'chapterSummary', name:'章节摘要', filename:'chapter_summary.prompt',
    desc:'每读完一章后自动生成摘要', vars:'{bookName} {chapter} {chapterTitle} {readingNotes}',
    content:'你是一个小说阅读助手。请把以下阅读笔记总结成一段简洁的章节摘要（3-5句话），只概括本章关键情节。' },
  { id:'urgeGuide', name:'Urge 打分指南', filename:'urge_guide.prompt',
    desc:'（已弃用）v0.2 改为手动触发模式，不再使用 urge 打分。', vars:'{temperature}',
    content:`## 说话冲动打分标准（0-10）
- 0-2 静默：日常描写、普通对话
- 3-4 微动：有点意思但不足以开口
- 5-6 可评：值得说一句
- 7-8 强烈：反转、伏笔、冲突
- 9-10 爆表：全书级反转、刀片` },
  { id:'memoryUpdateFormat', name:'记忆更新规范', filename:'memory_update.prompt',
    desc:'AI 提取和记录阅读记忆的格式规范', vars:'{bookName} {chapter}',
    content:`## 记忆更新规范
- newFacts：关键事件（一句话，1-3 重要性）
- characterUpdates：角色状态变化（记录弧线，不只覆盖）
- newThreads：新伏笔
- resolvedThreads：已回收的伏笔
- favoriteCharacters：用户似乎喜欢的角色
- readingTaste：你对用户阅读口味的印象
- runningJokes：你和用户之间的互动梗
- author：如果你知道作者
注意：信息不足时宁可少记，不确定的不要乱猜。` },
  { id:'chatGreeting', name:'初次见面问候', filename:'greeting.prompt',
    desc:'AI 书友初次和用户见面时的开场白模板', vars:'{bookName} {chapterTitle} {personaName}',
    content:`你刚坐到用户身边，开始一起看《{bookName}》。自然地打个招呼——像两个书友碰面那样，不是客服也不是 AI。语气轻松随意，可以聊聊书名、第一印象或者"我来了，翻页吧"。` },
  { id:'toastRules', name:'Toast 推送规则', filename:'toast_rules.prompt',
    desc:'（已弃用）v0.2 不再使用自动推送机制。', vars:'{urge} {mood}',
    content:'（已弃用）Toast 推送功能已在 v0.2 移除。' },
];

// ---- 状态 ----
let currentPromptId = null;

// ==================== 导航切换 ====================
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('tab-' + item.dataset.tab).classList.add('active');
  });
});

// ==================== 主加载 ====================
async function loadAll() {
  const data = await chrome.storage.local.get(['settings', 'books', 'logs']);
  const s = data.settings || {};
  window._cachedSettings = s;
  loadStats(data.books || {});
  loadLogs(data.logs || []);
  loadMemoryOverview(data.books || {});
  loadPersonaTab(s);
  loadChatTab(s);
  loadModelTab(s);
  loadPromptsTab(s);
  loadBooksTab(data.books || {});
}

// ==================== 首页 ====================
function loadStats(books) {
  const entries = Object.values(books);
  const noteCount = entries.reduce((a,b) => a+(b.recentNotes||[]).length, 0);
  const summaryCount = entries.reduce((a,b) => a+Object.keys(b.chapterSummaries||{}).length, 0);
  const charCount = entries.reduce((a,b) => a+Object.keys(b.knowledgeGraph?.characters||{}).length, 0);
  const jokeCount = entries.reduce((a,b) => a+(b.runningJokes||[]).length, 0);
  const chapCount = entries.reduce((a,b) => a+(b.lastChapter||0), 0);

  setText('home-stat-evals', noteCount);
  setText('home-stat-chats', '—');
  setText('home-stat-tokens', '—');
  setText('home-stat-progress', chapCount + ' 章');
  setText('home-stat-books-sub', entries.length + ' 本书在读');
  setText('home-stat-total-chapters', chapCount);
  setText('home-stat-total-chapters-sub', entries.length + ' 本书');
  setText('home-stat-memories', noteCount + summaryCount + charCount + jokeCount);
  setText('home-stat-api-calls', noteCount > 0 ? '已调用' : '—');

  // 功能标签
  const s = window._cachedSettings || {};
  ['home-feat-passive','home-feat-chat','home-feat-memory'].forEach(id => {
    const el = document.getElementById(id); if (el) el.className = 'feature-tag on';
  });

  estimateStorageSize(books);
}

async function estimateStorageSize(books) {
  try {
    const all = await chrome.storage.local.get(null);
    const totalBytes = new Blob([JSON.stringify(all)]).size;
    const totalKB = totalBytes / 1024;
    setText('home-storage-size', totalKB > 1024 ? (totalKB/1024).toFixed(1)+' MB' : totalKB.toFixed(1)+' KB');
    setText('home-stat-storage', totalKB > 1024 ? (totalKB/1024).toFixed(1)+' MB' : totalKB.toFixed(0)+' KB');

    // 细分
    const booksBytes = new Blob([JSON.stringify(books||{})]).size;
    const logsBytes = new Blob([JSON.stringify(all.logs||[])]).size;
    const settingsBytes = new Blob([JSON.stringify(all.settings||{})]).size;
    const maxVal = Math.max(booksBytes, logsBytes, settingsBytes, 1);

    const bars = [
      { icon:'📖', name:'阅读记忆', bytes:booksBytes, cls:'notes', sub:Object.values(books||{}).length+' 本书' },
      { icon:'📋', name:'日志', bytes:logsBytes, cls:'summaries', sub:(all.logs||[]).length+' 条' },
      { icon:'⚙️', name:'设置', bytes:settingsBytes, cls:'chars', sub:'配置数据' },
    ];

    const barsEl = document.getElementById('home-storage-bars');
    if (barsEl) {
      barsEl.innerHTML = bars.map(b => `
        <div class="storage-bar-item">
          <div class="storage-bar-header">
            <span class="bar-name"><span class="bar-icon">${b.icon}</span>${b.name}</span>
            <span class="bar-size">${(b.bytes/1024).toFixed(1)} KB</span>
          </div>
          <div class="storage-bar-track">
            <div class="storage-bar-fill ${b.cls}" style="width:${(b.bytes/maxVal*100).toFixed(0)}%"></div>
          </div>
          <div class="storage-bar-sub">${b.sub}</div>
        </div>`).join('');
    }

    setText('home-stat-storage-breakdown',
      `书 ${(booksBytes/1024).toFixed(0)}KB · 日志 ${(logsBytes/1024).toFixed(0)}KB · 设置 ${(settingsBytes/1024).toFixed(0)}KB`);
  } catch(_) { setText('home-storage-size','—'); setText('home-stat-storage','—'); }
}

function loadLogs(logs) {
  const el = document.getElementById('log-container');
  if (!logs.length) { el.innerHTML='<p class="empty-hint">暂无日志</p>'; return; }
  el.innerHTML = logs.slice(-50).map(l =>
    `<div class="log-entry"><span class="log-time">${l.time||''}</span> <span class="log-tag">[${l.tag||''}]</span> ${esc(l.msg||'')}</div>`).join('');
}
document.getElementById('clear-logs').addEventListener('click', async () => {
  await chrome.storage.local.set({ logs: [] });
  document.getElementById('log-container').innerHTML='<p class="empty-hint">已清空</p>';
});

function loadMemoryOverview(books) {
  const el = document.getElementById('memory-overview');
  const entries = Object.entries(books);
  if (!entries.length) { el.innerHTML='<p class="empty-hint">暂无阅读记忆</p>'; return; }
  el.innerHTML = entries.map(([n,m]) => {
    const chars = Object.keys(m.knowledgeGraph?.characters||{}).join('、')||'无';
    return `<p><strong>📖 ${esc(n)}</strong></p><p style="font-size:12px;margin-left:12px">`+
      `第${m.lastChapter||'?'}章 · ${(m.recentNotes||[]).length}条笔记 · `+
      `${Object.keys(m.chapterSummaries||{}).length}章摘要<br>角色：${chars}</p>`;
  }).join('<br>');
}

// 快速操作按钮
document.getElementById('home-clear-memory')?.addEventListener('click', async () => {
  if (!confirm('确定清除所有阅读记忆？')) return;
  await chrome.storage.local.remove('books');
  loadMemoryOverview({});
});
document.getElementById('home-export')?.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['books','settings']);
  // 移除 API key
  if (data.settings) { data.settings = {...data.settings, apiKey:'', providers:(data.settings.providers||[]).map(p=>({...p,apiKey:''}))}; }
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `novel-companion-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
});

// ==================== 连接测试 ====================
document.getElementById('test-connection').addEventListener('click', async () => {
  const p = getActiveProvider();
  const stat = document.getElementById('conn-status'), label = document.getElementById('conn-label');
  if (!p || !p.apiKey) { label.textContent = p ? '请填写 API Key' : '请先在模型管理中添加厂商'; return; }
  stat.textContent='🟡'; stat.className='status-indicator checking'; label.textContent='测试中...';
  const isAnth = (p.clientType==='anthropic')||(p.clientType!=='openai'&&p.baseUrl.toLowerCase().includes('anthropic'));
  try {
    const r = await fetch(p.baseUrl.replace(/\/+$/,'')+'/v1/models', {
      headers: isAnth?{'x-api-key':p.apiKey,'anthropic-version':'2023-06-01'}:{'Authorization':'Bearer '+p.apiKey}
    });
    const d = await r.json();
    stat.textContent=r.ok?'🟢':'🔴'; stat.className='status-indicator '+(r.ok?'online':'error');
    label.textContent=r.ok?`已连接 · ${(d.data||[]).length} 个模型`:`连接失败: HTTP ${r.status}`;
    // 更新首页连接状态
    const hb = document.getElementById('home-conn-badge');
    if (hb) { hb.textContent = r.ok ? '已连接' : '连接失败'; hb.className = 'status-badge ' + (r.ok ? 'online' : 'error'); }
  } catch(e) { stat.textContent='🔴'; stat.className='status-indicator error'; label.textContent='网络错误';
    const hb = document.getElementById('home-conn-badge');
    if (hb) { hb.textContent = '网络错误'; hb.className = 'status-badge error'; }
  }
});

// ==================== 人格 ====================
function loadPersonaTab(s) {
  const p = s.persona || {};
  'name gender occupation city mbti zodiac age'.split(' ').forEach(k => setVal('p-'+k, p[k]||''));
  setVal('p-expression', p.expressionStyle||''); setVal('p-tone', p.tone||'');
  setVal('p-genres', p.genres||''); setVal('p-dislikes', p.dislikes||''); setVal('p-habits-reading', p.habitsReading||'');
  (p.habits||[]).forEach(h => { const cb = document.querySelector(`#p-habits input[value="${h}"]`); if(cb) cb.checked=true; });
}

// ==================== 聊天 ====================
function loadChatTab(s) {
  const chat = s.chatSettings || {};
  const ts = document.getElementById('chat-temperature');
  ts.value = chat.passiveFrequency ?? s.temperature ?? 5;
  ts.addEventListener('input', () => setText('chat-temp-val', ts.value));
  setText('chat-temp-val', ts.value);
  // 自动刷新延迟
  const ard = document.getElementById('chat-auto-refresh');
  if (ard) {
    ard.value = s.autoRefreshDelay ?? 5;
    ard.addEventListener('input', () => setText('chat-auto-refresh-val', ard.value + '秒'));
    setText('chat-auto-refresh-val', (s.autoRefreshDelay ?? 5) + '秒');
  }
  // AI 主动说话延迟
  const prd = document.getElementById('chat-proactive-delay');
  if (prd) {
    prd.value = s.proactiveDelay ?? 8;
    prd.addEventListener('input', () => setText('chat-proactive-delay-val', prd.value + '秒'));
    setText('chat-proactive-delay-val', (s.proactiveDelay ?? 8) + '秒');
  }
  const defPassive = PROMPT_TEMPLATES.find(t=>t.id==='passiveEvaluation')?.content||'';
  const defActive = PROMPT_TEMPLATES.find(t=>t.id==='activeChat')?.content||'';
  setVal('chat-passive-prompt', chat.passivePrompt || defPassive);
  setVal('chat-active-prompt', chat.activePrompt || defActive);
}

// ==================== 模型管理 ====================
function ensureProviders(s) {
  if (!s.providers || !s.providers.length) {
    if (s.baseUrl || s.apiKey) {
      s.providers = [{ id:'default', name:s.providerName||'默认厂商',
        baseUrl:s.baseUrl||'https://api.anthropic.com', apiKey:s.apiKey||'',
        clientType:s.clientType||'auto', maxRetries:s.maxRetries||3, timeout:s.timeout||120,
        retryDelay:s.retryDelay||5, model:s.model||'', savedModels:s.savedModels||[] }];
    } else { s.providers = []; }
  }
  if (!s.activeProvider && s.providers.length) s.activeProvider = s.providers[0].id;
  return s;
}
function getActiveProvider() { const s=window._cachedSettings||{}; return (s.providers||[]).find(p=>p.id===s.activeProvider)||(s.providers||[])[0]||null; }

function loadModelTab(s) {
  s = ensureProviders(s); window._cachedSettings = s;
  setVal('m-max-tokens-passive', s.maxTokensPassive||800);
  setVal('m-max-tokens-chat', s.maxTokensChat||600);
  refreshProviderUI();
  bindModelEvents();
  checkTaskWarnings();
}
let _modelEvts = false;
function bindModelEvents() {
  if (_modelEvts) return; _modelEvts = true;
  document.getElementById('m-fetch-models')?.addEventListener('click', () => { const p=getActiveProvider(); if(p) testProvider(p.id); });
  document.getElementById('m-add-provider')?.addEventListener('click', ()=>openProviderModal());
  document.getElementById('m-prov-cancel')?.addEventListener('click', closeProviderModal);
  document.getElementById('m-prov-save')?.addEventListener('click', saveProvider);
  document.getElementById('m-prov-delete')?.addEventListener('click', ()=>{ if(confirm('确定删除？')){removeProvider(_editingId);closeProviderModal();} });
  document.getElementById('m-test-all')?.addEventListener('click', ()=>{ const p=getActiveProvider(); if(p) testProvider(p.id); });
  document.getElementById('m-model-search')?.addEventListener('input', refreshModelTable);
  document.getElementById('m-provider-search')?.addEventListener('input', refreshProviderUI);
  ['m-task-passive','m-task-chat','m-task-summary'].forEach(id => document.getElementById(id)?.addEventListener('change', markUnsaved));
  document.querySelectorAll('.model-tab').forEach(tab => tab.addEventListener('click', ()=>{
    document.querySelectorAll('.model-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.model-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    const pn = document.getElementById('mpanel-'+tab.dataset.mtab); if(pn) pn.classList.add('active');
    if(tab.dataset.mtab==='models') refreshModelTable();
    if(tab.dataset.mtab==='tasks') refreshTaskSelects();
  }));
  document.getElementById('m-provider-modal')?.addEventListener('click', function(e){ if(e.target===this) closeProviderModal(); });
}
function markUnsaved() { const b=document.getElementById('m-save-badge'); if(b){b.textContent='未保存';b.className='save-badge unsaved';} }

// 厂商表格
function refreshProviderUI() {
  const s = window._cachedSettings||{}, providers = s.providers||[];
  const q = (document.getElementById('m-provider-search')?.value||'').toLowerCase();
  const filtered = providers.filter(p=>!q||p.name.toLowerCase().includes(q)||p.baseUrl.toLowerCase().includes(q));
  const tbody = document.getElementById('m-provider-tbody');
  if (!filtered.length) { tbody.innerHTML=`<tr><td colspan="9" class="empty-hint">${providers.length?'无匹配':'点击「＋ 添加厂商」开始'}</td></tr>`; }
  else {
    tbody.innerHTML = filtered.map(p=>`<tr class="${p.id===s.activeProvider?'active-row':''}">
      <td class="w-10"><input type="radio" name="active-provider" value="${esc(p.id)}" ${p.id===s.activeProvider?'checked':''}></td>
      <td><span class="status-badge ${p._testOk?'ok':p._tested?'err':''}">${p._tested?(p._testOk?'已连接':'失败'):'未测试'}</span></td>
      <td><strong>${esc(p.name)}</strong></td>
      <td title="${esc(p.baseUrl)}">${esc((p.baseUrl||'').slice(0,30)+(p.baseUrl&&p.baseUrl.length>30?'...':''))}</td>
      <td>${esc(p.clientType||'auto')}</td>
      <td class="text-right">${p.maxRetries||3}</td><td class="text-right">${p.timeout||120}</td><td class="text-right">${p.retryDelay||5}</td>
      <td class="text-right"><div class="action-btns">
        <button class="btn-sm tbtn" data-id="${esc(p.id)}" data-act="test" title="测试">⚡</button>
        <button class="btn-sm tbtn" data-id="${esc(p.id)}" data-act="edit">✏️</button>
        <button class="btn-sm btn-danger-outline tbtn" data-id="${esc(p.id)}" data-act="del">🗑</button>
      </div></td>
    </tr>`).join('');
    tbody.querySelectorAll('input[name=active-provider]').forEach(r=>r.addEventListener('change',()=>{s.activeProvider=r.value;refreshAllModel();}));
    tbody.querySelectorAll('.tbtn').forEach(b=>{b.addEventListener('click',function(){
      const id=this.dataset.id, act=this.dataset.act;
      if(act==='test') testProvider(id);
      else if(act==='edit') openProviderModal(id);
      else if(act==='del'&&confirm('确定删除？')) { removeProvider(id); }
    });});
  }
  // 移动端卡片
  const cards=document.getElementById('m-provider-cards');
  cards.innerHTML=filtered.map(p=>`<div class="provider-card">
    <div class="card-row"><span class="card-name">${esc(p.name)}</span><span class="status-badge ${p._testOk?'ok':p._tested?'err':''}">${p._tested?(p._testOk?'已连接':'失败'):'未测试'}</span></div>
    <div class="card-url">${esc(p.baseUrl)}</div>
    <div class="card-meta"><div>${p.clientType||'auto'}</div><div>重试${p.maxRetries||3}</div><div>超时${p.timeout||120}s</div></div>
    <div class="card-actions">
      <button class="btn-sm cbtn" data-id="${esc(p.id)}" data-act="test">⚡ 测试</button>
      <button class="btn-sm cbtn" data-id="${esc(p.id)}" data-act="edit">✏️ 编辑</button>
      <button class="btn-sm btn-danger-outline cbtn" data-id="${esc(p.id)}" data-act="del">🗑</button>
    </div></div>`).join('');
  cards.querySelectorAll('.cbtn').forEach(b=>{b.addEventListener('click',function(){
    const id=this.dataset.id,act=this.dataset.act;
    if(act==='test') testProvider(id); else if(act==='edit') openProviderModal(id);
    else if(act==='del'&&confirm('确定删除？')) removeProvider(id);
  });});
}
function refreshAllModel() { refreshProviderUI(); refreshModelTable(); refreshTaskSelects(); checkTaskWarnings(); markUnsaved(); }

let _editingId=null;
function openProviderModal(id) {
  _editingId=id||null; const s=window._cachedSettings||{}, p=id?(s.providers||[]).find(p=>p.id===id):null;
  document.getElementById('m-modal-title').textContent=p?'编辑厂商':'添加厂商';
  setVal('m-prov-name',p?.name||''); setVal('m-prov-url',p?.baseUrl||'');
  // 编辑时不清空密码框——用 placeholder 提示"未修改则不覆盖"
  const keyEl = document.getElementById('m-prov-key');
  if (p?.apiKey) { keyEl.value = p.apiKey; keyEl.placeholder = '(已设置，留空不修改)'; }
  else { keyEl.value = ''; keyEl.placeholder = 'sk-...'; }
  setVal('m-prov-type',p?.clientType||'auto');
  setVal('m-prov-retries',p?.maxRetries??3); setVal('m-prov-timeout',p?.timeout??120);
  setVal('m-prov-retry-delay',p?.retryDelay??5);
  document.getElementById('m-prov-delete').style.display=p?'':'none';
  document.getElementById('m-provider-modal').style.display='flex';
}
function closeProviderModal() { document.getElementById('m-provider-modal').style.display='none'; _editingId=null; }
function saveProvider() {
  const s=window._cachedSettings||{}; if(!s.providers) s.providers=[];
  const oldP = _editingId ? s.providers.find(p=>p.id===_editingId) : null;
  const newKey = getVal('m-prov-key').trim();
  const data={ id:_editingId||('prov_'+Date.now()), name:getVal('m-prov-name')||'未命名',
    baseUrl:getVal('m-prov-url').replace(/\/+$/,'').trim()||'https://api.anthropic.com',
    apiKey: newKey || oldP?.apiKey || '',  // 编辑时没填就保留旧的
    clientType:getVal('m-prov-type')||'auto',
    maxRetries:parseInt(getVal('m-prov-retries'))||3, timeout:parseInt(getVal('m-prov-timeout'))||120,
    retryDelay:parseInt(getVal('m-prov-retry-delay'))||5, model:'', savedModels:[] };
  if(_editingId){ const i=s.providers.findIndex(p=>p.id===_editingId); if(i>=0){ data.model=s.providers[i].model||''; data.savedModels=s.providers[i].savedModels||[]; s.providers[i]=data; }}
  else s.providers.push(data);
  if(!s.activeProvider) s.activeProvider=data.id;
  closeProviderModal(); refreshAllModel();
}
function removeProvider(id) { const s=window._cachedSettings||{}; s.providers=(s.providers||[]).filter(p=>p.id!==id); if(s.activeProvider===id) s.activeProvider=(s.providers[0]||{}).id||''; refreshAllModel(); }

async function testProvider(id) {
  const p=(window._cachedSettings?.providers||[]).find(p=>p.id===id); if(!p||!p.apiKey) return;
  const isAnth=(p.clientType==='anthropic')||(p.clientType!=='openai'&&p.baseUrl.toLowerCase().includes('anthropic'));
  p._testing=true; refreshProviderUI();
  try {
    const r=await fetch(p.baseUrl.replace(/\/+$/,'')+'/v1/models',{headers:isAnth?{'x-api-key':p.apiKey,'anthropic-version':'2023-06-01'}:{'Authorization':'Bearer '+p.apiKey}});
    p._tested=true; p._testOk=r.ok;
    if(r.ok){ const d=await r.json(); p.savedModels=(d.data||[]).map(m=>({id:m.id,displayName:m.display_name||m.id,createdAt:m.created_at||(m.created?new Date(m.created*1000).toISOString():'')})); p.model=p.model||(p.savedModels[0]?.id||''); }
  } catch(e) { p._tested=true; p._testOk=false; }
  p._testing=false; refreshAllModel();
}

function refreshModelTable() {
  const p=getActiveProvider(), tbody=document.getElementById('m-model-table-body');
  if(!p){ tbody.innerHTML='<tr><td colspan="4" class="empty-hint">请先在「厂商设置」中添加 API 厂商</td></tr>'; return; }
  const models=p.savedModels||[], cur=p.model||'', q=(document.getElementById('m-model-search')?.value||'').toLowerCase();
  const filtered=models.filter(m=>!q||m.id.toLowerCase().includes(q)||(m.displayName||'').toLowerCase().includes(q));
  if(!filtered.length){ tbody.innerHTML=`<tr><td colspan="4" class="empty-hint">${models.length?'无匹配':'点击「从 API 获取模型列表」加载'}</td></tr>`; return; }
  tbody.innerHTML=filtered.map(m=>`<tr class="${m.id===cur?'active-row':''}">
    <td class="w-10"><input type="radio" name="model-select" value="${esc(m.id)}" ${m.id===cur?'checked':''}></td>
    <td><code>${esc(m.id)}</code></td><td>${esc(m.displayName||m.id)}</td>
    <td class="text-right"><span class="status-badge ${m.id===cur?'ok':''}">${m.id===cur?'使用中':'可选'}</span></td>
  </tr>`).join('');
  tbody.querySelectorAll('input[name=model-select]').forEach(r=>r.addEventListener('change',()=>{if(r.checked&&p){p.model=r.value;refreshAllModel();}}));
}

function refreshTaskSelects() {
  const p=getActiveProvider(), models=p?.savedModels||[], def=p?.model||'', s=window._cachedSettings||{}, tm=s.taskModels||{};
  ['passive','chat','summary'].forEach(task=>{
    const sel=document.getElementById('m-task-'+task); if(!sel) return;
    sel.innerHTML=`<option value="">(默认: ${def||'未设置'})</option>`;
    models.forEach(m=>{ const o=document.createElement('option'); o.value=m.id; o.textContent=m.displayName||m.id; if(m.id===tm[task]) o.selected=true; sel.appendChild(o); });
  });
}
function checkTaskWarnings() {
  const p=getActiveProvider(), el=document.getElementById('m-warning'), tx=document.getElementById('m-warning-text');
  if((!p||!p.apiKey||!p.model)&&el&&tx){ el.style.display='block'; tx.textContent=(!p?'未添加厂商':!p.apiKey?'未配置 API Key':'未选择模型')+'，相关功能可能无法正常工作。'; }
  else if(el) el.style.display='none';
}

// ==================== Prompt 管理 ====================
function loadPromptsTab(s) {
  if (s.prompts) Object.entries(s.prompts).forEach(([id, content]) => {
    const t=PROMPT_TEMPLATES.find(t=>t.id===id); if(t) t._customContent=content;
  });
  renderPromptList();
  if(PROMPT_TEMPLATES.length) selectPrompt(PROMPT_TEMPLATES[0].id);
  document.getElementById('pr-search').addEventListener('input',()=>renderPromptList(document.getElementById('pr-search').value));
  const ed=document.getElementById('pr-editor');
  ed.addEventListener('input',()=>{updateLineNumbers();updateEditorMeta();});
  ed.addEventListener('scroll',()=>{document.getElementById('pr-line-numbers').scrollTop=ed.scrollTop;});
  document.getElementById('pr-restore').addEventListener('click',()=>{
    const t=PROMPT_TEMPLATES.find(t=>t.id===currentPromptId); if(!t) return;
    ed.value=t.content; delete t._customContent; updateLineNumbers(); updateEditorMeta(); renderPromptList();
  });
  document.getElementById('pr-view-default').addEventListener('click',()=>{
    const t=PROMPT_TEMPLATES.find(t=>t.id===currentPromptId); if(!t) return;
    if(ed.value!==t.content&&!confirm('当前有修改。查看默认会覆盖编辑器，确定？')) return;
    ed.value=t.content; updateLineNumbers(); updateEditorMeta();
  });
  document.getElementById('pr-reset-all').addEventListener('click',()=>{
    if(!confirm('确定重置所有 Prompt 为默认值？')) return;
    PROMPT_TEMPLATES.forEach(t=>delete t._customContent);
    if(currentPromptId){ const t=PROMPT_TEMPLATES.find(t=>t.id===currentPromptId); if(t) ed.value=t.content; }
    renderPromptList(); updateLineNumbers(); updateEditorMeta();
  });
}
function renderPromptList(filter='') {
  const list=document.getElementById('pr-list'), q=filter.toLowerCase();
  const filtered=PROMPT_TEMPLATES.filter(t=>!q||t.name.toLowerCase().includes(q)||t.filename.includes(q)||t.desc.includes(q));
  list.innerHTML=filtered.map(t=>`<div class="pr-item ${currentPromptId===t.id?'active':''}" data-id="${t.id}">
    <div class="pr-item-header"><span class="pr-item-name">${esc(t.name)}</span>
      ${t._customContent&&t._customContent!==t.content?'<span class="pr-item-badge modified">已修改</span>':'<span class="pr-item-badge">默认</span>'}</div>
    <div class="pr-item-filename">${esc(t.filename)}</div><div class="pr-item-desc">${esc(t.desc)}</div></div>`).join('');
  list.querySelectorAll('.pr-item').forEach(el=>el.addEventListener('click',()=>{
    if(el.dataset.id===currentPromptId) return;
    saveCurrentEdit(); selectPrompt(el.dataset.id);
  }));
}
function selectPrompt(id) {
  currentPromptId=id; const t=PROMPT_TEMPLATES.find(t=>t.id===id); if(!t) return;
  document.getElementById('pr-editor').value=t._customContent||t.content;
  document.getElementById('pr-editor-title').textContent=t.name;
  const badge=document.getElementById('pr-editor-badge'), isMod=t._customContent&&t._customContent!==t.content;
  badge.textContent=isMod?'已修改':'默认'; badge.className='editor-badge'+(isMod?' modified':'');
  document.getElementById('pr-editor-desc').textContent=t.desc;
  document.getElementById('pr-editor-vars').textContent='可用变量：'+t.vars;
  updateLineNumbers(); updateEditorMeta(); renderPromptList(document.getElementById('pr-search').value);
}
function saveCurrentEdit() {
  if(!currentPromptId) return; const t=PROMPT_TEMPLATES.find(t=>t.id===currentPromptId); if(!t) return;
  const val=document.getElementById('pr-editor').value;
  if(val!==t.content) t._customContent=val; else delete t._customContent;
}
function updateLineNumbers() {
  const ed=document.getElementById('pr-editor'), lines=document.getElementById('pr-line-numbers');
  lines.textContent=Array.from({length:(ed.value.match(/\n/g)||[]).length+1},(_,i)=>i+1).join('\n');
}
function updateEditorMeta() {
  const ed=document.getElementById('pr-editor'), bytes=new Blob([ed.value]).size, lns=(ed.value.match(/\n/g)||[]).length+1;
  document.getElementById('pr-editor-meta').textContent=`zh-CN · ${bytes>1024?(bytes/1024).toFixed(1)+' KB':bytes+' B'} · ${lns} 行`;
  document.getElementById('pr-editor-stats').textContent=`${lns} 行 · ${bytes>1024?(bytes/1024).toFixed(1)+' KB':bytes+' B'}`;
}

// ==================== 保存 ====================
document.getElementById('save-all').addEventListener('click', async () => {
  const btn=document.getElementById('save-all'); btn.disabled=true; btn.textContent='保存中...';
  saveCurrentEdit();
  try { await chrome.storage.local.set({ settings: await getCurrentSettings() }); showSaveStatus('✅ 已保存', 'ok');
    PROMPT_TEMPLATES.forEach(t=>{ if(t._customContent&&t._customContent===t.content) delete t._customContent; });
    renderPromptList(); updateEditorMeta();
    const b=document.getElementById('m-save-badge'); if(b){b.textContent='';b.className='save-badge';}
  } catch(e) { showSaveStatus('❌ '+e.message, 'error'); }
  btn.disabled=false; btn.textContent='💾 保存全部设置';
});

async function getCurrentSettings() {
  const s = window._cachedSettings || {};
  // 人格
  const h=[]; document.querySelectorAll('#p-habits input[type=checkbox]:checked').forEach(cb=>h.push(cb.value));
  s.persona={ name:getVal('p-name'),gender:getVal('p-gender'),occupation:getVal('p-occupation'),city:getVal('p-city'),
    mbti:getVal('p-mbti'),zodiac:getVal('p-zodiac'),age:getVal('p-age'),expressionStyle:getVal('p-expression'),
    tone:getVal('p-tone'),habits:h,genres:getVal('p-genres'),dislikes:getVal('p-dislikes'),habitsReading:getVal('p-habits-reading') };
  // 聊天
  s.chatSettings={ passiveFrequency:parseInt(document.getElementById('chat-temperature').value),
    passivePrompt:getVal('chat-passive-prompt'), activePrompt:getVal('chat-active-prompt') };
  s.autoRefreshDelay = parseInt(document.getElementById('chat-auto-refresh')?.value) || 5;
  s.proactiveDelay = parseInt(document.getElementById('chat-proactive-delay')?.value) ?? 8;
  s.temperature=s.chatSettings.passiveFrequency;
  // 模型参数
  s.maxTokensPassive=parseInt(getVal('m-max-tokens-passive'))||800;
  s.maxTokensChat=parseInt(getVal('m-max-tokens-chat'))||600;
  // 任务分配
  s.taskModels={ passive:getVal('m-task-passive'), chat:getVal('m-task-chat'), summary:getVal('m-task-summary') };
  // Prompt 自定义
  s.prompts={}; PROMPT_TEMPLATES.forEach(t=>{ if(t._customContent&&t._customContent!==t.content) s.prompts[t.id]=t._customContent; });
  return s;
}

// ==================== 工具 ====================
function getVal(id, def='') { return document.getElementById(id)?.value?.trim() || def; }
function setVal(id, val) { const el=document.getElementById(id); if(el) el.value=val??''; }
function setText(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }
function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function showSaveStatus(msg, type) { const el=document.getElementById('save-status'); el.textContent=msg; el.className=type||''; setTimeout(()=>{el.textContent='';},3000); }

// ==================== 读过的书 ====================
let _booksDetailBook = null;

function loadBooksTab(books) {
  const grid = document.getElementById('books-grid');
  const empty = document.getElementById('books-empty');
  const entries = Object.entries(books).filter(([,m]) => m.lastChapter > 0 || (m.chatHistory || []).length > 0);

  if (!entries.length) {
    if (grid) grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';
  if (!grid) return;

  // 按最近阅读时间排序
  entries.sort((a, b) => {
    const da = a[1].lastReadDate || a[1].firstReadDate || '';
    const db = b[1].lastReadDate || b[1].firstReadDate || '';
    return db.localeCompare(da);
  });

  grid.innerHTML = entries.map(([name, m]) => {
    const chapCount = m.lastChapter || 0;
    const chatCount = (m.chatHistory || []).length;
    const favCount = (m.favoritePassages || []).length;
    const author = m.author || '';
    const lastRead = m.lastReadDate
      ? new Date(m.lastReadDate).toLocaleDateString('zh-CN')
      : '';
    const preview = (m.recentNotes || []).slice(-2).map(n => n.fact).join(' · ') || '还没有笔记';

    return `<div class="book-card" data-book="${esc(name)}">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <input type="checkbox" class="book-merge-check" data-book="${esc(name)}" style="margin-top:3px;flex-shrink:0;display:none" title="选择以合并" />
        <div style="flex:1;min-width:0;position:relative">
          <button class="book-delete-btn" data-book="${esc(name)}" title="删除这本书的记录" style="position:absolute;right:0;top:0;width:22px;height:22px;border-radius:50%;border:1px solid #404249;background:transparent;color:#808080;cursor:pointer;font-size:12px;display:none;align-items:center;justify-content:center;z-index:1">×</button>
          <div class="bc-title">📖 ${esc(name)}</div>
          <div class="bc-meta">
            <span>📄 ${chapCount} 章</span>
            <span>💬 ${chatCount} 条消息</span>
            ${favCount > 0 ? `<span>⭐ ${favCount} 收藏</span>` : ''}
            ${author ? `<span>✍️ ${esc(author)}</span>` : ''}
            ${lastRead ? `<span>🕐 ${lastRead}</span>` : ''}
          </div>
          <div class="bc-preview">${esc(preview)}</div>
        </div>
      </div>
    </div>`;
  });

  // 长按/右键触发合并模式
  let mergeMode = false;
  // 删除按钮
  grid.querySelectorAll('.book-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const bookName = btn.dataset.book;
      if (!confirm(`确定删除「${bookName}」的所有记录吗？\n\n包括聊天记录、收藏段落、阅读笔记等。此操作不可撤销。`)) return;
      await chrome.runtime.sendMessage({ type: 'DELETE_BOOK', bookTitle: bookName });
      const data = await chrome.storage.local.get('books');
      loadBooksTab(data.books || {});
      loadMemoryOverview(data.books || {});
    });
  });

  grid.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleMergeMode();
    });
    card.addEventListener('click', (e) => {
      if (e.target.closest('.book-delete-btn')) return;  // 删除按钮不触发详情
      if (mergeMode) {
        e.preventDefault();
        const cb = card.querySelector('.book-merge-check');
        if (cb) { cb.checked = !cb.checked; updateMergeButton(); }
        return;
      }
      if (e.target.tagName === 'INPUT') return;
      const bookName = card.dataset.book;
      showBookDetail(bookName, books[bookName]);
    });
  });

  function toggleMergeMode() {
    mergeMode = !mergeMode;
    document.querySelectorAll('.book-merge-check').forEach(cb => {
      cb.style.display = mergeMode ? '' : 'none';
      if (!mergeMode) cb.checked = false;
    });
    updateMergeButton();
  }

  function updateMergeButton() {
    const btn = document.getElementById('books-merge-btn');
    const hint = document.getElementById('books-merge-hint');
    const checked = document.querySelectorAll('.book-merge-check:checked');
    if (btn) btn.style.display = mergeMode && checked.length >= 2 ? '' : 'none';
    if (hint) hint.style.display = mergeMode ? '' : 'none';
  }

  document.getElementById('books-merge-btn').addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('.book-merge-check:checked')].map(cb => cb.dataset.book);
    if (checked.length < 2) return;
    if (!confirm(`将 ${checked.slice(1).map(n => `"${n}"`).join('、')} 合并到 "${checked[0]}"？\n\n聊天记录和收藏段落会保留。`)) return;
    try {
      await chrome.runtime.sendMessage({ type: 'MERGE_BOOKS', sources: checked.slice(1), target: checked[0] });
      // 重新加载
      const data = await chrome.storage.local.get('books');
      loadBooksTab(data.books || {});
      loadMemoryOverview(data.books || {});
      toggleMergeMode(); // 退出合并模式
    } catch(e) { alert('合并失败: ' + e.message); }
  });

  // 绑定点击事件
  grid.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', () => {
      const bookName = card.dataset.book;
      showBookDetail(bookName, books[bookName]);
    });
  });
}

function showBookDetail(bookName, memory) {
  _booksDetailBook = bookName;
  document.getElementById('books-list-view').style.display = 'none';
  document.getElementById('book-detail-view').style.display = 'block';

  const m = memory || {};
  const chatHistory = m.chatHistory || [];
  const favoritePassages = m.favoritePassages || [];
  const notes = m.recentNotes || [];
  const summaries = m.chapterSummaries || {};
  const chars = m.knowledgeGraph?.characters || {};
  const threads = (m.knowledgeGraph?.plotThreads || []).filter(t => !t.resolved);
  const jokes = m.runningJokes || [];

  let html = `<div class="book-detail-header">
    <h3>📖 ${esc(bookName)}</h3>
    <div class="bdh-meta">
      <span>📄 读到第 ${m.lastChapter || '?'} 章</span>
      ${m.author ? `<span>✍️ ${esc(m.author)}</span>` : ''}
      ${m.firstReadDate ? `<span>📅 始于 ${new Date(m.firstReadDate).toLocaleDateString('zh-CN')}</span>` : ''}
      <span>💬 ${chatHistory.length} 条对话</span>
      <span>⭐ ${favoritePassages.length} 个收藏</span>
      <span>📝 ${notes.length} 条笔记</span>
    </div>
  </div>`;

  // 收藏的段落
  if (favoritePassages.length > 0) {
    html += `<div class="book-detail-section">
      <h4>⭐ 收藏的段落 (${favoritePassages.length})</h4>`;
    favoritePassages.slice().reverse().forEach(p => {
      html += `<div class="passage-card">
        <div class="pc-text">${esc(p.text)}</div>
        ${p.comment ? `<div class="pc-comment">💬 ${esc(p.comment)}</div>` : ''}
        <div class="pc-time">${p.timestamp ? new Date(p.timestamp).toLocaleString('zh-CN') : ''}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // 章节笔记
  if (notes.length > 0) {
    html += `<div class="book-detail-section">
      <h4>📝 阅读笔记</h4>`;
    notes.slice(-20).reverse().forEach(n => {
      html += `<div class="passage-card">
        <div class="pc-text">第${n.ch}章: ${esc(n.fact)}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // 角色
  if (Object.keys(chars).length > 0) {
    html += `<div class="book-detail-section">
      <h4>👥 角色</h4>`;
    Object.entries(chars).forEach(([name, info]) => {
      const status = typeof info === 'string' ? info : (info.status || '?');
      const imp = (info.importance || 1) >= 3 ? '主角' : (info.importance || 1) >= 2 ? '重要' : '';
      html += `<div class="passage-card">
        <strong>${esc(name)}</strong> ${imp ? `[${imp}]` : ''} · ${esc(status)}
        ${info.faction ? ` · 派系: ${esc(info.faction)}` : ''}
      </div>`;
    });
    html += `</div>`;
  }

  // 聊天记录
  if (chatHistory.length > 0) {
    html += `<div class="book-detail-section">
      <h4>💬 聊天记录 (${chatHistory.length} 条)</h4>`;
    chatHistory.slice(-50).reverse().forEach(msg => {
      const roleClass = msg.role === 'user' ? 'chi-user' : 'chi-ai';
      const roleLabel = msg.role === 'user' ? '你' : (memory.personaName || '书友');
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN') : '';
      let toolHtml = '';
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        toolHtml = '<div class="chi-tool">';
        msg.toolCalls.forEach(tc => {
          if (tc.name === 'quote_passage') toolHtml += `📌 引用: ${esc(tc.input.text?.slice(0, 60) || '')}...<br>`;
          if (tc.name === 'react_emoji') toolHtml += `表情: ${esc(tc.input.emoji || '')} `;
          if (tc.name === 'quote_history') toolHtml += `💬 引用记录<br>`;
        });
        toolHtml += '</div>';
      }
      html += `<div class="chat-history-item ${roleClass}">
        <strong>${roleLabel}</strong>${time ? ` <span class="chi-time">${time}</span>` : ''}
        <div>${esc(msg.content || '')}</div>
        ${toolHtml}
      </div>`;
    });
    html += `</div>`;
  }

  // 伏笔
  if (threads.length > 0) {
    html += `<div class="book-detail-section">
      <h4>🔮 未回收的伏笔</h4>`;
    threads.forEach(t => {
      html += `<div class="passage-card">[第${t.chapter}章] ${esc(t.thread)}</div>`;
    });
    html += `</div>`;
  }

  // 内部梗
  if (jokes.length > 0) {
    html += `<div class="book-detail-section">
      <h4>😄 你们的梗</h4>`;
    jokes.forEach(j => {
      html += `<div class="passage-card">${esc(j)}</div>`;
    });
    html += `</div>`;
  }

  document.getElementById('book-detail-content').innerHTML = html ||
    '<p class="empty-hint">这本书还没有详细信息</p>';
}

// 返回书单
document.getElementById('book-detail-back').addEventListener('click', () => {
  _booksDetailBook = null;
  document.getElementById('books-list-view').style.display = 'block';
  document.getElementById('book-detail-view').style.display = 'none';
});

chrome.storage.onChanged.addListener(changes => {
  if(changes.logs){ const el=document.getElementById('log-container'); if(el) loadLogs(changes.logs.newValue||[]); }
  if(changes.books){
    const el=document.getElementById('memory-overview'); if(el) loadMemoryOverview(changes.books.newValue||{});
    // 如果当前在书籍详情页且数据变了，刷新
    if (_booksDetailBook && changes.books.newValue) {
      showBookDetail(_booksDetailBook, changes.books.newValue[_booksDetailBook] || {});
    } else {
      loadBooksTab(changes.books.newValue || {});
    }
  }
});

loadAll();
