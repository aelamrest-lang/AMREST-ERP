import { useStore } from "../lib/store";
import { Card, Table, Th, Td, Badge, Empty } from "../components/ui";

export function Logs() {
  const { db } = useStore();
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold">Activity Logs</h1><p className="text-sm text-slate-500">User actions across the system</p></div>
      <Card>
        <Table>
          <thead><tr><Th>Time</Th><Th>User</Th><Th>Module</Th><Th>Action</Th></tr></thead>
          <tbody>
            {db.logs.map(l => {
              const u = db.users.find(x => x.id === l.userId);
              return (
                <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="text-xs">{new Date(l.timestamp).toLocaleString()}</Td>
                  <Td className="font-medium">{u?.name || "—"}</Td>
                  <Td><Badge color="indigo">{l.module}</Badge></Td>
                  <Td>{l.action}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {db.logs.length === 0 && <Empty title="No activity logged yet"/>}
      </Card>
    </div>
  );
}
