import { currentSession } from "../session";

export function DemoBanner() {
  if (currentSession) return null;

  return (
    <div className="border-b bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
      Anteprima con dati di esempio.
    </div>
  );
}
