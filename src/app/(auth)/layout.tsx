export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Root layout already renders <Header/> (which hides user info on auth pages)
  // and hides <BottomNav/> on auth pages — so this layout just adds vertical centering.
  return (
    <div className="flex-1 flex flex-col justify-center py-8">
      {children}
    </div>
  );
}
