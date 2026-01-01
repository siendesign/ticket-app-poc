import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { CreateEventRequest, UUID } from '@/types';

/**
 * Atomic operation to create an event and its associated seats.
 */
export async function createEvent(data: CreateEventRequest & { createdById: UUID }) {
  return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Create the event record
    const event = await tx.event.create({
      data: {
        name: data.name,
        description: data.description,
        venueName: data.venueName,
        venueAddress: data.venueAddress,
        eventDate: new Date(data.eventDate),
        doorsOpen: data.doorsOpen ? new Date(data.doorsOpen) : null,
        bookingOpens: new Date(data.bookingOpens),
        bookingCloses: new Date(data.bookingCloses),
        totalSeats: data.totalSeats,
        basePriceCents: data.basePriceCents,
        currency: data.currency || 'USD',
        status: 'published', // Published by default for simplicity in this POC
        createdById: data.createdById,
      },
    });

    // 2. Automatically generate seat layout based on totalSeats
    // Logic: 10 seats per row, starting from Row 'A'
    const seatsPerRow = 10;
    const totalToGenerate = data.totalSeats;
    
    const seatsData = [];
    for (let i = 0; i < totalToGenerate; i++) {
        const rowIdx = Math.floor(i / seatsPerRow);
        const seatNum = (i % seatsPerRow) + 1;
        
        // Generate row name (A, B, C... Z, AA, AB...)
        let rowName = '';
        let n = rowIdx;
        while (n >= 0) {
            rowName = String.fromCharCode(65 + (n % 26)) + rowName;
            n = Math.floor(n / 26) - 1;
        }

        const displayLabel = `${rowName}-${seatNum}`;

        seatsData.push({
            eventId: event.id,
            section: 'General',
            rowName,
            seatNumber: seatNum.toString(),
            displayLabel,
            category: 'standard',
            priceMultiplier: 1.0,
            status: 'available',
        });
    }

    // Use createMany for high-performance batch insertion
    await tx.seat.createMany({
        data: seatsData,
    });

    return event;
  });
}

/**
 * Fetch all published events.
 */
export async function getPublishedEvents() {
  return await prisma.event.findMany({
    where: { status: 'published' },
    orderBy: { eventDate: 'asc' },
  });
}
