import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
      <Image src="/logo.png" alt="Ringo Connect" width={64} height={64} priority />
      <h1 className="text-3xl font-medium text-ringo-text">Ringo Connect</h1>
      <p className="text-ringo-muted max-w-sm">
        One page for your links, your catalog, and a direct line to WhatsApp.
      </p>
      <div className="flex gap-3">
        <Link
          href="/auth/signup"
          className="px-5 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium"
        >
          Create your page
        </Link>
        <Link
          href="/auth/login"
          className="px-5 py-2 rounded-card border border-ringo-border text-sm font-medium text-ringo-text"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
