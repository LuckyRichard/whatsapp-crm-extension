/**
 * analytics.js - 数据统计分析模块
 */

const Analytics = {
  /**
   * 获取总览数据
   */
  async getOverview() {
    const customers = await CRMStorage.getAllCustomers();
    const list = Object.values(customers);
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();

    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

    return {
      totalCustomers: list.length,
      todayActive: list.filter(c => (c.lastActiveAt || 0) >= todayTs).length,
      weekActive: list.filter(c => (c.lastActiveAt || 0) >= weekAgo).length,
      monthActive: list.filter(c => (c.lastActiveAt || 0) >= monthAgo).length,
      pendingReminders: list.reduce((sum, c) =>
        sum + (c.reminders || []).filter(r => !r.done).length, 0),
      taggedCount: list.filter(c => (c.tags || []).length > 0).length,
      withNotes: list.filter(c => c.notes).length,
      totalMessages: list.reduce((sum, c) =>
        sum + (c.messages || []).length, 0)
    };
  },

  /**
   * 获取标签分布
   */
  async getTagDistribution() {
    return CRMStorage.getTagStats();
  },

  /**
   * 获取客户活跃度排行
   */
  async getTopActiveCustomers(limit = 10) {
    const customers = await CRMStorage.getAllCustomers();
    const list = Object.values(customers)
      .map(c => ({
        phone: c.phone,
        name: c.name || c.phone,
        company: c.company,
        messageCount: (c.messages || []).length,
        lastActiveAt: c.lastActiveAt || 0,
        followUpCount: (c.followUps || []).length
      }))
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, limit);
    return list;
  },

  /**
   * 获取每日消息趋势（最近30天）
   */
  async getDailyTrend(days = 30) {
    const customers = await CRMStorage.getAllCustomers();
    const list = Object.values(customers);
    const trend = {};
    const now = Date.now();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      trend[key] = 0;
    }

    list.forEach(c => {
      (c.messages || []).forEach(m => {
        const d = new Date(m.timestamp);
        const key = d.toISOString().split('T')[0];
        if (trend[key] !== undefined) {
          trend[key]++;
        }
      });
    });

    return trend;
  },

  /**
   * 获取模板使用排行
   */
  async getTemplateUsageRanking() {
    const templates = await TemplateManager.getAll();
    return templates
      .filter(t => t.usageCount > 0)
      .sort((a, b) => b.usageCount - a.usageCount);
  },

  /**
   * 获取跟进统计
   */
  async getFollowUpStats() {
    const customers = await CRMStorage.getAllCustomers();
    const list = Object.values(customers);
    let total = 0;
    let completed = 0;
    let overdue = 0;
    const now = Date.now();

    list.forEach(c => {
      (c.reminders || []).forEach(r => {
        total++;
        if (r.done) completed++;
        else if (r.time < now) overdue++;
      });
    });

    return {
      total,
      completed,
      pending: total - completed,
      overdue
    };
  },

  /**
   * 获取客户分类统计
   */
  async getCategoryStats() {
    const customers = await CRMStorage.getAllCustomers();
    const list = Object.values(customers);
    const categories = {
      vip: 0,      // 高价值客户
      active: 0,   // 活跃客户
      dormant: 0,  // 沉默客户
      new: 0       // 新客户
    };
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    list.forEach(c => {
      const lastActive = c.lastActiveAt || 0;
      if (lastActive >= weekAgo) categories.active++;
      else if (lastActive >= monthAgo) categories.dormant++;
      else categories.dormant++;

      if (c.createdAt >= weekAgo) categories.new++;
      if ((c.tags || []).includes('VIP')) categories.vip++;
    });

    return categories;
  },

  /**
   * 生成完整报告
   */
  async generateReport() {
    const [overview, tagDist, topActive, trend, templateRank, followUpStats, categoryStats] = await Promise.all([
      this.getOverview(),
      this.getTagDistribution(),
      this.getTopActiveCustomers(),
      this.getDailyTrend(),
      this.getTemplateUsageRanking(),
      this.getFollowUpStats(),
      this.getCategoryStats()
    ]);

    return {
      overview,
      tagDistribution: tagDist,
      topActiveCustomers: topActive,
      dailyTrend: trend,
      templateRanking: templateRank,
      followUpStats,
      categoryStats,
      generatedAt: Date.now()
    };
  }
};

if (typeof window !== 'undefined') {
  window.Analytics = Analytics;
}
