"use client"

import { Button } from "./ui/button"
import { logout } from "@/actions/auth"
import { useRouter } from "next/navigation"
import Link from 'next/link'
import { LogIn } from 'lucide-react'

export function UserSwitcher({ currentUser }: { currentUser: any }) {
    const router = useRouter()

    const handleLogout = async () => {
        await logout()
        // router.refresh() // Logout redirects already
    }

    if (currentUser) {
        return (
            <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-card/80 backdrop-blur border p-2 rounded-lg shadow-lg">
                <div className="flex flex-col text-xs mr-2">
                    <span className="font-semibold">{currentUser.fullName || currentUser.email}</span>
                    <span className="text-muted-foreground">{currentUser.email}</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleLogout}>
                    Logout
                </Button>
            </div>
        )
    }

    return (
        <div className="fixed top-4 right-4 z-50 flex gap-2">
            <Button asChild variant="default" size="sm">
                <Link href="/login">
                    <LogIn className="w-4 h-4 mr-2" />
                    Login
                </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
                <Link href="/register">
                    Register
                </Link>
            </Button>
        </div>
    )
}
