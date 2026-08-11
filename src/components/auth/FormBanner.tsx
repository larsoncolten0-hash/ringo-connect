export default function FormBanner({
  type = "error",
  children,
}: {
  type?: "error" | "success";
  children: React.ReactNode;
}) {
  const styles =
    type === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
      : "border-ringo-teal/30 bg-ringo-teal/10 text-ringo-teal";

  return (
    <div className={`rounded-card border px-3.5 py-2.5 text-sm mb-4 ${styles}`} role="status">
      {children}
    </div>
  );
}
