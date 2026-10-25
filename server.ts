import { createClient } from "@libsql/client";
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  handleGoogleSession,
  handleGoogleSignIn,
  handleGoogleSignOut,
  //extractIapUserEmail,
} from "./src/services/verify";
import { GlowPayloadSchema, type GlowPayload } from "./src/services/validate";

const port = Number(Bun.env.PORT || Bun.env.PORT || 3000);
const host = Bun.env.HOST || (Bun.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

// Get public keys
const IAP_JWKS_URL = new URL('https://www.gstatic.com/iap/verify/public_key-jwk');
const iapJwks = createRemoteJWKSet(IAP_JWKS_URL);
const issuer = "https://cloud.google.com/iap";

const databaseUrl = Bun.env.TURSO_DATABASE_URL?.trim();
const authToken = Bun.env.TURSO_AUTH_TOKEN?.trim();
const db = databaseUrl
  ? createClient({
      url: databaseUrl,
      authToken: authToken,
    })
  : null;

const EXPECTED_AUDIENCE = '';

export interface IapUser {
  email: string;
  sub: string;
}

export async function authenticateIapRequest(req: Request): Promise<IapUser | null> {
  const jwt = req.headers.get("x-goog-authenticated-user-jwt");
  const rawEmail = req.headers.get("x-goog-authenticated-user-email") || "";
  const headerEmail = rawEmail.replace(/^accounts\.google\.com:/, "").trim();

  const expectedAudience = Bun.env.IAP_AUDIENCE?.trim() || EXPECTED_AUDIENCE;

  if (jwt) {
    try {
      // Verify the token using Google's IAP keys
      const { payload } = await jwtVerify(jwt, iapJwks, {
        issuer: "https://cloud.google.com/iap",
        audience: expectedAudience || undefined,
        algorithms: ["ES256"],
      });

      const email = (typeof payload.email === "string" ? payload.email : "") || headerEmail;
      const sub = typeof payload.sub === "string" ? payload.sub : "";

      if (email) {
        return { email, sub };
      }
    } catch (error) {
      console.error("IAP JWT verification failed:", error);
    }
  }

  // Fallback to IAP email header
  if (headerEmail) {
    return { email: headerEmail, sub: "" };
  }

  return null;
}

const server = Bun.serve({
  hostname: host,
  port,
  routes: {
    "/healthz": {
      GET: () => new Response("OK", { status: 200 }),
    },
    "/api/auth/session": {
    GET: async (req) => {
      // Check IAP header first (production behind IAP)
      const iapUser = await authenticateIapRequest(req);
      if (iapUser) {
        const authenticatedEmail = iapUser.email;
        return Response.json({
          user: {
            email: iapUser.email,
            name: iapUser.email.split("@")[0],
            picture: null,
          },
        });
      }

        // 2. Fall back to local cookie session (for local dev)
        return handleGoogleSession(req);
      },
    },
    "/api/auth/signout": {
      POST: () => handleGoogleSignOut(),
    },
    "/api/glow": {
      POST: async (req) => {
        if (!db) {
          return Response.json(
            { error: "Db missing" },
            { status: 503 },
          );
        }
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
        }

        if (typeof body !== "object" || body === null) {
          return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
        }

        //const payload = body as GlowPayload;
        const parsed = GlowPayloadSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message },
            { status: 400 }
          );
        }
        //GlowPayload
        const payload = parsed.data;


        try {
          const result = await db.execute({
            sql: `INSERT INTO glow_logs (message, locale, timestamp, user_email, created_at, anonymous_id)
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [
              payload.message,
              payload.locale.trim(),
              payload.timestamp,
              payload.user_email,
              payload.created_at,
              payload.anonymous_id,
            ],
          });
          return Response.json(
            { success: true, message: `${result.rowsAffected} row(s) inserted` },
            { status: 201 },
          );
        } catch (error) {
          //console.error("Failed to insert Glow log into Turso.", error);
          return Response.json({ error: "Could not save Glow log." }, { status: 500 });
        }
      },
    },
    "/api/glow/logs": {
      GET: async () => {
        if (!db) {
          return Response.json(
            { error: "No db." },
            { status: 503 },
          );
        }
        try {
          const result = await db.execute(`
            SELECT id, message, user_email, locale, created_at AS last_seen
            FROM glow_logs
            ORDER BY created_at DESC, id DESC
          `);

          return Response.json({
            logs: result.rows.map((row) => ({
              id: Number(row.id),
              message: String(row.message ?? ""),
              userEmail: String(row.user_email ?? ""),
              locale: String(row.locale ?? ""),
              lastSeen: row.last_seen == null ? null : String(row.last_seen),
            })),
          });
        } catch (error) {
          //console.error("Failed to query logs.", error);
          return Response.json(
            { error: "Could not load users." },
            { status: 500 },
          );
        }
      },
    },
  },
  // This handles all page traffic that isn't caught by the '/api/...' definitions above
  async fetch(req) {
    const url = new URL(req.url);

    // Serve static files
    const filePath = `./dist${url.pathname}`;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }
    // SPA Fallback: Any client-side route (/, /glow2) returns dist/index.html
    const indexHtml = Bun.file("./dist/index.html");
    if (await indexHtml.exists()) {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
        
  },
});


console.log(`meetgreet running at http://localhost:${port}`);
