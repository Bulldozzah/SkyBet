import { createFileRoute, Link } from "@tanstack/react-router";
import { TrendingUp, Calculator, Radar, Wallet, BarChart3, ShieldCheck, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BetMaster — Cover Betting Planner" },
      { name: "description", content: "Split your budget across every possible outcome. Scan live odds for profitable combinations. Track every bet." },
      { property: "og:title", content: "BetMaster — Cover Betting Planner" },
      { property: "og:description", content: "Cover-betting planner: calculate stakes, scan odds, record results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary to-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <div className="flex items-center gap-2 text-lg font-bold text-primary">
          <TrendingUp className="h-6 w-6" /> BetMaster
        </div>
        <div className="flex items-center gap-2">
          <Link to="/calculator" className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-accent">
            Log in
          </Link>
          <Link
            to="/calculator"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Join now
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-8 text-center md:px-8 md:pt-20">
        <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          Cover betting made simple
        </span>
        <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-black tracking-tight text-foreground md:text-6xl">
          Back every outcome. <span className="text-primary">Cover your losses.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
          BetMaster splits your budget across every possible match result so whichever outcome
          actually happens, your payout covers what you staked.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/calculator"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Open Calculator <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/scanner"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:bg-accent"
          >
            Scan live odds
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 md:grid-cols-4 md:px-8">
        {[
          { icon: Calculator, title: "Calculator", desc: "Split budget across 3, 9 or 27 scenarios." },
          { icon: Radar, title: "Scanner", desc: "Find combinations that clear your profit floor." },
          { icon: Wallet, title: "My Bets", desc: "Save plans, settle them when games finish." },
          { icon: BarChart3, title: "Stats", desc: "Profit, ROI, win rate — per team and overall." },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-card p-5">
            <f.icon className="h-6 w-6 text-primary" />
            <h3 className="mt-3 font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 md:px-8">
        <div className="rounded-2xl border border-border bg-card p-6 md:p-10">
          <div className="mb-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
            <ShieldCheck className="h-4 w-4" /> How access works
          </div>
          <div className="grid gap-6 md:grid-cols-4">
            {["Register", "Confirm email", "Upload proof of payment", "Admin approves"].map((step, i) => (
              <div key={step}>
                <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <div className="mt-2 font-medium">{step}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
