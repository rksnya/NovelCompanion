// ============================================================
// Novel Companion — 聊天面板 UI (Shadow DOM)
// QQ/Discord 风格：头像 + 引用回复 + 表情反应 + 「」原文
// ============================================================

const ChatUI = {
  _state: {
    expanded: false,
    temperature: 5,
    messages: [],           // { role, content, mood, id, toolCalls }
    personaName: '',
    _totalInput: 0,
    _totalOutput: 0,
    _msgIdCounter: 0,
  },

  // ---- 初始化 ----
  init(temperature = 5) {
    if (this._host) return;
    this._state.temperature = temperature;

    this._host = document.createElement('div');
    this._host.id = '__novel_companion_host';
    this._host.style.cssText = 'position:fixed;z-index:2147483646;right:0;top:0;bottom:0;pointer-events:none;';
    document.body.appendChild(this._host);

    this._shadow = this._host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = this._getStyles();
    this._shadow.appendChild(style);

    this._container = document.createElement('div');
    this._container.id = 'nc-container';
    this._container.innerHTML = this._getHTML();
    this._shadow.appendChild(this._container);

    this._bindEvents();
    this._setCollapsed(true);
  },

  _getStyles() {
    return `
      *{margin:0;padding:0;box-sizing:border-box}
      :host{all:initial}

      #nc-container{
        font-family:"PingFang SC","Noto Sans SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        font-size:14px;line-height:1.5;color:#dcddde;pointer-events:auto;
      }

      /* ====== 右下角按钮 ====== */
      #nc-bubble{
        position:fixed;right:20px;bottom:20px;
        width:56px;height:56px;border-radius:50%;
        background:#2b2d31;border:2px solid #404249;
        display:flex;align-items:center;justify-content:center;
        cursor:pointer;transition:transform .2s,box-shadow .2s,border-color .2s,opacity .3s;
        box-shadow:0 4px 20px rgba(0,0,0,.5);user-select:none;z-index:1;
      }
      #nc-bubble:hover{
        transform:scale(1.1);box-shadow:0 8px 28px rgba(0,0,0,.7);
        border-color:#5865f2;
      }
      #nc-bubble svg{width:28px;height:28px;fill:none;stroke:#b5bac1;stroke-width:2;transition:stroke .2s}
      #nc-bubble:hover svg{stroke:#fff}
      #nc-bubble-label{
        position:fixed;right:84px;bottom:34px;
        background:#1e1f22;border:1px solid #404249;border-radius:6px;
        padding:6px 12px;font-size:12px;color:#949ba4;
        white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .3s;z-index:1;
      }
      #nc-bubble:hover+#nc-bubble-label,#nc-bubble-label:hover{opacity:1}

      /* ====== 侧边栏面板 ====== */
      #nc-panel{
        position:fixed;right:0;top:0;bottom:0;width:480px;
        background:#313338;border-left:1px solid #1e1f22;
        display:flex;flex-direction:column;
        transform:translateX(100%);
        transition:transform .35s cubic-bezier(.34,1.56,.64,1);
        box-shadow:-4px 0 24px rgba(0,0,0,.6);z-index:2;
      }
      #nc-panel.expanded{transform:translateX(0)}
      #nc-resize-handle{
        position:absolute;left:0;top:0;bottom:0;width:5px;
        cursor:col-resize;z-index:10;transition:background .2s;
      }
      #nc-resize-handle:hover,#nc-resize-handle.active{background:#5865f2}

      /* ====== 面板头部 ====== */
      #nc-header{
        padding:12px 16px;border-bottom:1px solid #1e1f22;
        flex-shrink:0;background:#2b2d31;
      }
      #nc-header-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
      #nc-book-name{
        font-size:15px;font-weight:600;color:#f2f3f5;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;
      }
      #nc-chapter-label{
        font-size:11px;color:#949ba4;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;
      }
      #nc-close-btn{
        width:32px;height:32px;border-radius:50%;
        border:1px solid #404249;background:transparent;color:#b5bac1;
        cursor:pointer;display:flex;align-items:center;justify-content:center;
        transition:background .2s,color .2s;flex-shrink:0;
      }
      #nc-close-btn:hover{background:#404249;color:#f2f3f5}
      #nc-close-btn svg{width:16px;height:16px}

      /* 温度 */
      #nc-temp-row{display:flex;align-items:center;gap:8px}
      #nc-temp-label{font-size:11px;color:#949ba4;white-space:nowrap}
      #nc-temp-slider{
        flex:1;-webkit-appearance:none;appearance:none;
        height:4px;border-radius:2px;
        background:linear-gradient(to right,#4a90d9,#5865f2,#f5a623,#e67e22,#e74c3c);
        outline:none;cursor:pointer;
      }
      #nc-temp-slider::-webkit-slider-thumb{
        -webkit-appearance:none;width:18px;height:18px;border-radius:50%;
        background:#f2f3f5;border:2px solid #5865f2;
        cursor:pointer;box-shadow:0 0 6px rgba(88,101,242,.4);
        transition:transform .15s;
      }
      #nc-temp-slider::-webkit-slider-thumb:hover{transform:scale(1.15)}
      #nc-temp-val{font-size:11px;color:#b5bac1;min-width:20px;text-align:center}

      /* ====== 消息区 ====== */
      #nc-messages{
        flex:1;overflow-y:auto;padding:12px 0;
        display:flex;flex-direction:column;
      }
      #nc-messages::-webkit-scrollbar{width:6px}
      #nc-messages::-webkit-scrollbar-track{background:transparent}
      #nc-messages::-webkit-scrollbar-thumb{background:#1e1f22;border-radius:3px}

      #nc-empty-state{
        text-align:center;color:#4e5058;margin-top:100px;
        padding:0 40px;
      }
      #nc-empty-state .nc-empty-icon{margin-bottom:12px;color:#404249}
      #nc-empty-state .nc-empty-title{font-size:15px;color:#949ba4;margin-bottom:6px}
      #nc-empty-state .nc-empty-desc{font-size:13px;line-height:1.7;color:#4e5058}

      /* ====== 消息行（气泡风格 + 头像） ====== */
      .nc-msg-row{
        display:flex;padding:5px 14px;gap:8px;
        position:relative;
        animation:nc-fade-in .2s ease;
      }
      @keyframes nc-fade-in{
        from{opacity:0;transform:translateY(6px)}
        to{opacity:1;transform:translateY(0)}
      }
      .nc-msg-row.ai-row{justify-content:flex-start}
      .nc-msg-row.user-row{justify-content:flex-end}

      .nc-msg-row.nc-msg-consecutive{padding-top:1px}
      .nc-msg-row.nc-msg-consecutive .nc-msg-avatar{visibility:hidden}
      .nc-msg-row.nc-msg-consecutive .nc-msg-header{display:none}

      .nc-msg-avatar{
        width:34px;height:34px;border-radius:50%;
        flex-shrink:0;align-self:flex-start;
        display:flex;align-items:center;justify-content:center;
        font-size:14px;font-weight:600;color:#fff;
        margin-top:2px;
      }
      .nc-msg-avatar.ai{background:#5865f2}
      .nc-msg-avatar.user{background:#248046}

      .nc-msg-bubble-wrap{
        max-width:78%;display:flex;flex-direction:column;
      }
      .nc-msg-row.ai-row .nc-msg-bubble-wrap{align-items:flex-start}
      .nc-msg-row.user-row .nc-msg-bubble-wrap{align-items:flex-end}

      .nc-msg-header{
        display:flex;align-items:baseline;gap:6px;margin-bottom:2px;padding:0 4px;
      }
      .nc-msg-username{font-size:12px;font-weight:600;color:#b5bac1}
      .nc-msg-time{
        font-size:10px;color:#4e5058;opacity:0;transition:opacity .2s;
      }
      .nc-msg-row:hover .nc-msg-time{opacity:1}

      /* ====== 气泡本体 ====== */
      .nc-msg-bubble{
        padding:8px 12px;border-radius:14px;
        font-size:14px;line-height:1.55;
        word-break:break-word;
        position:relative;
      }
      .nc-msg-bubble.ai-bubble{
        background:#2b2d31;
        border-bottom-left-radius:6px;
        color:#dbdee1;
      }
      .nc-msg-bubble.user-bubble{
        background:#3a5090;
        border-bottom-right-radius:6px;
        color:#e0e0e0;
      }

      .nc-msg-bubble p{margin:0 0 4px}
      .nc-msg-bubble p:last-child{margin-bottom:0}
      .nc-msg-bubble code{
        background:rgba(0,0,0,.25);padding:1px 5px;border-radius:3px;
        font-size:.9em;font-family:monospace;
      }
      .nc-msg-bubble pre{
        background:rgba(0,0,0,.25);padding:8px 10px;border-radius:4px;
        overflow-x:auto;margin:4px 0;
      }
      .nc-msg-bubble pre code{background:none;padding:0}
      .nc-msg-bubble blockquote{
        border-left:3px solid rgba(255,255,255,.15);padding-left:8px;margin:4px 0;color:#949ba4;
      }
      .nc-msg-bubble strong{color:#f2f3f5}
      .nc-msg-bubble em{color:inherit}
      .nc-msg-bubble del{opacity:.5}

      /* ====== 工具调用标签（pill badge 风格） ====== */
      .nc-tool-pill{
        display:inline-flex;align-items:center;gap:4px;
        padding:1px 8px;border-radius:10px;
        font-size:11px;font-weight:500;
        background:rgba(128,128,160,.12);color:#949ba4;
        border:1px solid rgba(128,128,160,.15);
        margin:2px 0;white-space:nowrap;
        user-select:none;transition:background .15s;
      }
      .nc-tool-pill svg{width:12px;height:12px;flex-shrink:0;opacity:.7}
      .nc-tool-pill.quote-passage{background:rgba(240,178,50,.1);color:#c0a060;border-color:rgba(240,178,50,.2)}
      .nc-tool-pill.quote-history{background:rgba(88,101,242,.1);color:#8890d0;border-color:rgba(88,101,242,.2)}
      .nc-tool-pill.react-emoji{background:rgba(236,72,153,.1);color:#d080a0;border-color:rgba(236,72,153,.2)}
      .nc-tool-pill.check-page{background:rgba(34,197,94,.1);color:#60b080;border-color:rgba(34,197,94,.2)}
      .nc-tool-pill:hover{filter:brightness(1.2)}

      /* ====== QQ/Discord 引用原文：「」样式 ====== */
      .nc-quote-passage{
        display:block;margin:6px 0;padding:4px 8px;
        border-left:3px solid #f0b232;border-radius:0 4px 4px 0;
        background:rgba(240,178,50,.05);
        font-size:13.5px;line-height:1.6;color:#a09870;
      }
      .nc-quote-passage .qp-bracket{color:#7a7258;opacity:.7}
      .nc-quote-passage .qp-text{font-style:italic}
      .nc-quote-passage .qp-comment{
        display:block;margin-top:4px;font-style:normal;color:#b5bac1;font-size:13px;
      }
      .nc-quote-passage .qp-fav{
        display:inline-block;margin-left:6px;font-size:12px;color:#4e5058;
        cursor:pointer;transition:color .2s;font-style:normal;vertical-align:middle;
      }
      .nc-quote-passage .qp-fav:hover{color:#f0b232}
      .nc-quote-passage .qp-fav.favorited{color:#f0b232}

      /* ====== 引用回复（Discord reply 风格） ====== */
      .nc-reply-preview{
        display:flex;align-items:center;gap:6px;
        margin-bottom:4px;padding:2px 0;
        font-size:12.5px;color:#949ba4;
        cursor:pointer;max-width:fit-content;
        transition:color .15s;
      }
      .nc-reply-preview:hover{color:#dbdee1}
      .nc-reply-preview .rp-line{
        width:2px;height:14px;border-radius:1px;
        background:#5865f2;flex-shrink:0;
      }
      .nc-reply-preview .rp-avatar{
        width:15px;height:15px;border-radius:50%;flex-shrink:0;
        display:flex;align-items:center;justify-content:center;
        font-size:7px;color:#fff;font-weight:600;
      }
      .nc-reply-preview .rp-avatar.ai{background:#5865f2}
      .nc-reply-preview .rp-avatar.user{background:#248046}
      .nc-reply-preview .rp-name{font-weight:600;flex-shrink:0}
      .nc-reply-preview .rp-text{
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#6d6f78;
      }

      /* 跳转高亮 */
      .nc-msg-row.jump-highlight{
        animation:nc-jump-flash .8s ease;
      }
      @keyframes nc-jump-flash{
        0%,100%{background:transparent}
        30%{background:rgba(88,101,242,.15)}
      }

      /* ====== Emoji 反应（Discord 风格） ====== */
      .nc-reactions{
        display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;
      }
      .nc-reaction-chip{
        display:inline-flex;align-items:center;gap:3px;
        padding:1px 8px;border-radius:10px;
        background:rgba(88,101,242,.12);border:1px solid rgba(88,101,242,.2);
        font-size:15px;line-height:1.4;
        cursor:default;transition:background .15s,border-color .15s;
        user-select:none;
      }
      .nc-reaction-chip:hover{
        background:rgba(88,101,242,.25);border-color:rgba(88,101,242,.4);
      }
      .nc-reaction-chip .rc-count{font-size:11px;color:#b5bac1;margin-left:1px}

      .nc-msg-content .nc-inline-emoji{font-size:1.2em;vertical-align:middle}

      /* ====== 输入区 ====== */
      #nc-input-area{
        padding:10px 16px;border-top:1px solid #1e1f22;
        display:flex;gap:8px;flex-shrink:0;background:#2b2d31;
      }
      #nc-input{
        flex:1;padding:10px 14px;border-radius:8px;
        border:none;background:#383a40;color:#dbdee1;
        font-size:14px;outline:none;resize:none;
      }
      #nc-input::placeholder{color:#6d6f78}
      #nc-input:focus{background:#313338}

      #nc-send-btn{
        width:40px;height:40px;border-radius:50%;border:none;
        background:#5865f2;color:#fff;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        transition:background .2s,transform .15s;flex-shrink:0;
      }
      #nc-send-btn:hover{background:#4752c4;transform:scale(1.05)}
      #nc-send-btn:disabled{background:#383a40;color:#4e5058;cursor:default;transform:none}
      #nc-send-btn svg{width:18px;height:18px}

      /* ====== 打字指示器 ====== */
      .nc-typing-row{
        display:flex;padding:6px 16px;gap:10px;align-items:center;
      }
      .nc-typing-dots{
        display:flex;align-items:center;gap:3px;padding:8px 12px;
        background:#2b2d31;border-radius:8px;
      }
      .nc-typing-dot{
        width:7px;height:7px;border-radius:50%;background:#4e5058;
        animation:nc-bounce 1.4s ease-in-out infinite;
      }
      .nc-typing-dot:nth-child(2){animation-delay:.2s}
      .nc-typing-dot:nth-child(3){animation-delay:.4s}
      @keyframes nc-bounce{
        0%,60%,100%{transform:translateY(0);opacity:.4}
        30%{transform:translateY(-5px);opacity:1}
      }

      /* ====== 状态栏 ====== */
      #nc-status-bar{
        padding:4px 16px;border-top:1px solid #1e1f22;
        display:flex;align-items:center;justify-content:space-between;
        font-size:11px;color:#4e5058;flex-shrink:0;min-height:24px;
        background:#2b2d31;
      }
      #nc-status-bar .status-text{display:flex;align-items:center;gap:4px}
      #nc-status-bar .status-dot{
        width:5px;height:5px;border-radius:50%;background:#4e5058;flex-shrink:0;
      }
      #nc-status-bar .status-dot.thinking{background:#f0b232}
      #nc-status-bar .status-dot.reading{background:#23a55a}

      /* ====== 响应式 ====== */
      @media(max-width:600px){
        #nc-panel{width:100vw!important}
        #nc-bubble{width:52px;height:52px;right:12px;bottom:12px}
      }
      @media(min-width:1200px){
        #nc-panel{width:420px}
      }
    `;
  },

  _getHTML() {
    return `
      <div id="nc-bubble" title="与书友聊天">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/></svg>
      </div>
      <div id="nc-bubble-label">📖 和书友聊聊</div>

      <div id="nc-panel">
        <div id="nc-resize-handle"></div>
        <div id="nc-header">
          <div id="nc-header-top">
            <div>
              <div id="nc-book-name">AI 书友</div>
              <div id="nc-chapter-label"></div>
            </div>
            <button id="nc-close-btn" title="关闭">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div id="nc-temp-row">
            <span id="nc-temp-label">话多</span>
            <input type="range" id="nc-temp-slider" min="0" max="10" value="5"/>
            <span id="nc-temp-val">5</span>
          </div>
        </div>

        <div id="nc-messages">
          <div id="nc-empty-state">
            <div class="nc-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".4">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
                <line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </div>
            <div class="nc-empty-title">打开书，我在旁边呢</div>
            <div class="nc-empty-desc">看到想聊的就叫我一声</div>
          </div>
        </div>

        <div id="nc-input-area">
          <input type="text" id="nc-input" placeholder="输入消息..."/>
          <button id="nc-send-btn" title="发送">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          </button>
        </div>
        <div id="nc-status-bar">
          <span class="status-text"><span class="status-dot reading" id="nc-status-dot"></span><span id="nc-status-label">就绪</span></span>
          <span id="nc-token-count"></span>
        </div>
      </div>
    `;
  },

  _bindEvents() {
    const bubble = this._shadow.getElementById('nc-bubble');
    const closeBtn = this._shadow.getElementById('nc-close-btn');
    const sendBtn = this._shadow.getElementById('nc-send-btn');
    const input = this._shadow.getElementById('nc-input');
    const slider = this._shadow.getElementById('nc-temp-slider');

    bubble.addEventListener('click', () => this._onBubbleClick?.());

    closeBtn.addEventListener('click', () => this._setExpanded(false));

    sendBtn.addEventListener('click', () => this._handleSend());

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._handleSend(); }
    });

    slider.addEventListener('input', () => {
      const val = parseInt(slider.value);
      this._state.temperature = val;
      this._shadow.getElementById('nc-temp-val').textContent = val;
      this._onTemperatureChange?.(val);
    });

    this._bindResizeHandle();
  },

  _bindResizeHandle() {
    const handle = this._shadow.getElementById('nc-resize-handle');
    const panel = this._shadow.getElementById('nc-panel');
    let dragging = false, startX = 0, startWidth = 0;

    const onMouseMove = (e) => {
      if (!dragging) return;
      panel.style.width = Math.min(800, Math.max(320, startWidth + (startX - e.clientX))) + 'px';
      panel.style.transition = 'none';
    };
    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      panel.style.transition = 'transform .35s cubic-bezier(.34,1.56,.64,1)';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    handle.addEventListener('mousedown', (e) => {
      dragging = true; startX = e.clientX; startWidth = panel.offsetWidth;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });
  },

  /* ============ 面板状态 ============ */
  _setExpanded(expanded) {
    this._state.expanded = expanded;
    const panel = this._shadow.getElementById('nc-panel');
    const bubble = this._shadow.getElementById('nc-bubble');
    const label = this._shadow.getElementById('nc-bubble-label');

    if (expanded) {
      panel.classList.add('expanded');
      bubble.style.opacity = '0'; bubble.style.pointerEvents = 'none';
      if (label) label.style.display = 'none';
      this._flushProactive();  // 打开面板时显示 AI 主动说的话
      setTimeout(() => this._shadow.getElementById('nc-input')?.focus(), 350);
    } else {
      panel.classList.remove('expanded');
      bubble.style.opacity = '1'; bubble.style.pointerEvents = 'auto';
      if (label) label.style.display = '';
    }
  },
  _setCollapsed(c) { this._setExpanded(!c); },

  /* ============ 消息渲染（Discord 风格） ============ */
  _nextMsgId() { return 'msg_' + (++this._state._msgIdCounter); },

  addMessage(role, content, mood, opts = {}) {
    const msgId = this._nextMsgId();
    const lastMsg = this._state.messages[this._state.messages.length - 1];
    const isConsecutive = !opts.noMerge && lastMsg && lastMsg.role === role
      && (Date.now() - (lastMsg._time || 0) < 300000);

    const msgObj = { id: msgId, role, content, mood, _time: Date.now() };
    this._state.messages.push(msgObj);
    if (this._state.messages.length > 100) this._state.messages = this._state.messages.slice(-50);

    const empty = this._shadow.getElementById('nc-empty-state');
    if (empty) empty.style.display = 'none';

    const container = this._shadow.getElementById('nc-messages');
    const personaName = this._state.personaName || '书友';
    const isAI = role === 'ai' || role === 'assistant';
    const rowClass = isAI ? 'ai-row' : 'user-row';
    const bubbleClass = isAI ? 'ai-bubble' : 'user-bubble';
    const avatarLetter = isAI ? personaName.charAt(0) : '你';
    const avatarBg = isAI ? 'ai' : 'user';
    const username = isAI ? personaName : '你';
    const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    const row = document.createElement('div');
    row.className = 'nc-msg-row ' + rowClass + (isConsecutive ? ' nc-msg-consecutive' : '');
    row.dataset.msgId = msgId;

    // 头像
    const avatar = document.createElement('div');
    avatar.className = 'nc-msg-avatar ' + avatarBg;
    avatar.textContent = avatarLetter;

    // 气泡包裹
    const wrap = document.createElement('div');
    wrap.className = 'nc-msg-bubble-wrap';

    // 头部（用户名 + 时间）
    const header = document.createElement('div');
    header.className = 'nc-msg-header';
    header.innerHTML = `<span class="nc-msg-username">${username}</span><span class="nc-msg-time">${timeStr}</span>`;

    // 气泡
    const bubble = document.createElement('div');
    bubble.className = 'nc-msg-bubble ' + bubbleClass;
    bubble.innerHTML = isAI ? this._renderMarkdown(content) : this._escapeHTML(content);

    // 反应容器
    const reactions = document.createElement('div');
    reactions.className = 'nc-reactions';

    wrap.appendChild(header);
    wrap.appendChild(bubble);
    wrap.appendChild(reactions);

    // AI: 头像在左；用户: 头像在右
    if (isAI) {
      row.appendChild(avatar);
      row.appendChild(wrap);
    } else {
      row.appendChild(wrap);
      row.appendChild(avatar);
    }

    container.appendChild(row);
    if (!opts.silent) container.scrollTop = container.scrollHeight;

    return msgId;
  },

  /* ============ 引用原文：「」样式 ============ */
  _makePill(icon, label, cls) {
    return `<span class="nc-tool-pill ${cls}">${icon} ${label}</span> `;
  },

  addQuotedPassage(text, comment) {
    const container = this._shadow.getElementById('nc-messages');
    const lastAIBubble = container.querySelector('.nc-msg-row.ai-row:last-of-type .nc-msg-bubble.ai-bubble');
    if (!lastAIBubble) return;

    const passageId = 'qp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const quoteEl = document.createElement('div');
    quoteEl.className = 'nc-quote-passage';
    quoteEl.dataset.passageId = passageId;
    quoteEl.innerHTML = `
      <div style="margin-bottom:4px">${this._makePill('📌', '引用原文', 'quote-passage')}</div>
      <span class="qp-bracket">「</span><span class="qp-text">${this._escapeHTML(text)}</span><span class="qp-bracket">」</span>
      ${comment ? `<span class="qp-comment">${this._renderMarkdown(comment)}</span>` : ''}
      <span class="qp-fav" data-passage-id="${passageId}" data-text="${this._escapeHTML(text)}" data-comment="${this._escapeHTML(comment || '')}" title="收藏">☆</span>
    `;

    lastAIBubble.appendChild(quoteEl);
    container.scrollTop = container.scrollHeight;

    const favBtn = quoteEl.querySelector('.qp-fav');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const favorited = !favBtn.classList.contains('favorited');
      favBtn.classList.toggle('favorited');
      favBtn.textContent = favorited ? '★' : '☆';
      this._onFavoritePassage?.({
        text, comment,
        favorited,
        timestamp: new Date().toISOString(),
      });
    });
  },

  /* ============ 引用聊天记录（Discord reply 风格） ============ */
  addQuotedHistory(text, who) {
    const container = this._shadow.getElementById('nc-messages');
    // 找到聊天记录中匹配的消息
    const targetMsg = [...this._state.messages].reverse().find(m =>
      m.role === (who === 'user' ? 'user' : 'assistant') && m.content.includes(text.slice(0, 30))
    );
    const targetId = targetMsg?.id;

    // 在最后一条 AI 消息的气泡包裹中，插入 reply preview 到气泡前面
    const lastAIWrap = container.querySelector('.nc-msg-row.ai-row:last-of-type .nc-msg-bubble-wrap');
    if (!lastAIWrap) return;

    const personaName = this._state.personaName || '书友';
    const whoName = who === 'user' ? '你' : personaName;
    const whoAvatarClass = who === 'user' ? 'user' : 'ai';
    const whoLetter = who === 'user' ? '你' : personaName.charAt(0);

    const replyEl = document.createElement('div');
    replyEl.className = 'nc-reply-preview';
    replyEl.innerHTML = `
      ${this._makePill('💬', '引用聊天', 'quote-history')}
      <div style="display:flex;align-items:center;gap:6px">
        <div class="rp-line"></div>
        <div class="rp-avatar ${whoAvatarClass}">${whoLetter}</div>
        <span class="rp-name">${whoName}</span>
        <span class="rp-text">${this._escapeHTML(text.slice(0, 60))}</span>
      </div>
    `;

    if (targetId) {
      replyEl.dataset.jumpTo = targetId;
      replyEl.title = '点击跳转到原消息';
      replyEl.addEventListener('click', () => this._jumpToMessage(targetId));
    }

    // 插入到气泡（header 之后、bubble 之前）
    const header = lastAIWrap.querySelector('.nc-msg-header');
    if (header && header.nextSibling) {
      lastAIWrap.insertBefore(replyEl, header.nextSibling);
    } else {
      lastAIWrap.insertBefore(replyEl, lastAIWrap.firstChild);
    }

    container.scrollTop = container.scrollHeight;
  },

  _jumpToMessage(msgId) {
    const row = this._shadow.querySelector(`[data-msg-id="${msgId}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('jump-highlight');
    void row.offsetWidth; // reflow
    row.classList.add('jump-highlight');
    setTimeout(() => row.classList.remove('jump-highlight'), 800);
  },

  /* ============ AI 主动说话 ============ */
  showProactiveComment(reply, toolCalls) {
    // 保存待显示的评论
    this._state._pendingProactive = { reply, toolCalls, time: Date.now() };

    // 气泡红点
    const bubble = this._shadow.getElementById('nc-bubble');
    if (bubble) {
      bubble.style.borderColor = '#f0b232';
      bubble.style.boxShadow = '0 4px 20px rgba(240,178,50,.3)';
    }
  },

  _flushProactive() {
    const pending = this._state._pendingProactive;
    if (!pending) return;

    this._state._pendingProactive = null;

    // 清除红点
    const bubble = this._shadow.getElementById('nc-bubble');
    if (bubble) {
      bubble.style.borderColor = '#404249';
      bubble.style.boxShadow = '0 4px 20px rgba(0,0,0,.5)';
    }

    // 渲染评论
    if (pending.reply) {
      this.addMessage('ai', pending.reply);
    }
    if (pending.toolCalls) {
      for (const tc of pending.toolCalls) {
        switch (tc.name) {
          case 'quote_passage':
            this.addQuotedPassage(tc.input.text, tc.input.comment);
            break;
          case 'react_emoji':
            this.addEmojiReaction(tc.input.emoji);
            break;
        }
      }
    }
  },

  /* ============ 系统提示 ============ */
  addSystemNote(text, toolType) {
    const container = this._shadow.getElementById('nc-messages');
    const el = document.createElement('div');
    el.style.cssText = 'text-align:center;padding:4px 0;';
    if (toolType) {
      el.innerHTML = this._makePill('👁', text, 'check-page');
    } else {
      el.style.cssText += 'font-size:11px;color:#4e5058;';
      el.textContent = text;
    }
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  /* ============ Emoji 反应（Discord 风格） ============ */
  addEmojiReaction(emoji) {
    const container = this._shadow.getElementById('nc-messages');
    const rows = container.querySelectorAll('.nc-msg-row');
    const lastUserRow = [...rows].reverse().find(r => r.querySelector('.nc-msg-avatar.user'));
    if (!lastUserRow) return;

    const reactionsEl = lastUserRow.querySelector('.nc-reactions');
    if (!reactionsEl) return;

    // 确保有 pill 标签
    if (!reactionsEl.querySelector('.nc-tool-pill.react-emoji')) {
      const pill = document.createElement('span');
      pill.className = 'nc-tool-pill react-emoji';
      pill.innerHTML = '😊 表情反应';
      reactionsEl.appendChild(pill);
    }

    const existing = reactionsEl.querySelector(`.nc-reaction-chip[data-emoji="${emoji}"]`);
    if (existing) {
      const countEl = existing.querySelector('.rc-count');
      countEl.textContent = String(parseInt(countEl?.textContent || '1') + 1);
    } else {
      const chip = document.createElement('span');
      chip.className = 'nc-reaction-chip';
      chip.dataset.emoji = emoji;
      chip.innerHTML = `${emoji}<span class="rc-count">1</span>`;
      reactionsEl.appendChild(chip);
    }

    container.scrollTop = container.scrollHeight;
  },

  /* ============ 加载/状态 ============ */
  setLoading(loading) {
    const btn = this._shadow.getElementById('nc-send-btn');
    const input = this._shadow.getElementById('nc-input');
    const sendSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

    if (loading) {
      btn.disabled = true; btn.innerHTML = '…'; input.disabled = true;
      this._removeTypingIndicator();
      const container = this._shadow.getElementById('nc-messages');
      const row = document.createElement('div');
      row.className = 'nc-typing-row'; row.id = 'nc-typing-indicator';
      row.innerHTML = `
        <div class="nc-msg-avatar ai">${(this._state.personaName || '书友').charAt(0)}</div>
        <div class="nc-typing-dots">
          <span class="nc-typing-dot"></span><span class="nc-typing-dot"></span><span class="nc-typing-dot"></span>
        </div>
      `;
      container.appendChild(row);
      container.scrollTop = container.scrollHeight;
      this.setStatus('thinking', '正在输入...');
    } else {
      btn.disabled = false; btn.innerHTML = sendSVG; input.disabled = false; input.focus();
      this._removeTypingIndicator();
      this.setStatus('reading', '就绪');
    }
  },

  _removeTypingIndicator() {
    const el = this._shadow.getElementById('nc-typing-indicator');
    if (el) el.remove();
  },

  setStatus(mode, label) {
    const dot = this._shadow.getElementById('nc-status-dot');
    const labelEl = this._shadow.getElementById('nc-status-label');
    if (dot) dot.className = 'status-dot ' + (mode || 'reading');
    if (labelEl && label) labelEl.textContent = label;
  },

  addTokenUsage(i, o) {
    this._state._totalInput = (this._state._totalInput || 0) + (i || 0);
    this._state._totalOutput = (this._state._totalOutput || 0) + (o || 0);
    const el = this._shadow.getElementById('nc-token-count');
    if (el && (this._state._totalInput + this._state._totalOutput) > 0) {
      el.textContent = `${this._state._totalInput} / ${this._state._totalOutput} tk`;
    }
  },

  setBookInfo(book, ch) {
    this._shadow.getElementById('nc-book-name').textContent = book || 'AI 书友';
    this._shadow.getElementById('nc-chapter-label').textContent = ch || '';
  },

  setTemperature(val) {
    this._state.temperature = val;
    const s = this._shadow.getElementById('nc-temp-slider');
    const v = this._shadow.getElementById('nc-temp-val');
    if (s) s.value = val;
    if (v) v.textContent = val;
  },

  setPersonaName(name) {
    this._state.personaName = name || '书友';
    const b = this._shadow.getElementById('nc-bubble');
    if (b) b.title = `与 ${this._state.personaName} 聊天`;
  },

  /* ============ 发送 ============ */
  _handleSend() {
    const input = this._shadow.getElementById('nc-input');
    const text = input.value.trim();
    if (!text) return;
    this.addMessage('user', text);
    input.value = '';
    this.setLoading(true);
    this._onSendMessage?.(text);
  },

  /* ============ 回调 ============ */
  onBubbleClick(cb) { this._onBubbleClick = cb; },
  onSendMessage(cb) { this._onSendMessage = cb; },
  onTemperatureChange(cb) { this._onTemperatureChange = cb; },
  onFavoritePassage(cb) { this._onFavoritePassage = cb; },

  /* ============ Markdown ============ */
  _renderMarkdown(text) {
    let html = this._escapeHTML(text);
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^[-*] (.*)$/gm, '%%UL%%<li>$1</li>');
    html = html.replace(/^\d+\. (.*)$/gm, '%%OL%%<li>$1</li>');
    html = html.replace(/(?:%%UL%%<li>.*<\/li>\n?)+/g, m => '<ul>'+m.replace(/%%UL%%/g,'')+'</ul>');
    html = html.replace(/(?:%%OL%%<li>.*<\/li>\n?)+/g, m => '<ol>'+m.replace(/%%OL%%/g,'')+'</ol>');
    html = html.replace(/%%UL%%/g, ''); html = html.replace(/%%OL%%/g, '');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '').replace(/<p>\s*<br>\s*<\/p>/g, '');
    return html;
  },

  _escapeHTML(str) {
    const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
  },
};

window.__NovelChatUI = ChatUI;
