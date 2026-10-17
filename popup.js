/**
 * popup.js - 弹窗逻辑
 */

document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  await loadReminders();
  await loadQuickTags();
  bindEvents();
});

async function loadQuickTags() {
  const container = document.getElementById('quick-tags');
  if (!container) return;
  const settings = await CRMStorage.getSettings();
  const customTags = settings.customTags || ['VIP', '意向客户', '已成交', '待跟进', '新客户'];
  container.innerHTML = customTags.map(tag =>
    '<button class="tag-btn" data-tag="' + tag + '">' + tag + '</button>'
  ).join('');
  // 绑定点击事件
  container.querySelectorAll('.tag-btn').forEach(btn => {
    btn.onclick = async () => {
      const tag = btn.dataset.tag;
      const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
      if (tabs.length === 0) {
        alert('请先打开 WhatsApp Web');
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'QUICK_TAG', tag });
      btn.classList.add('active');
      setTimeout(() => btn.classList.remove('active'), 300);
    };
  });
}

async function loadStats() {
  try {
    const overview = await Analytics.getOverview();
    document.getElementById('stat-total').textContent = overview.totalCustomers;
    document.getElementById('stat-pending').textContent = overview.pendingReminders;

    const followUpStats = await Analytics.getFollowUpStats();
    document.getElementById('stat-overdue').textContent = followUpStats.overdue;
  } catch (e) {
    console.error('Load stats error:', e);
  }
}

async function loadReminders() {
  const container = document.getElementById('reminders-list');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_REMINDERS' });
    if (!result || result.reminders.length === 0) {
      container.innerHTML = '<div class="empty">暂无待跟进提醒 ✨</div>';
      return;
    }

    container.innerHTML = result.reminders.slice(0, 5).map(r => `
      <div class="reminder-item ${r.overdue ? 'overdue' : ''}">
        <div class="reminder-info">
          <strong>${r.customerName}</strong>
          <span class="reminder-note">${r.note || '跟进'}</span>
        </div>
        <div class="reminder-time">${formatTime(r.time)}</div>
        <button class="btn-done" data-phone="${r.customerPhone}" data-id="${r.id}" title="标记完成">✓</button>
      </div>
    `).join('');

    // 绑定完成按钮
    container.querySelectorAll('.btn-done').forEach(btn => {
      btn.onclick = async () => {
        await CRMStorage.completeReminder(btn.dataset.phone, btn.dataset.id);
        btn.parentElement.remove();
        loadStats();
        if (container.children.length === 0) {
          container.innerHTML = '<div class="empty">暂无待跟进提醒 ✨</div>';
        }
      };
    });
  } catch (e) {
    container.innerHTML = '<div class="empty">加载失败</div>';
  }
}

function bindEvents() {
  // 打开管理面板
  document.getElementById('btn-dashboard').onclick = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  };

  // 导出数据
  document.getElementById('btn-export').onclick = async () => {
    const data = await CRMStorage.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp-crm-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = ts - now.getTime();

  if (diff < 0) {
    const overdueH = Math.abs(diff) / 3600000;
    if (overdueH < 24) return '过期' + Math.floor(overdueH) + '小时';
    return '过期' + Math.floor(overdueH / 24) + '天';
  }
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟后';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时后';
  return Math.floor(diff / 86400000) + '天后';
}

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TAG_ADDED') {
    loadStats();
  }
});
