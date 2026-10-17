/**
 * dashboard.js - 管理面板主逻辑
 */

let currentTab = 'overview';
let editingTemplateId = null;
let editingCustomerPhone = null;
let selectedCustomers = new Set();
let batchSelectedCustomers = new Set();

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadCurrentTab();

  // 检查 URL hash 是否指定了 tab
  const hash = window.location.hash.replace('#', '');
  if (hash && document.querySelector(`[data-tab="${hash}"]`)) {
    switchTab(hash);
  }
});

// ==================== 导航 ====================

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.onclick = () => switchTab(item.dataset.tab);
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  loadCurrentTab();
}

async function loadCurrentTab() {
  switch (currentTab) {
    case 'overview': await loadOverview(); break;
    case 'customers': await loadCustomers(); break;
    case 'templates': await loadTemplates(); break;
    case 'reminders': await loadReminders(); break;
    case 'batch': await loadBatch(); break;
    case 'settings': await loadSettings(); break;
  }
}

// ==================== 数据总览 ====================

async function loadOverview() {
  const report = await Analytics.generateReport();

  // 统计卡片
  const statsHtml = `
    <div class="stat-card"><div class="stat-number">${report.overview.totalCustomers}</div><div class="stat-desc">客户总数</div></div>
    <div class="stat-card"><div class="stat-number">${report.overview.weekActive}</div><div class="stat-desc">本周活跃</div></div>
    <div class="stat-card"><div class="stat-number">${report.followUpStats.overdue}</div><div class="stat-desc">过期提醒</div></div>
    <div class="stat-card"><div class="stat-number">${report.followUpStats.pending}</div><div class="stat-desc">待跟进</div></div>
    <div class="stat-card"><div class="stat-number">${report.overview.totalMessages}</div><div class="stat-desc">消息记录</div></div>
    <div class="stat-card"><div class="stat-number">${Object.keys(report.tagDistribution).length}</div><div class="stat-desc">标签数</div></div>
  `;
  document.getElementById('overview-stats').innerHTML = statsHtml;

  // 消息趋势（简易柱状图）
  const trendData = report.dailyTrend;
  const maxVal = Math.max(...Object.values(trendData), 1);
  const trendHtml = Object.entries(trendData).map(([date, count]) => {
    const h = Math.max(2, (count / maxVal) * 120);
    const shortDate = date.slice(5);
    return `<div class="bar-item" title="${date}: ${count}条"><div class="bar" style="height:${h}px"></div><span class="bar-label">${shortDate}</span></div>`;
  }).join('');
  document.getElementById('chart-trend').innerHTML = `<div class="bar-chart">${trendHtml}</div>`;

  // 客户分类
  const cat = report.categoryStats;
  const catHtml = `
    <div class="category-list">
      <div class="category-item"><span class="cat-dot" style="background:#25D366"></span>活跃客户<span class="cat-count">${cat.active}</span></div>
      <div class="category-item"><span class="cat-dot" style="background:#ffa726"></span>沉默客户<span class="cat-count">${cat.dormant}</span></div>
      <div class="category-item"><span class="cat-dot" style="background:#42a5f5"></span>新客户<span class="cat-count">${cat.new}</span></div>
      <div class="category-item"><span class="cat-dot" style="background:#ef5350"></span>VIP<span class="cat-count">${cat.vip}</span></div>
    </div>
  `;
  document.getElementById('chart-category').innerHTML = catHtml;

  // 活跃客户排行
  const topHtml = report.topActiveCustomers.map((c, i) => `
    <div class="rank-item">
      <span class="rank-num">${i + 1}</span>
      <span class="rank-name">${c.name}</span>
      <span class="rank-value">${c.messageCount} 条消息</span>
    </div>
  `).join('');
  document.getElementById('top-customers').innerHTML = topHtml || '<div class="empty-text">暂无数据</div>';

  // 模板排行
  const tplHtml = report.templateRanking.slice(0, 10).map((t, i) => `
    <div class="rank-item">
      <span class="rank-num">${i + 1}</span>
      <span class="rank-name">${t.name}</span>
      <span class="rank-value">${t.usageCount} 次</span>
    </div>
  `).join('');
  document.getElementById('template-ranking').innerHTML = tplHtml || '<div class="empty-text">暂无数据</div>';
}

