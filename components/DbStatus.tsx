/** Small notice shown in the top bar when the Supabase settings are missing. */
export function DbStatus() {
  return (
    <span
      title="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to connect"
      className="mr-2 inline-flex h-6 items-center gap-1.5 rounded-sm bg-hover px-2 text-[12px] text-text-2"
    >
      <span className="h-2 w-2 rounded-full bg-[#f9a825]" />
      <span className="hidden wide:inline">database not connected</span>
    </span>
  );
}
