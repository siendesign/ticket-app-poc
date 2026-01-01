"use client"

import { Button } from "./ui/button"
import { loginAction, logoutAction } from "@/actions/auth"
import { useRouter } from "next/navigation"

export function UserSwitcher({ currentUser }: { currentUser: any }) {
    const router = useRouter()

    const handleLogin = async (userId: string) => {
        await loginAction(userId)
        router.refresh()
    }

    const handleLogout = async () => {
        await logoutAction()
        router.refresh()
    }

    if (currentUser) {
        return (
            <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-card/80 backdrop-blur border p-2 rounded-lg shadow-lg">
                <div className="flex flex-col text-xs mr-2">
                    <span className="font-semibold">{currentUser.name}</span>
                    <span className="text-muted-foreground">{currentUser.email}</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleLogout}>
                    Logout
                </Button>
            </div>
        )
    }

    return (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 bg-card/80 backdrop-blur border p-4 rounded-lg shadow-lg">
            <p className="text-sm font-semibold mb-1">Select User (Test Mode)</p>
            <Button
                variant="default"
                size="sm"
                onClick={() => handleLogin('11111111-1111-1111-1111-111111111111')}
                className="w-full justify-start"
            >
                Login as Alice
            </Button>
            <Button
                variant="secondary"
                size="sm"
                onClick={() => handleLogin('22222222-2222-2222-2222-222222222222')}
                className="w-full justify-start"
            >
                Login as Bob
            </Button>
        </div>
    )
}
