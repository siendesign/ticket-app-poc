import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Create default admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ticket-app.com' },
    update: {},
    create: {
      email: 'admin@ticket-app.com',
      fullName: 'Admin User',
      // Note: This is an example hash. If your app uses bcrypt, you'll need a valid hash.
      // E.g. for "password123"
      passwordHash: '$2b$10$EpWaTgiFCs05xsmE6.t9ptOB1hTz8ZqcC7.GM.t.v.m.u.i.u.i', 
      status: 'active'
    },
  })
  
  console.log('Creates user:', admin)

  // Create an example event
  const event = await prisma.event.create({
    data: {
        name: 'Launch Party',
        description: 'First event on the new platform',
        venueName: 'The Cloud',
        venueAddress: '123 Internet Blvd',
        eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week from now
        doorsOpen: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 - 3600000), // 1 hour before
        bookingOpens: new Date(),
        bookingCloses: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
        totalSeats: 100,
        basePriceCents: 5000,
        currency: 'USD',
        status: 'published',
        createdById: admin.id
    }
  })

  console.log('Created event:', event)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
