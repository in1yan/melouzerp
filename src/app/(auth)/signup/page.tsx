"use client";

import Link from "next/link";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client";

function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [requestedRole, setRequestedRole] = useState<"lead" | "employee">("employee");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const search = useSearchParams();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api("/api/auth/signup", {
        method: "POST",
        body: { name, email, password, requested_role: requestedRole },
      });
      router.push(search.get("next") || "/dashboard");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Sign up failed");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Request access</h1>
        <p className="text-sm text-muted-foreground">
          Sign up as a lead or employee. An admin must approve you before you can join.
        </p>
      </div>
      <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      <Input
        type="password"
        placeholder="Password (min 8 characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        autoComplete="new-password"
      />
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">I am joining as</span>
        <div className="grid grid-cols-2 gap-2">
          {(["employee", "lead"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRequestedRole(r)}
              className={
                "rounded-md border px-3 py-2 text-left text-sm transition-colors " +
                (requestedRole === r
                  ? "border-primary bg-primary/10 font-medium"
                  : "hover:bg-accent")
              }
            >
              <span className="block capitalize">{r}</span>
              <span className="block text-[11px] font-normal text-muted-foreground">
                {r === "employee" ? "Work on assigned tasks" : "Lead and review employees"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Submitting request..." : "Request access"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already registered?{" "}
        <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
