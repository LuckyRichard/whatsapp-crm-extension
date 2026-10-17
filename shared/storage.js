/**
 * storage.js - 客户数据本地存储模块
 * 使用 chrome.storage.local 管理所有客户数据
 */

const CRMStorage = {
  // ==================== 客户管理 ====================

  /**
   * 获取所有客户
   */
  async getAllCustomers() {
    const { customers = {} } = await chrome.storage.local.get('customers');
    return customers;
  },

  /**
   * 根据手机号获取客户
   */
  async getCustomer(phone) {
    const customers = await this.getAllCustomers();
    return customers[phone] || null;
  },

  /**
   * 保存/更新客户
   */
  async saveCustomer(phone, data) {
    const customers = await this.getAllCustomers();
    const existing = customers[phone] || {};
    customers[phone] = {
      ...existing,
      ...data,
      phone,
      updatedAt: Date.now(),
      createdAt: existing.createdAt || Date.now()
    };
    await chrome.storage.local.set({ customers });
    // 云同步：已登录时推送到 Firestore
    if (typeof SyncManager !== 'undefined' && SyncManager.isLoggedIn()) {
      SyncManager.pushCustomer(phone, customers[phone]);
    }
    return customers[phone];
  },

  /**
   * 删除客户
   */
  async deleteCustomer(phone) {
    const customers = await this.getAllCustomers();
    delete customers[phone];
    await chrome.storage.local.set({ customers });
    // 云同步：从 Firestore 删除
    if (typeof SyncManager !== 'undefined' && SyncManager.isLoggedIn()) {
      SyncManager.deleteCustomerFromCloud(phone);
    }
  },

  /**
   * 给客户添加标签
   */
  async addTag(phone, tag) {
    const customer = await this.getCustomer(phone);
    if (!customer) return null;
    const tags = customer.tags || [];
    if (!tags.includes(tag)) {
      tags.push(tag);
      return this.saveCustomer(phone, { tags });
    }
    return customer;
  },

  /**
   * 移除客户标签
   */
  async removeTag(phone, tag) {
    const customer = await this.getCustomer(phone);
    if (!customer) return null;
    const tags = (customer.tags || []).filter(t => t !== tag);
    return this.saveCustomer(phone, { tags });
  },

  /**
   * 添加跟进记录
   */
  async addFollowUp(phone, record) {
    const customer = await this.getCustomer(phone);
    if (!customer) return null;
    const followUps = customer.followUps || [];
    followUps.push({
      ...record,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: Date.now()
    });
    return this.saveCustomer(phone, { followUps });
  },

  /**
   * 设置跟进提醒
   */
  async setReminder(phone, reminder) {
    const customer = await this.getCustomer(phone);
    if (!customer) return null;
    const reminders = customer.reminders || [];
    reminders.push({
      ...reminder,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: Date.now(),
      done: false
    });
    // 通知 background 设置闹钟
    await chrome.runtime.sendMessage({
      type: 'SET_REMINDER',
      phone,
      reminder
    });
    return this.saveCustomer(phone, { reminders });
  },

  /**
   * 完成提醒
   */
  async completeReminder(phone, reminderId) {
    const customer = await this.getCustomer(phone);
    if (!customer) return null;
    const reminders = (customer.reminders || []).map(r => {
      if (r.id === reminderId) r.done = true;
      return r;
    });
    return this.saveCustomer(phone, { reminders });
  },

  /**
   * 添加消息记录（自动记录）
   */
  async addMessageRecord(phone, message) {
    const customer = await this.getCustomer(phone);
    if (!customer) return null;
    const messages = customer.messages || [];
    messages.push({
      ...message,
      timestamp: Date.now()
    });
    // 只保留最近200条消息记录
    if (messages.length > 200) messages.splice(0, messages.length - 200);
    return this.saveCustomer(phone, { messages });
  },

  /**
   * 更新客户自动信息
   */
  async updateAutoInfo(phone, info) {
    const customer = await this.getCustomer(phone);
    if (!customer) return null;
    const autoInfo = customer.autoInfo || {};
    return this.saveCustomer(phone, {
      autoInfo: { ...autoInfo, ...info }
    });
  },

  // ==================== 批量操作 ====================

  /**
   * 批量添加标签
   */
  async batchAddTag(phones, tag) {
    for (const phone of phones) {
      await this.addTag(phone, tag);
    }
  },

  /**
   * 批量发送消息记录
   */
  async addBatchSendRecord(phones, templateId, variables) {
    for (const phone of phones) {
      await this.addFollowUp(phone, {
        type: 'batch_send',
        templateId,
        variables,
        status: 'sent'
      });
    }
  },

  // ==================== 查询 ====================

  /**
   * 按标签筛选客户
   */
  async getCustomersByTag(tag) {
    const customers = await this.getAllCustomers();
    return Object.values(customers).filter(c =>
      (c.tags || []).includes(tag)
    );
  },

  /**
   * 获取有待跟进的客户
   */
  async getCustomersWithPendingReminders() {
    const customers = await this.getAllCustomers();
    const now = Date.now();
    return Object.values(customers).filter(c =>
      (c.reminders || []).some(r => !r.done && r.time <= now)
    );
  },

  /**
   * 获取所有标签及数量
   */
  async getTagStats() {
    const customers = await this.getAllCustomers();
    const stats = {};
    Object.values(customers).forEach(c => {
      (c.tags || []).forEach(tag => {
        stats[tag] = (stats[tag] || 0) + 1;
      });
    });
    return stats;
  },

  /**
   * 搜索客户
   */
  async searchCustomers(query) {
    const customers = await this.getAllCustomers();
    const q = query.toLowerCase();
    return Object.values(customers).filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      (c.tags || []).some(t => t.toLowerCase().includes(q)) ||
      c.notes?.toLowerCase().includes(q)
    );
  },

  // ==================== 设置 ====================

  async getSettings() {
    const { settings = {} } = await chrome.storage.local.get('settings');
    return {
      autoRecord: true,
      reminderCheckInterval: 5, // minutes
      ...settings
    };
  },

  async saveSettings(settings) {
    await chrome.storage.local.set({ settings });
    // 云同步：推送设置到 Firestore
    if (typeof SyncManager !== 'undefined' && SyncManager.isLoggedIn()) {
      SyncManager.pushSettings(settings);
    }
  },

  // ==================== 导出/导入 ====================

  async exportData() {
    const data = await chrome.storage.local.get(null);
    return JSON.stringify(data, null, 2);
  },

  async importData(jsonStr) {
    const data = JSON.parse(jsonStr);
    await chrome.storage.local.set(data);
  }
};

// 兼容 content script 和 popup/dashboard
if (typeof window !== 'undefined') {
  window.CRMStorage = CRMStorage;
}
