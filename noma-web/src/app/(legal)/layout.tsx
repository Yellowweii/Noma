export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-white text-neutral-800 selection:bg-neutral-200">
      <main>{children}</main>
    </div>
  );
}