// ==================== 客户管理 ====================

async function loadCustomers() {
  const customers = await CRMStorage.getAllCustomers();
  const tagStats = await CRMStorage.getTagStats();

  // 标签筛选下拉
  const tagFilter = document.getElementById('customer-tag-filter');
  tagFilter.innerHTML = '<option value="">全部标签</option>' +
    Object.entries(tagStats).map(([tag, count]) =>
      `<option value="${tag}">${tag} (${count})</option>`
    ).join('');

  renderCustomerTable(Object.values(customers));

  // 搜索
  document.getElementById('customer-search').oninput = debounce(async (e) => {
    const q = e.target.value;
    if (q) {
      const results = await CRMStorage.searchCustomers(q);
      renderCustomerTable(results);
    } else {
      const all = await CRMStorage.getAllCustomers();
      renderCustomerTable(Object.values(all));
    }
  }, 300);

  // 标签筛选
  tagFilter.onchange = async (e) => {
    const tag = e.target.value;
    if (tag) {
      const filtered = await CRMStorage.getCustomersByTag(tag);
      renderCustomerTable(filtered);
    } else {
      const all = await CRMStorage.getAllCustomers();
      renderCustomerTable(Object.values(all));
    }
  };

  // 全选
  document.getElementById('select-all-customers').onchange = (e) => {
    const checkboxes = document.querySelectorAll('.customer-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = e.target.checked;
      if (e.target.checked) selectedCustomers.add(cb.dataset.phone);
      else selectedCustomers.delete(cb.dataset.phone);
    });
    updateBatchActions();
  };

  // 导出
  document.getElementById('btn-export-data').onclick = async () => {
    const data = await CRMStorage.exportData();
    downloadFile(data, `whatsapp-crm-${new Date().toISOString().split('T')[0]}.json`);
  };

  // 导入
  document.getElementById('btn-import-data').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      await CRMStorage.importData(text);
      alert('导入成功！');
      loadCustomers();
    };
    input.click();
  };
}

function renderCustomerTable(customers) {
  const tbody = document.getElementById('customers-tbody');
  if (customers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-text">暂无客户数据</td></tr>';
    return;
  }

  tbody.innerHTML = customers.map(c => `
    <tr>
      <td><input type="checkbox" class="customer-checkbox" data-phone="${c.phone}" ${selectedCustomers.has(c.phone) ? 'checked' : ''}></td>
      <td><strong>${c.name || '-'}</strong></td>
      <td>${c.phone}</td>
      <td>${c.company || '-'}</td>
      <td>${(c.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join(' ') || '-'}</td>
      <td>${(c.messages || []).length}</td>
      <td>${formatTime(c.lastActiveAt)}</td>
      <td>
        <button class="btn-sm" onclick="editCustomer('${c.phone}')">编辑</button>
      </td>
    </tr>
  `).join('');

  // 绑定 checkbox 事件
  document.querySelectorAll('.customer-checkbox').forEach(cb => {
    cb.onchange = () => {
      if (cb.checked) selectedCustomers.add(cb.dataset.phone);
      else selectedCustomers.delete(cb.dataset.phone);
      updateBatchActions();
    };
  });
}

function updateBatchActions() {
  const bar = document.getElementById('customer-batch-actions');
  bar.style.display = selectedCustomers.size > 0 ? 'flex' : 'none';
  document.getElementById('selected-count').textContent = `已选 ${selectedCustomers.size} 个`;
}

