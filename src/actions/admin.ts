'use server'

import prisma from '@/lib/prisma'
import { unstable_noStore as noStore, revalidatePath } from 'next/cache'
import { createEvent } from '@/lib/db/events'
import { bulkRefundEventBookings, refundBooking } from '@/lib/db/seats'
import { publishBookingEvent, publishBookingEventBatch } from '@/lib/kafka/producer'
import { getCurrentUser } from './auth'
import { CreateEventRequest, CreateEventResponse } from '@/types'

export async function getAdminData() {
  noStore() // Disable caching for admin data
  
  const [users, events, seats, bookings] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.event.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.seat.findMany({ orderBy: [
      { section: 'asc' },
      { rowName: 'asc' },
      { seatNumber: 'asc' }
    ] }),
    prisma.booking.findMany({ orderBy: { bookedAt: 'desc' } })
  ])

  // Convert Decimals to numbers for serializability if needed
  const serializedSeats = seats.map((seat: any) => ({
    ...seat,
    priceMultiplier: seat.priceMultiplier.toNumber()
  }))

  // Analytics Computation
  const totalRevenue = bookings
    .filter((b: any) => b.status === 'confirmed')
    .reduce((sum: number, b: any) => sum + b.priceCents, 0)
  
  const totalSeats = seats.length
  const bookedSeats = seats.filter((s: any) => s.status === 'booked').length
  const heldSeats = seats.filter((s: any) => s.status === 'held').length
  const occupancyRate = totalSeats > 0 ? (bookedSeats / totalSeats) * 100 : 0

  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const recentBookings = bookings.filter((b: any) => b.bookedAt > oneHourAgo).length

  return {
    users,
    events,
    seats: serializedSeats,
    bookings,
    analytics: {
      totalRevenueCents: totalRevenue,
      occupancyRate,
      bookedCount: bookedSeats,
      heldCount: heldSeats,
      totalCount: totalSeats,
      recentVelocityPerHour: recentBookings
    }
  }
}

export async function getAnalyticsSummary() {
  noStore()
  
  const [seats, bookings] = await Promise.all([
    prisma.seat.findMany({ select: { status: true } }),
    prisma.booking.findMany({ 
      where: { bookedAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
      select: { status: true, priceCents: true, bookedAt: true }
    })
  ])

  // Get total confirmed revenue (we need all bookings for this, or a separate sum query)
  // For total revenue, it's better to do a sum query if possible
  const totalRevenueResult = await prisma.booking.aggregate({
    where: { status: 'confirmed' },
    _sum: { priceCents: true }
  })

  const totalSeats = seats.length
  const bookedSeats = seats.filter((s: any) => s.status === 'booked').length
  const heldSeats = seats.filter((s: any) => s.status === 'held').length
  const occupancyRate = totalSeats > 0 ? (bookedSeats / totalSeats) * 100 : 0

  return {
    totalRevenueCents: totalRevenueResult._sum.priceCents || 0,
    occupancyRate,
    bookedCount: bookedSeats,
    heldCount: heldSeats,
    totalCount: totalSeats,
    recentVelocityPerHour: bookings.length // already filtered to last hour
  }
}

export async function createEventAction(request: CreateEventRequest): Promise<CreateEventResponse> {
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: { code: 'UNAUTHORIZED', message: 'You must be logged in as an admin' } }
  }

  try {
    const event = await createEvent({
      ...request,
      createdById: user.id,
    })

    revalidatePath('/admin')
    revalidatePath('/')

    return { success: true, event: event as any }
  } catch (error: any) {
    console.error('Failed to create event:', error)
    return { 
      success: false, 
      error: { 
        code: 'INTERNAL_ERROR', 
        message: error.message || 'An unexpected error occurred while creating the event' 
      } 
    }
  }
}

export async function getEventAnalytics(eventId: string) {
  noStore()
  
  const [event, seats, totalRevenueResult, bookingsLastHour] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      include: {
        _count: {
          select: { bookings: true }
        }
      }
    }),
    prisma.seat.findMany({
      where: { eventId },
      select: { status: true }
    }),
    prisma.booking.aggregate({
      where: { eventId, status: 'confirmed' },
      _sum: { priceCents: true }
    }),
    prisma.booking.findMany({
      where: {
        eventId,
        createdAt: { gte: new Date(Date.now() - 3600000) }
      },
      include: {
          user: { select: { fullName: true, email: true } },
          seat: { select: { displayLabel: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    })
  ])

  if (!event) throw new Error('Event not found')

  const totalSeats = seats.length
  const bookedSeats = seats.filter((s: any) => s.status === 'booked').length
  const heldSeats = seats.filter((s: any) => s.status === 'held').length
  const occupancyRate = totalSeats > 0 ? (bookedSeats / totalSeats) * 100 : 0

  return {
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      eventDate: event.eventDate,
      venueName: event.venueName
    },
    analytics: {
      totalRevenueCents: totalRevenueResult._sum.priceCents || 0,
      occupancyRate,
      bookedCount: bookedSeats,
      heldCount: heldSeats,
      totalCount: totalSeats,
      recentVelocityPerHour: bookingsLastHour.length
    },
    recentBookings: bookingsLastHour
  }
}

export async function refundBookingAction(bookingId: string) {
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const result = await refundBooking(bookingId, user.id)

    if (!result.success) {
      return { success: false, error: result.message }
    }

    // Publish Kafka event for real-time seat release
    try {
      await publishBookingEvent({
        type: 'seat.released',
        version: '1.0',
        timestamp: new Date().toISOString(),
        traceId: crypto.randomUUID(),
        payload: {
          eventId: result.eventId,
          seatId: result.seatId,
          userId: user.id,
          previousStatus: 'booked',
          newStatus: 'available',
          metadata: {
              section: result.seat.section,
              rowName: result.seat.rowName,
              seatNumber: result.seat.seatNumber,
              displayLabel: result.seat.displayLabel
          }
        },
      });
    } catch (kafkaError) {
      console.error('Failed to publish Kafka release event during refund:', kafkaError);
    }

    revalidatePath('/admin')
    revalidatePath(`/admin/events/${result.eventId}`)
    revalidatePath('/')
    
    return { success: true }
  } catch (error: any) {
    console.error('Unexpected error in refundBookingAction:', error)
    return { success: false, error: 'Failed to process refund' }
  }
}

export async function cancelEventAction(eventId: string) {
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    const result = await bulkRefundEventBookings(eventId, user.id)

    if (!result.success) {
      return { success: false, error: result.message }
    }

    // Publish Kafka events in batch for all released seats
    if (result.releasedSeats.length > 0) {
      try {
        const events = result.releasedSeats.map(seat => ({
          type: 'seat.released' as const,
          version: '1.0' as const,
          timestamp: new Date().toISOString(),
          traceId: crypto.randomUUID(),
          payload: {
            eventId: eventId,
            seatId: seat.id,
            userId: user.id,
            previousStatus: 'booked' as const, // For bulk, we simplify to available
            newStatus: 'available' as const,
            metadata: {
              section: seat.section,
              rowName: seat.rowName,
              seatNumber: seat.seatNumber,
              displayLabel: seat.displayLabel
            }
          }
        }))

        await publishBookingEventBatch(events)
      } catch (kafkaError) {
        console.error('Failed to publish Kafka batch events during event cancellation:', kafkaError)
      }
    }

    revalidatePath('/admin')
    revalidatePath(`/admin/events/${eventId}`)
    revalidatePath('/')
    
    return { success: true }
  } catch (error: any) {
    console.error('Unexpected error in cancelEventAction:', error)
    return { success: false, error: 'Failed to process event cancellation' }
  }
}
