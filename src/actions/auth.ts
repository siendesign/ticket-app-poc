'use server'

import prisma from '@/lib/prisma'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { UUID } from '@/types'

export async function loginAction(userId: UUID) {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  })
  
  if (!user) {
    throw new Error('User not found')
  }

  cookies().set('session', JSON.stringify({
    userId: user.id,
    email: user.email,
    name: user.fullName
  }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 // 1 day
  })
}

export async function logoutAction() {
  cookies().delete('session')
}

export async function getCurrentUser() {
  const session = cookies().get('session')
  if (!session) return null
  return JSON.parse(session.value)
}