async function editCustomer(phone) {
  editingCustomerPhone = phone;
  const customer = await CRMStorage.getCustomer(phone);
  if (!customer) return;

  document.getElementById('cust-name').value = customer.name || '';
  document.getElementById('cust-phone').value = customer.phone;
  document.getElementById('cust-company').value = customer.company || '';
  document.getElementById('cust-country').value = customer.country || '';
  document.getElementById('cust-tags').value = (customer.tags || []).join(', ');
  document.getElementById('cust-notes').value = customer.notes || '';

  document.getElementById('customer-modal').style.display = 'flex';

  document.getElementById('btn-save-customer').onclick = async () => {
    await CRMStorage.saveCustomer(phone, {
      name: document.getElementById('cust-name').value,
      company: document.getElementById('cust-company').value,
      country: document.getElementById('cust-country').value,
      tags: document.getElementById('cust-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      notes: document.getElementById('cust-notes').value
    });
    closeCustomerModal();
    loadCustomers();
  };

  document.getElementById('btn-delete-customer').onclick = async () => {
    if (confirm(`确定删除客户 ${customer.name || phone}？`)) {
      await CRMStorage.deleteCustomer(phone);
      closeCustomerModal();
      loadCustomers();
    }
  };
}

function closeCustomerModal() {
  document.getElementById('customer-modal').style.display = 'none';
}

async function batchAddTag() {
  const tag = prompt('输入要添加的标签：');
  if (!tag) return;
  await CRMStorage.batchAddTag([...selectedCustomers], tag.trim());
  selectedCustomers.clear();
  loadCustomers();
}

async function batchDelete() {
  if (!confirm(`确定删除选中的 ${selectedCustomers.size} 个客户？`)) return;
  for (const phone of selectedCustomers) {
    await CRMStorage.deleteCustomer(phone);
  }
  selectedCustomers.clear();
  loadCustomers();
}

// ==================== 话术模板 ====================

async function loadTemplates() {
  const templates = await TemplateManager.getAll();
  const grid = document.getElementById('template-grid');

  grid.innerHTML = templates.map(t => `
    <div class="template-card">
      <div class="template-card-header">
        <span class="template-cat-badge">${t.category}</span>
      </div>
      <h4>${t.name}</h4>
      <p class="template-preview">${t.content.substring(0, 120)}${t.content.length > 120 ? '...' : ''}</p>
      <div class="template-footer">
        <span>使用 ${t.usageCount || 0} 次</span>
        <div class="template-card-actions">
          <button class="btn-tpl-edit" onclick="editTemplate('${t.id}')">编辑</button>
          <button class="btn-tpl-copy" onclick="copyTemplate('${t.id}')">复制</button>
          <button class="btn-tpl-delete" onclick="deleteTemplate('${t.id}')">删除</button>
        </div>
      </div>
    </div>
  `).join('');

  // 新建模板
  document.getElementById('btn-add-template').onclick = () => openTemplateModal();

  // 分类 datalist
  const categories = await TemplateManager.getCategories();
  document.getElementById('category-list').innerHTML =
    categories.map(c => `<option value="${c}">`).join('');
}

function openTemplateModal(id) {
  editingTemplateId = id || null;
  document.getElementById('template-modal-title').textContent = id ? '编辑模板' : '新建模板';
  document.getElementById('template-modal').style.display = 'flex';

  if (id) {
    TemplateManager.getById(id).then(t => {
      document.getElementById('tpl-name').value = t.name;
      document.getElementById('tpl-category').value = t.category;
      document.getElementById('tpl-content').value = t.content;
      updateVariablesHint();
    });
  } else {
    document.getElementById('tpl-name').value = '';
    document.getElementById('tpl-category').value = '';
    document.getElementById('tpl-content').value = '';
    updateVariablesHint();
  }

  document.getElementById('tpl-content').oninput = updateVariablesHint;

  document.getElementById('btn-save-template').onclick = async () => {
    const data = {
      name: document.getElementById('tpl-name').value,
      category: document.getElementById('tpl-category').value,
      content: document.getElementById('tpl-content').value,
      variables: TemplateManager.extractVariables(document.getElementById('tpl-content').value)
    };

    if (!data.name || !data.content) {
      alert('请填写模板名称和内容');
      return;
    }

    if (editingTemplateId) {
      await TemplateManager.update(editingTemplateId, data);
    } else {
      await TemplateManager.add(data);
    }

    closeTemplateModal();
    loadTemplates();
  };
}

function updateVariablesHint() {
  const content = document.getElementById('tpl-content').value;
  const vars = TemplateManager.extractVariables(content);
  document.getElementById('tpl-variables-hint').textContent =
    vars.length > 0 ? vars.map(v => `{{${v}}}`).join(', ') : '暂无变量';
}

function closeTemplateModal() {
  document.getElementById('template-modal').style.display = 'none';
}

async function editTemplate(id) {
  openTemplateModal(id);
}

async function deleteTemplate(id) {
  if (confirm('确定删除这个模板？')) {
    await TemplateManager.remove(id);
    loadTemplates();
  }
}

async function copyTemplate(id) {
  const t = await TemplateManager.getById(id);
  if (t) {
    navigator.clipboard.writeText(t.content);
    await TemplateManager.incrementUsage(id);
    alert('模板已复制到剪贴板');
  }
}

// ==================== 跟进提醒 ====================

async function loadReminders() {
  const customers = await CRMStorage.getAllCustomers();
  const now = Date.now();
  const overdue = [];
  const pending = [];
  const done = [];

  Object.values(customers).forEach(c => {
    (c.reminders || []).forEach(r => {
      const item = { ...r, customerPhone: c.phone, customerName: c.name || c.phone };
      if (r.done) done.push(item);
      else if (r.time < now) overdue.push(item);
      else pending.push(item);
    });
  });

  pending.sort((a, b) => a.time - b.time);
  overdue.sort((a, b) => a.time - b.time);

  document.getElementById('reminders-overdue').innerHTML =
    overdue.length > 0 ? overdue.map(renderReminderItem).join('') : '<div class="empty-text">无过期提醒</div>';
  document.getElementById('reminders-pending').innerHTML =
    pending.length > 0 ? pending.map(renderReminderItem).join('') : '<div class="empty-text">无待跟进</div>';
  document.getElementById('reminders-done').innerHTML =
    done.length > 0 ? done.slice(0, 20).map(renderReminderItem).join('') : '<div class="empty-text">无已完成</div>';
}

function renderReminderItem(r) {
  return `
    <div class="reminder-card ${r.overdue || (!r.done && r.time < Date.now()) ? 'overdue' : ''}">
      <div class="reminder-card-header">
        <strong>${r.customerName}</strong>
        <span>${formatTime(r.time)}</span>
      </div>
      <p>${r.note || '跟进'}</p>
      ${!r.done ? `<button class="btn-sm btn-primary" onclick="markReminderDone('${r.customerPhone}', '${r.id}')">标记完成</button>` : '<span class="done-badge">✅ 已完成</span>'}
    </div>
  `;
}

async function markReminderDone(phone, id) {
  await CRMStorage.completeReminder(phone, id);
  loadReminders();
}

// ==================== 批量操作 ====================

async function loadBatch() {
  const templates = await TemplateManager.getAll();
  const customers = await CRMStorage.getAllCustomers();
  const tagStats = await CRMStorage.getTagStats();

  // 模板选择
  const tplSelect = document.getElementById('batch-template-select');
  tplSelect.innerHTML = '<option value="">选择话术模板...</option>' +
    templates.map(t => `<option value="${t.id}">[${t.category}] ${t.name}</option>`).join('');

  // 标签筛选
  const tagFilter = document.getElementById('batch-tag-filter');
  tagFilter.innerHTML = '<option value="">全部客户</option>' +
    Object.entries(tagStats).map(([tag, count]) =>
      `<option value="${tag}">${tag} (${count})</option>`
    ).join('');

  renderBatchCustomerList(Object.values(customers));

  // 模板选择变化
  tplSelect.onchange = () => updateBatchPreview();

  // 标签筛选
  tagFilter.onchange = async () => {
    const tag = tagFilter.value;
    if (tag) {
      const filtered = await CRMStorage.getCustomersByTag(tag);
      renderBatchCustomerList(filtered);
    } else {
      renderBatchCustomerList(Object.values(customers));
    }
  };

  // 搜索
  document.getElementById('batch-search').oninput = debounce(async (e) => {
    const q = e.target.value;
    if (q) {
      const results = await CRMStorage.searchCustomers(q);
      renderBatchCustomerList(results);
    } else {
      renderBatchCustomerList(Object.values(customers));
    }
  }, 300);

  // 全选
  document.getElementById('batch-select-all').onchange = (e) => {
    const checkboxes = document.querySelectorAll('.batch-customer-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = e.target.checked;
      if (e.target.checked) batchSelectedCustomers.add(cb.dataset.phone);
      else batchSelectedCustomers.delete(cb.dataset.phone);
    });
    updateBatchCount();
    updateBatchPreview();
  };
}

