"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The signed-in person's id, for upload paths that live under their own storage folder. It is undefined until the browser has answered (and stays undefined when signed out).
export default function useCurrentUserId(): string | undefined {
  const [userId, setUserId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    createClient()
      .auth.getUser()
      .then(({ data }) => live && setUserId(data.user?.id))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return userId;
}
