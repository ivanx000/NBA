import { StatusAction, StatusLink, StatusPage } from "@/components/status-page";

/** /game/[id] for an id we don't have. */
export default function GameNotFound() {
  return (
    <StatusPage
      label="404"
      title="No such game"
      actions={
        <>
          <StatusAction href="/">Tonight&apos;s games</StatusAction>
          <StatusLink href="/performance">Every graded game</StatusLink>
        </>
      }
    >
      <p>
        There&apos;s no regular-season game with that ID here. The link may be mistyped, or the game may be from
        before 2025-26.
      </p>
    </StatusPage>
  );
}
