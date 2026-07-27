import { useState } from "react";
import { useStore } from "../lib/store";
import { Button, Input, Label } from "./ui";
import { IconBolt } from "./icons";

export function Login() {
  const { login } = useStore();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await login(u, p);
    if (!r.ok) setErr("Invalid Username or Password");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(circle at 20% 20%, rgba(99,102,241,0.4), transparent 40%), radial-gradient(circle at 80% 80%, rgba(245,158,11,0.3), transparent 40%)" }} />
      <div className="relative z-10 w-full max-w-5xl grid lg:grid-cols-2 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-indigo-700 via-indigo-800 to-slate-900 text-white">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg">
                <IconBolt size={26} />
              </div>
              <div>
                <div className="font-bold text-xl">AMREST ELECTRICALS</div>
                <div className="text-xs uppercase tracking-widest text-indigo-200">Limited</div>
              </div>
            </div>
            <h1 className="text-3xl font-bold leading-tight mb-3">Transformer Manufacturing<br/>ERP & Sales CRM</h1>
            <p className="text-indigo-200 text-sm">Complete platform for costing, quotations, production tracking, inventory control and procurement management.</p>
          </div>
          <div className="space-y-3 text-sm">
            <Feature title="Sales & CRM" desc="Leads, Quotations, Proforma & Sales Orders"/>
            <Feature title="Department Access" desc="Production, Purchase, Testing, Store and Sales roles"/>
            <Feature title="Inventory & Procurement" desc="Real-time stock, GRN, Purchase Orders"/>
            <Feature title="Reports & Analytics" desc="GST, Sales, Production dashboards"/>
          </div>
        </div>
        <div className="p-8 lg:p-12">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-white"><IconBolt size={22}/></div>
            <div><div className="font-bold text-slate-800 dark:text-white">AMREST ELECTRICALS</div></div>
          </div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-1">Sign in to your workspace</h2>
          <p className="text-sm text-slate-500 mb-6">Access your ERP & CRM dashboard</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Username</Label>
              <Input value={u} onChange={(e: any) => setU(e.target.value)} placeholder="Enter username" autoComplete="off" name="amrest-login-username" required />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" value={p} onChange={(e: any) => setP(e.target.value)} placeholder="Enter password" autoComplete="new-password" name="amrest-login-password" required />
            </div>
            {err && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 rounded-lg">{err}</div>}
            <Button type="submit" className="w-full" size="lg">Sign In</Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center mt-0.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-indigo-200 text-xs">{desc}</div>
      </div>
    </div>
  );
}
