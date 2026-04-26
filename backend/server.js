const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs/promises");
const fsSync = require("fs");
const crypto = require("crypto");
// nodemailer kept for future features (order confirmations, etc.)
// const nodemailer = require("nodemailer");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ADMIN_PHONE = process.env.ADMIN_PHONE || "9744226927";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Naresh@5454";
// Email config kept for future features (order confirmations)
// const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "brevo";
const WORKER_JWT_SECRET = process.env.WORKER_JWT_SECRET || "birgunj-fashion-default-secret-change-me";

app.use(cors());
app.use(express.json({ limit: "50mb" }));
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
      extraImages: [
        "https://images.unsplash.com/photo-1583391733956-6c78276477e2?auto=format&fit=crop&w=900&q=80",
      ],
      sizes: ["S", "M", "L", "XL"],
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
      extraImages: [
        "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
      ],
      sizes: ["S", "M", "L", "XL"],
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
      extraImages: [
        "https://images.unsplash.com/photo-1519238359922-989348752efb?auto=format&fit=crop&w=900&q=80",
      ],
      sizes: ["2-3Y", "4-5Y", "6-7Y", "8-9Y"],
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
      extraImages: [
        "https://images.unsplash.com/photo-1523779105320-d1cd346ff52b?auto=format&fit=crop&w=900&q=80",
      ],
      sizes: ["Free Size"],
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

const writeDb = async (db) => {
  const content = JSON.stringify(db, null, 2);
  const handle = await fs.open(DB_FILE, "w");
  await handle.writeFile(content, "utf-8");
  await handle.sync();
  await handle.close();
  console.log(`[${now()}] Database hard-synced: ${db.products.length} products.`);
};

function cleanPhone(phone = "") {
  return String(phone).replace(/[^\d+]/g, "").trim();
}

function cleanEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Password Hashing ──────────────────────────────
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHmac("sha256", salt).update(password).digest("hex");
  return { hash, salt };
}

function verifyPassword(password, storedHash, salt) {
  const { hash } = hashPassword(password, salt);
  return hash === storedHash;
}

function validPassword(password) {
  if (!password || password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain a number";
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) return "Password must contain a special character (e.g. @, #, $, !)";
  return null;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt,
  };
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
      size: item.size || null,
      image: product.image,
      lineTotal: Number(product.price) * quantity,
    };
  });
  const subtotal = lines.reduce((sum, item) => sum + item.lineTotal, 0);
  const codCharge = method === "COD" ? Math.round(subtotal * 0.03) : 0;
  return { lines, subtotal, codCharge, total: subtotal + codCharge };
}

// ── Customer Registration ──
app.post("/api/auth/register", async (req, res) => {
  const firstName = String(req.body.firstName || "").trim();
  const lastName = String(req.body.lastName || "").trim();
  const phone = cleanPhone(req.body.phone);
  const email = cleanEmail(req.body.email);
  const password = req.body.password || "";

  if (!firstName) return res.status(400).json({ error: "First name is required" });
  if (!lastName) return res.status(400).json({ error: "Last name is required" });
  if (!phone || phone.length < 7) return res.status(400).json({ error: "Valid mobile number is required" });
  if (!validEmail(email)) return res.status(400).json({ error: "Valid email address is required" });

  const passwordError = validPassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const db = await readDb();
  const existing = db.users.find((u) => u.email === email);
  if (existing) return res.status(409).json({ error: "An account with this email already exists. Please login." });

  const { hash, salt } = hashPassword(password);
  const user = {
    id: uid("usr"),
    firstName,
    lastName,
    phone,
    email,
    passwordHash: hash,
    salt,
    createdAt: now(),
  };
  db.users.push(user);
  await writeDb(db);

  console.log(`✅ New customer registered: ${email}`);
  res.status(201).json({ token: createSession("customer", user.id), user: publicUser(user) });
});

// ── Customer Login ──
app.post("/api/auth/login", async (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = req.body.password || "";

  if (!validEmail(email)) return res.status(400).json({ error: "Valid email address is required" });
  if (!password) return res.status(400).json({ error: "Password is required" });

  const db = await readDb();
  const user = db.users.find((u) => u.email === email);
  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (!verifyPassword(password, user.passwordHash, user.salt)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  console.log(`✅ Customer logged in: ${email}`);
  res.json({ token: createSession("customer", user.id), user: publicUser(user) });
});

// Exchange a Cloudflare Worker JWT for a backend session
app.post("/api/auth/exchange-token", async (req, res) => {
  const workerToken = (req.body.token || "").trim();
  if (!workerToken) return res.status(400).json({ error: "Token required" });

  try {
    // Verify HMAC-SHA256 JWT from Cloudflare Worker
    const parts = workerToken.split(".");
    if (parts.length !== 3) throw new Error("Malformed token");

    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: "Token expired" });
    }

    // Verify signature
    const hmac = crypto.createHmac("sha256", WORKER_JWT_SECRET);
    hmac.update(parts[0] + "." + parts[1]);
    const expectedSig = hmac.digest("base64url");
    if (expectedSig !== parts[2]) {
      return res.status(401).json({ error: "Invalid token signature" });
    }

    const email = cleanEmail(payload.email);
    if (!validEmail(email)) return res.status(400).json({ error: "Invalid email in token" });

    // Find or create user
    const db = await readDb();
    let user = db.users.find((u) => u.email === email);
    if (!user) {
      user = { id: uid("usr"), email, createdAt: now() };
      db.users.push(user);
      await writeDb(db);
    }

    res.json({ token: createSession("customer", user.id), user: publicUser(user) });
  } catch (e) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
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
    extraImages: req.body.extraImages || [],
    sizes: Array.isArray(req.body.sizes) ? req.body.sizes : [],
    stock: Number.isFinite(stock) ? stock : 0,
    featured: Boolean(featured),
    createdAt: now(),
  };
  db.products.push(product);
  await writeDb(db);
  res.status(201).json(product);
});

