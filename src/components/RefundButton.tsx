"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { RotateCcw } from "lucide-react"
import { refundBookingAction } from "@/actions/admin"
import { useToast } from "@/components/ui/use-toast"

interface RefundButtonProps {
    bookingId: string
    status: string
}

export function RefundButton({ bookingId, status }: RefundButtonProps) {
    const { toast } = useToast()
    const [isPending, startTransition] = useTransition()

    const handleRefund = () => {
        if (!confirm("Are you sure you want to refund this booking? This will release the seat immediately.")) return

        startTransition(async () => {
            const result = await refundBookingAction(bookingId)
            if (result.success) {
                toast({
                    title: "Booking Refunded",
                    description: "The seat has been released and is now available for booking.",
                })
            } else {
                toast({
                    title: "Refund Failed",
                    description: result.error || "An unexpected error occurred.",
                    variant: "destructive",
                })
            }
        })
    }

    if (status !== 'confirmed') return null

    return (
        <Button
            variant="outline"
            size="sm"
            className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
            disabled={isPending}
            onClick={handleRefund}
        >
            <RotateCcw className={`w-4 h-4 ${isPending ? "animate-spin" : ""}`} />
            {isPending ? "Processing..." : "Refund"}
        </Button>
    )
}
