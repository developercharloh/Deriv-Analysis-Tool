import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { InstallTab } from "./install-tab";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Decorative background — outside main flow so no layout interference */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden>
        <div className="absolute top-[-10%] left-[-5%] w-[600px] h-[600px] rounded-full opacity-30"
          style={{ background: "radial-gradient(circle,#0ea5e9 0%,transparent 65%)", filter: "blur(80px)" }} />
        <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full opacity-22"
          style={{ background: "radial-gradient(circle,#FF4FA3 0%,transparent 65%)", filter: "blur(80px)" }} />
        <div className="absolute top-[35%] right-[25%] w-[350px] h-[350px] rounded-full opacity-12"
          style={{ background: "radial-gradient(circle,#a855f7 0%,transparent 65%)", filter: "blur(60px)" }} />
        {/* Faint grid */}
        <div className="absolute inset-0 opacity-25"
          style={{
            backgroundImage: "linear-gradient(rgba(14,165,233,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,0.07) 1px,transparent 1px)",
            backgroundSize: "48px 48px",
          }} />
      </div>

      <div className="min-h-screen bg-background text-foreground flex">
        <Sidebar />

        {/* Content — offset by sidebar width */}
        <div className="flex-1 min-w-0 md:pl-64 flex flex-col min-h-screen relative z-10">
          <Topbar />
          <main className="flex-1 p-3 sm:p-5 md:p-8 pb-24">
            <div className="max-w-7xl mx-auto w-full">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Floating install tab — visible on all admin pages */}
      <InstallTab />
    </>
  );
}
