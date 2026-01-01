"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "./ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./ui/dialog"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"
import { createEventAction } from "@/actions/admin"
import { useToast } from "./ui/use-toast"
import { CreateEventRequest } from "@/types"

export function AddEventDialog() {
    const [open, setOpen] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const { toast } = useToast()

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setIsLoading(true)

        const formData = new FormData(event.currentTarget)
        const name = formData.get("name") as string
        const venueName = formData.get("venueName") as string
        const basePriceCents = parseInt(formData.get("basePriceCents") as string) * 100
        const totalSeats = parseInt(formData.get("totalSeats") as string)
        const eventDate = formData.get("eventDate") as string
        const bookingOpens = formData.get("bookingOpens") as string
        const bookingCloses = formData.get("bookingCloses") as string
        const description = formData.get("description") as string
        const venueAddress = formData.get("venueAddress") as string

        const request: CreateEventRequest = {
            name,
            venueName,
            basePriceCents,
            totalSeats,
            eventDate: new Date(eventDate).toISOString(),
            bookingOpens: new Date(bookingOpens).toISOString(),
            bookingCloses: new Date(bookingCloses).toISOString(),
            description,
            venueAddress,
            currency: "USD"
        }

        try {
            const result = await createEventAction(request)
            if (result.success) {
                toast({
                    title: "Event created",
                    description: `Successfully created ${name} with ${totalSeats} seats.`,
                })
                setOpen(false)
            } else {
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: result.error?.message || "Failed to create event",
                })
            }
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "An unexpected error occurred",
            })
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="gap-2">
                    <Plus className="h-4 w-4" />
                    New Event
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[525px] max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Create New Event</DialogTitle>
                        <DialogDescription>
                            Add a new event to the system. Seats will be automatically generated.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Event Name</Label>
                            <Input id="name" name="name" placeholder="e.g. Summer Rocks 2025" required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea id="description" name="description" placeholder="Describe the event..." />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="venueName">Venue Name</Label>
                                <Input id="venueName" name="venueName" placeholder="Arena X" required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="totalSeats">Total Seats</Label>
                                <Input id="totalSeats" name="totalSeats" type="number" min="1" max="1000" defaultValue="50" required />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="basePriceCents">Base Price ($)</Label>
                                <Input id="basePriceCents" name="basePriceCents" type="number" step="0.01" min="0" defaultValue="49.99" required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="eventDate">Event Date & Time</Label>
                                <Input id="eventDate" name="eventDate" type="datetime-local" required />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="bookingOpens">Booking Opens</Label>
                                <Input id="bookingOpens" name="bookingOpens" type="datetime-local" required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="bookingCloses">Booking Closes</Label>
                                <Input id="bookingCloses" name="bookingCloses" type="datetime-local" required />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="venueAddress">Venue Address</Label>
                            <Input id="venueAddress" name="venueAddress" placeholder="123 Main St, City" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? "Creating..." : "Create Event"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
