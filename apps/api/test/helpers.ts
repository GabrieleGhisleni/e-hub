import { SignJWT } from "jose";
import { SESSION_AUDIENCE, SESSION_ISSUER } from "../src/auth.ts";

export async function sessionToken(
  secret: string,
  claims: { sub?: string; email?: string; aud?: string; iss?: string; exp?: string } = {},
): Promise<string> {
  return new SignJWT({ email: claims.email ?? "me@example.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub ?? "u1")
    .setIssuer(claims.iss ?? SESSION_ISSUER)
    .setAudience(claims.aud ?? SESSION_AUDIENCE)
    .setExpirationTime(claims.exp ?? "1h")
    .sign(new TextEncoder().encode(secret));
}
