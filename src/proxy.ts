import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "melouz_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

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
