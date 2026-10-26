export function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
      {children}
    </span>
  );
}
