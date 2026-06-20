// ============================================================
// Novel Companion — 正文提取模块
// 纯启发式，遍历 DOM 树找文本块，不认标签
// ============================================================

const Extractor = {

  // ---- 判断页面是否为"文字型"页面 ----
  isTextHeavyPage() {
    const blocks = this._findAllTextBlocks();
    return blocks.length >= 8;
  },

  // ---- 获取当前屏幕上的可见文本 ----
  getVisibleParagraphs(options = {}) {
    const {
      contextBefore = 3,
      contextAfter = 5,
      minTextLen = 15,
      maxTotalLen = 1200,
    } = options;

    const blocks = this._findAllTextBlocks();
    if (blocks.length === 0) return '';

    const viewportTop = window.scrollY;
    const viewportBottom = viewportTop + window.innerHeight;
    const viewportCenter = viewportTop + window.innerHeight / 2;

    // 只保留视口内或附近的块
    const nearby = blocks.filter(b => {
      const centerY = b.absY + b.height / 2;
      return Math.abs(centerY - viewportCenter) < window.innerHeight * 1.5;
    });

    if (nearby.length === 0) {
      // 回退：取所有块中离屏幕中央最近的几个
      blocks.sort((a, b) => {
        const da = Math.abs(a.absY + a.height / 2 - viewportCenter);
        const db = Math.abs(b.absY + b.height / 2 - viewportCenter);
        return da - db;
      });
      const closest = blocks.slice(0, contextBefore + contextAfter);
      return this._assembleText(closest, maxTotalLen);
    }

    // 找到离屏幕中央最近的块
    let closest = nearby[0];
    let closestDist = Infinity;
    for (const b of nearby) {
      const dist = Math.abs(b.absY + b.height / 2 - viewportCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closest = b;
      }
    }

    const idx = blocks.indexOf(closest);
    const start = Math.max(0, idx - contextBefore);
    const end = Math.min(blocks.length, idx + contextAfter + 1);
    const context = blocks.slice(start, end);

    return this._assembleText(context, maxTotalLen);
  },

  // ---- 核心：通用文本块发现 ----
  // 不依赖特定标签，遍历 DOM 找任何"包含显著文字"的块级元素
  _findAllTextBlocks() {
    const blocks = [];
    const seen = new Set();

    // 策略：用 TreeWalker 遍历所有元素节点
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          // 跳过明显不是正文的容器
          const tag = node.tagName?.toLowerCase();
          if (['script', 'style', 'noscript', 'iframe', 'svg', 'img',
               'nav', 'header', 'footer', 'aside', 'form', 'button',
               'input', 'select', 'textarea', 'canvas', 'video', 'audio'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          // 跳过隐藏元素
          if (!this._isVisible(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    // 收集所有候选文本块
    while (walker.nextNode()) {
      const el = walker.currentNode;

      const fullText = el.textContent?.trim() || '';

      // 跳过太短的
      if (fullText.length < 20) continue;

      // 跳过链接密度高的（导航、评论区）
      const links = el.querySelectorAll('a');
      let linkTextLen = 0;
      links.forEach(a => linkTextLen += a.textContent.length);
      const linkDensity = fullText.length > 0 ? linkTextLen / fullText.length : 0;
      if (linkDensity > 0.3) continue;

      // 判断是否为"叶子文本容器"
      // 关键修复：readlang 等网站把每个单词包在 <span> 里，
      // 导致子元素很多但全是行内元素。区分行内/块级子元素。
      let blockChildren = 0;
      for (const child of el.children) {
        const display = window.getComputedStyle(child).display;
        if (!display.startsWith('inline')) {
          blockChildren++;
        }
      }

      // 块级子元素少（≤3个）= 叶子节点，文本属于一个整体
      if (blockChildren > 3) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 150 || rect.height < 8) continue;

      // 去重：用文本前缀 + 位置
      const key = fullText.slice(0, 80) + '|' + Math.round(rect.top / 50) * 50;
      if (seen.has(key)) continue;
      seen.add(key);

      blocks.push({
        el: el,
        text: fullText,
        absY: rect.top + window.scrollY,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        width: rect.width,
      });
    }

    // 按页面位置排序
    blocks.sort((a, b) => a.absY - b.absY);

    // 合并距离很近的相邻文本块（同一段落被拆成多个元素的情况）
    return this._mergeAdjacentBlocks(blocks);
  },

  // 合并相邻文本块
  _mergeAdjacentBlocks(blocks) {
    if (blocks.length < 2) return blocks;

    const merged = [];
    let current = { ...blocks[0] };

    for (let i = 1; i < blocks.length; i++) {
      const next = blocks[i];
      const gap = next.absY - (current.absY + current.height);

      // 如果间隙小于一行（~20px），合并
      if (gap < 20 && next.text.length > 0) {
        current.text += '\n' + next.text;
        current.bottom = next.bottom;
        current.height = next.absY + next.height - current.absY;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
    return merged;
  },

  // 判断元素是否可见
  _isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 && rect.height < 10) return false;
    return true;
  },

  _assembleText(blocks, maxLen) {
    let result = '';
    for (const b of blocks) {
      const remaining = maxLen - result.length;
      if (remaining <= 0) break;
      const toAdd = b.text.length > remaining
        ? b.text.slice(0, remaining) + '…'
        : b.text;
      result += toAdd + '\n\n';
    }
    return result.trim();
  },

  // ---- 获取章节标题 ----
  getChapterTitle() {
    const headings = document.querySelectorAll('h1, h2, h3, h4');
    let best = null;
    let bestScore = 0;

    for (const h of headings) {
      const text = h.textContent.trim();
      if (text.length < 2 || text.length > 100) continue;

      const rect = h.getBoundingClientRect();
      if (rect.top < -200 || rect.top > window.innerHeight * 2) continue;

      let score = 0;
      if (/第[一二三四五六七八九十百千\d]+章/.test(text)) score += 10;
      if (/第[\d]+章/.test(text)) score += 10;
      if (/章/.test(text)) score += 5;
      if (/卷|节|回|话|Part|Chapter/i.test(text)) score += 3;
      if (rect.top < window.innerHeight * 0.3) score += 4;

      const fontSize = parseFloat(window.getComputedStyle(h).fontSize);
      if (fontSize > 18) score += 3;
      if (text.length < 50) score += 2;

      if (score > bestScore) {
        bestScore = score;
        best = text;
      }
    }
    return best || '';
  },

  // ---- 获取书名 ----
  getBookTitle() {
    const separators = [' - ', ' | ', ' — ', ' _ ', '·', ' / ', '/', ' | ', '|'];

    const isChapterLike = (s) => (
      /^#\d/.test(s) ||
      /第[\s一二三四五六七八九十百千\d]+[章回节卷话]/.test(s) ||
      /Chapter\s*\d+/i.test(s) ||
      /Part\s*\d+/i.test(s)
    );

    // 清理：去包裹、去噪音后缀、去残余标点
    const cleanTitle = (s) => {
      let t = s.trim();
      // 去「」『』"" 包裹
      t = t.replace(/^[「『""]/, '').replace(/[」』""]$/, '');
      // 去 】】 等
      t = t.replace(/[】〗]$/, '');
      // 去末尾残余的 ！」！等标点+括号组合
      t = t.replace(/[！!」』】〗]+$/, '');
      // 去 [pixiv] [xxx网] 等
      t = t.replace(/\s*\[.*?\]$/i, '');
      // 去 "的系列作品" "の系列作品" "系列小说" "の小説" 等后缀
      t = t.replace(/[の的]系列作品$/, '');
      t = t.replace(/系列小説$/, '');
      t = t.replace(/[の的]小説$/, '');
      t = t.replace(/シリーズ$/, '');
      return t.trim();
    };

    const isNoise = (s) => (
      s.length <= 1 ||
      /readlang|github|twitter|facebook|google|pixiv|fanbox|booth/i.test(s) ||
      /^https?:\/\//i.test(s) ||
      /^\d+$/.test(s)
    );

    // 打分：越像书名分越高
    const titleScore = (s) => {
      let score = 0;
      // 短小精悍加分（2-15字最佳）
      if (s.length >= 2 && s.length <= 8) score += 3;
      else if (s.length <= 15) score += 2;
      else if (s.length <= 25) score += 1;
      else score -= 2;  // 太长不像书名
      // 含「」的书名通常已被清理，残留标点扣分
      if (/[」』】〗！!」』]/.test(s)) score -= 3;
      // 像句子（含句号逗号）的扣分
      if (/[，。、．,.]/.test(s)) score -= 2;
      // 含"的"但很短可能是书名的一部分，不扣分
      return score;
    };

    const candidates = [];
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) candidates.push(ogTitle.getAttribute('content')?.trim() || '');
    const titleEl = document.querySelector('title');
    if (titleEl) candidates.push(titleEl.textContent?.trim() || '');

    for (const raw of candidates) {
      if (!raw || raw.length < 2) continue;

      // 尝试按分隔符拆分
      let parts = [raw];
      for (const sep of separators) {
        if (raw.includes(sep)) {
          parts = raw.split(sep).map(p => p.trim()).filter(Boolean);
          break;
        }
      }

      // 清理 + 过滤 + 打分
      const scored = parts
        .map(p => ({ text: cleanTitle(p), score: 0 }))
        .filter(p => !isChapterLike(p.text) && !isNoise(p.text))
        .map(p => ({ ...p, score: titleScore(p.text) }));

      if (scored.length > 0) {
        // 取最高分
        scored.sort((a, b) => b.score - a.score);
        return scored[0].text;
      }

      // 无法拆分，直接清理
      const cleaned = cleanTitle(raw);
      if (!isChapterLike(cleaned) && !isNoise(cleaned) && cleaned.length < 80) {
        return cleaned;
      }
    }

    // h1 回退
    const h1 = document.querySelector('h1');
    if (h1) {
      const text = h1.textContent.trim();
      const cleaned = text.replace(/^[「『]/, '').replace(/[」』]$/, '').trim();
      if (cleaned.length > 1 && cleaned.length < 50 && !isChapterLike(cleaned)) return cleaned;
    }

    // 最后回退：用 document.title 做拆分+打分
    const rawTitle = document.title || '未知书名';
    for (const sep of separators) {
      if (rawTitle.includes(sep)) {
        const parts = rawTitle.split(sep)
          .map(p => cleanTitle(p))
          .filter(p => !isChapterLike(p) && !isNoise(p) && p.length <= 30);
        if (parts.length > 0) {
          return parts.map(p => ({ text: p, score: titleScore(p) }))
            .sort((a, b) => b.score - a.score)[0].text;
        }
      }
    }
    return cleanTitle(rawTitle) || '未知书名';
  },

  // ---- 章节号 ----
  getChapterNumber(chapterTitle) {
    if (!chapterTitle) return 0;
    const match = chapterTitle.match(/第[\s]*(\d+)[章回节卷话]/);
    if (match) return parseInt(match[1], 10);
    return 0;
  },

  // ---- 作者检测 ----
  getAuthor() {
    // meta author
    const metaAuthor = document.querySelector('meta[name="author"]');
    if (metaAuthor) return metaAuthor.getAttribute('content')?.trim() || '';

    // OpenGraph
    const ogAuthor = document.querySelector('meta[property="og:article:author"]');
    if (ogAuthor) return ogAuthor.getAttribute('content')?.trim() || '';

    // JSON-LD
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        if (data.author?.name) return data.author.name;
        if (Array.isArray(data.author)) return data.author[0]?.name || '';
      } catch (_) {}
    }

    return '';
  },

  // ---- 组合输出 ----
  getReadingContext(options = {}) {
    const visibleText = this.getVisibleParagraphs(options);
    const chapterTitle = this.getChapterTitle();
    const bookTitle = this.getBookTitle();
    const chapter = this.getChapterNumber(chapterTitle);
    const author = this.getAuthor();

    return {
      visibleText,
      chapterTitle,
      bookTitle,
      chapter,
      author,
      url: window.location.href,
    };
  },
};

window.__NovelExtractor = Extractor;
