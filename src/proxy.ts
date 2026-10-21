import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "melouz_session";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // CSRF hardening: mutations on same-origin APIs must not be callable from
  // another site. Cross-origin form/fetch calls always send an Origin header
  // that differs from ours; same-origin navigations and API clients either
  // omit Origin or match it.
  if (pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      const host = request.headers.get("host");
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!originHost || (host && originHost !== host)) {
        return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
      }
    }
  }

  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isProtected =
    pathname.startsWith("/dashboard") ||
    (pathname.startsWith("/api/") &&
      !pathname.startsWith("/api/auth/login") &&
      !pathname.startsWith("/api/auth/signup"));

  if (isAuthPage && hasSession) {
    // A stale/invalid session cookie would otherwise create an infinite
    // /dashboard -> /login -> /dashboard loop. When the dashboard reports a
    // stale session, drop the cookie and let the auth page render.
    if (request.nextUrl.searchParams.get("stale") === "1") {
      const response = NextResponse.next();
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isProtected && !hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    if (pathname !== "/dashboard") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
