import { createClient } from "@libsql/client";
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  handleGoogleSession,
  handleGoogleSignIn,
  handleGoogleSignOut,
  //extractIapUserEmail,
} from "./src/services/verify";
import {  type GlowPayload } from "./src/services/validate";

const port = Number(Bun.env.PORT || Bun.env.PORT || 3000);
const host = Bun.env.VITE_APP_STAGE === "production" ? "0.0.0.0" : (Bun.env.HOST || "127.0.0.1");

// Get public keys
const IAP_JWKS_URL = new URL('https://www.gstatic.com/iap/verify/public_key-jwks');
const iapJwks = createRemoteJWKSet(IAP_JWKS_URL);
const issuer = "https://cloud.google.com/iap";

const databaseUrl = Bun.env.TURSO_DATABASE_URL;
const db = databaseUrl
  ? createClient({
      url: databaseUrl,
      authToken: Bun.env.TURSO_AUTH_TOKEN,
    })
  : null;

const EXPECTED_AUDIENCE = '';

export interface IapUser {
  email: string;
  sub: string;
}

export async function authenticateIapRequest(req: Request): Promise<IapUser | null> {
  const jwt = req.headers.get("x-goog-authenticated-user-jwt");
  if (!jwt) {
    return null;
  }

  const expectedAudience = Bun.env.IAP_AUDIENCE || EXPECTED_AUDIENCE;

  try {
    // Verify the token using Google's IAP keys
    const { payload } = await jwtVerify(jwt, iapJwks, {
      issuer: "https://cloud.google.com/iap",
      audience: expectedAudience || undefined,
      algorithms: ["ES256"],
    });

    const email = typeof payload.email === "string" ? payload.email : "";
    const sub = typeof payload.sub === "string" ? payload.sub : "";

    if (!email) {
      return null;
    }
    //console.log('IAP Token verified successfully:', payload);
    return { email, sub };
  } catch (error) {
    // Token signature mismatch, expired, or invalid audience
    console.error("IAP JWT verification failed:", error);
    return null;
  }
}


const server = Bun.serve({
  hostname: host,
  port,
  routes: {
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

        const payload = body as GlowPayload;

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

    // Core Session Check: Inspect headers for your existing authentication tokens
    const cookieHeader = req.headers.get("Cookie") || "";
    const hasActiveSession = cookieHeader.includes("session_token"); // Adjust string match to match your verify utility cookie key

    // Default Root Path Handling
    if (url.pathname === "/") {
      const indexHtml = Bun.file("./dist/index.html");
      console.log("default");
      if (hasActiveSession) {
        // Logged-in users skip authentication and land straight onto your application workspace
    
        if (await indexHtml.exists()) {
          return new Response(indexHtml, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      } else {
        if(Bun.env.VITE_APP_STAGE === 'development')
        {
          if (await indexHtml.exists()) {
            return new Response(indexHtml, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
        }
        else{
          return new Response("Not Found.", { status: 404 });
        }
        /* Force unauthenticated browser traffic directly to the signin route
        return new Response(null, {
          status: 302,
          headers: { "Location": "/signin.html" },
        });
        */
      }
    }

    // Serve your local frontend static web views safely out of your build/public directory
    if (url.pathname === "/signin.html" || url.pathname === "/index.html") {
      const file = Bun.file(`./public${url.pathname}`);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    return new Response("Not Found", { status: 404 });
        
  },
});


console.log(`meetgreet running at http://localhost:${port}`);
