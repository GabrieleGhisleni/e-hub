import { Loader2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@ehub/ui/components/alert";
import { Button } from "@ehub/ui/components/button";
import { Input } from "@ehub/ui/components/input";
import { Label } from "@ehub/ui/components/label";

/** Z-Library sign-in, shown until the user connects their own account: the password is sent once and never kept. */
export function ZlibraryConnectForm({
  onConnect,
  busy,
  error,
}: {
  onConnect: (email: string, password: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    void onConnect(email.trim(), password).then(() => setPassword(""));
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-sm flex-col gap-3 py-6">
      <p className="text-sm text-muted-foreground">
        Collega il tuo account Z-Library. La password serve solo per questo accesso: l&apos;app conserva soltanto la
        chiave di sessione.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="zlibrary-email">Email</Label>
        <Input
          id="zlibrary-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="zlibrary-password">Password</Label>
        <Input
          id="zlibrary-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={busy || email.trim() === "" || password === ""}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        Collega
      </Button>
    </form>
  );
}
