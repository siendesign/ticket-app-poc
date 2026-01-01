import { getEventAnalytics } from "@/actions/admin"
import { SingleEventAnalytics } from "@/components/SingleEventAnalytics"
import { ChevronLeft, Calendar, MapPin, ExternalLink } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CancelEventButton } from "@/components/CancelEventButton"

export default async function EventDashboardPage({ params }: { params: { id: string } }) {
    const data = await getEventAnalytics(params.id)

    return (
        <main className="container mx-auto py-10 px-4 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="space-y-4">
                    <Link href="/admin" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-primary transition-colors gap-1">
                        <ChevronLeft className="w-4 h-4" />
                        Back to Dashboard
                    </Link>
                    <div className="space-y-1">
                        <h1 className="text-4xl font-extrabold tracking-tight">{data.event.name}</h1>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                {new Date(data.event.eventDate).toLocaleString()}
                            </div>
                            <div className="flex items-center gap-1">
                                <MapPin className="w-4 h-4" />
                                {data.event.venueName}
                            </div>
                            <span className="capitalize px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/20">
                                {data.event.status}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                    <Button asChild variant="outline" className="flex-1 md:flex-none gap-2">
                        <Link href={`/events/${data.event.id}`} target="_blank">
                            <ExternalLink className="w-4 h-4" />
                            View Public Map
                        </Link>
                    </Button>
                    <CancelEventButton
                        eventId={data.event.id}
                        eventName={data.event.name}
                        status={data.event.status}
                    />
                </div>
            </div>

            <SingleEventAnalytics eventId={params.id} initialData={data} />
        </main>
    )
}