function renderBatchCustomerList(customers) {
  const list = document.getElementById('batch-customer-list');
  list.innerHTML = customers.map(c => `
    <label class="batch-customer-item">
      <input type="checkbox" class="batch-customer-checkbox" data-phone="${c.phone}"
        ${batchSelectedCustomers.has(c.phone) ? 'checked' : ''}>
      <span>${c.name || c.phone}</span>
      <span class="batch-customer-phone">${c.phone}</span>
    </label>
  `).join('');

  list.querySelectorAll('.batch-customer-checkbox').forEach(cb => {
    cb.onchange = () => {
      if (cb.checked) batchSelectedCustomers.add(cb.dataset.phone);
      else batchSelectedCustomers.delete(cb.dataset.phone);
      updateBatchCount();
      updateBatchPreview();
    };
  });
}

function updateBatchCount() {
  document.getElementById('batch-selected-count').textContent = `已选 ${batchSelectedCustomers.size} 个客户`;
}

async function updateBatchPreview() {
  const templateId = document.getElementById('batch-template-select').value;
  const preview = document.getElementById('batch-preview');

  if (!templateId) {
    preview.textContent = '选择模板和客户后预览消息内容';
    return;
  }

  const template = await TemplateManager.getById(templateId);
  if (!template) return;

  // 显示第一个选中客户的预览
  const firstPhone = [...batchSelectedCustomers][0];
  if (!firstPhone) {
    preview.textContent = '请选择至少一个客户';
    return;
  }

  const customer = await CRMStorage.getCustomer(firstPhone);
  const variables = { name: customer?.name || firstPhone };

  // 加载设置中的默认值
  const settings = await CRMStorage.getSettings();
  if (settings.myName) variables.myName = settings.myName;
  if (settings.company) variables.company = settings.company;

  const rendered = TemplateManager.render(template.content, variables);
  preview.textContent = rendered;
}

