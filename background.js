/**
 * background.js - Service Worker
 * 处理提醒闹钟、通知、消息路由
 */

// 安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('[WA CRM] Extension installed');
  // 设置定期检查提醒的闹钟
  chrome.alarms.create('checkReminders', {
    periodInMinutes: 5
  });
});

// 闹钟触发 - 检查跟进提醒
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkReminders') {
    await checkReminders();
  }
});

/**
 * 检查所有待处理的提醒
 */
async function checkReminders() {
  const { customers = {} } = await chrome.storage.local.get('customers');
  const now = Date.now();
  const pending = [];

  Object.values(customers).forEach(customer => {
    (customer.reminders || []).forEach(reminder => {
      if (!reminder.done && reminder.time <= now && !reminder.notified) {
        pending.push({
          phone: customer.phone,
          name: customer.name || customer.phone,
          reminder
        });
      }
    });
  });

  // 发送通知
  for (const item of pending) {
    chrome.notifications.create(`reminder_${item.reminder.id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '📋 跟进提醒',
      message: `${item.name}: ${item.reminder.note || '该跟进这个客户了'}`,
      priority: 2,
      requireInteraction: true
    });

    // 标记已通知
    const customers = (await chrome.storage.local.get('customers')).customers || {};
    if (customers[item.phone]) {
      const r = customers[item.phone].reminders.find(r => r.id === item.reminder.id);
      if (r) r.notified = true;
      await chrome.storage.local.set({ customers });
    }
  }

  // 更新角标
  await updateBadge();
}

/**
 * 更新角标数字
 */
async function updateBadge() {
  const { customers = {} } = await chrome.storage.local.get('customers');
  const now = Date.now();
  let count = 0;

  Object.values(customers).forEach(customer => {
    (customer.reminders || []).forEach(r => {
      if (!r.done && r.time <= now) count++;
    });
  });

  chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#25D366' });
}

// 监听来自 content script 和 popup 的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'SET_REMINDER':
      // 设置单个提醒的闹钟
      const delayMin = Math.max(1, Math.floor((msg.reminder.time - Date.now()) / 60000));
      chrome.alarms.create(`reminder_${msg.reminder.id}`, {
        delayInMinutes: delayMin
      });
      sendResponse({ ok: true });
      break;

    case 'GET_REMINDERS':
      // 获取所有待处理提醒
      chrome.storage.local.get('customers', ({ customers = {} }) => {
        const now = Date.now();
        const reminders = [];
        Object.values(customers).forEach(c => {
          (c.reminders || []).forEach(r => {
            if (!r.done) {
              reminders.push({
                ...r,
                customerPhone: c.phone,
                customerName: c.name || c.phone,
                overdue: r.time < now
              });
            }
          });
        });
        reminders.sort((a, b) => a.time - b.time);
        sendResponse({ reminders });
      });
      return true; // async

    case 'UPDATE_BADGE':
      updateBadge();
      sendResponse({ ok: true });
      break;

    case 'OPEN_DASHBOARD':
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      sendResponse({ ok: true });
      break;

    case 'NOTIFY':
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: msg.title || 'WhatsApp CRM',
        message: msg.message || ''
      });
      sendResponse({ ok: true });
      break;
  }
});

// 通知点击 - 跳转到对应聊天
chrome.notifications.onClicked.addListener(async (notifId) => {
  if (notifId.startsWith('reminder_')) {
    // 找到对应的 WhatsApp 聊天
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  }
});

// 初始化角标
updateBadge();
