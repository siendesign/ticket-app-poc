"use client"

import { Calendar, MapPin, Ticket } from "lucide-react"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card"
import { Button } from "./ui/button"
import Link from "next/link"

interface EventCardProps {
    event: {
        id: string
        name: string
        venueName: string
        eventDate: Date
        basePriceCents: number
        totalSeats: number
        description?: string | null
    }
}

export function EventCard({ event }: EventCardProps) {
    const formattedDate = new Date(event.eventDate).toLocaleDateString("en-US", {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })

    return (
        <Card className="group overflow-hidden border-2 transition-all duration-300 hover:border-primary/50 hover:shadow-2xl hover:shadow-primary/10">
            <div className="aspect-video w-full bg-gradient-to-br from-primary/20 via-primary/5 to-background relative overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center opacity-20 group-hover:opacity-30 transition-opacity">
                    <Ticket className="w-32 h-32 rotate-12" />
                </div>
                <div className="absolute top-4 right-4">
                    <div className="px-3 py-1 bg-background/80 backdrop-blur-md rounded-full border text-xs font-bold text-primary">
                        ${(event.basePriceCents / 100).toFixed(0)}+
                    </div>
                </div>
            </div>
            <CardHeader>
                <CardTitle className="line-clamp-1 group-hover:text-primary transition-colors">{event.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {event.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px]">
                        {event.description}
                    </p>
                )}
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                        <Calendar className="w-4 h-4 text-primary" />
                        {formattedDate}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                        <MapPin className="w-4 h-4 text-primary" />
                        {event.venueName}
                    </div>
                </div>
            </CardContent>
            <CardFooter className="pt-0">
                <Button asChild className="w-full font-bold tracking-wide shadow-lg shadow-primary/20 group-hover:translate-y-[-2px] transition-transform">
                    <Link href={`/events/${event.id}`}>
                        Book Now
                    </Link>
                </Button>
            </CardFooter>
        </Card>
    )
}
