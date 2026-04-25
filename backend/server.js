const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ADMIN_PHONE = process.env.ADMIN_PHONE || "9800000000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

const sessions = new Map();

const uid = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
const now = () => new Date().toISOString();
const deliveryDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 8);
  return date.toISOString();
};

const seedData = {
  users: [],
  otps: [],
  products: [
    {
      id: uid("prd"),
      name: "Festive Kurta Set",
      category: "Women",
      price: 3499,
      description: "Soft embroidered kurta set designed for celebrations and family gatherings.",
      image:
        "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=80",
      stock: 18,
      featured: true,
      createdAt: now(),
    },
    {
      id: uid("prd"),
      name: "Classic Denim Jacket",
      category: "Men",
      price: 2499,
      description: "Everyday denim layer with a clean fit and durable stitching.",
      image:
        "https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=900&q=80",
      stock: 14,
      featured: true,
      createdAt: now(),
    },
    {
      id: uid("prd"),
      name: "Kids Party Dress",
      category: "Kids",
      price: 1899,
      description: "Comfortable, bright party wear made for movement and photos.",
      image:
        "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=900&q=80",
      stock: 22,
      featured: true,
      createdAt: now(),
    },
    {
      id: uid("prd"),
      name: "Handcrafted Tote Bag",
      category: "Accessories",
      price: 1299,
      description: "Roomy daily tote with a woven texture and premium handles.",
      image:
        "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80",
      stock: 20,
      featured: false,
      createdAt: now(),
    },
  ],
  orders: [],
  payments: [],
  returns: [],
  chatMessages: [],
  pages: {
    aboutTitle: "About Us",
    about:
      "BIRGUNJ FASHION COLLECTION brings curated fashion, festive wear, and everyday essentials to customers with reliable delivery and personal service.",
    services:
      "We offer fashion retail, assisted shopping, QR payment support, cash on delivery, order tracking, and return/refund handling.",
    contactTitle: "Contact",
    contactText: "Reach us for sizing, payment, delivery, and return/refund queries.",
  },
  settings: {
    qrCode:
      "https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=BIRGUNJ-FASHION-COLLECTION-PAYMENT",
    storePhone: "9800000000",
    storeEmail: "support@birgunjfashion.local",
  },
};

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(seedData, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
}

async function writeDb(db) {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

function cleanPhone(phone = "") {
  return String(phone).replace(/[^\d+]/g, "").trim();
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, phone: user.phone, createdAt: user.createdAt };
}

function createSession(type, subject) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { type, subject, createdAt: Date.now() });
  return token;
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const session = sessions.get(token);
  if (!session || session.type !== "customer") {
    return res.status(401).json({ error: "Customer login required" });
  }
  req.userId = session.subject;
  next();
}

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const session = sessions.get(token);
  if (!session || session.type !== "admin") {
    return res.status(401).json({ error: "Admin login required" });
  }
  next();
}

function orderTotal(items, products, method) {
  const lines = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) throw new Error("Product not found");
    const quantity = Math.max(1, Number(item.quantity) || 1);
    return {
      productId: product.id,
      name: product.name,
      price: Number(product.price),
      quantity,
      image: product.image,
      lineTotal: Number(product.price) * quantity,
    };
  });
  const subtotal = lines.reduce((sum, item) => sum + item.lineTotal, 0);
  const codCharge = method === "COD" ? Math.round(subtotal * 0.03) : 0;
  return { lines, subtotal, codCharge, total: subtotal + codCharge };
}

app.post("/api/auth/request-otp", async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  if (phone.length < 8) return res.status(400).json({ error: "Valid phone number required" });

  const db = await readDb();
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  db.otps = db.otps.filter((record) => record.phone !== phone);
  db.otps.push({ phone, otp, expiresAt: Date.now() + 5 * 60 * 1000, createdAt: now() });
  await writeDb(db);

  res.json({
    message: "OTP generated. Connect an SMS gateway before production.",
    phone,
    demoOtp: otp,
  });
});

app.post("/api/auth/verify-otp", async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  const otp = String(req.body.otp || "").trim();
  const db = await readDb();
  const record = db.otps.find((entry) => entry.phone === phone && entry.otp === otp);
  if (!record || record.expiresAt < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }

  let user = db.users.find((entry) => entry.phone === phone);
  if (!user) {
    user = { id: uid("usr"), phone, createdAt: now() };
    db.users.push(user);
  }
  db.otps = db.otps.filter((entry) => entry.phone !== phone);
  await writeDb(db);

  res.json({ token: createSession("customer", user.id), user: publicUser(user) });
});

app.post("/api/admin/login", (req, res) => {
  if (cleanPhone(req.body.phone) !== ADMIN_PHONE || req.body.password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }
  res.json({ token: createSession("admin", "admin"), admin: { phone: ADMIN_PHONE } });
});