app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  console.log("=== PUT /api/admin/products/:id ===");
  console.log("Product ID:", req.params.id);
  console.log("Body image:", req.body.image ? req.body.image.substring(0, 60) + "... (" + req.body.image.length + " chars)" : "EMPTY/UNDEFINED");
  console.log("Body extraImages:", Array.isArray(req.body.extraImages) ? req.body.extraImages.map((img, i) => "extra[" + i + "]: " + (img ? img.substring(0, 60) + "... (" + img.length + " chars)" : "EMPTY")) : "NOT AN ARRAY: " + typeof req.body.extraImages);
  console.log("Body keys:", Object.keys(req.body));
  const db = await readDb();
  const product = db.products.find((entry) => entry.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  Object.assign(product, {
    name: req.body.name ?? product.name,
    category: req.body.category ?? product.category,
    price: req.body.price !== undefined ? Number(req.body.price) : product.price,
    description: req.body.description ?? product.description,
    image: req.body.image ?? product.image,
    extraImages: req.body.extraImages !== undefined ? req.body.extraImages : (product.extraImages || []),
    sizes: req.body.sizes !== undefined ? req.body.sizes : (product.sizes || []),
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
    const location = req.body.customer?.location;
    if (location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))) {
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      customer.location = {
        latitude,
        longitude,
        accuracy: Number.isFinite(Number(location.accuracy)) ? Number(location.accuracy) : null,
        mapUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
        capturedAt: now(),
      };
    }
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

// ── Customer Order Cancellation ──
app.post("/api/orders/:id/cancel", requireAuth, async (req, res) => {
  const db = await readDb();
  const order = db.orders.find((entry) => entry.id === req.params.id && entry.userId === req.userId);
  if (!order) return res.status(404).json({ error: "Order not found" });

  // Already cancelled?
  if (order.orderStatus === "Cancelled") {
    return res.status(400).json({ error: "This order is already cancelled" });
  }

  // Check if order has been shipped (Out for delivery, Shipped, Delivered)
  const isShipped = order.tracking.some((t) => 
    t.at && (t.label.toLowerCase().includes("shipped") || 
             t.label.toLowerCase().includes("out for delivery") || 
             t.label.toLowerCase().includes("delivered"))
  );

  if (isShipped) {
    return res.status(400).json({ error: "Cannot cancel — order has already been shipped" });
  }

  // Cancel the order
  order.orderStatus = "Cancelled";
  order.paymentStatus = order.paymentMethod === "COD" ? "Cancelled" : "Refund pending";
  order.cancelledAt = now();
  order.tracking.push({ label: "Order cancelled by customer", at: now() });

  // Update payment record
  db.payments
    .filter((p) => p.orderId === order.id)
    .forEach((p) => {
      p.status = order.paymentStatus;
      p.updatedAt = now();
    });

  await writeDb(db);
  console.log(`❌ Order ${order.id} cancelled by customer`);
  res.json({ message: "Order cancelled successfully", order });
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
  const SSL_KEY_PATH = path.join(__dirname, "server.key");
  const SSL_CERT_PATH = path.join(__dirname, "server.cert");
  
  const isProduction = process.env.NODE_ENV === "production" || process.env.RENDER === "true";

  if (!isProduction && fsSync.existsSync(SSL_KEY_PATH) && fsSync.existsSync(SSL_CERT_PATH)) {
    const options = {
      key: fsSync.readFileSync(SSL_KEY_PATH),
      cert: fsSync.readFileSync(SSL_CERT_PATH),
    };
    https.createServer(options, app).listen(PORT, "0.0.0.0", () => {
      console.log(`BIRGUNJ FASHION COLLECTION running securely at https://localhost:${PORT}`);
      console.log(`For local network, use https://<YOUR-IP>:${PORT}`);
    });
  } else {
    http.createServer(app).listen(PORT, "0.0.0.0", () => {
      console.log(`BIRGUNJ FASHION COLLECTION running at http://localhost:${PORT}`);
      console.log(`NOTE: GPS location requires HTTPS. Generate SSL certs (server.key, server.cert) in the backend directory to enable it.`);
    });
  }
});
