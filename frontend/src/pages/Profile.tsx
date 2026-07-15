import { useState } from "react";
import { useStore } from "../lib/store";
import { Card, Button, Input, Label, Badge } from "../components/ui";
import { roleLabels } from "../lib/permissions";

export function Profile() {
  const { currentUser, changePassword } = useStore();
  const [oldP, setOldP] = useState("");
  const [newP, setNewP] = useState("");
  const [conf, setConf] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newP !== conf) return setMsg({ type: "err", text: "New passwords don't match" });
    if (newP.length < 4) return setMsg({ type: "err", text: "Password must be at least 4 characters" });
    const r = changePassword(oldP, newP);
    if (r.ok) { setMsg({ type: "ok", text: "Password changed successfully" }); setOldP(""); setNewP(""); setConf(""); }
    else setMsg({ type: "err", text: r.msg || "Failed" });
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div><h1 className="text-2xl font-bold">My Profile</h1></div>
      <Card>
        <div className="p-5 flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-2xl font-bold">{currentUser?.name.charAt(0)}</div>
          <div>
            <div className="text-lg font-semibold">{currentUser?.name}</div>
            <div className="text-sm text-slate-500">{currentUser?.email}</div>
            <div className="mt-1"><Badge color={currentUser?.role === "admin" ? "purple" : "blue"}>{currentUser ? roleLabels[currentUser.role] : ""}</Badge></div>
          </div>
        </div>
      </Card>
      <Card>
        <div className="p-5">
          <h3 className="font-semibold mb-3">Change Password</h3>
          <form onSubmit={submit} className="space-y-3">
            <div><Label>Current Password</Label><Input type="password" value={oldP} onChange={(e: any) => setOldP(e.target.value)} required/></div>
            <div><Label>New Password</Label><Input type="password" value={newP} onChange={(e: any) => setNewP(e.target.value)} required/></div>
            <div><Label>Confirm New Password</Label><Input type="password" value={conf} onChange={(e: any) => setConf(e.target.value)} required/></div>
            {msg && <div className={`text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}
            <Button type="submit">Update Password</Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
