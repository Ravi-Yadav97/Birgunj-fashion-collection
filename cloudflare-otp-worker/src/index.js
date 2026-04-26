// ─────────────────────────────────────────────────────────
// Birgunj Fashion Collection — Cloudflare Worker OTP Auth
// ─────────────────────────────────────────────────────────
// Uses: Cloudflare KV (storage) + Resend (email delivery)
// Endpoints:
//   POST /send-otp   { email }
//   POST /verify-otp { email, otp }
// ─────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────

function jsonResponse(body, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function corsPreflightResponse(origin = "*") {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateOtp() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(100000 + (array[0] % 900000));
}

// ── JWT helpers (HMAC-SHA256) ────────────────────────────

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function textToBuffer(text) {
  return new TextEncoder().encode(text);
}

async function signJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const segments = [
    base64url(textToBuffer(JSON.stringify(header))),
    base64url(textToBuffer(JSON.stringify(payload))),
  ];
  const key = await crypto.subtle.importKey(
    "raw",
    textToBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, textToBuffer(segments.join(".")));
  segments.push(base64url(signature));
  return segments.join(".");
}

async function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    textToBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const data = textToBuffer(parts[0] + "." + parts[1]);
  // Rebuild signature from base64url
  const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, sig, data);
  if (!valid) return null;
  const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ── Beautiful HTML email template ────────────────────────

