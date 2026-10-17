/**
 * templates.js - 话术模板管理模块
 * 支持变量替换、分类管理
 */

const TemplateManager = {
  // 默认模板
  defaultTemplates: [
    {
      id: 'greeting',
      name: '初次问候',
      category: '开场白',
      content: 'Hi {{name}}! Thank you for reaching out. This is {{myName}} from {{company}}. How can I help you today?',
      variables: ['name', 'myName', 'company'],
      usageCount: 0
    },
    {
      id: 'follow_up',
      name: '跟进客户',
      category: '跟进',
      content: 'Hi {{name}}, this is {{myName}}. I wanted to follow up on our conversation about {{product}}. Do you have any questions or need more information?',
      variables: ['name', 'myName', 'product'],
      usageCount: 0
    },
    {
      id: 'quote',
      name: '发送报价',
      category: '报价',
      content: 'Hi {{name}}, thank you for your interest! Here is the quotation for {{product}}:\n\n{{details}}\n\nPrice: {{price}}\nMOQ: {{moq}}\nLead time: {{leadTime}}\n\nPlease let me know if you have any questions!',
      variables: ['name', 'product', 'details', 'price', 'moq', 'leadTime'],
      usageCount: 0
    },
    {
      id: 'catalog',
      name: '发送产品目录',
      category: '产品',
      content: 'Hi {{name}}! I\'d like to share our latest catalog with you. We have a wide range of {{category}} products. Please check the attached file and let me know which items interest you!',
      variables: ['name', 'category'],
      usageCount: 0
    },
    {
      id: 'sample',
      name: '样品确认',
      category: '样品',
      content: 'Hi {{name}}, the sample for {{product}} has been sent out. Tracking number: {{tracking}}. It should arrive in about {{days}} days. Please let me know once you receive it!',
      variables: ['name', 'product', 'tracking', 'days'],
      usageCount: 0
    },
    {
      id: 'order_confirm',
      name: '订单确认',
      category: '订单',
      content: 'Hi {{name}}, thank you for your order! Here are the details:\n\nOrder: {{orderNo}}\nProduct: {{product}}\nQuantity: {{quantity}}\nTotal: {{total}}\n\nWe will start production right away. I\'ll keep you updated on the progress!',
      variables: ['name', 'orderNo', 'product', 'quantity', 'total'],
      usageCount: 0
    },
    {
      id: 'shipping',
      name: '发货通知',
      category: '物流',
      content: 'Hi {{name}}, good news! Your order {{orderNo}} has been shipped.\n\nTracking: {{tracking}}\nCarrier: {{carrier}}\nEstimated delivery: {{eta}}\n\nPlease track your shipment and let me know if you need any help!',
      variables: ['name', 'orderNo', 'tracking', 'carrier', 'eta'],
      usageCount: 0
    },
    {
      id: 'payment_remind',
      name: '催付款',
      category: '付款',
      content: 'Hi {{name}}, hope you\'re doing well! Just a friendly reminder about the payment for order {{orderNo}} ({{amount}}). Could you please arrange the payment at your earliest convenience? Let me know if you need the invoice again!',
      variables: ['name', 'orderNo', 'amount'],
      usageCount: 0
    },
    {
      id: 'holiday',
      name: '节日问候',
      category: '关系维护',
      content: 'Hi {{name}}! {{holiday}} is coming, and I want to wish you and your family a wonderful holiday season! Looking forward to our continued partnership in the new year!',
      variables: ['name', 'holiday'],
      usageCount: 0
    },
    {
      id: 'reconnect',
      name: '重新激活',
      category: '关系维护',
      content: 'Hi {{name}}, it\'s been a while since we last talked! This is {{myName}} from {{company}}. We recently launched some new {{category}} products that I think you\'d be interested in. Would you like me to send you the catalog?',
      variables: ['name', 'myName', 'company', 'category'],
      usageCount: 0
    }
  ],

  /**
   * 获取所有模板
   */
  async getAll() {
    const { templates } = await chrome.storage.local.get('templates');
    if (!templates) {
      // 首次使用，初始化默认模板
      await this.saveAll(this.defaultTemplates);
      return this.defaultTemplates;
    }
    return templates;
  },

  /**
   * 保存所有模板
   */
  async saveAll(templates) {
    await chrome.storage.local.set({ templates });
    // 云同步：推送模板到 Firestore
    if (typeof SyncManager !== 'undefined' && SyncManager.isLoggedIn()) {
      SyncManager.pushTemplates(templates);
    }
  },

  /**
   * 添加模板
   */
  async add(template) {
    const templates = await this.getAll();
    template.id = template.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    template.usageCount = 0;
    template.createdAt = Date.now();
    templates.push(template);
    await this.saveAll(templates);
    return template;
  },

  /**
   * 更新模板
   */
  async update(id, data) {
    const templates = await this.getAll();
    const idx = templates.findIndex(t => t.id === id);
    if (idx === -1) return null;
    templates[idx] = { ...templates[idx], ...data };
    await this.saveAll(templates);
    return templates[idx];
  },

  /**
   * 删除模板
   */
  async remove(id) {
    const templates = await this.getAll();
    const filtered = templates.filter(t => t.id !== id);
    await this.saveAll(filtered);
  },

  /**
   * 根据ID获取模板
   */
  async getById(id) {
    const templates = await this.getAll();
    return templates.find(t => t.id === id) || null;
  },

  /**
   * 按分类获取模板
   */
  async getByCategory(category) {
    const templates = await this.getAll();
    return templates.filter(t => t.category === category);
  },

  /**
   * 获取所有分类
   */
  async getCategories() {
    const templates = await this.getAll();
    const cats = new Set(templates.map(t => t.category));
    return [...cats];
  },

  /**
   * 渲染模板（变量替换）
   */
  render(templateContent, variables) {
    return templateContent.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] || match;
    });
  },

  /**
   * 提取模板中的变量
   */
  extractVariables(content) {
    const matches = content.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
  },

  /**
   * 增加使用次数
   */
  async incrementUsage(id) {
    const templates = await this.getAll();
    const t = templates.find(t => t.id === id);
    if (t) {
      t.usageCount = (t.usageCount || 0) + 1;
      await this.saveAll(templates);
    }
  },

  /**
   * 重置为默认模板
   */
  async resetToDefaults() {
    await this.saveAll(this.defaultTemplates);
  }
};

if (typeof window !== 'undefined') {
  window.TemplateManager = TemplateManager;
}
