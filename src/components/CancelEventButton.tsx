"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Trash2, AlertTriangle } from "lucide-react"
import { cancelEventAction } from "@/actions/admin"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

interface CancelEventButtonProps {
    eventId: string
    eventName: string
    status: string
}

export function CancelEventButton({ eventId, eventName, status }: CancelEventButtonProps) {
    const { toast } = useToast()
    const router = useRouter()
    const [isPending, startTransition] = useTransition()
    const [open, setOpen] = useState(false)

    const handleCancel = () => {
        startTransition(async () => {
            const result = await cancelEventAction(eventId)
            if (result.success) {
                toast({
                    title: "Event Cancelled",
                    description: `"${eventName}" has been cancelled and all bookings have been refunded.`,
                })
                setOpen(false)
                router.push('/admin')
            } else {
                toast({
                    title: "Cancellation Failed",
                    description: result.error || "An unexpected error occurred.",
                    variant: "destructive",
                })
            }
        })
    }

    if (status === 'cancelled') {
        return (
            <Button variant="outline" disabled className="gap-2 opacity-50">
                <AlertTriangle className="w-4 h-4" />
                Event Cancelled
            </Button>
        )
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="destructive" className="gap-2">
                    <Trash2 className="w-4 h-4" />
                    Cancel Event & Refund All
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="w-5 h-5" />
                        Extreme Action
                    </DialogTitle>
                    <DialogDescription className="pt-2">
                        You are about to cancel <strong>{eventName}</strong>. This action is <strong>irreversible</strong> and will:
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-4 text-sm">
                    <div className="flex items-start gap-2">
                        <div className="mt-1 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                        <p>Refund <strong>all active bookings</strong> for this event.</p>
                    </div>
                    <div className="flex items-start gap-2">
                        <div className="mt-1 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                        <p>Release <strong>all seats</strong> back to the available pool.</p>
                    </div>
                    <div className="flex items-start gap-2">
                        <div className="mt-1 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                        <p>Disable further bookings for this event.</p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                        Discard
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={handleCancel}
                        disabled={isPending}
                    >
                        {isPending ? "Processing..." : "Yes, Cancel Everything"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
