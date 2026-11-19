import { Users } from "lucide-react";
import type { Episode } from "@core/schema";
import { Button } from "@ehub/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ehub/ui/components/dialog";

export function EpisodeGuests({ episode }: { episode: Episode }) {
  const { guests, guestDescriptions = {} } = episode;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Ospiti dell'episodio"
          title="Ospiti dell'episodio"
        >
          <Users aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ospiti dell'episodio</DialogTitle>
        </DialogHeader>
        {guests.length > 0 ? (
          <ul className="space-y-4">
            {guests.map((name) => (
              <li key={name}>
                <h3 className="font-medium">{name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {Object.hasOwn(guestDescriptions, name)
                    ? guestDescriptions[name]
                    : "Una presentazione non è ancora disponibile."}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Il catalogo non indica ospiti per questo episodio.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
