import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

let db = null;
const isVercel = Boolean(process.env.VERCEL);
const DB_PATH = process.env.DB_PATH || 'delivery.db';

if (!isVercel) {
  try {
    const sqliteModule = await import('sqlite3');
    const sqlite3 = sqliteModule.default || sqliteModule;
    db = new sqlite3.Database(DB_PATH);
  } catch (err) {
    console.warn('⚠️ تعذر تشغيل SQLite محلياً، سيتم الاعتماد على Supabase فقط:', err?.message || err);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pfuwluefmaetpcpjkjbd.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmdXdsdWVmbWFldHBjcGpramJkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQwNzgsImV4cCI6MjA5OTY5MDA3OH0.GbLGNT4mlHJpGN2pNl1pi90wOeC82fVXQ_U4199Pd3s';

export const isSupabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { transport: WebSocket }
    })
  : null;

// الحالات الأساسية للعميل (Customer States)
export const CustomerState = Object.freeze({
  IDLE: 'IDLE',
  AWAITING_MENU_SELECTION: 'AWAITING_MENU_SELECTION',
  SELECTING_RESTAURANT: 'SELECTING_RESTAURANT',
  IN_ORDER_FLOW: 'IN_ORDER_FLOW',
  CONFIRMING_ORDER: 'CONFIRMING_ORDER',
  HUMAN_SUPPORT: 'HUMAN_SUPPORT'
});

// دوال مساعدة للتعامل مع SQLite بأسلوب Promises / Async-Await
export const run = (sql, params = []) => {
  if (!db) return Promise.resolve({ lastID: 0, changes: 0 });
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const get = async (sql, params = []) => {
  if (isSupabaseEnabled) {
    if (sql.includes('orders WHERE id = ?')) {
      const { data } = await supabase.from('orders').select('*').eq('id', params[0]).maybeSingle();
      if (data) return data;
    }
    if (sql.includes('users WHERE phone = ?')) {
      const { data } = await supabase.from('users').select('*').eq('phone', params[0]).maybeSingle();
      if (data) return data;
    }
  }
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
};

export const all = (sql, params = []) => {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
};

// إنشاء الجداول وتهيئة قاعدة البيانات
export const initDB = async () => {
  // 1. تهيئة جداول SQLite المحلية إذا كان السيرفر يدعم كتابة الملفات
  if (db) {
    try {
      await run(`
        CREATE TABLE IF NOT EXISTS users (
          phone TEXT PRIMARY KEY,
          state TEXT NOT NULL DEFAULT 'IDLE',
          last_interaction DATETIME DEFAULT CURRENT_TIMESTAMP,
          current_data TEXT DEFAULT '{}'
        )
      `);

      // إضافة عمود current_data تلقائياً إن كان الجدول منشأ مسبقاً
      try {
        await run(`ALTER TABLE users ADD COLUMN current_data TEXT DEFAULT '{}'`);
      } catch {}


      await run(`
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          category TEXT,
          details TEXT,
          pickup_location TEXT,
          delivery_location TEXT,
          status TEXT DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS restaurants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          area TEXT DEFAULT 'طنطا',
          menu_text TEXT,
          image_url TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (err) {
      console.warn('⚠️ تعذر إنشاء جداول SQLite:', err.message);
    }
  }

  if (isSupabaseEnabled) {
    try {
      const { error } = await supabase.from('restaurants').select('id').limit(1);
      if (error) {
        console.error('⚠️ تعذر الاتصال بـ Supabase، سيتم استخدام SQLite مؤقتاً:', error.message);
      } else {
        console.log(`⚡ تم الاتصال بقاعدة بيانات Supabase بنجاح (${SUPABASE_URL})`);
      }
    } catch (err) {
      console.error('⚠️ خطأ اتصال Supabase:', err.message);
    }
  } else {
    console.log(`📦 تم تهيئة قاعدة بيانات SQLite المحلية (${DB_PATH})`);
  }
};

// إدارة المطاعم والمينيوهات
export const getAllRestaurants = async (onlyActive = false) => {
  if (isSupabaseEnabled) {
    try {
      let query = supabase.from('restaurants').select('*').order('id', { ascending: true });
      if (onlyActive) {
        query = query.eq('is_active', true);
      }
      const { data, error } = await query;
      if (!error && data) {
        return data.map(r => ({ ...r, is_active: r.is_active ? 1 : 0 }));
      }
    } catch (err) {
      console.error('⚠️ خطأ في جلب المطاعم من Supabase:', err.message);
    }
  }

  if (onlyActive) {
    return all(`SELECT * FROM restaurants WHERE is_active = 1 ORDER BY id ASC`);
  }
  return all(`SELECT * FROM restaurants ORDER BY id ASC`);
};

export const getRestaurantById = async (id) => {
  if (isSupabaseEnabled) {
    try {
      const { data, error } = await supabase.from('restaurants').select('*').eq('id', id).maybeSingle();
      if (!error && data) {
        return { ...data, is_active: data.is_active ? 1 : 0 };
      }
      if (!data && !error) return undefined;
    } catch (err) {
      console.error('⚠️ خطأ في جلب المطعم من Supabase:', err.message);
    }
  }
  return get(`SELECT * FROM restaurants WHERE id = ?`, [id]);
};

export const addRestaurant = async ({ name, area = 'طنطا', menu_text = '', image_url = '', is_active = 1 }) => {
  const activeBool = Boolean(is_active);

  if (isSupabaseEnabled) {
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .insert({
          name,
          area,
          menu_text,
          image_url,
          is_active: activeBool
        })
        .select()
        .single();
      if (!error && data) {
        // مزامنة مع SQLite المحلي
        try {
          await run(
            `INSERT INTO restaurants (id, name, area, menu_text, image_url, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
            [data.id, name, area, menu_text, image_url, activeBool ? 1 : 0]
          );
        } catch {}
        return { ...data, is_active: data.is_active ? 1 : 0 };
      }
    } catch (err) {
      console.error('⚠️ خطأ في إضافة المطعم إلى Supabase:', err.message);
    }
  }

  const res = await run(
    `INSERT INTO restaurants (name, area, menu_text, image_url, is_active) VALUES (?, ?, ?, ?, ?)`,
    [name, area, menu_text, image_url, activeBool ? 1 : 0]
  );
  return getRestaurantById(res.lastID);
};

