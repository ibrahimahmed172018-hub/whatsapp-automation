const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { DB_PATH, ADMIN_PHONE } = require('./config');

// إذا كانت قاعدة البيانات في مكان محلي وDB_PATH في مسار دائم جديد، انسخها
const localDb = path.join(__dirname, 'delivery_bot.db');
try { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); } catch {}
if (path.resolve(DB_PATH) !== path.resolve(localDb) && !fs.existsSync(DB_PATH) && fs.existsSync(localDb)) {
  try {
    fs.copyFileSync(localDb, DB_PATH);
    const localWal = path.join(__dirname, 'delivery_bot.db-wal');
    if (fs.existsSync(localWal)) {
      try { fs.copyFileSync(localWal, DB_PATH + '-wal'); } catch {}
    }
    console.log(`📦 تم ترحيل قاعدة البيانات إلى المسار الدائم: ${DB_PATH}`);
  } catch (e) {
    console.error('فشل ترحيل قاعدة البيانات:', e.message);
  }
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Check and migrate schema if old Telegram schema exists
const usersTableInfo = db.pragma('table_info(users)');
const hasPhone = usersTableInfo.some((col) => col.name === 'phone');
if (usersTableInfo.length > 0 && !hasPhone) {
  db.exec(`
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS restaurants;
    DROP TABLE IF EXISTS categories;
    DROP TABLE IF EXISTS category_items;
  `);
}

// Initialize tables according to specified schema
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  phone TEXT PRIMARY KEY,
  state TEXT DEFAULT 'IDLE',
  selected_category TEXT,
  selected_restaurant TEXT,
  pending_details TEXT,
  pending_image TEXT,
  is_admin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT,
  category TEXT,
  restaurant TEXT,
  details TEXT,
  image_url TEXT,
  driver_phone TEXT DEFAULT NULL,
  chat_jid TEXT DEFAULT NULL,
  status TEXT DEFAULT 'NEW',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  menu_url TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

try {
  db.exec('ALTER TABLE orders ADD COLUMN driver_phone TEXT DEFAULT NULL;');
} catch {}
try {
  db.exec('ALTER TABLE orders ADD COLUMN chat_jid TEXT DEFAULT NULL;');
} catch {}

// Seed default restaurants
const initialRestaurants = [
  { name: 'مطعم كرم الشام', menu_url: 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=600' },
  { name: 'كريب زون (Crepe Zone)', menu_url: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600' },
  { name: 'عنتر الكبابجي', menu_url: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600' },
  { name: 'كشري الباشا', menu_url: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=600' },
  { name: 'كريب لافير', menu_url: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600' },
  { name: 'بازوكا', menu_url: 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=600' }
];

const countRow = db.prepare('SELECT COUNT(*) as count FROM restaurants').get();
if (countRow.count === 0) {
  const insertStmt = db.prepare('INSERT INTO restaurants (name, menu_url) VALUES (?, ?)');
  for (const r of initialRestaurants) {
    insertStmt.run(r.name, r.menu_url);
  }
}

// Prepared Statements
const stmts = {
  // Users
  getUser: db.prepare('SELECT * FROM users WHERE phone = ?'),
  upsertUser: db.prepare(`INSERT INTO users (phone, state) VALUES (?, 'IDLE') ON CONFLICT(phone) DO NOTHING`),
  setState: db.prepare('UPDATE users SET state = ? WHERE phone = ?'),
  setSelectedCategory: db.prepare('UPDATE users SET selected_category = ?, state = ? WHERE phone = ?'),
  setSelectedRestaurant: db.prepare('UPDATE users SET selected_restaurant = ?, state = ? WHERE phone = ?'),
  setPendingDetails: db.prepare('UPDATE users SET pending_details = ?, pending_image = ?, state = ? WHERE phone = ?'),
  resetUser: db.prepare(`UPDATE users SET state = 'IDLE', selected_category = NULL, selected_restaurant = NULL, pending_details = NULL, pending_image = NULL WHERE phone = ?`),
  setAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE phone = ?'),
  getAdmins: db.prepare('SELECT phone FROM users WHERE is_admin = 1'),
  countUsers: db.prepare('SELECT COUNT(*) as total FROM users'),

  // Restaurants
  getRestaurants: db.prepare('SELECT * FROM restaurants ORDER BY id ASC'),
  getRestaurantById: db.prepare('SELECT * FROM restaurants WHERE id = ?'),
  insertRestaurant: db.prepare('INSERT INTO restaurants (name, menu_url) VALUES (?, ?)'),
  deleteRestaurant: db.prepare('DELETE FROM restaurants WHERE id = ?'),
  countRestaurants: db.prepare('SELECT COUNT(*) as total FROM restaurants'),

  // Orders
  insertOrder: db.prepare(`INSERT INTO orders (phone, category, restaurant, details, image_url, chat_jid, status) VALUES (?, ?, ?, ?, ?, ?, 'NEW')`),
  getOrder: db.prepare('SELECT * FROM orders WHERE id = ?'),
  updateOrderStatus: db.prepare('UPDATE orders SET status = ? WHERE id = ?'),
  acceptOrder: db.prepare("UPDATE orders SET status = 'accepted', driver_phone = ? WHERE id = ?"),
  lastOrders: db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 10'),
  allOrders: db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 100'),
  deleteOrder: db.prepare('DELETE FROM orders WHERE id = ?'),
  countOrders: db.prepare('SELECT COUNT(*) as total FROM orders'),
  countPending: db.prepare("SELECT COUNT(*) as total FROM orders WHERE status IN ('NEW', 'pending')"),
  countDelivering: db.prepare("SELECT COUNT(*) as total FROM orders WHERE status IN ('accepted', 'delivering')"),
  countCompleted: db.prepare("SELECT COUNT(*) as total FROM orders WHERE status = 'completed'"),
  countCancelled: db.prepare("SELECT COUNT(*) as total FROM orders WHERE status = 'cancelled'"),

  // Settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
};

// Ensure primary admin is seeded
if (ADMIN_PHONE) {
  const adminClean = ADMIN_PHONE.replace(/[^0-9]/g, '');
  stmts.upsertUser.run(adminClean);
  stmts.setAdmin.run(1, adminClean);
  if (adminClean.startsWith('0')) {
    const intl = '20' + adminClean.slice(1);
    stmts.upsertUser.run(intl);
    stmts.setAdmin.run(1, intl);
  }
}

module.exports = { db, stmts };
