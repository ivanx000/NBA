const GITHUB_URL = "https://github.com/ivanx000/NBA";

export function SiteFooter() {
  return (
    <footer className="border-t border-line px-4 py-6 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>Unofficial fan project. Not affiliated with the NBA.</p>
        <p>
          Data: NBA.com public stats ·{" "}
          <a
            href={GITHUB_URL}
            className="text-blue-hi underline-offset-4 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