document.getElementById('btn-batch-send')?.addEventListener('click', async () => {
  const templateId = document.getElementById('batch-template-select').value;
  if (!templateId) { alert('请先选择模板'); return; }
  if (batchSelectedCustomers.size === 0) { alert('请选择至少一个客户'); return; }

  const template = await TemplateManager.getById(templateId);
  const settings = await CRMStorage.getSettings();

  if (!confirm(`将为 ${batchSelectedCustomers.size} 个客户准备消息，每条消息会复制到剪贴板，确认开始？`)) return;

  for (const phone of batchSelectedCustomers) {
    const customer = await CRMStorage.getCustomer(phone);
    const variables = {
      name: customer?.name || phone,
      myName: settings.myName || '',
      company: settings.company || ''
    };

    const rendered = TemplateManager.render(template.content, variables);

    try {
      await navigator.clipboard.writeText(rendered);
      alert(`已复制 ${customer?.name || phone} 的消息到剪贴板\n\n请在 WhatsApp 中按 Ctrl+V 粘贴发送\n\n点击确定继续下一个`);
    } catch (e) {
      console.error('Copy failed:', e);
    }

    // 记录发送
    await CRMStorage.addFollowUp(phone, {
      type: 'batch_send',
      templateId,
      status: 'sent',
      timestamp: Date.now()
    });

    await TemplateManager.incrementUsage(templateId);
  }

  alert('批量操作完成！');
  batchSelectedCustomers.clear();
});

