const fs = require("fs");
const http = require("http");
const path = require("path");

const root = __dirname;
const envPaths = [path.join(root, ".env"), path.join(root, ".env.local")];

envPaths.forEach((envPath) => {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
});

const port = Number(process.env.PORT || 4173);
const allowedEmailDomain = process.env.ALLOWED_EMAIL_DOMAIN || "coastalcrestroofing.com";
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.5";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function readJsonBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anonKey:
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "",
  };
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function verifyCompanyUser(req) {
  if (process.env.AUTH_REQUIRED !== "true") return { ok: true };

  const token = tokenFromRequest(req);
  const { url, anonKey } = supabaseConfig();
  if (!token || !url || !anonKey) {
    return { ok: false, status: 401, message: "Sign in before using the CRM AI." };
  }

  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });
    if (!response.ok) return { ok: false, status: 401, message: "Your CRM session could not be verified." };

    const user = await response.json();
    const email = String(user.email || "").toLowerCase();
    if (!email.endsWith(`@${allowedEmailDomain.toLowerCase()}`)) {
      return { ok: false, status: 403, message: "Use a company email to access the CRM AI." };
    }
    return { ok: true, user: { email, id: user.id || "" } };
  } catch {
    return { ok: false, status: 503, message: "CRM AI sign-in verification is temporarily unavailable." };
  }
}

function authConfigScript() {
  const authConfig = supabaseConfig();
  const config = {
    supabaseUrl: authConfig.url,
    supabaseAnonKey: authConfig.anonKey,
    allowedEmailDomain,
    adminEmails: process.env.ADMIN_EMAILS || process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || "",
    defaultRole: process.env.DEFAULT_AUTH_ROLE || "viewer",
    authRequired: process.env.AUTH_REQUIRED === "true",
    syncEnabled: process.env.SUPABASE_SYNC_ENABLED === "true",
    stateId: process.env.SUPABASE_STATE_ID || "coastal-crest",
  };
  return `window.ROOFLINE_SUPABASE_CONFIG = ${JSON.stringify(config)};`;
}

function assistantInstructions() {
  return [
    "You are CRM AI for a roofing and construction CRM.",
    "Answer in real time using practical, plain English.",
    "Help with roofing sales copy, estimate language, job-scope descriptions, CRM workflows, arithmetic, and general business questions.",
    "Be concise unless the user asks for a detailed explanation.",
    "Do not claim you changed CRM records, sent emails, or uploaded files. If an action is needed inside the app, tell the user what to click or ask them to use the CRM navigation commands.",
    "When drafting customer-facing roofing content, use professional contractor language and avoid overpromising code, insurance, warranty, or legal outcomes.",
  ].join(" ");
}

function assistantInput(prompt, context, history) {
  const safeContext = {
    companyName: context?.companyName || "",
    currentView: context?.currentView || "",
    userRole: context?.userRole || "",
    counts: context?.counts || {},
  };
  const safeHistory = Array.isArray(history)
    ? history
        .slice(-8)
        .map((message) => ({
          role: message?.role === "assistant" ? "assistant" : "user",
          text: String(message?.text || "").slice(0, 1200),
        }))
        .filter((message) => message.text)
    : [];

  return [
    `CRM context:\n${JSON.stringify(safeContext, null, 2)}`,
    safeHistory.length ? `Recent chat:\n${safeHistory.map((message) => `${message.role}: ${message.text}`).join("\n")}` : "",
    `User question:\n${String(prompt || "").slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function responseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  (data?.output || []).forEach((item) => {
    (item?.content || []).forEach((part) => {
      if (typeof part?.text === "string") chunks.push(part.text);
    });
  });
  return chunks.join("").trim();
}

async function handleAssistantRequest(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed", reply: "Use POST for CRM AI messages." });
    return;
  }

  const auth = await verifyCompanyUser(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: "auth", reply: auth.message });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 503, {
      error: "missing_openai_key",
      reply: "The CRM AI is wired up, but OPENAI_API_KEY is not configured on the server yet.",
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: "bad_request", reply: error.message || "Invalid request." });
    return;
  }

  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    sendJson(res, 400, { error: "empty_prompt", reply: "Ask me a question and I will answer it." });
    return;
  }

  try {
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel,
        instructions: assistantInstructions(),
        input: assistantInput(prompt, body.context, body.history),
        max_output_tokens: 900,
      }),
    });
    const data = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      const message = data?.error?.message || "The live AI service could not answer right now.";
      sendJson(res, 502, { error: "openai_error", reply: message });
      return;
    }

    sendJson(res, 200, {
      reply: responseText(data) || "I could not generate an answer for that. Try asking it a different way.",
    });
  } catch {
    sendJson(res, 503, {
      error: "network",
      reply: "The live AI service is temporarily unreachable. Try again in a moment.",
    });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/assistant") {
    handleAssistantRequest(req, res);
    return;
  }

  if (url.pathname === "/auth-config.js") {
    send(res, 200, authConfigScript(), "text/javascript; charset=utf-8");
    return;
  }

  if (url.pathname === "/login/") {
    sendRedirect(res, "/login");
    return;
  }

  if (url.pathname === "/logout/") {
    sendRedirect(res, "/logout");
    return;
  }

  const routes = {
    "/": "/index.html",
    "/login": "/login.html",
    "/logout": "/logout.html",
  };
  const requested = routes[url.pathname] || decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (!path.extname(requested)) {
        fs.readFile(path.join(root, "index.html"), (indexError, indexContent) => {
          if (indexError) {
            send(res, 404, "Not found");
            return;
          }
          send(res, 200, indexContent, types[".html"]);
        });
        return;
      }
      send(res, 404, "Not found");
      return;
    }
    send(res, 200, content, types[path.extname(filePath)] || "application/octet-stream");
  });
});

server.listen(port, () => {
  console.log(`Roofline CRM running at http://localhost:${port}`);
});
