'use server'

import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

export async function getCurrentUser() {
  const userId = cookies().get('session_user_id')?.value
  if (!userId) return null

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, status: true }
    })
    return user
  } catch (error) {
    return null
  }
}

// Schema for registration
const RegisterSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
})

// Schema for login
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function register(prevState: any, formData: FormData) {
  const data = Object.fromEntries(formData)
  const parsed = RegisterSchema.safeParse(data)

  if (!parsed.success) {
    return { success: false, message: 'Invalid data', errors: parsed.error.flatten().fieldErrors }
  }

  const { email, password, fullName } = parsed.data

  try {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return { success: false, message: 'User already exists' }
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        email,
        fullName,
        passwordHash: hashedPassword,
        status: 'active',
      },
    })

    // Set session cookie
    cookies().set('session_user_id', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: '/',
    })

    return { success: true }
  } catch (error) {
    console.error('Registration error:', error)
    return { success: false, message: 'Failed to create user' }
  }
}

export async function login(prevState: any, formData: FormData) {
  const data = Object.fromEntries(formData)
  const parsed = LoginSchema.safeParse(data)

  if (!parsed.success) {
    return { success: false, message: 'Invalid credentials' }
  }

  const { email, password } = parsed.data

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return { success: false, message: 'Invalid credentials' }
    }

    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      return { success: false, message: 'Invalid credentials' }
    }

    // Set session cookie
    cookies().set('session_user_id', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: '/',
    })

    return { success: true }
  } catch (error) {
    console.error('Login error:', error)
    return { success: false, message: 'Something went wrong' }
  }
}

export async function logout() {
  cookies().delete('session_user_id')
  redirect('/login')
}
