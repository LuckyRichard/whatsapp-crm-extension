/**
 * sync.js - Firebase 云同步模块
 * 使用 Firebase Auth + Firestore 实现跨设备数据同步
 * 
 * 架构说明：
 * - chrome.storage.local 仍是主存储（service worker 依赖它读提醒）
 * - Firestore 作为云端备份和同步源
 * - 登录后：拉取 Firestore → 写入 local；监听 Firestore 变化 → 更新 local
 * - 任何本地写操作：同时写入 Firestore
 */

const SyncManager = {
  // Firebase 配置（用户需在设置中填写）
  firebaseConfig: null,
  
  // 状态
  _initialized: false,
  _currentUser: null,
  _listeners: [],
  
  // ==================== 初始化 ====================
  
  /**
   * 检查是否有 Firebase 配置
   */
  hasConfig() {
    return this.firebaseConfig && this.firebaseConfig.apiKey;
  },
  
  /**
   * 设置 Firebase 配置并初始化
   */
  async init(config) {
    if (!config || !config.apiKey) {
      console.warn('[Sync] No Firebase config');
      return false;
    }
    
    this.firebaseConfig = config;
    
    try {
      // 检查 Firebase SDK 是否已加载
      if (typeof firebase === 'undefined') {
        console.error('[Sync] Firebase SDK not loaded');
        return false;
      }
      
      // 初始化 Firebase App（避免重复初始化报错）
      try {
        firebase.initializeApp(config);
      } catch (e) {
        // 已初始化，忽略
        if (e.code !== 'app/duplicate-app') throw e;
      }
      
      this._auth = firebase.auth();
      this._db = firebase.firestore();
      this._initialized = true;
      
      // 监听认证状态
      this._auth.onAuthStateChanged(user => {
        this._currentUser = user;
        if (user) {
          console.log('[Sync] Logged in:', user.email);
          this._onLogin(user.uid);
        } else {
          console.log('[Sync] Logged out');
          this._onLogout();
        }
        // 通知 UI 更新
        window.dispatchEvent(new CustomEvent('sync-auth-change', { detail: { user } }));
      });
      
      return true;
    } catch (e) {
      console.error('[Sync] Init failed:', e);
      return false;
    }
  },
  
  // ==================== 认证 ====================
  
  /**
   * 注册
   */
  async register(email, password) {
    if (!this._initialized) throw new Error('Sync not initialized');
    const cred = await this._auth.createUserWithEmailAndPassword(email, password);
    return cred.user;
  },
  
  /**
   * 登录
   */
  async login(email, password) {
    if (!this._initialized) throw new Error('Sync not initialized');
    const cred = await this._auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },
  
  /**
   * 登出
   */
  async logout() {
    if (!this._initialized) return;
    await this._auth.signOut();
  },
  
  /**
   * 获取当前用户
   */
  getCurrentUser() {
    return this._currentUser;
  },
  
  /**
   * 是否已登录
   */
  isLoggedIn() {
    return !!this._currentUser;
  },
  
  // ==================== 数据同步核心 ====================
  
  /**
   * 登录成功后：从 Firestore 拉取数据到本地
   */
  async _onLogin(uid) {
    try {
      console.log('[Sync] Pulling data from Firestore...');
      
      // 并行拉取所有集合
      const [customersSnap, templatesSnap, settingsSnap] = await Promise.all([
        this._db.collection(`users/${uid}/customers`).get(),
        this._db.collection(`users/${uid}/templates`).get(),
        this._db.doc(`users/${uid}/settings`).get()
      ]);
      
      // 转换 customers
      const customers = {};
      customersSnap.forEach(doc => {
        const data = doc.data();
        if (data.phone) customers[data.phone] = data;
      });
      
      // 转换 templates
      const templates = [];
      templatesSnap.forEach(doc => {
        templates.push({ id: doc.id, ...doc.data() });
      });
      
      // 写入本地存储
      const existing = await chrome.storage.local.get(['customers', 'templates', 'settings']);
      
      // 合并策略：Firestore 优先（首次登录），但保留本地新增的客户
      const mergedCustomers = { ...existing.customers };
      for (const [phone, data] of Object.entries(customers)) {
        if (!mergedCustomers[phone]) {
          mergedCustomers[phone] = data;
        } else {
          // 两边都有，取更新时间较新的
          const localTime = mergedCustomers[phone].updatedAt || 0;
          const remoteTime = data.updatedAt || 0;
          if (remoteTime > localTime) {
            mergedCustomers[phone] = data;
          }
        }
      }
      
      await chrome.storage.local.set({
        customers: mergedCustomers,
        templates: templates.length > 0 ? templates : existing.templates,
        settings: settingsSnap.exists ? { ...existing.settings, ...settingsSnap.data() } : existing.settings
      });
      
      console.log('[Sync] Data pulled:', Object.keys(mergedCustomers).length, 'customers,', templates.length, 'templates');
      
      // 启动实时监听
      this._startListeners(uid);
      
    } catch (e) {
      console.error('[Sync] Pull failed:', e);
    }
  },
  
  /**
   * 登出后：停止监听
   */
  _onLogout() {
    this._stopListeners();
  },
  
  /**
   * 启动 Firestore 实时监听
   */
  _startListeners(uid) {
    this._stopListeners(); // 先清理旧的
    
    // 监听 customers 集合变化
    const customersUnsub = this._db.collection(`users/${uid}/customers`)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added' || change.type === 'modified') {
            const data = change.doc.data();
            if (data.phone) {
              this._updateLocalCustomer(data.phone, data);
            }
          } else if (change.type === 'removed') {
            // 可选：同步删除
          }
        });
      }, err => {
        console.error('[Sync] Customers listener error:', err);
      });
    
    // 监听 templates 集合变化
    const templatesUnsub = this._db.collection(`users/${uid}/templates`)
      .onSnapshot(snapshot => {
        const templates = [];
        snapshot.forEach(doc => {
          templates.push({ id: doc.id, ...doc.data() });
        });
        chrome.storage.local.set({ templates });
      }, err => {
        console.error('[Sync] Templates listener error:', err);
      });
    
    this._listeners = [customersUnsub, templatesUnsub];
  },
  
  /**
   * 停止所有监听
   */
  _stopListeners() {
    this._listeners.forEach(unsub => unsub());
    this._listeners = [];
  },
  
  /**
   * 更新本地单个客户（来自 Firestore 推送）
   */
  async _updateLocalCustomer(phone, data) {
    const { customers = {} } = await chrome.storage.local.get('customers');
    const existing = customers[phone] || {};
    const localTime = existing.updatedAt || 0;
    const remoteTime = data.updatedAt || 0;
    
    // 只在远程更新时才覆盖（避免循环）
    if (remoteTime >= localTime) {
      customers[phone] = { ...existing, ...data, phone };
      await chrome.storage.local.set({ customers });
    }
  },
  
  // ==================== 写入操作（供 storage.js 调用） ====================
  
  /**
   * 保存客户到 Firestore
   */
  async pushCustomer(phone, data) {
    if (!this.isLoggedIn()) return;
    const uid = this._currentUser.uid;
    try {
      await this._db.collection(`users/${uid}/customers`).doc(phone).set(data, { merge: true });
    } catch (e) {
      console.error('[Sync] Push customer failed:', e);
    }
  },
  
  /**
   * 删除客户从 Firestore
   */
  async deleteCustomerFromCloud(phone) {
    if (!this.isLoggedIn()) return;
    const uid = this._currentUser.uid;
    try {
      await this._db.collection(`users/${uid}/customers`).doc(phone).delete();
    } catch (e) {
      console.error('[Sync] Delete customer failed:', e);
    }
  },
  
  /**
   * 保存所有模板到 Firestore
   */
  async pushTemplates(templates) {
    if (!this.isLoggedIn()) return;
    const uid = this._currentUser.uid;
    try {
      const batch = this._db.batch();
      const colRef = this._db.collection(`users/${uid}/templates`);
      
      // 先清空旧数据（简单粗暴但有效）
      const existing = await colRef.get();
      existing.forEach(doc => batch.delete(doc.ref));
      
      // 写入新数据
      templates.forEach(t => {
        const { id, ...data } = t;
        batch.set(colRef.doc(id), data);
      });
      
      await batch.commit();
    } catch (e) {
      console.error('[Sync] Push templates failed:', e);
    }
  },
  
  /**
   * 保存设置到 Firestore
   */
  async pushSettings(settings) {
    if (!this.isLoggedIn()) return;
    const uid = this._currentUser.uid;
    try {
      await this._db.doc(`users/${uid}/settings`).set(settings, { merge: true });
    } catch (e) {
      console.error('[Sync] Push settings failed:', e);
    }
  },
  
  // ==================== 工具 ====================
  
  /**
   * 手动触发全量同步（用于冲突解决或强制刷新）
   */
  async forceSync() {
    if (!this.isLoggedIn()) return;
    const uid = this._currentUser.uid;
    await this._onLogin(uid);
  },
  
  /**
   * 获取同步状态
   */
  getStatus() {
    return {
      initialized: this._initialized,
      loggedIn: this.isLoggedIn(),
      user: this._currentUser ? { email: this._currentUser.email } : null,
      hasConfig: this.hasConfig()
    };
  }
};

// 暴露到全局
if (typeof window !== 'undefined') {
  window.SyncManager = SyncManager;
}
