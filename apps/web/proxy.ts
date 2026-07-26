import { NextResponse, type NextRequest } from 'next/server'

/**
 * Pass-through for now.
 *
 * This was `middleware.ts` refreshing the Supabase auth session on every
 * request. Next 16 deprecated the `middleware` convention in favour of
 * `proxy`, and Firebase Auth keeps its session in the client SDK rather than
 * in cookies, so there is nothing to refresh here.
 *
 * Kept as a seam: Phase 4 decides whether the auth guard lives here or stays
 * client-side in the AuthProvider.
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - image assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
