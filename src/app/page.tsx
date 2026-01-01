import { getPublishedEvents } from '@/lib/db/events'
import { EventCard } from '@/components/EventCard'
import Link from 'next/link'
import { ShieldCheck as Shield, Zap as Flash, Globe as World } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default async function Home() {
    const events = await getPublishedEvents()

    return (
        <main className="flex min-h-screen flex-col bg-background">
            {/* HERO SECTION */}
            <header className="relative w-full py-24 md:py-40 overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background">
                <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:40px_40px]" />
                <div className="container relative mx-auto px-4 text-center space-y-8">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold tracking-widest uppercase animate-in fade-in slide-in-from-bottom-3 duration-1000">
                        <Flash className="w-3 h-3 fill-current" />
                        Next-Gen Ticketing
                    </div>
                    <h1 className="text-5xl md:text-8xl font-black tracking-tighter animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-100">
                        Experience <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-600">Pure Consistency</span>
                    </h1>
                    <p className="text-lg md:text-2xl text-muted-foreground max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-5 duration-1000 delay-200">
                        The ultimate event booking platform with real-time updates and zero double-booking guarantees.
                    </p>

                    <div className="pt-4 animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-300">
                        <Link href="/admin" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors border-b border-transparent hover:border-primary">
                            Switch to Dashboard View →
                        </Link>
                    </div>
                </div>
            </header>

            {/* EVENT LISTING */}
            <section className="container mx-auto px-4 py-16">
                <div className="flex flex-col md:flex-row justify-between items-end gap-4 mb-12">
                    <div className="space-y-1">
                        <h2 className="text-3xl font-bold tracking-tight">Upcoming Events</h2>
                        <p className="text-muted-foreground">Discover and book tickets for the hottest shows.</p>
                    </div>
                    {events.length > 0 && (
                        <div className="text-sm font-medium px-4 py-2 bg-muted rounded-lg border text-muted-foreground">
                            Showing <span className="text-primary font-bold">{events.length}</span> live events
                        </div>
                    )}
                </div>

                {events.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {events.map((event: any) => (
                            <EventCard key={event.id} event={event} />
                        ))}
                    </div>
                ) : (
                    <div className="py-24 text-center space-y-6 bg-muted/30 rounded-3xl border-2 border-dashed">
                        <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto">
                            <Flash className="w-10 h-10 text-muted-foreground opacity-50" />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-xl font-bold">No live events found</h3>
                            <p className="text-muted-foreground max-w-xs mx-auto">
                                Check back later or head over to the Admin Dashboard to create your first event!
                            </p>
                        </div>
                        <Button asChild variant="outline" className="border-2">
                            <Link href="/admin">Go to Admin Dashboard</Link>
                        </Button>
                    </div>
                )}
            </section>

            {/* FEATURES BARS */}
            <section className="border-t bg-muted/30 py-12 mt-auto">
                <div className="container mx-auto px-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div className="flex items-center gap-4 p-4">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shrink-0 transition-transform hover:scale-110">
                                <Shield className="w-6 h-6" />
                            </div>
                            <div>
                                <h4 className="font-bold">Atomic Transactions</h4>
                                <p className="text-xs text-muted-foreground">Guaranteed seating reservations.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 p-4">
                            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0 transition-transform hover:scale-110">
                                <World className="w-6 h-6" />
                            </div>
                            <div>
                                <h4 className="font-bold">Real-time Updates</h4>
                                <p className="text-xs text-muted-foreground">Instant seat status propagation.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 p-4">
                            <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center text-green-500 shrink-0 transition-transform hover:scale-110">
                                <Flash className="w-6 h-6" />
                            </div>
                            <div>
                                <h4 className="font-bold">Zero Latency</h4>
                                <p className="text-xs text-muted-foreground">Optimistic UI with robust fallbacks.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    )
}