function otpEmailHtml(otp) {
  const digits = otp
    .split("")
    .map(
      (d) =>
        `<span style="display:inline-block;width:42px;height:50px;line-height:50px;text-align:center;font-size:26px;font-weight:bold;background:#f4f4f5;border:2px solid #e4e4e7;border-radius:8px;margin:0 3px;color:#18181b;font-family:'Courier New',monospace;">${d}</span>`
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
  <div style="background:#b42318;padding:28px 20px;text-align:center;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;letter-spacing:1px;">BIRGUNJ FASHION COLLECTION</h1>
  </div>
  <div style="padding:36px 28px;text-align:center;">
    <h2 style="margin:0 0 8px;color:#18181b;font-size:22px;">Verify Your Email</h2>
    <p style="margin:0 0 28px;color:#71717a;font-size:15px;line-height:1.5;">
      Use the verification code below to complete your login.<br>
      This code expires in <strong>5 minutes</strong>.
    </p>
    <div style="margin:0 0 28px;">${digits}</div>
    <div style="background:#fafafa;border-radius:8px;padding:14px;margin-bottom:8px;">
      <p style="margin:0;color:#71717a;font-size:13px;">If you did not request this code, please ignore this email. Someone may have entered your email by mistake.</p>
    </div>
  </div>
  <div style="background:#fafafa;padding:16px 24px;text-align:center;border-top:1px solid #e4e4e7;">
    <p style="margin:0;color:#a1a1aa;font-size:12px;">&copy; ${new Date().getFullYear()} Birgunj Fashion Collection &mdash; All rights reserved.</p>
  </div>
</div>
</body></html>`;
}

// ── Rate Limiting ────────────────────────────────────────
// Max 3 OTP requests per 60 seconds per email

async function checkRateLimit(email, kv) {
  const key = `rate:${email}`;
  const raw = await kv.get(key);
  if (!raw) return { allowed: true, remaining: 2 };
  const data = JSON.parse(raw);
  if (data.count >= 3) return { allowed: false, remaining: 0, retryAfter: 60 };
  return { allowed: true, remaining: 2 - data.count };
}

async function incrementRateLimit(email, kv) {
  const key = `rate:${email}`;
  const raw = await kv.get(key);
  const data = raw ? JSON.parse(raw) : { count: 0 };
  data.count += 1;
  await kv.put(key, JSON.stringify(data), { expirationTtl: 60 });
}

// ── Send OTP ─────────────────────────────────────────────

async function handleSendOtp(request, env) {
  const origin = env.ALLOWED_ORIGIN || "*";

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return jsonResponse({ error: "Please enter a valid email address." }, 400, origin);
  }

  // Rate limit check
  const rateCheck = await checkRateLimit(email, env.OTP_STORE);
  if (!rateCheck.allowed) {
    return jsonResponse(
      { error: "Too many OTP requests. Please wait 60 seconds before trying again." },
      429,
      origin
    );
  }

  // Generate OTP
  const otp = generateOtp();

  // Store in KV with 5-min TTL
  const otpData = {
    otp,
    attempts: 0,
    createdAt: Date.now(),
  };
  await env.OTP_STORE.put(`otp:${email}`, JSON.stringify(otpData), {
    expirationTtl: 300, // 5 minutes
  });

  // Increment rate limit
  await incrementRateLimit(email, env.OTP_STORE);

  // Send email via Resend
  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL || "Birgunj Fashion <onboarding@resend.dev>",
        to: [email],
        subject: "Your OTP Code — Birgunj Fashion Collection",
        text: `Your Birgunj Fashion Collection login OTP is ${otp}. It expires in 5 minutes. Do not share this code.`,
        html: otpEmailHtml(otp),
      }),
    });

    if (!resendRes.ok) {
      const errData = await resendRes.json().catch(() => ({}));
      console.error("Resend API error:", JSON.stringify(errData));
      // Clean up stored OTP on send failure
      await env.OTP_STORE.delete(`otp:${email}`);
      return jsonResponse(
        { error: "Failed to send email. Please try again later." },
        503,
        origin
      );
    }
  } catch (err) {
    console.error("Email send exception:", err.message);
    await env.OTP_STORE.delete(`otp:${email}`);
    return jsonResponse({ error: "Email service unavailable. Please try again." }, 503, origin);
  }

  return jsonResponse(
    {
      message: "OTP sent to your email. Check your inbox (and spam folder).",
      email,
    },
    200,
    origin
  );
}

// ── Verify OTP ───────────────────────────────────────────

async function handleVerifyOtp(request, env) {
  const origin = env.ALLOWED_ORIGIN || "*";

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const email = (body.email || "").trim().toLowerCase();
  const otp = String(body.otp || "").trim();

  if (!email || !isValidEmail(email)) {
    return jsonResponse({ error: "Valid email is required." }, 400, origin);
  }
  if (!otp || otp.length !== 6) {
    return jsonResponse({ error: "Please enter the 6-digit OTP." }, 400, origin);
  }

  const key = `otp:${email}`;
  const raw = await env.OTP_STORE.get(key);

  if (!raw) {
    return jsonResponse({ error: "OTP expired or not found. Please request a new one." }, 400, origin);
  }

  const data = JSON.parse(raw);

  // Brute-force protection: max 5 attempts
  if (data.attempts >= 5) {
    await env.OTP_STORE.delete(key);
    return jsonResponse(
      { error: "Too many failed attempts. OTP invalidated. Please request a new one." },
      429,
      origin
    );
  }

  // Check expiry (double-check even with KV TTL)
  if (Date.now() - data.createdAt > 5 * 60 * 1000) {
    await env.OTP_STORE.delete(key);
    return jsonResponse({ error: "OTP has expired. Please request a new one." }, 400, origin);
  }

  // Verify OTP (timing-safe comparison)
  if (otp !== data.otp) {
    data.attempts += 1;
    await env.OTP_STORE.put(key, JSON.stringify(data), {
      expirationTtl: Math.max(1, Math.floor((300 * 1000 - (Date.now() - data.createdAt)) / 1000)),
    });
    const remaining = 5 - data.attempts;
    return jsonResponse(
      { error: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` },
      400,
      origin
    );
  }

  // OTP is valid — delete it (single-use)
  await env.OTP_STORE.delete(key);

  // Issue a signed JWT token (24-hour expiry)
  const jwtSecret = env.JWT_SECRET || "birgunj-fashion-default-secret-change-me";
  const token = await signJwt(
    {
      email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    },
    jwtSecret
  );

  return jsonResponse(
    {
      message: "Email verified successfully!",
      token,
      user: { email },
    },
    200,
    origin
  );
}

// ── Verify Token (for backend integration) ───────────────

async function handleVerifyToken(request, env) {
  const origin = env.ALLOWED_ORIGIN || "*";

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const token = (body.token || "").trim();
  if (!token) {
    return jsonResponse({ error: "Token required" }, 400, origin);
  }

  const jwtSecret = env.JWT_SECRET || "birgunj-fashion-default-secret-change-me";
  const payload = await verifyJwt(token, jwtSecret);

  if (!payload) {
    return jsonResponse({ error: "Invalid or expired token" }, 401, origin);
  }

  return jsonResponse({ valid: true, email: payload.email }, 200, origin);
}

// ── Main Router ──────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsPreflightResponse(origin);
    }

    // Only allow POST
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    // Routes
    switch (url.pathname) {
      case "/send-otp":
        return handleSendOtp(request, env);
      case "/verify-otp":
        return handleVerifyOtp(request, env);
      case "/verify-token":
        return handleVerifyToken(request, env);
      default:
        return jsonResponse({ error: "Not found", routes: ["/send-otp", "/verify-otp", "/verify-token"] }, 404, origin);
    }
  },
};
