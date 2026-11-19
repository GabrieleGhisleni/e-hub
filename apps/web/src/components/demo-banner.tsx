import { HOSTED, currentSession } from "../session";

export function DemoBanner() {
  if (!HOSTED || currentSession) return null;

  return (
    <div className="border-b bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
      Anteprima con dati di esempio.
    </div>
  );
}
