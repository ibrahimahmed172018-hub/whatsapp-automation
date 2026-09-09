// ==========================================
// db.js — قاعدة البيانات و Prepared Statements
// لو عايز تضيف جدول جديد أو query جديدة، هتجي هنا
// ==========================================

const Database = require('better-sqlite3');
const { DB_PATH, PRIMARY_ADMIN_CHAT_ID } = require('./config');

// ─── Session Maps (in-memory, تُعاد عند restart) ───────────────────────────
// chatId -> { catId, itemName, photos[] }  → لتتبع رفع صور متعددة
const adminMultiPhotos = new Map();
// chatId -> { name, input_type }           → لتتبع خطوات إضافة قسم جديد
const adminNewCategory = new Map();

// ─── Helper Parsers ─────────────────────────────────────────────────────────

/** تحليل image_ids المخزنة كـ JSON array أو string مفرد */
function parseMenuImages(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [raw];
  } catch { return [raw]; }
}

/** تحليل تفاصيل الطلب — يرجع { text, photoId } */
function parseOrderDetails(raw) {
  if (!raw) return { text: '', photoId: null };
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && p.type === 'photo')
      return { text: p.text || 'صورة مرفقة من العميل', photoId: p.fileId };
  } catch {}
  return { text: raw, photoId: null };
}

// ─── Database Setup ──────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  chat_id           INTEGER PRIMARY KEY,
  state             TEXT    NOT NULL DEFAULT 'IDLE',
  selected_category TEXT    DEFAULT NULL,
  pending_details   TEXT    DEFAULT NULL,
  is_admin          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL,
  username    TEXT    DEFAULT '',
  category    TEXT    NOT NULL,
  details     TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  input_type  TEXT NOT NULL DEFAULT 'text',
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS category_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  image_ids    TEXT DEFAULT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS restaurants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  menu_image_id  TEXT    DEFAULT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

// ─── Seed Default Categories ─────────────────────────────────────────────────

db.exec(`
INSERT OR IGNORE INTO categories (id, name, prompt, input_type, sort_order) VALUES
  ('cat_delivery',    '🛵 دليفري وطلبات خاصة',    '🛵 *دليفري وطلبات خاصة*\n\nاكتب تفاصيل طلبك كاملة:\n• العنوان (من أين؟ إلى أين؟)\n• وصف ما تريد إحضاره\n• أي ملاحظات إضافية',                               'text',          1),
  ('cat_restaurants', '🍔 مطاعم طنطا',            '🍔 *مطاعم طنطا*\n\nاكتب طلبك:\n• اسم المطعم (لو عندك تفضيل)\n• الأصناف المطلوبة\n• عنوان التوصيل',                                                          'items',         2),
  ('cat_shopping',    '🛒 تسوق من طنطا',          '🛒 *تسوق من طنطا*\n\nاكتب تفاصيل مشترياتك أو أرسل صورة لقائمة المشتريات:\n• اسم المنتج أو المحل\n• الكمية\n• عنوان التوصيل',                               'photo_or_text', 3),
  ('cat_pharmacy',    '💊 صيدليات وأدوية طنطا',   '💊 *صيدليات وأدوية طنطا*\n\nاكتب طلب الدواء أو أرسل صورة الروشتة:\n• اسم الدواء أو صورة الروشتة\n• عنوان التوصيل\n• رقم التواصل (اختياري)',                'photo_or_text', 4),
  ('cat_shops',       '🏪 محلات المنطقة',         '🏪 *محلات المنطقة*\n\nاكتب ما تريده من المحلات أو اختر المحل من القائمة:\n• اسم المحل أو المنطقة\n• المنتج المطلوب\n• عنوان التوصيل',                       'items',         5),
  ('cat_support',     '📞 خدمة العملاء',          '📞 *خدمة العملاء*\n\nاكتب استفسارك أو مشكلتك وسيتواصل معك فريقنا في أقرب وقت.',                                                                             'text',          6);

INSERT INTO category_items (category_id, name, image_ids, created_at)
  SELECT 'cat_restaurants', name, menu_image_id, created_at FROM restaurants
  WHERE NOT EXISTS (
    SELECT 1 FROM category_items
    WHERE category_items.category_id = 'cat_restaurants'
      AND category_items.name = restaurants.name
  );
`);

