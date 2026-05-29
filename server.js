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

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function authConfigScript() {
  const config = {
    supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseAnonKey:
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "",
    allowedEmailDomain,
    adminEmails: process.env.ADMIN_EMAILS || process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || "",
    defaultRole: process.env.DEFAULT_AUTH_ROLE || "viewer",
    authRequired: process.env.AUTH_REQUIRED === "true",
    syncEnabled: process.env.SUPABASE_SYNC_ENABLED === "true",
    stateId: process.env.SUPABASE_STATE_ID || "coastal-crest",
  };
  return `window.ROOFLINE_SUPABASE_CONFIG = ${JSON.stringify(config)};`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
