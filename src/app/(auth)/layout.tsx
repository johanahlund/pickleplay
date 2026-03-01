export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-primary text-white px-4 py-3 text-center sticky top-0 z-50">
        <h1 className="text-lg font-bold">🏓 PicklePlay</h1>
      </header>
      <main className="flex-1 max-w-[600px] mx-auto w-full px-4 py-6">
        {children}
      </main>
    </div>
  );
}
