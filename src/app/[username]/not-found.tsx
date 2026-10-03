import { PublicNotFound } from "@/components/public/PublicStates";

// Reached whenever a route under /[username] calls notFound(): a profile that does not exist, is not
// published, or whose owner is suspended all end up here and look identical on purpose. The response
// is still a 404 (that comes from notFound(), not from this file).
export default function ProfileNotFound() {
  return <PublicNotFound />;
}
