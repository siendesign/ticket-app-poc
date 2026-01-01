import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from "@/components/ui/toaster"
import { UserSwitcher } from "@/components/UserSwitcher"
import { getCurrentUser } from "@/actions/auth"

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
    title: 'Real-Time Ticketing POC',
    description: 'Seat booking system with race condition handling',
}

export default async function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const user = await getCurrentUser()

    return (
        <html lang="en" className="dark">
            <body className={inter.className}>
                <UserSwitcher currentUser={user} />
                {children}
                <Toaster />
            </body>
        </html>
    )
}