// ─── Prepared Statements ─────────────────────────────────────────────────────

const stmts = {
  // ── Users ──
  getUser:    db.prepare('SELECT * FROM users WHERE chat_id = ?'),
  upsertUser: db.prepare(`INSERT INTO users (chat_id, state) VALUES (?, 'IDLE') ON CONFLICT(chat_id) DO NOTHING`),
  setState:   db.prepare('UPDATE users SET state = ? WHERE chat_id = ?'),
  setCategory:db.prepare('UPDATE users SET selected_category = ?, state = ? WHERE chat_id = ?'),
  setPending: db.prepare('UPDATE users SET pending_details = ?, state = ? WHERE chat_id = ?'),
  resetUser:  db.prepare(`UPDATE users SET state='IDLE', selected_category=NULL, pending_details=NULL WHERE chat_id = ?`),
  setAdmin:   db.prepare('UPDATE users SET is_admin = ? WHERE chat_id = ?'),
  getAdmins:  db.prepare('SELECT chat_id FROM users WHERE is_admin = 1'),

  // ── Orders ──
  insertOrder:       db.prepare(`INSERT INTO orders (chat_id, username, category, details, status) VALUES (?, ?, ?, ?, 'pending')`),
  getOrder:          db.prepare('SELECT * FROM orders WHERE id = ?'),
  updateOrderStatus: db.prepare('UPDATE orders SET status = ? WHERE id = ?'),
  lastOrders:        db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 10'),
  countOrders:       db.prepare('SELECT COUNT(*) as total FROM orders'),
  countUsers:        db.prepare('SELECT COUNT(*) as total FROM users'),
  countPending:      db.prepare("SELECT COUNT(*) as total FROM orders WHERE status='pending'"),
  countDelivering:   db.prepare("SELECT COUNT(*) as total FROM orders WHERE status IN ('accepted', 'delivering')"),
  countCompleted:    db.prepare("SELECT COUNT(*) as total FROM orders WHERE status='completed'"),
  countCancelled:    db.prepare("SELECT COUNT(*) as total FROM orders WHERE status='cancelled'"),

  // ── Categories ──
  getCategories:        db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC'),
  getCategory:          db.prepare('SELECT * FROM categories WHERE id = ?'),
  insertCategory:       db.prepare('INSERT INTO categories (id, name, prompt, input_type, sort_order) VALUES (?, ?, ?, ?, ?)'),
  deleteCategory:       db.prepare('DELETE FROM categories WHERE id = ?'),
  updateCategoryPrompt: db.prepare('UPDATE categories SET prompt = ? WHERE id = ?'),
  countCategories:      db.prepare('SELECT COUNT(*) as total FROM categories'),

  // ── Category Items (مطاعم، محلات، إلخ) ──
  getCategoryItems:   db.prepare('SELECT * FROM category_items WHERE category_id = ? ORDER BY id ASC'),
  getCategoryItem:    db.prepare('SELECT * FROM category_items WHERE id = ?'),
  insertCategoryItem: db.prepare('INSERT INTO category_items (category_id, name, image_ids) VALUES (?, ?, ?)'),
  deleteCategoryItem: db.prepare('DELETE FROM category_items WHERE id = ?'),
  countCategoryItems: db.prepare('SELECT COUNT(*) as total FROM category_items WHERE category_id = ?'),
  countAllItems:      db.prepare('SELECT COUNT(*) as total FROM category_items'),
};

// تثبيت حساب الأدمن الأساسي دائماً
stmts.upsertUser.run(PRIMARY_ADMIN_CHAT_ID);
stmts.setAdmin.run(1, PRIMARY_ADMIN_CHAT_ID);

module.exports = { db, stmts, adminMultiPhotos, adminNewCategory, parseMenuImages, parseOrderDetails };
