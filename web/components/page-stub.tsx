export function PageStub({
  title,
  eyebrow = "Tip-Off",
  children,
}: {
  title: string;
  /** Small mono label over the title. */
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-32 pb-20 sm:px-6">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-3 font-display text-5xl leading-[0.95] font-extrabold uppercase sm:text-7xl">{title}</h1>
      <span aria-hidden className="mt-5 block h-[3px] w-20 rounded-full bg-blue-hi shadow-[0_0_16px_var(--blue-hi)]" />
      <div className="holo-panel mt-8 max-w-prose rounded-xl p-6 text-lg text-muted-foreground">{children}</div>
    </main>
  );
}