export const updateRestaurant = async (id, { name, area, menu_text, image_url, is_active }) => {
  const activeBool = Boolean(is_active);

  if (isSupabaseEnabled) {
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .update({
          name,
          area,
          menu_text,
          image_url,
          is_active: activeBool
        })
        .eq('id', id)
        .select()
        .single();
      if (!error && data) {
        try {
          await run(
            `UPDATE restaurants SET name = ?, area = ?, menu_text = ?, image_url = ?, is_active = ? WHERE id = ?`,
            [name, area, menu_text, image_url, activeBool ? 1 : 0, id]
          );
        } catch {}
        return { ...data, is_active: data.is_active ? 1 : 0 };
      }
    } catch (err) {
      console.error('⚠️ خطأ في تعديل المطعم في Supabase:', err.message);
    }
  }

  await run(
    `UPDATE restaurants SET name = ?, area = ?, menu_text = ?, image_url = ?, is_active = ? WHERE id = ?`,
    [name, area, menu_text, image_url, activeBool ? 1 : 0, id]
  );
  return getRestaurantById(id);
};

export const toggleRestaurantActive = async (id) => {
  const rest = await getRestaurantById(id);
  if (!rest) return null;
  const newStatus = rest.is_active ? 0 : 1;

  if (isSupabaseEnabled) {
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .update({ is_active: Boolean(newStatus) })
        .eq('id', id)
        .select()
        .single();
      if (!error && data) {
        try { await run(`UPDATE restaurants SET is_active = ? WHERE id = ?`, [newStatus, id]); } catch {}
        return { ...data, is_active: data.is_active ? 1 : 0 };
      }
    } catch (err) {
      console.error('⚠️ خطأ في تغيير حالة المطعم في Supabase:', err.message);
    }
  }

  await run(`UPDATE restaurants SET is_active = ? WHERE id = ?`, [newStatus, id]);
  return { ...rest, is_active: newStatus };
};

export const deleteRestaurant = async (id) => {
  if (isSupabaseEnabled) {
    try {
      await supabase.from('restaurants').delete().eq('id', id);
    } catch (err) {
      console.error('⚠️ خطأ في حذف المطعم من Supabase:', err.message);
    }
  }
  return run(`DELETE FROM restaurants WHERE id = ?`, [id]);
};

// تم إيقاف إضافة المطاعم التجريبية تلقائياً
export const seedDefaultRestaurants = async () => {
  return;
};

