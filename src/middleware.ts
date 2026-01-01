import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const userId = request.cookies.get('session_user_id')?.value
  const pathname = request.nextUrl.pathname

  // Protect Admin Routes
  if (pathname.startsWith('/admin')) {
    if (!userId) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  // Redirect Logged-In Users away from Auth Pages
  if (userId) {
    if (pathname === '/login' || pathname === '/register') {
      return NextResponse.redirect(new URL('/admin', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/login', '/register'],
}