app.get("/api/products", async (_req, res) => {
  const db = await readDb();
  res.json(db.products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post("/api/admin/products", requireAdmin, async (req, res) => {
  const { name, category, description, image, featured } = req.body;
  const price = Number(req.body.price);
  const stock = Number(req.body.stock);
  if (!name || !category || !price || !image) {
    return res.status(400).json({ error: "Name, category, price, and image are required" });
  }
  const db = await readDb();
  const product = {
    id: uid("prd"),
    name,
    category,
    price,
    description: description || "",
    image,
    stock: Number.isFinite(stock) ? stock : 0,
    featured: Boolean(featured),
    createdAt: now(),
  };
  db.products.push(product);
  await writeDb(db);
  res.status(201).json(product);
});

app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const product = db.products.find((entry) => entry.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  Object.assign(product, {
    name: req.body.name ?? product.name,
    category: req.body.category ?? product.category,
    price: req.body.price !== undefined ? Number(req.body.price) : product.price,
    description: req.body.description ?? product.description,
    image: req.body.image ?? product.image,
    stock: req.body.stock !== undefined ? Number(req.body.stock) : product.stock,
    featured: req.body.featured !== undefined ? Boolean(req.body.featured) : product.featured,
    updatedAt: now(),
  });
  await writeDb(db);
  res.json(product);
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  db.products = db.products.filter((entry) => entry.id !== req.params.id);
  await writeDb(db);
  res.json({ message: "Product deleted" });
});

app.get("/api/settings", async (_req, res) => {
  const db = await readDb();
  res.json({ settings: db.settings, pages: db.pages });
});

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const db = await readDb();
  db.settings = { ...db.settings, ...req.body.settings };
  db.pages = { ...db.pages, ...req.body.pages };
  await writeDb(db);
  res.json({ settings: db.settings, pages: db.pages });
});

app.post("/api/orders", requireAuth, async (req, res) => {
  const method = req.body.paymentMethod === "COD" ? "COD" : "ONLINE";
  const db = await readDb();
  try {
    const totals = orderTotal(req.body.items || [], db.products, method);
    if (!totals.lines.length) return res.status(400).json({ error: "Cart is empty" });
    const customer = {
      phone: cleanPhone(req.body.customer?.phone),
      additionalPhone: cleanPhone(req.body.customer?.additionalPhone),
      email: String(req.body.customer?.email || "").trim(),
      address: String(req.body.customer?.address || "").trim(),
    };
    if (!customer.phone || !customer.address) {
      return res.status(400).json({ error: "Phone and address are required" });
    }

    const order = {
      id: uid("ord"),
      userId: req.userId,
      items: totals.lines,
      customer,
      paymentMethod: method,
      paymentReference: String(req.body.paymentReference || "").trim(),
      subtotal: totals.subtotal,
      codCharge: totals.codCharge,
      total: totals.total,
      paymentStatus: method === "COD" ? "Pay on delivery" : "Pending manual verification",
      orderStatus: "Confirmed",
      tracking: [
        { label: "Order confirmed", at: now() },
        { label: "Preparing package", at: null },
        { label: "Out for delivery", at: null },
        { label: "Delivered", at: null },
      ],
      expectedDeliveryDate: deliveryDate(),
      createdAt: now(),
    };
    db.orders.push(order);
    db.payments.push({
      id: uid("pay"),
      orderId: order.id,
      method,
      amount: order.total,
      status: order.paymentStatus,
      createdAt: now(),
    });
    await writeDb(db);
    res.status(201).json({ message: "Order Confirmed", order });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/orders/my", requireAuth, async (req, res) => {
  const db = await readDb();
  res.json(db.orders.filter((order) => order.userId === req.userId).reverse());
});

app.post("/api/returns", requireAuth, async (req, res) => {
  const db = await readDb();
  const order = db.orders.find((entry) => entry.id === req.body.orderId && entry.userId === req.userId);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const request = {
    id: uid("ret"),
    orderId: order.id,
    userId: req.userId,
    reason: req.body.reason || "Other",
    details: req.body.details || "",
    status: "Requested",
    createdAt: now(),
  };
  db.returns.push(request);
  await writeDb(db);
  res.status(201).json(request);
});

app.post("/api/chat", async (req, res) => {
  const db = await readDb();
  const message = {
    id: uid("msg"),
    name: req.body.name || "Customer",
    phone: cleanPhone(req.body.phone),
    message: String(req.body.message || "").slice(0, 500),
    status: "New",
    createdAt: now(),
  };
  if (!message.message) return res.status(400).json({ error: "Message required" });
  db.chatMessages.push(message);
  await writeDb(db);
  res.status(201).json({ message: "Thanks. Our support team will contact you shortly.", chat: message });
});

app.get("/api/admin/orders", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json(db.orders.reverse());
});

app.put("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const order = db.orders.find((entry) => entry.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  order.paymentStatus = req.body.paymentStatus ?? order.paymentStatus;
  order.orderStatus = req.body.orderStatus ?? order.orderStatus;
  if (req.body.trackingLabel) order.tracking.push({ label: req.body.trackingLabel, at: now() });
  db.payments
    .filter((payment) => payment.orderId === order.id)
    .forEach((payment) => {
      payment.status = order.paymentStatus;
      payment.updatedAt = now();
    });
  await writeDb(db);
  res.json(order);
});

app.get("/api/admin/payments", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json(db.payments.reverse());
});

app.get("/api/admin/returns", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json(db.returns.reverse());
});

app.get("/api/admin/chats", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json(db.chatMessages.reverse());
});

app.put("/api/admin/chats/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const message = db.chatMessages.find((entry) => entry.id === req.params.id);
  if (!message) return res.status(404).json({ error: "Chat message not found" });
  message.status = req.body.status || message.status;
  message.updatedAt = now();
  await writeDb(db);
  res.json(message);
});

app.put("/api/admin/returns/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const request = db.returns.find((entry) => entry.id === req.params.id);
  if (!request) return res.status(404).json({ error: "Return request not found" });
  request.status = req.body.status || request.status;
  request.updatedAt = now();
  await writeDb(db);
  res.json(request);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

ensureDb().then(() => {
  app.listen(PORT, () => console.log(`BIRGUNJ FASHION COLLECTION running at http://localhost:${PORT}`));
});
