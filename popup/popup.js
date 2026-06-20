// ============================================================
// Novel Companion — 快捷弹窗
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const powerToggle = document.getElementById('power-toggle');
  const openOptions = document.getElementById('open-options');
  const quickStats = document.getElementById('quick-stats');

  // 加载设置
  const settings = await sendToBackground('GET_SETTINGS');
  powerToggle.checked = settings.enabled !== false;

  // 加载快捷统计
  const data = await chrome.storage.local.get('books');
  const books = data.books || {};
  const entries = Object.values(books);
  const totalNotes = entries.reduce((s, b) => s + (b.recentNotes?.length || 0), 0);
  const totalChapters = entries.reduce((s, b) => s + (b.lastChapter || 0), 0);

  if (entries.length > 0) {
    quickStats.innerHTML = entries.map((b, i) =>
      `<div class="stat-line">📖 ${esc(b.name || '未知')} · 第${b.lastChapter || '?'}章 · ${b.recentNotes?.length || 0}条笔记</div>`
    ).join('');
  } else {
    quickStats.innerHTML = '<p class="empty-hint">还没有阅读记录</p>';
  }

  // 开关即时生效
  powerToggle.addEventListener('change', async () => {
    settings.enabled = powerToggle.checked;
    await sendToBackground('SAVE_SETTINGS', { settings });
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE', enabled: powerToggle.checked })
        .catch(() => {});
    }
  });

  // 打开完整设置页
  openOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  function sendToBackground(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else resolve(response || {});
      });
    });
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
});
