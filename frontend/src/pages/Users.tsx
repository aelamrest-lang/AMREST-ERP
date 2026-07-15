import { useState } from "react";
import { useStore, uid } from "../lib/store";
import { Card, Button, Input, Select, Label, Modal, Table, Th, Td, Badge, Empty } from "../components/ui";
import type { Role, User } from "../lib/types";
import { defaultPermissionsForRole, moduleLabels, normalizePermissions, permissionActions, permissionModules, permissionTemplates, roleDescriptions, roleLabels } from "../lib/permissions";
import { IconPlus, IconEdit, IconTrash } from "../components/icons";

const roleOptions: Role[] = ["admin", "sales", "production", "purchase", "testing", "store"];
const roleColors: Record<Role, string> = {
  admin: "purple",
  sales: "blue",
  production: "indigo",
  purchase: "yellow",
  testing: "green",
  store: "slate",
};

export function Users() {
  const { db, setDB, log } = useStore();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<User | null>(null);

  const blank = (): User => ({ id: "", name: "", email: "", username: "", password: "", role: "sales", customRoleName: "", permissions: defaultPermissionsForRole("sales"), active: true, createdAt: new Date().toISOString() });
  const [form, setForm] = useState<User>(blank());

  const openNew = () => { setEdit(null); setForm(blank()); setOpen(true); };
  const openEdit = (u: User) => { setEdit(u); setForm({ ...u, permissions: normalizePermissions(u) }); setOpen(true); };
  const save = () => {
    if (!form.username || !form.password || !form.name) return alert("Name, username and password are required");
    const saved = { ...form, permissions: normalizePermissions(form) };
    if (edit) setDB(d => ({...d, users: d.users.map(x => x.id === edit.id ? saved : x)}));
    else setDB(d => ({...d, users: [{...saved, id: uid()}, ...d.users]}));
    log(`${edit ? "Updated" : "Created"} user ${form.username}`, "Users");
    setOpen(false);
  };
  const remove = (u: User) => {
    if (u.id === "u-admin") return alert("Cannot delete primary admin");
    if (!confirm(`Delete user ${u.username}?`)) return;
    setDB(d => ({...d, users: d.users.filter(x => x.id !== u.id)}));
    log(`Deleted user ${u.username}`, "Users");
  };
  const toggle = (u: User) => {
    setDB(d => ({...d, users: d.users.map(x => x.id === u.id ? {...x, active: !x.active} : x)}));
    log(`${u.active ? "Deactivated" : "Activated"} user ${u.username}`, "Users");
  };
  const resetPwd = (u: User) => {
    const np = prompt(`New password for ${u.username}:`, "password123");
    if (!np) return;
    setDB(d => ({...d, users: d.users.map(x => x.id === u.id ? {...x, password: np} : x)}));
    log(`Reset password for ${u.username}`, "Users");
  };

  const setDepartment = (role: Role) => {
    setForm(f => ({ ...f, role, permissions: defaultPermissionsForRole(role), customRoleName: f.customRoleName || "" }));
  };

  const applyTemplate = (role: Role) => {
    setForm(f => ({ ...f, role, permissions: defaultPermissionsForRole(role), customRoleName: roleLabels[role] }));
  };

  const cloneFromUser = (userId: string) => {
    const source = db.users.find(u => u.id === userId);
    if (!source) return;
    setForm(f => ({
      ...f,
      role: source.role,
      customRoleName: source.customRoleName ? `Copy of ${source.customRoleName}` : `Copy of ${roleLabels[source.role]}`,
      permissions: normalizePermissions(source),
    }));
  };

  const togglePermission = (module: string, action: any, checked: boolean) => {
    setForm(f => ({
      ...f,
      permissions: {
        ...normalizePermissions(f),
        [module]: {
          ...normalizePermissions(f)[module],
          [action]: checked,
        },
      },
    }));
  };

  const toggleModuleAll = (module: string, checked: boolean) => {
    setForm(f => {
      const current = normalizePermissions(f);
      return {
        ...f,
        permissions: {
          ...current,
          [module]: Object.fromEntries(permissionActions.map(action => [action, checked])) as any,
        },
      };
    });
  };

  const currentPermissions = normalizePermissions(form);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold">User Management</h1><p className="text-sm text-slate-500">Create department-wise users and assign access controls</p></div>
        <Button onClick={openNew}><IconPlus size={14}/> New User</Button>
      </div>
      <Card>
        <Table>
          <thead><tr><Th>Name</Th><Th>Username</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {db.users.map(u => (
              <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td className="font-medium">{u.name}</Td>
                <Td className="font-mono text-xs">{u.username}</Td>
                <Td>{u.email}</Td>
                <Td>
                  <Badge color={roleColors[u.role]}>{u.customRoleName || roleLabels[u.role]}</Badge>
                  {u.customRoleName && <div className="text-[10px] text-slate-500 mt-1">Dept: {roleLabels[u.role]}</div>}
                </Td>
                <Td><Badge color={u.active ? "green" : "red"}>{u.active ? "Active" : "Inactive"}</Badge></Td>
                <Td><div className="flex gap-1 flex-wrap">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(u)}><IconEdit size={14}/></Button>
                  <Button size="sm" variant="outline" onClick={() => toggle(u)}>{u.active ? "Deactivate" : "Activate"}</Button>
                  <Button size="sm" variant="outline" onClick={() => resetPwd(u)}>Reset Pwd</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(u)}><IconTrash size={14}/></Button>
                </div></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {db.users.length === 0 && <Empty/>}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? "Edit User" : "New User"} size="xl">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Label>Full Name</Label><Input value={form.name} onChange={(e: any) => setForm({...form, name: e.target.value})}/></div>
          <div><Label>Username</Label><Input value={form.username} onChange={(e: any) => setForm({...form, username: e.target.value})}/></div>
          <div><Label>Email</Label><Input value={form.email} onChange={(e: any) => setForm({...form, email: e.target.value})}/></div>
          <div><Label>Password</Label><Input type="text" value={form.password} onChange={(e: any) => setForm({...form, password: e.target.value})}/></div>
          <div><Label>Department</Label>
            <Select value={form.role} onChange={(e: any) => setDepartment(e.target.value)}>
              {roleOptions.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}
            </Select>
          </div>
          <div><Label>Custom Role Name</Label><Input value={form.customRoleName || ""} onChange={(e: any) => setForm({...form, customRoleName: e.target.value})} placeholder="e.g. Senior Purchase Approver"/></div>
          <div><Label>Apply Permission Template</Label>
            <Select value="" onChange={(e: any) => e.target.value && applyTemplate(e.target.value)}>
              <option value="">Select template...</option>
              {permissionTemplates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </div>
          <div><Label>Clone Permissions From User</Label>
            <Select value="" onChange={(e: any) => e.target.value && cloneFromUser(e.target.value)}>
              <option value="">Select user...</option>
              {db.users.filter(u => !edit || u.id !== edit.id).map(u => <option key={u.id} value={u.id}>{u.name} - {u.customRoleName || roleLabels[u.role]}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-xs text-slate-600 dark:text-slate-300">
            <div className="font-semibold text-slate-700 dark:text-slate-200 mb-1">Permission Summary</div>
            {form.customRoleName ? `${form.customRoleName} is based on ${roleLabels[form.role]}. ` : ""}{roleDescriptions[form.role]}
          </div>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={e => setForm({...form, active: e.target.checked})}/> Active
          </label>
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Module Permissions</h3>
              <p className="text-xs text-slate-500">Menus are hidden unless View is ticked. Action buttons follow Create, Edit, Delete, Approve, Print and Export permissions.</p>
            </div>
          </div>
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg max-h-[46vh]">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  <Th className="min-w-44">Module</Th>
                  <Th>All</Th>
                  {permissionActions.map(action => <Th key={action} className="text-center capitalize">{action}</Th>)}
                </tr>
              </thead>
              <tbody>
                {permissionModules.map(module => {
                  const row = currentPermissions[module];
                  const all = permissionActions.every(action => row[action]);
                  return (
                    <tr key={module} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <Td className="font-medium">{moduleLabels[module]}</Td>
                      <Td><input type="checkbox" checked={all} onChange={e => toggleModuleAll(module, e.target.checked)} /></Td>
                      {permissionActions.map(action => (
                        <Td key={action} className="text-center">
                          <input type="checkbox" checked={!!row[action]} onChange={e => togglePermission(module, action, e.target.checked)} />
                        </Td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>{edit ? "Update" : "Create"}</Button></div>
      </Modal>
    </div>
  );
}
