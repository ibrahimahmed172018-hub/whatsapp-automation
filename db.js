const Database = require('better-sqlite3');
const path = require('path');
const { DB_PATH, ADMIN_PHONE } = require('./config');

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
  status TEXT DEFAULT 'NEW',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  menu_url TEXT
);
`);

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
  insertOrder: db.prepare(`INSERT INTO orders (phone, category, restaurant, details, image_url, status) VALUES (?, ?, ?, ?, ?, 'NEW')`),
  getOrder: db.prepare('SELECT * FROM orders WHERE id = ?'),
  updateOrderStatus: db.prepare('UPDATE orders SET status = ? WHERE id = ?'),
  lastOrders: db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 10'),
  countOrders: db.prepare('SELECT COUNT(*) as total FROM orders'),
  countPending: db.prepare("SELECT COUNT(*) as total FROM orders WHERE status IN ('NEW', 'pending')"),
  countDelivering: db.prepare("SELECT COUNT(*) as total FROM orders WHERE status IN ('accepted', 'delivering')"),
  countCompleted: db.prepare("SELECT COUNT(*) as total FROM orders WHERE status = 'completed'"),
  countCancelled: db.prepare("SELECT COUNT(*) as total FROM orders WHERE status = 'cancelled'"),
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