// الدوال المساعدة لإدارة الحالات والطلبات
export const getUserState = async (phone) => {
  if (isSupabaseEnabled) {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
      if (!error && data) {
        let orderData = data.current_data ?? data.current_order_data;
        if (typeof orderData === 'string') {
          try { orderData = JSON.parse(orderData); } catch { orderData = {}; }
        }
        return {
          phone: data.phone,
          state: data.state,
          current_data: orderData || {},
          current_order_data: orderData || {},
          last_interaction: data.last_interaction
        };
      }

      // إذا لم يكن العميل مسجلاً، نقوم بإنشائه بحالة IDLE
      if (!data) {
        const newUser = {
          phone,
          state: CustomerState.IDLE,
          current_order_data: {},
          last_interaction: new Date().toISOString()
        };
        try { await supabase.from('users').upsert(newUser); } catch {}
        return {
          ...newUser,
          current_data: {}
        };
      }
    } catch (err) {
      console.error('⚠️ خطأ في getUserState من Supabase:', err.message);
    }
  }

  // Fallback SQLite
  const user = await get(`SELECT * FROM users WHERE phone = ?`, [phone]);
  if (!user) {
    await run(
      `INSERT INTO users (phone, state, current_data, last_interaction) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [phone, CustomerState.IDLE, '{}']
    );
    return {
      phone,
      state: CustomerState.IDLE,
      current_data: {},
      current_order_data: {},
      last_interaction: new Date().toISOString()
    };
  }

  let orderData = {};
  const rawData = user.current_data ?? user.current_order_data ?? '{}';
  try {
    orderData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  } catch {
    orderData = {};
  }

  return {
    ...user,
    current_data: orderData,
    current_order_data: orderData
  };
};

export const setUserState = async (phone, state, data = null) => {
  if (isSupabaseEnabled) {
    try {
      let orderData = data;
      if (orderData === null) {
        const existing = await getUserState(phone);
        orderData = existing.current_data ?? existing.current_order_data;
      }

      const payload = {
        phone,
        state,
        current_order_data: orderData,
        last_interaction: new Date().toISOString()
      };

      const { data: updated, error } = await supabase
        .from('users')
        .upsert(payload)
        .select()
        .single();

      if (!error && updated) {
        let parsed = updated.current_data ?? updated.current_order_data;
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
        }
        return {
          phone: updated.phone,
          state: updated.state,
          current_data: parsed || {},
          current_order_data: parsed || {},
          last_interaction: updated.last_interaction
        };
      }
    } catch (err) {
      console.error('⚠️ خطأ في setUserState في Supabase:', err.message);
    }
  }

  // Fallback SQLite
  const existing = await get(`SELECT * FROM users WHERE phone = ?`, [phone]);
  const serializedData =
    data !== null ? JSON.stringify(data) : (existing?.current_data ?? existing?.current_order_data ?? '{}');

  try {
    await run(
      `INSERT INTO users (phone, state, current_data, last_interaction)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(phone) DO UPDATE SET
         state = excluded.state,
         current_data = excluded.current_data,
         last_interaction = CURRENT_TIMESTAMP`,
      [phone, state, serializedData]
    );
  } catch {
    await run(
      `INSERT INTO users (phone, state, current_order_data, last_interaction)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(phone) DO UPDATE SET
         state = excluded.state,
         current_order_data = excluded.current_order_data,
         last_interaction = CURRENT_TIMESTAMP`,
      [phone, state, serializedData]
    );
  }

  return getUserState(phone);
};

export const resetUserState = async (phone) => {
  return setUserState(phone, CustomerState.IDLE, {});
};

export const getAllOrders = async (limit = 50) => {
  if (isSupabaseEnabled) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('id', { ascending: false })
        .limit(limit);
      if (!error && data) return data;
    } catch (err) {
      console.error('⚠️ خطأ في getAllOrders في Supabase:', err.message);
    }
  }

  // Fallback SQLite
  return await all(`SELECT * FROM orders ORDER BY id DESC LIMIT ?`, [limit]);
};

export const saveOrder = async (phone, orderDetails = {}) => {
  // تنظيف رقم الهاتف وإزالة أي لاحقة LID أو JID لضمان حفظ رقم نظيف
  const cleanPhone = String(phone || '')
    .replace(/@lid/g, '')
    .replace(/@s\.whatsapp\.net/g, '')
    .replace(/@c\.us/g, '')
    .replace(/[^0-9]/g, '');
  const finalPhone = cleanPhone || phone;

  const {
    category = null,
    details = null,
    pickup_location = null,
    delivery_location = null,
    status = 'pending'
  } = orderDetails;

  if (isSupabaseEnabled) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .insert({
          phone: finalPhone,
          category,
          details,
          pickup_location,
          delivery_location,
          status
        })
        .select()
        .single();

      if (!error && data) {
        return {
          id: data.id,
          phone: data.phone,
          category: data.category,
          details: data.details,
          pickup_location: data.pickup_location,
          delivery_location: data.delivery_location,
          status: data.status,
          created_at: data.created_at
        };
      }
    } catch (err) {
      console.error('⚠️ خطأ في saveOrder في Supabase:', err.message);
    }
  }

  // Fallback SQLite
  const result = await run(
    `INSERT INTO orders (phone, category, details, pickup_location, delivery_location, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [finalPhone, category, details, pickup_location, delivery_location, status]
  );

  return {
    id: result.lastID,
    phone: finalPhone,
    category,
    details,
    pickup_location,
    delivery_location,
    status
  };
};

export default {
  CustomerState,
  initDB,
  getUserState,
  setUserState,
  resetUserState,
  saveOrder,
  getAllOrders,
  getAllRestaurants,
  getRestaurantById,
  addRestaurant,
  updateRestaurant,
  toggleRestaurantActive,
  deleteRestaurant,
  run,
  get,
  all,
  raw: db,
  supabase,
  isSupabaseEnabled
};
