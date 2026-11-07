"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/store/session";

/** Sends signed in people who have not finished sign up to /welcome. */
export function OnboardingGuard() {
  const user = useSession((s) => s.user);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (user && !user.onboarded && pathname !== "/welcome") {
      router.replace(`/welcome?next=${encodeURIComponent(pathname)}`);
    }
  }, [user, pathname, router]);

  return null;
}
