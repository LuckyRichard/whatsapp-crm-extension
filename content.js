/**
 * content.js - WhatsApp Web 内容脚本
 * 注入侧边栏、监听聊天变化、自动记录客户信息
 * 修复：使用事件委托替代 onclick，解决 Chrome 扩展隔离环境调用问题
 */

(function() {
  'use strict';

  // ==================== 状态管理 ====================
  const state = {
    currentChat: null,
    sidebarOpen: false,
    sidebarEl: null,
    observer: null,
    messageObserver: null,
    lastMessageText: '',
    settings: {}
  };

  // ==================== 初始化 ====================

  function init() {
    console.log('[WA CRM] Content script loaded');
    loadSettings();
    initSync();
    waitForWhatsApp().then(() => {
      injectFloatingButton();
      observeChatChanges();
      console.log('[WA CRM] Ready');
    });
  }

  function loadSettings() {
    chrome.storage.local.get('settings', ({ settings = {} }) => {
      state.settings = { autoRecord: true, ...settings };
    });
  }

  async function initSync() {
    if (typeof SyncManager === 'undefined') return;
    const { firebaseConfig } = await chrome.storage.local.get('firebaseConfig');
    if (firebaseConfig && firebaseConfig.apiKey) {
      await SyncManager.init(firebaseConfig);
      console.log('[WA CRM] Sync initialized');
    }
    // 监听认证状态变化，更新侧边栏 UI
    window.addEventListener('sync-auth-change', () => {
      if (state.sidebarOpen) refreshSidebarContent();
      updateSyncIndicator();
    });
  }

  function updateSyncIndicator() {
    const indicator = document.getElementById('wa-crm-sync-indicator');
    if (!indicator) return;
    const status = typeof SyncManager !== 'undefined' ? SyncManager.getStatus() : {};
    if (status.loggedIn) {
      indicator.innerHTML = '<span class="wa-crm-sync-dot online"></span>' +
        '<span>' + (status.user?.email || '') + '</span>';
    } else if (status.hasConfig) {
      indicator.innerHTML = '<span class="wa-crm-sync-dot offline"></span><span>\u672A\u767B\u5F55</span>';
    } else {
      indicator.innerHTML = '<span class="wa-crm-sync-dot no-config"></span><span>\u672A\u914D\u7F6E</span>';
    }
  }

  function waitForWhatsApp() {
    return new Promise(resolve => {
      const check = () => {
        if (document.querySelector('#app') && document.querySelector('#pane-side')) {
          resolve();
        } else {
          setTimeout(check, 1000);
        }
      };
      check();
    });
  }

  // ==================== 浮动按钮 ====================

  function injectFloatingButton() {
    if (document.getElementById('wa-crm-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'wa-crm-btn';
    btn.innerHTML = '<div class="wa-crm-fab"><svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg><span class="wa-crm-badge" style="display:none">0</span></div>';
    btn.onclick = () => toggleSidebar();
    document.body.appendChild(btn);

    updateFabBadge();
    setInterval(updateFabBadge, 60000);
  }

  async function updateFabBadge() {
    const result = await chrome.runtime.sendMessage({ type: 'GET_REMINDERS' });
    const badge = document.querySelector('.wa-crm-badge');
    if (badge && result) {
      const overdue = result.reminders.filter(r => r.overdue).length;
      badge.textContent = overdue;
      badge.style.display = overdue > 0 ? 'block' : 'none';
    }
  }

  // ==================== 侧边栏 ====================

  function toggleSidebar() {
    if (state.sidebarOpen) closeSidebar();
    else openSidebar();
  }

  async function openSidebar() {
    if (state.sidebarEl) {
      state.sidebarEl.style.display = 'flex';
      state.sidebarOpen = true;
      await refreshSidebarContent();
      return;
    }

    const sidebar = document.createElement('div');
    sidebar.id = 'wa-crm-sidebar';
    sidebar.innerHTML = [
      '<div class="wa-crm-header">',
      '  <h3>\uD83D\uDCCB \u5BA2\u6237\u7BA1\u7406</h3>',
      '  <div class="wa-crm-header-actions">',
      '    <button class="wa-crm-icon-btn" data-action="show-account" title="\u8D26\u53F7\u540C\u6B65"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></button>',
      '    <button class="wa-crm-icon-btn" data-action="ai-analyze" title="AI\u5206\u6790\u5BA2\u6237"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.5-9.11 0-12.58 3.51-3.47 9.14-3.49 12.65-.06L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"/></svg></button>',
      '    <button class="wa-crm-icon-btn" data-action="open-dashboard" title="\u6253\u5F00\u7BA1\u7406\u9762\u677F"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg></button>',
      '    <button class="wa-crm-icon-btn" data-action="close-sidebar" title="\u5173\u95ED"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>',
      '  </div>',
      '</div>',
      '<div id="wa-crm-sync-indicator" class="wa-crm-sync-bar"></div>',
      '<div class="wa-crm-body" id="wa-crm-body"><div class="wa-crm-loading">\u52A0\u8F7D\u4E2D...</div></div>'
    ].join('\n');

    document.body.appendChild(sidebar);
    state.sidebarEl = sidebar;
    state.sidebarOpen = true;

    // 事件委托：统一处理侧边栏内所有点击
    sidebar.addEventListener('click', handleSidebarClick);

    await refreshSidebarContent();
  }

  function closeSidebar() {
    if (state.sidebarEl) {
      state.sidebarEl.style.display = 'none';
      state.sidebarOpen = false;
    }
  }

  // ==================== 事件委托（核心修复） ====================

  function handleSidebarClick(e) {
    // 找到最近的带 data-action 的祖先元素
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const dataId = target.dataset.id;
    const dataTag = target.dataset.tag;
    const dataTab = target.dataset.tab;

    switch (action) {
      case 'close-sidebar':
        closeSidebar();
        break;

      case 'open-dashboard':
        chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
        break;

      case 'edit-customer':
        doEditCustomerInfo();
        break;

      case 'add-tag':
        doAddTag();
        break;

      case 'remove-tag':
        if (dataTag) doRemoveTag(dataTag);
        break;

      case 'add-reminder':
        doAddReminder();
        break;

      case 'complete-reminder':
        if (dataId) doCompleteReminder(dataId);
        break;

      case 'use-template':
        if (dataId) doUseTemplate(dataId);
        break;

      case 'ai-analyze':
        doAiAnalyze();
        break;

      case 'show-account':
        showAccountModal();
        break;

      case 'do-login':
        doLogin();
        break;

      case 'do-register':
        doRegister();
        break;

      case 'do-logout':
        doLogout();
        break;

      case 'close-login-modal':
        closeAccountModal();
        break;

      case 'open-sync-settings':
        closeAccountModal();
        chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', tab: 'settings' });
        break;
    }
  }

  // ==================== 各操作实现 ====================

  async function doEditCustomerInfo() {
    const chatInfo = getCurrentChatInfo();
    if (!chatInfo) return;

    const customer = await CRMStorage.getCustomer(chatInfo.phone);
    const company = prompt('\u516C\u53F8\u540D\u79F0\uFF1A', customer?.company || '');
    if (company === null) return;

    const country = prompt('\u56FD\u5BB6/\u5730\u533A\uFF1A', customer?.country || '');
    if (country === null) return;

    const notes = prompt('\u5907\u6CE8\uFF1A', customer?.notes || '');
    if (notes === null) return;

    const name = prompt('\u5BA2\u6237\u540D\u79F0\uFF1A', customer?.name || chatInfo.name);
    if (name === null) return;

    await CRMStorage.saveCustomer(chatInfo.phone, { name, company, country, notes });
    refreshSidebarContent();
  }

  async function doAddTag() {
    const chatInfo = getCurrentChatInfo();
    if (!chatInfo) return;

    // 从设置中加载自定义标签
    const settings = await new Promise(resolve => {
      chrome.storage.local.get('settings', ({ settings = {} }) => resolve(settings));
    });
    const customTags = settings.customTags || ['VIP', '意向客户', '已成交', '待跟进', '新客户'];
    const tagsHint = customTags.join('、');

    const tag = prompt('输入标签名称：\n\n常用标签：' + tagsHint + '\n\n也可以输入任意自定义标签');
    if (tag && tag.trim()) {
      await CRMStorage.addTag(chatInfo.phone, tag.trim());
      // 尝试同步到 WhatsApp Business 原生标签
      await syncLabelToWhatsApp(tag.trim());
      refreshSidebarContent();
    }
  }

  async function doRemoveTag(tag) {
    const chatInfo = getCurrentChatInfo();
    if (!chatInfo) return;
    await CRMStorage.removeTag(chatInfo.phone, tag);
    refreshSidebarContent();
  }

  async function doAddReminder() {
    const chatInfo = getCurrentChatInfo();
    if (!chatInfo) return;

    const note = prompt('跟进内容（可留空）：');
    if (note === null) return;

    const timeStr = prompt('提醒时间（支持多种格式）：\n\n' +
      '• 相对时间：30分钟后、1小时后、3天后\n' +
      '• 明天/后天：明天下午3点、后天上午10点\n' +
      '• 周几：下周一、周五\n' +
      '• 具体日期：10月20日 14:00、2026-10-20 14:00');
    if (!timeStr) return;

    const time = parseTimeInput(timeStr);
    if (!time) {
      alert('时间格式不正确，请重新输入\n\n支持的格式：\n• 30分钟后、1小时后、3天后\n• 明天下午3点、后天上午10点\n• 下周一、10月20日 14:00\n• 2026-10-20 14:00');
      return;
    }

    await CRMStorage.setReminder(chatInfo.phone, { note, time });
    refreshSidebarContent();
  }

  async function doCompleteReminder(reminderId) {
    const chatInfo = getCurrentChatInfo();
    if (!chatInfo) return;
    await CRMStorage.completeReminder(chatInfo.phone, reminderId);
    refreshSidebarContent();
  }

  async function doUseTemplate(templateId) {
    const chatInfo = getCurrentChatInfo();
    if (!chatInfo) return;

    const template = await TemplateManager.getById(templateId);
    if (!template) return;

    const customer = await CRMStorage.getCustomer(chatInfo.phone) || {};
    const variables = { name: customer.name || chatInfo.name || '' };

    for (const v of template.variables) {
      if (v === 'name') continue;
      const val = prompt('\u8BF7\u8F93\u5165 ' + v + '\uFF1A');
      if (val === null) return;
      variables[v] = val;
    }

    const rendered = TemplateManager.render(template.content, variables);
    insertTextToInput(rendered);
    await TemplateManager.incrementUsage(templateId);
  }

  // ==================== AI \u5206\u6790 ====================

  async function doAiAnalyze() {
    const chatInfo = getCurrentChatInfo();
    if (!chatInfo) return;

    const settings = await new Promise(resolve => {
      chrome.storage.local.get('settings', ({ settings = {} }) => resolve(settings));
    });

    if (!settings.aiApiUrl || !settings.aiApiKey) {
      showAiModal('\u26A0\uFE0F \u8BF7\u5148\u914D\u7F6E AI \u63A5\u53E3',
        '\u8BF7\u5728\u7BA1\u7406\u9762\u677F > \u8BBE\u7F6E > AI \u5206\u6790\u914D\u7F6E\u4E2D\u586B\u5199 API \u5730\u5740\u548C\u5BC6\u94A5\u3002\n\n\u652F\u6301\u4EFB\u4F55 OpenAI \u517C\u5BB9\u683C\u5F0F\u7684\u63A5\u53E3\uFF0C\u5982 ChatGPT\u3001DeepSeek\u3001\u901A\u4E49\u5343\u95EE\u7B49\u3002');
      return;
    }

    const customer = await CRMStorage.getCustomer(chatInfo.phone) || {};
    const messages = customer.messages || [];

    if (messages.length === 0) {
      showAiModal('\u6682\u65E0\u804A\u5929\u8BB0\u5F55',
        '\u8FD8\u6CA1\u6709\u8BB0\u5F55\u5230\u4E0E\u8FD9\u4F4D\u5BA2\u6237\u7684\u804A\u5929\u5185\u5BB9\u3002\n\u804A\u5929\u6D88\u606F\u4F1A\u81EA\u52A8\u8BB0\u5F55\uFF0C\u4E4B\u540E\u518D\u6765\u5206\u6790\u3002');
      return;
    }

    showAiModal('\uD83E\uDD16 AI \u5206\u6790\u4E2D...', '\u6B63\u5728\u5206\u6790\u804A\u5929\u8BB0\u5F55\uFF0C\u8BF7\u7A0D\u7B49...');

    const chatHistory = messages.slice(-50).map(m =>
      (m.direction === 'in' ? '\u5BA2\u6237' : '\u6211') + ': ' + m.text
    ).join('\n');

    const prompt = `\u4F60\u662F\u4E00\u4E2A\u5916\u8D38\u4E1A\u52A1\u4E13\u5BB6\u3002\u8BF7\u6839\u636E\u4EE5\u4E0B\u4E0E\u5BA2\u6237\u7684WhatsApp\u804A\u5929\u8BB0\u5F55\uFF0C\u505A\u4EE5\u4E0B\u5206\u6790\uFF1A

1. \u3010\u5BA2\u6237\u80CC\u8C03\u3011\u6839\u636E\u804A\u5929\u5185\u5BB9\u63A8\u65AD\u5BA2\u6237\u7684\u516C\u53F8\u80CC\u666F\u3001\u4E1A\u52A1\u7C7B\u578B\u3001\u91C7\u8D2D\u80FD\u529B
2. \u3010\u610F\u5411\u5224\u65AD\u3011\u5BA2\u6237\u7684\u8D2D\u4E70\u610F\u5411\u7A0B\u5EA6\uFF08\u9AD8/\u4E2D/\u4F4E\uFF09\u53CA\u539F\u56E0
3. \u3010\u5173\u6CE8\u70B9\u3011\u5BA2\u6237\u6700\u5173\u5FC3\u7684\u95EE\u9898\uFF08\u4EF7\u683C\u3001\u8D28\u91CF\u3001\u4EA4\u671F\u7B49\uFF09
4. \u3010\u8DDF\u8FDB\u5EFA\u8BAE\u3011\u5177\u4F53\u7684\u4E0B\u4E00\u6B65\u8DDF\u8FDB\u8BDD\u672F\u5EFA\u8BAE\uFF08\u7ED9\u51FA\u53EF\u76F4\u63A5\u590D\u5236\u7684\u82F1\u6587\u8BDD\u672F\uFF09
5. \u3010\u98CE\u9669\u63D0\u793A\u3011\u9700\u8981\u6CE8\u610F\u7684\u98CE\u9669\u6216\u95EE\u9898

\u804A\u5929\u8BB0\u5F55\uFF1A
${chatHistory}

\u5BA2\u6237\u4FE1\u606F\uFF1A
\u540D\u79F0\uFF1A${customer.name || chatInfo.name}
\u516C\u53F8\uFF1A${customer.company || '\u672A\u77E5'}
\u6807\u7B7E\uFF1A${(customer.tags || []).join(', ') || '\u65E0'}

\u8BF7\u7528\u4E2D\u6587\u56DE\u7B54\uFF0C\u8BDD\u672F\u90E8\u5206\u7528\u82F1\u6587\u3002\u683C\u5F0F\u6E05\u6670\uFF0C\u4FBF\u4E8E\u9605\u8BFB\u3002`;

    try {
      const response = await fetch(settings.aiApiUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + settings.aiApiKey
        },
        body: JSON.stringify({
          model: settings.aiModel || 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: '\u4F60\u662F\u4E00\u4E2A\u4E13\u4E1A\u7684\u5916\u8D38\u4E1A\u52A1\u987E\u95EE\uFF0C\u64C5\u957F\u5BA2\u6237\u5206\u6790\u548C\u9500\u552E\u8BDD\u672F\u3002' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        showAiModal('\u274C AI \u5206\u6790\u5931\u8D25',
          '\u63A5\u53E3\u8FD4\u56DE\u9519\u8BEF: ' + response.status + '\n' + errText.substring(0, 200));
        return;
      }

      const data = await response.json();
      const result = data.choices?.[0]?.message?.content || '\u672A\u83B7\u53D6\u5230\u5206\u6790\u7ED3\u679C';
      showAiModal('\uD83E\uDD16 AI \u5206\u6790\u7ED3\u679C', result);

    } catch (e) {
      showAiModal('\u274C \u8FDE\u63A5\u5931\u8D25',
        '\u65E0\u6CD5\u8FDE\u63A5 AI \u670D\u52A1: ' + e.message +
        '\n\n\u8BF7\u68C0\u67E5\uFF1A\n1. API \u5730\u5740\u662F\u5426\u6B63\u786E\n2. \u7F51\u7EDC\u662F\u5426\u6B63\u5E38\n3. \u5982\u679C\u662F\u56FD\u5916\u670D\u52A1\uFF0C\u662F\u5426\u9700\u8981\u79D1\u5B66\u4E0A\u7F51');
    }
  }

  function showAiModal(title, content) {
    let modal = document.getElementById('wa-crm-ai-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'wa-crm-ai-modal';
      modal.className = 'wa-crm-modal-overlay';
      modal.innerHTML = [
        '<div class="wa-crm-modal">',
        '  <div class="wa-crm-modal-header">',
        '    <h3 id="wa-crm-ai-modal-title"></h3>',
        '    <button class="wa-crm-modal-close" data-action="close-ai-modal">\u00D7</button>',
        '  </div>',
        '  <div class="wa-crm-modal-body" id="wa-crm-ai-modal-body"></div>',
        '</div>'
      ].join('\n');
      document.body.appendChild(modal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('[data-action="close-ai-modal"]')) {
          modal.style.display = 'none';
        }
      });
    }

    document.getElementById('wa-crm-ai-modal-title').textContent = title;
    const body = document.getElementById('wa-crm-ai-modal-body');
    body.innerHTML = '<div class="wa-crm-ai-content">' + content.replace(/\n/g, '<br>') + '</div>';
    modal.style.display = 'flex';
  }

  // ==================== 账号同步弹窗 ====================

  function showAccountModal() {
    let modal = document.getElementById('wa-crm-account-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'wa-crm-account-modal';
      modal.className = 'wa-crm-modal-overlay';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('[data-action="close-login-modal"]')) {
          closeAccountModal();
        }
      });
    }

    const status = typeof SyncManager !== 'undefined' ? SyncManager.getStatus() : {};

    if (status.loggedIn) {
      // 已登录：显示账号信息和登出按钮
      modal.innerHTML = [
        '<div class="wa-crm-modal" style="width:400px">',
        '  <div class="wa-crm-modal-header">',
        '    <h3>\u2601\uFE0F \u540C\u6B65\u8D26\u53F7</h3>',
        '    <button class="wa-crm-modal-close" data-action="close-login-modal">\u00D7</button>',
        '  </div>',
        '  <div class="wa-crm-modal-body">',
        '    <div class="wa-crm-account-info">',
        '      <div class="wa-crm-account-avatar">' + (status.user?.email || '?')[0].toUpperCase() + '</div>',
        '      <div>',
        '        <div class="wa-crm-account-email">' + (status.user?.email || '') + '</div>',
        '        <div class="wa-crm-account-status"><span class="wa-crm-sync-dot online"></span> \u5DF2\u767B\u5F55\uFF0C\u6570\u636E\u540C\u6B65\u4E2D</div>',
        '      </div>',
        '    </div>',
        '    <div class="wa-crm-account-actions">',
        '      <button class="wa-crm-btn wa-crm-btn-outline" data-action="open-sync-settings">\u2699\uFE0F \u540C\u6B65\u8BBE\u7F6E</button>',
        '      <button class="wa-crm-btn wa-crm-btn-danger" data-action="do-logout">\u9000\u51FA\u767B\u5F55</button>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('\n');
    } else if (status.hasConfig) {
      // 有配置但未登录：显示登录/注册表单
      modal.innerHTML = [
        '<div class="wa-crm-modal" style="width:400px">',
        '  <div class="wa-crm-modal-header">',
        '    <h3>\u2601\uFE0F \u767B\u5F55\u540C\u6B65\u8D26\u53F7</h3>',
        '    <button class="wa-crm-modal-close" data-action="close-login-modal">\u00D7</button>',
        '  </div>',
        '  <div class="wa-crm-modal-body">',
        '    <div class="wa-crm-auth-tabs">',
        '      <button class="wa-crm-auth-tab active" data-auth-tab="login">\u767B\u5F55</button>',
        '      <button class="wa-crm-auth-tab" data-auth-tab="register">\u6CE8\u518C</button>',
        '    </div>',
        '    <div id="wa-crm-auth-form-login" class="wa-crm-auth-form">',
        '      <input type="email" id="wa-crm-login-email" class="wa-crm-input" placeholder="\u90AE\u7BB1">',
        '      <input type="password" id="wa-crm-login-password" class="wa-crm-input" placeholder="\u5BC6\u7801">',
        '      <div id="wa-crm-login-error" class="wa-crm-form-error"></div>',
        '      <button class="wa-crm-btn wa-crm-btn-primary" data-action="do-login">\u767B\u5F55</button>',
        '    </div>',
        '    <div id="wa-crm-auth-form-register" class="wa-crm-auth-form" style="display:none">',
        '      <input type="email" id="wa-crm-register-email" class="wa-crm-input" placeholder="\u90AE\u7BB1">',
        '      <input type="password" id="wa-crm-register-password" class="wa-crm-input" placeholder="\u5BC6\u7801\uFF08\u81F3\u5C116\u4F4D\uFF09">',
        '      <div id="wa-crm-register-error" class="wa-crm-form-error"></div>',
        '      <button class="wa-crm-btn wa-crm-btn-primary" data-action="do-register">\u6CE8\u518C</button>',
        '    </div>',
        '    <p class="wa-crm-auth-hint">\u767B\u5F55\u540E\u5BA2\u6237\u6570\u636E\u4F1A\u81EA\u52A8\u540C\u6B65\u5230\u4E91\u7AEF\uFF0C\u5176\u4ED6\u8BBE\u5907\u767B\u5F55\u540C\u4E00\u8D26\u53F7\u5373\u53EF\u83B7\u53D6\u3002</p>',
        '  </div>',
        '</div>'
      ].join('\n');

      // Tab 切换
      modal.querySelectorAll('.wa-crm-auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          modal.querySelectorAll('.wa-crm-auth-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const target = tab.dataset.authTab;
          modal.querySelector('#wa-crm-auth-form-login').style.display = target === 'login' ? 'block' : 'none';
          modal.querySelector('#wa-crm-auth-form-register').style.display = target === 'register' ? 'block' : 'none';
        });
      });
    } else {
      // 未配置 Firebase
      modal.innerHTML = [
        '<div class="wa-crm-modal" style="width:400px">',
        '  <div class="wa-crm-modal-header">',
        '    <h3>\u2601\uFE0F \u540C\u6B65\u672A\u914D\u7F6E</h3>',
        '    <button class="wa-crm-modal-close" data-action="close-login-modal">\u00D7</button>',
        '  </div>',
        '  <div class="wa-crm-modal-body">',
        '    <p style="font-size:13px;color:#555;line-height:1.8;margin-bottom:16px">',
        '      \u8DE8\u8BBE\u5907\u540C\u6B65\u529F\u80FD\u9700\u8981\u5148\u914D\u7F6E Firebase\u3002<br>',
        '      \u8BF7\u5728 <strong>\u7BA1\u7406\u9762\u677F > \u8BBE\u7F6E > \u540C\u6B65\u914D\u7F6E</strong> \u4E2D\u586B\u5199 Firebase \u9879\u76EE\u4FE1\u606F\u3002',
        '    </p>',
        '    <button class="wa-crm-btn wa-crm-btn-primary" data-action="open-sync-settings" style="width:100%">\u524D\u5F80\u914D\u7F6E</button>',
        '  </div>',
        '</div>'
      ].join('\n');
    }

    modal.style.display = 'flex';
  }

  function closeAccountModal() {
    const modal = document.getElementById('wa-crm-account-modal');
    if (modal) modal.style.display = 'none';
  }

  async function doLogin() {
    const email = document.getElementById('wa-crm-login-email')?.value?.trim();
    const password = document.getElementById('wa-crm-login-password')?.value;
    const errorEl = document.getElementById('wa-crm-login-error');

    if (!email || !password) {
      if (errorEl) errorEl.textContent = '\u8BF7\u586B\u5199\u90AE\u7BB1\u548C\u5BC6\u7801';
      return;
    }

    if (errorEl) errorEl.textContent = '';

    try {
      await SyncManager.login(email, password);
      closeAccountModal();
      updateSyncIndicator();
      if (state.sidebarOpen) refreshSidebarContent();
    } catch (e) {
      if (errorEl) {
        const msg = e.code === 'auth/user-not-found' ? '\u7528\u6237\u4E0D\u5B58\u5728' :
                    e.code === 'auth/wrong-password' ? '\u5BC6\u7801\u9519\u8BEF' :
                    e.code === 'auth/invalid-email' ? '\u90AE\u7BB1\u683C\u5F0F\u4E0D\u6B63\u786E' :
                    e.code === 'auth/invalid-credential' ? '\u90AE\u7BB1\u6216\u5BC6\u7801\u9519\u8BEF' :
                    '\u767B\u5F55\u5931\u8D25: ' + (e.message || '');
        errorEl.textContent = msg;
      }
    }
  }

  async function doRegister() {
    const email = document.getElementById('wa-crm-register-email')?.value?.trim();
    const password = document.getElementById('wa-crm-register-password')?.value;
    const errorEl = document.getElementById('wa-crm-register-error');

    if (!email || !password) {
      if (errorEl) errorEl.textContent = '\u8BF7\u586B\u5199\u90AE\u7BB1\u548C\u5BC6\u7801';
      return;
    }

    if (password.length < 6) {
      if (errorEl) errorEl.textContent = '\u5BC6\u7801\u81F3\u5C11\u9700\u89816\u4F4D';
      return;
    }

    if (errorEl) errorEl.textContent = '';

    try {
      await SyncManager.register(email, password);
      closeAccountModal();
      updateSyncIndicator();
      if (state.sidebarOpen) refreshSidebarContent();
    } catch (e) {
      if (errorEl) {
        const msg = e.code === 'auth/email-already-in-use' ? '\u8BE5\u90AE\u7BB1\u5DF2\u6CE8\u518C' :
                    e.code === 'auth/weak-password' ? '\u5BC6\u7801\u592A\u77ED\uFF0C\u81F3\u5C11\u9700\u89816\u4F4D' :
                    e.code === 'auth/invalid-email' ? '\u90AE\u7BB1\u683C\u5F0F\u4E0D\u6B63\u786E' :
                    '\u6CE8\u518C\u5931\u8D25: ' + (e.message || '');
        errorEl.textContent = msg;
      }
    }
  }

  async function doLogout() {
    await SyncManager.logout();
    closeAccountModal();
    updateSyncIndicator();
    if (state.sidebarOpen) refreshSidebarContent();
  }

  // ==================== 侧边栏内容渲染 ====================

  async function refreshSidebarContent() {
    const body = document.getElementById('wa-crm-body');
    if (!body) return;

    const chatInfo = getCurrentChatInfo();
    if (!chatInfo) {
      body.innerHTML = '<div class="wa-crm-empty"><p>\uD83D\uDCAC \u9009\u62E9\u4E00\u4E2A\u804A\u5929\u5F00\u59CB\u7BA1\u7406\u5BA2\u6237</p></div>';
      return;
    }

    let customer = await CRMStorage.getCustomer(chatInfo.phone);
    if (!customer) {
      customer = await CRMStorage.saveCustomer(chatInfo.phone, {
        name: chatInfo.name,
        phone: chatInfo.phone,
        source: 'whatsapp'
      });
    }

    await CRMStorage.saveCustomer(chatInfo.phone, { lastActiveAt: Date.now() });

    // 合并插件标签与 WhatsApp Business 原生标签（去重）
    const pluginTags = customer.tags || [];
    const waLabels = readWhatsAppLabels();
    const allTags = [...new Set([...pluginTags, ...waLabels])];

    const reminders = (customer.reminders || []).filter(r => !r.done);
    const templates = await TemplateManager.getAll();
    const emptyEm = '<em style="color:#999">\u672A\u586B\u5199</em>';
    const emptyText = '<span class="wa-crm-empty-text">\u6682\u65E0</span>';

    const tagsHtml = allTags.length > 0
      ? allTags.map(t => {
          const isPluginTag = pluginTags.includes(t);
          if (isPluginTag) {
            return '<span class="wa-crm-tag" data-action="remove-tag" data-tag="' + escHtml(t) + '">' + escHtml(t) + ' <span class="wa-crm-tag-remove">\u00D7</span></span>';
          } else {
            return '<span class="wa-crm-tag wa-crm-tag-wa">' + escHtml(t) + ' <span class="wa-crm-tag-wa-badge">WA</span></span>';
          }
        }).join('')
      : emptyText;

    const remindersHtml = reminders.length > 0
      ? reminders.map(r => {
          const overdue = r.time < Date.now() ? ' overdue' : '';
          return '<div class="wa-crm-reminder' + overdue + '">' +
            '<div class="wa-crm-reminder-time">' + formatReminderTime(r.time) + '</div>' +
            '<div class="wa-crm-reminder-note">' + escHtml(r.note || '\u8DDF\u8FDB') + '</div>' +
            '<button class="wa-crm-text-btn" data-action="complete-reminder" data-id="' + r.id + '">\u2713</button>' +
            '</div>';
        }).join('')
      : '<span class="wa-crm-empty-text">\u6682\u65E0\u63D0\u9192</span>';

    const templatesHtml = templates.slice(0, 5).map(t =>
      '<div class="wa-crm-template-item" data-action="use-template" data-id="' + t.id + '">' +
      '<span class="wa-crm-template-cat">' + escHtml(t.category) + '</span>' +
      '<span class="wa-crm-template-name">' + escHtml(t.name) + '</span>' +
      '</div>'
    ).join('');

    body.innerHTML = [
      '<div class="wa-crm-section">',
      '  <div class="wa-crm-customer-card">',
      '    <div class="wa-crm-avatar">' + ((customer.name || '?')[0].toUpperCase()) + '</div>',
      '    <div class="wa-crm-customer-info">',
      '      <h4>' + escHtml(customer.name || chatInfo.name) + '</h4>',
      '      <p class="wa-crm-phone">' + escHtml(customer.phone) + '</p>',
      (customer.company ? '      <p class="wa-crm-company">' + escHtml(customer.company) + '</p>' : ''),
      '    </div>',
      '  </div>',
      '</div>',

      '<div class="wa-crm-section">',
      '  <div class="wa-crm-section-header">',
      '    <span>\uD83D\uDCDD \u5BA2\u6237\u4FE1\u606F</span>',
      '    <button class="wa-crm-text-btn" data-action="edit-customer">\u7F16\u8F91</button>',
      '  </div>',
      '  <div class="wa-crm-info-grid">',
      '    <div class="wa-crm-info-item"><label>\u516C\u53F8</label><span>' + (customer.company || emptyEm) + '</span></div>',
      '    <div class="wa-crm-info-item"><label>\u56FD\u5BB6/\u5730\u533A</label><span>' + (customer.country || emptyEm) + '</span></div>',
      '    <div class="wa-crm-info-item"><label>\u6765\u6E90</label><span>' + escHtml(customer.source || 'WhatsApp') + '</span></div>',
      '    <div class="wa-crm-info-item"><label>\u6700\u540E\u6D3B\u8DC3</label><span>' + formatTime(customer.lastActiveAt) + '</span></div>',
      '  </div>',
      (customer.notes ? '<div class="wa-crm-notes"><label>\u5907\u6CE8</label><p>' + escHtml(customer.notes) + '</p></div>' : ''),
      '</div>',

      '<div class="wa-crm-section">',
      '  <div class="wa-crm-section-header">',
      '    <span>\uD83C\uDFF7\uFE0F \u6807\u7B7E</span>',
      '    <button class="wa-crm-text-btn" data-action="add-tag">+ \u6DFB\u52A0</button>',
      '  </div>',
      '  <div class="wa-crm-tags">' + tagsHtml + '</div>',
      '</div>',

      '<div class="wa-crm-section">',
      '  <div class="wa-crm-section-header">',
      '    <span>\u23F0 \u8DDF\u8FDB\u63D0\u9192</span>',
      '    <button class="wa-crm-text-btn" data-action="add-reminder">+ \u6DFB\u52A0</button>',
      '  </div>',
      '  <div class="wa-crm-reminders">' + remindersHtml + '</div>',
      '</div>',

      '<div class="wa-crm-section">',
      '  <div class="wa-crm-section-header">',
      '    <span>\uD83D\uDCAC \u5FEB\u6377\u8BDD\u672F</span>',
      '    <button class="wa-crm-text-btn" data-action="open-dashboard" data-tab="templates">\u7BA1\u7406</button>',
      '  </div>',
      '  <div class="wa-crm-templates">' + templatesHtml + '</div>',
      '</div>'
    ].join('\n');
  }

  // ==================== 聊天监听 ====================

  function observeChatChanges() {
    const observer = new MutationObserver(debounce(() => {
      const chatInfo = getCurrentChatInfo();
      if (chatInfo && chatInfo.phone !== state.currentChat) {
        state.currentChat = chatInfo.phone;
        if (state.sidebarOpen) refreshSidebarContent();
      }
    }, 500));

    observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

    const msgObserver = new MutationObserver(debounce(() => {
      if (!state.settings.autoRecord) return;
      const chatInfo = getCurrentChatInfo();
      if (!chatInfo) return;
      captureNewMessages(chatInfo);
    }, 1000));

    const msgArea = document.querySelector('#app .copyable-text');
    if (msgArea) {
      msgObserver.observe(msgArea.closest('[class]') || msgArea, { childList: true, subtree: true });
    }

    state.observer = observer;
    state.messageObserver = msgObserver;
  }

  async function captureNewMessages(chatInfo) {
    const messages = document.querySelectorAll('.message-in .copyable-text__copyable, .message-out .copyable-text__copyable');
    if (messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    const text = lastMsg.getAttribute('data-pre-plaintext') || lastMsg.textContent;
    if (!text || text === state.lastMessageText) return;

    state.lastMessageText = text;
    const isIncoming = lastMsg.closest('.message-in') !== null;

    await CRMStorage.addMessageRecord(chatInfo.phone, {
      text: text.substring(0, 500),
      direction: isIncoming ? 'in' : 'out',
      timestamp: Date.now()
    });

    if (isIncoming) await autoExtractInfo(chatInfo.phone, text);
  }

  async function autoExtractInfo(phone, text) {
    const patterns = {
      company: [
        /(?:I work at|I'm from|my company is|we are)\s+([A-Z][\w\s&]+)/i,
        /(?:\u516C\u53F8|\u6211\u4EEC\u662F|\u6211\u53F8)\s*[:\uFF1A]?\s*([^\s,\uFF0C\u3002]+)/
      ],
      email: [/([\w.-]+@[\w.-]+\.\w+)/],
      product: [
        /(?:interested in|looking for|need|want to buy|I want)\s+([^.\n]{3,50})/i,
        /(?:\u9700\u8981|\u60F3\u4E70|\u8981|\u611F\u5174\u8DA3)\s*[:\uFF1A]?\s*([^\s,\uFF0C\u3002]{2,30})/
      ]
    };

    const updates = {};
    for (const [field, regs] of Object.entries(patterns)) {
      for (const reg of regs) {
        const match = text.match(reg);
        if (match) { updates[field] = match[1].trim(); break; }
      }
    }

    if (Object.keys(updates).length > 0) {
      await CRMStorage.updateAutoInfo(phone, updates);
    }
  }

  // ==================== WhatsApp Business 标签同步 ====================

  /**
   * 从 WhatsApp Business Web 读取当前聊天的标签
   * WhatsApp Business 在聊天列表项和联系信息面板中显示标签
   */
  function readWhatsAppLabels() {
    const labels = [];
    try {
      // 方法1：从聊天列表项中读取标签（当前选中的聊天）
      const activeChatItem = document.querySelector('[data-testid="conversation-item"][class*="selected"]') ||
                             document.querySelector('#pane-side [role="row"][aria-selected="true"]');
      if (activeChatItem) {
        // WhatsApp Business 标签通常是带有特定颜色背景的小元素
        const labelEls = activeChatItem.querySelectorAll('[data-testid*="label"] span, .lx2ni [style*="background-color"]');
        labelEls.forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length < 30 && !labels.includes(text)) {
            labels.push(text);
          }
        });
      }

      // 方法2：从聊天头部区域读取（有些版本在标题旁显示标签）
      const header = document.querySelector('#main header');
      if (header) {
        const headerLabels = header.querySelectorAll('[data-testid*="label"], [class*="label"]');
        headerLabels.forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length < 30 && !labels.includes(text)) {
            labels.push(text);
          }
        });
      }

      // 方法3：从联系信息面板读取（如果打开的话）
      const contactPanel = document.querySelector('[data-testid="contact-info-page-body"]');
      if (contactPanel) {
        const panelLabels = contactPanel.querySelectorAll('[data-testid*="label"] span, [class*="label-text"]');
        panelLabels.forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length < 30 && !labels.includes(text)) {
            labels.push(text);
          }
        });
      }
    } catch (e) {
      console.warn('[WA CRM] Read labels failed:', e);
    }
    return labels;
  }

  /**
   * 尝试将标签同步到 WhatsApp Business（通过 UI 自动化）
   * 注意：这是实验性功能，WhatsApp Web 的 DOM 结构可能变化
   */
  async function syncLabelToWhatsApp(label) {
    try {
      // 尝试打开联系信息面板
      const header = document.querySelector('#main header');
      if (!header) return false;

      // 点击联系信息按钮（通常在头部右侧）
      const infoBtn = header.querySelector('[data-testid="conversation-info-header"]') ||
                      header.querySelector('[title="Contact info"]') ||
                      header.querySelector('[title="联系信息"]');

      // 查找已有的 WhatsApp 标签，避免重复
      const existingLabels = readWhatsAppLabels();
      if (existingLabels.includes(label)) {
        console.log('[WA CRM] Label already exists in WhatsApp:', label);
        return true;
      }

      console.log('[WA CRM] WhatsApp label sync is experimental. Label:', label);
      // 自动化的具体实现依赖 WhatsApp Web 的 DOM 结构
      // 由于 WhatsApp Web 频繁更新，这里仅记录日志
      // 未来可以通过用户反馈适配具体的 DOM 选择器
      return false;
    } catch (e) {
      console.warn('[WA CRM] Sync label to WhatsApp failed:', e);
      return false;
    }
  }

  // ==================== 获取当前聊天信息 ====================

  function getCurrentChatInfo() {
    const header = document.querySelector('#main header');
    if (!header) return null;

    const titleEl = header.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
                    header.querySelector('span[dir="auto"]');
    if (!titleEl) return null;

    const name = titleEl.textContent.trim();
    if (!name) return null;

    let phone = name;
    if (/^[\d+\s()-]{8,}$/.test(name)) {
      phone = name.replace(/[\s()-]/g, '');
      if (!phone.startsWith('+')) phone = '+' + phone;
    }

    return { name, phone };
  }

  // ==================== 工具函数 ====================

  function insertTextToInput(text) {
    const inputBox = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                     document.querySelector('footer div[contenteditable="true"]');
    if (!inputBox) {
      alert('\u627E\u4E0D\u5230\u8F93\u5165\u6846\uFF0C\u8BF7\u786E\u4FDD\u5728\u804A\u5929\u754C\u9762\u4E2D');
      return;
    }
    inputBox.focus();
    document.execCommand('insertText', false, text);
    if (!inputBox.textContent) {
      inputBox.textContent = text;
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function parseTimeInput(str) {
    const now = new Date();
    str = str.trim();

    // 分钟后: "30分钟后", "30 minutes"
    const minMatch = str.match(/(\d+)\s*(分钟|分|min)/i);
    if (minMatch) return now.getTime() + parseInt(minMatch[1]) * 60 * 1000;

    // 小时后: "1小时后", "2 hours"
    const hourMatch = str.match(/(\d+)\s*(小时|时|h)/i);
    if (hourMatch) return now.getTime() + parseInt(hourMatch[1]) * 60 * 60 * 1000;

    // 天后: "3天后", "7 days"
    const daysMatch = str.match(/(\d+)\s*(天|日|days?)/i);
    if (daysMatch) return now.getTime() + parseInt(daysMatch[1]) * 24 * 60 * 60 * 1000;

    // 明天: "明天", "tomorrow", "明天下午3点", "tomorrow 9am"
    const tomorrowMatch = str.match(/(明天|tomorrow)\s*(上午|下午|晚上)?\s*(\d{1,2})?\s*(点|时|am|pm)?/i);
    if (tomorrowMatch) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      let hour = tomorrowMatch[3] ? parseInt(tomorrowMatch[3]) : 9;
      const period = tomorrowMatch[2] || tomorrowMatch[4];
      if (period && (period.includes('下午') || period.includes('晚上') || period.toLowerCase() === 'pm')) {
        if (hour < 12) hour += 12;
      } else if (period && (period.includes('上午') || period.toLowerCase() === 'am')) {
        if (hour === 12) hour = 0;
      }
      d.setHours(hour, 0, 0, 0);
      return d.getTime();
    }

    // 后天: "后天", "day after tomorrow"
    const dayAfterMatch = str.match(/(后天|day after tomorrow)/i);
    if (dayAfterMatch) {
      const d = new Date(now);
      d.setDate(d.getDate() + 2);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    }

    // 下周X: "下周一", "next Monday"
    const weekdayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
    const nextWeekMatch = str.match(/下周([一二三四五六日天])/);
    if (nextWeekMatch) {
      const targetDay = weekdayMap[nextWeekMatch[1]];
      const d = new Date(now);
      const currentDay = d.getDay();
      let daysToAdd = (targetDay - currentDay + 7) % 7;
      if (daysToAdd === 0) daysToAdd = 7;
      d.setDate(d.getDate() + daysToAdd);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    }

    // 周X: "周一", "Monday" (本周或下周)
    const thisWeekMatch = str.match(/周([一二三四五六日天])/);
    if (thisWeekMatch) {
      const targetDay = weekdayMap[thisWeekMatch[1]];
      const d = new Date(now);
      const currentDay = d.getDay();
      let daysToAdd = (targetDay - currentDay + 7) % 7;
      if (daysToAdd === 0) daysToAdd = 7;
      d.setDate(d.getDate() + daysToAdd);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    }

    // 中文日期: "10月20日 14:00", "10月20日下午3点"
    const cnDateMatch = str.match(/(\d{1,2})月(\d{1,2})[日号]?\s*(上午|下午|晚上)?\s*(\d{1,2})?\s*(点|时|:)?\s*(\d{1,2})?/);
    if (cnDateMatch) {
      const month = parseInt(cnDateMatch[1]) - 1;
      const day = parseInt(cnDateMatch[2]);
      let hour = cnDateMatch[4] ? parseInt(cnDateMatch[4]) : 9;
      const min = cnDateMatch[6] ? parseInt(cnDateMatch[6]) : 0;
      const period = cnDateMatch[3];
      if (period && (period.includes('下午') || period.includes('晚上'))) {
        if (hour < 12) hour += 12;
      }
      const d = new Date(now.getFullYear(), month, day, hour, min, 0, 0);
      if (d < now) d.setFullYear(d.getFullYear() + 1);
      return d.getTime();
    }

    // ISO格式: "2026-10-20 14:00", "2026-10-20T14:00"
    const isoMatch = str.match(/(\d{4}-\d{2}-\d{2})[T\s]*(\d{1,2}:\d{2})?/);
    if (isoMatch) {
      const d = new Date(isoMatch[1] + 'T' + (isoMatch[2] || '09:00'));
      if (!isNaN(d.getTime())) return d.getTime();
    }

    // 英文时间: "tomorrow 9am", "tomorrow 3pm"
    const enTimeMatch = str.match(/tomorrow\s*(\d{1,2})\s*(am|pm)?/i);
    if (enTimeMatch) {
      let hour = parseInt(enTimeMatch[1]);
      if (enTimeMatch[2]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(hour, 0, 0, 0);
      return d.getTime();
    }

    return null;
  }

  function formatTime(ts) {
    if (!ts) return '\u672A\u77E5';
    const d = new Date(ts);
    const diff = Date.now() - d;
    if (diff < 60000) return '\u521A\u521A';
    if (diff < 3600000) return Math.floor(diff / 60000) + '\u5206\u949F\u524D';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '\u5C0F\u65F6\u524D';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '\u5929\u524D';
    return d.toLocaleDateString('zh-CN');
  }

  function formatReminderTime(ts) {
    const d = new Date(ts);
    const now = Date.now();
    if (ts < now) return '\u26A0\uFE0F \u5DF2\u8FC7\u671F';
    const diff = ts - now;
    if (diff < 86400000) return '\u4ECA\u5929 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (diff < 172800000) return '\u660E\u5929 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==================== 消息监听（来自 popup） ====================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'QUICK_TAG') {
      const chatInfo = getCurrentChatInfo();
      if (chatInfo) {
        CRMStorage.addTag(chatInfo.phone, msg.tag).then(() => {
          syncLabelToWhatsApp(msg.tag);
          chrome.runtime.sendMessage({ type: 'TAG_ADDED' });
          sendResponse({ ok: true });
        });
      } else {
        sendResponse({ ok: false, error: 'No active chat' });
      }
      return true;
    }
  });

  // ==================== 启动 ====================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