// ==================== 设置 ====================

function renderCustomTags(tags) {
  const container = document.getElementById('custom-tags-list');
  if (!container) return;
  container.innerHTML = tags.map(tag =>
    '<span class="custom-tag-chip">' + tag + '<button data-tag="' + tag + '">&times;</button></span>'
  ).join('');
  container.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      const tagToRemove = btn.dataset.tag;
      const currentSettings = await CRMStorage.getSettings();
      const currentTags = currentSettings.customTags || [];
      const newTags = currentTags.filter(t => t !== tagToRemove);
      await CRMStorage.saveSettings({ ...currentSettings, customTags: newTags });
      renderCustomTags(newTags);
    };
  });
}

async function loadSettings() {
  const settings = await CRMStorage.getSettings();
  document.getElementById('setting-auto-record').checked = settings.autoRecord;
  document.getElementById('setting-check-interval').value = settings.reminderCheckInterval;
  document.getElementById('setting-my-name').value = settings.myName || '';
  document.getElementById('setting-company').value = settings.company || '';
  document.getElementById('setting-ai-url').value = settings.aiApiUrl || '';
  document.getElementById('setting-ai-key').value = settings.aiApiKey || '';
  document.getElementById('setting-ai-model').value = settings.aiModel || 'gpt-3.5-turbo';

  // 自定义标签管理
  const customTags = settings.customTags || ['VIP', '意向客户', '已成交', '待跟进', '新客户'];
  renderCustomTags(customTags);

  document.getElementById('btn-add-tag').onclick = async () => {
    const input = document.getElementById('new-tag-input');
    const newTag = input.value.trim();
    if (!newTag) return;
    const currentSettings = await CRMStorage.getSettings();
    const tags = currentSettings.customTags || ['VIP', '意向客户', '已成交', '待跟进', '新客户'];
    if (!tags.includes(newTag)) {
      tags.push(newTag);
      await CRMStorage.saveSettings({ ...currentSettings, customTags: tags });
      renderCustomTags(tags);
      input.value = '';
    }
  };

  document.getElementById('btn-save-settings').onclick = async () => {
    await CRMStorage.saveSettings({
      autoRecord: document.getElementById('setting-auto-record').checked,
      reminderCheckInterval: parseInt(document.getElementById('setting-check-interval').value),
      myName: document.getElementById('setting-my-name').value,
      company: document.getElementById('setting-company').value,
      aiApiUrl: document.getElementById('setting-ai-url').value,
      aiApiKey: document.getElementById('setting-ai-key').value,
      aiModel: document.getElementById('setting-ai-model').value
    });
    alert('设置已保存');
  };

  document.getElementById('btn-save-ai-settings').onclick = async () => {
    const currentSettings = await CRMStorage.getSettings();
    await CRMStorage.saveSettings({
      ...currentSettings,
      aiApiUrl: document.getElementById('setting-ai-url').value,
      aiApiKey: document.getElementById('setting-ai-key').value,
      aiModel: document.getElementById('setting-ai-model').value
    });
    alert('AI 配置已保存');
  };

  document.getElementById('btn-settings-export').onclick = async () => {
    const data = await CRMStorage.exportData();
    downloadFile(data, `whatsapp-crm-backup-${new Date().toISOString().split('T')[0]}.json`);
  };

  document.getElementById('btn-settings-import').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      await CRMStorage.importData(text);
      alert('导入成功！');
    };
    input.click();
  };

  document.getElementById('btn-reset-templates').onclick = async () => {
    if (confirm('确定重置所有模板为默认？自定义模板会丢失。')) {
      await TemplateManager.resetToDefaults();
      alert('模板已重置');
    }
  };

  // ---- Firebase 同步配置 ----
  const { firebaseConfig } = await chrome.storage.local.get('firebaseConfig');
  if (firebaseConfig) {
    document.getElementById('setting-fb-apikey').value = firebaseConfig.apiKey || '';
    document.getElementById('setting-fb-domain').value = firebaseConfig.authDomain || '';
    document.getElementById('setting-fb-projectid').value = firebaseConfig.projectId || '';
  }

  // 初始化 SyncManager
  if (typeof SyncManager !== 'undefined' && firebaseConfig?.apiKey) {
    await SyncManager.init(firebaseConfig);
    updateSyncStatusUI();
    window.addEventListener('sync-auth-change', updateSyncStatusUI);
  }

  document.getElementById('btn-save-firebase-config').onclick = async () => {
    const config = {
      apiKey: document.getElementById('setting-fb-apikey').value.trim(),
      authDomain: document.getElementById('setting-fb-domain').value.trim(),
      projectId: document.getElementById('setting-fb-projectid').value.trim()
    };
    if (!config.apiKey || !config.projectId) {
      alert('请至少填写 API Key 和 Project ID');
      return;
    }
    await chrome.storage.local.set({ firebaseConfig: config });
    if (typeof SyncManager !== 'undefined') {
      await SyncManager.init(config);
    }
    updateSyncStatusUI();
    alert('同步配置已保存');
  };

  document.getElementById('btn-sync-login').onclick = () => showDashboardLoginModal();
  document.getElementById('btn-sync-logout').onclick = async () => {
    if (typeof SyncManager !== 'undefined') {
      await SyncManager.logout();
      updateSyncStatusUI();
    }
  };

  function updateSyncStatusUI() {
    const section = document.getElementById('sync-status-section');
    const bar = document.getElementById('sync-status-bar');
    const dot = bar.querySelector('.sync-status-dot');
    const text = bar.querySelector('.sync-status-text');
    const actions = document.getElementById('sync-account-actions');
    const btnLogin = document.getElementById('btn-sync-login');
    const btnLogout = document.getElementById('btn-sync-logout');

    const status = typeof SyncManager !== 'undefined' ? SyncManager.getStatus() : {};

    if (status.hasConfig || status.initialized) {
      section.style.display = 'block';
      actions.style.display = 'block';

      if (status.loggedIn) {
        dot.className = 'sync-status-dot online';
        text.textContent = '已登录：' + (status.user?.email || '');
        btnLogin.style.display = 'none';
        btnLogout.style.display = 'inline-block';
      } else {
        dot.className = 'sync-status-dot offline';
        text.textContent = '配置完成，请登录后开始同步';
        btnLogin.style.display = 'inline-block';
        btnLogout.style.display = 'none';
      }
    } else {
      section.style.display = 'none';
    }
  }

  function showDashboardLoginModal() {
    let modal = document.getElementById('dashboard-sync-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dashboard-sync-modal';
      modal.className = 'modal';
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="width:400px">
        <div class="modal-header">
          <h3>☁️ 登录同步账号</h3>
          <button class="modal-close" onclick="this.closest('.modal').style.display='none'">×</button>
        </div>
        <div class="modal-body">
          <div class="wa-crm-auth-tabs" style="display:flex;border-bottom:2px solid #e0e0e0;margin-bottom:16px">
            <button class="wa-crm-auth-tab active" data-auth-tab="login" style="flex:1;padding:10px 0;border:none;background:none;font-size:14px;font-weight:500;color:#075e54;cursor:pointer;border-bottom:2px solid #075e54;margin-bottom:-2px">登录</button>
            <button class="wa-crm-auth-tab" data-auth-tab="register" style="flex:1;padding:10px 0;border:none;background:none;font-size:14px;font-weight:500;color:#999;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px">注册</button>
          </div>
          <div id="dash-auth-login">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="dash-login-email" class="form-group-input" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none" placeholder="your@email.com">
            </div>
            <div class="form-group">
              <label>密码</label>
              <input type="password" id="dash-login-password" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none" placeholder="密码">
            </div>
            <div id="dash-login-error" style="font-size:12px;color:#e53e3e;min-height:16px;margin-bottom:8px"></div>
            <button id="dash-btn-do-login" class="btn-primary" style="width:100%">登录</button>
          </div>
          <div id="dash-auth-register" style="display:none">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="dash-register-email" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none" placeholder="your@email.com">
            </div>
            <div class="form-group">
              <label>密码（至少6位）</label>
              <input type="password" id="dash-register-password" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none" placeholder="密码">
            </div>
            <div id="dash-register-error" style="font-size:12px;color:#e53e3e;min-height:16px;margin-bottom:8px"></div>
            <button id="dash-btn-do-register" class="btn-primary" style="width:100%">注册</button>
          </div>
          <p style="font-size:11px;color:#999;margin-top:16px;line-height:1.6">登录后客户数据会自动同步到云端，其他设备登录同一账号即可获取。</p>
        </div>
      </div>
    `;

    // Tab 切换
    modal.querySelectorAll('.wa-crm-auth-tab').forEach(tab => {
      tab.onclick = () => {
        modal.querySelectorAll('.wa-crm-auth-tab').forEach(t => {
          t.classList.remove('active');
          t.style.color = '#999';
          t.style.borderBottomColor = 'transparent';
        });
        tab.classList.add('active');
        tab.style.color = '#075e54';
        tab.style.borderBottomColor = '#075e54';
        const target = tab.dataset.authTab;
        document.getElementById('dash-auth-login').style.display = target === 'login' ? 'block' : 'none';
        document.getElementById('dash-auth-register').style.display = target === 'register' ? 'block' : 'none';
      };
    });

    // 登录
    document.getElementById('dash-btn-do-login').onclick = async () => {
      const email = document.getElementById('dash-login-email').value.trim();
      const password = document.getElementById('dash-login-password').value;
      const errorEl = document.getElementById('dash-login-error');
      if (!email || !password) { errorEl.textContent = '请填写邮箱和密码'; return; }
      try {
        await SyncManager.login(email, password);
        modal.style.display = 'none';
        updateSyncStatusUI();
      } catch (e) {
        errorEl.textContent = e.code === 'auth/user-not-found' ? '用户不存在' :
          e.code === 'auth/wrong-password' ? '密码错误' :
          e.code === 'auth/invalid-credential' ? '邮箱或密码错误' : '登录失败';
      }
    };

    // 注册
    document.getElementById('dash-btn-do-register').onclick = async () => {
      const email = document.getElementById('dash-register-email').value.trim();
      const password = document.getElementById('dash-register-password').value;
      const errorEl = document.getElementById('dash-register-error');
      if (!email || !password) { errorEl.textContent = '请填写邮箱和密码'; return; }
      if (password.length < 6) { errorEl.textContent = '密码至少需要6位'; return; }
      try {
        await SyncManager.register(email, password);
        modal.style.display = 'none';
        updateSyncStatusUI();
      } catch (e) {
        errorEl.textContent = e.code === 'auth/email-already-in-use' ? '该邮箱已注册' :
          e.code === 'auth/weak-password' ? '密码太短，至少需要6位' : '注册失败';
      }
    };
  }
}

// ==================== 工具函数 ====================

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
  return d.toLocaleDateString('zh-CN');
}

function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
