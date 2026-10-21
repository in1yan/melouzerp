import Link from "next/link";
import { GridBackground } from "@/components/shared/grid-background";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[#213183] px-4 py-8 sm:py-10">
      <div className="absolute inset-0">
        <GridBackground />
        <div className="absolute inset-0 bg-[#101535]/45" />
      </div>
      <div className="relative z-10 w-full max-w-sm space-y-6 rounded-2xl border border-white/20 bg-white/90 p-6 text-foreground shadow-2xl backdrop-blur-md dark:bg-[#11152a]/90">
        <div className="text-center">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Melouz OS
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
