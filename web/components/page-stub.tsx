export function PageStub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-28 pb-16 sm:px-6">
      <h1 className="font-display text-5xl font-bold tracking-tight uppercase">{title}</h1>
      <div className="mt-6 max-w-prose text-lg text-muted-foreground">{children}</div>
    </main>
  );
}
