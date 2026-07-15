import type { ModulePermission, PermissionAction, PermissionMatrix, Role, User } from "./types";

export type RouteId =
  | "dashboard" | "leads" | "parties" | "items" | "quotations" | "proformas" | "salesorders"
  | "purchase" | "grn" | "inventory" | "rawissue" | "bom" | "jobcards" | "production" | "testing" | "challans"
  | "reports" | "users" | "settings" | "docformats" | "logs" | "profile";

export const permissionActions: PermissionAction[] = ["view", "create", "edit", "delete", "approve", "print", "export"];

export const moduleLabels: Record<RouteId, string> = {
  dashboard: "Dashboard",
  leads: "Leads & Inquiry",
  parties: "Party Master",
  items: "Item Master",
  quotations: "Quotations",
  proformas: "Proforma Invoices",
  salesorders: "Sales Orders",
  purchase: "Purchase Orders",
  grn: "Goods Receipt Notes",
  inventory: "Inventory",
  rawissue: "Raw Material Issue",
  bom: "Bill of Material",
  jobcards: "Job Cards",
  production: "Production",
  testing: "QC Testing",
  challans: "Delivery Challan",
  reports: "Reports",
  users: "User Management",
  settings: "Company Settings",
  docformats: "Document Format Settings",
  logs: "Activity Logs",
  profile: "My Profile",
};

export const permissionModules: RouteId[] = [
  "dashboard", "leads", "parties", "items", "quotations", "proformas", "salesorders",
  "purchase", "grn", "inventory", "rawissue", "bom", "jobcards", "production", "testing", "challans",
  "reports", "users", "settings", "docformats", "logs", "profile",
];

export const roleLabels: Record<Role, string> = {
  admin: "Admin",
  sales: "Sales Person",
  production: "Production User",
  purchase: "Purchase User",
  testing: "Testing User",
  store: "Store / Inventory User",
};

export const roleDescriptions: Record<Role, string> = {
  admin: "Full ERP access, user administration, approvals and company settings.",
  sales: "CRM, parties, costing, quotations, proforma invoices and sales orders limited to own records.",
  production: "BOM, job cards, production planning and stage-wise manufacturing tracking.",
  purchase: "Vendor management, purchase orders, goods receipt notes and procurement reports.",
  testing: "Production testing workflow, job card visibility and quality-stage updates.",
  store: "Item master, inventory, stock movements, GRN support, reservations and delivery challans.",
};

const emptyPerm = (): ModulePermission => ({ view: false, create: false, edit: false, delete: false, approve: false, print: false, export: false });

export function blankPermissionMatrix(): PermissionMatrix {
  return Object.fromEntries(permissionModules.map(m => [m, emptyPerm()])) as PermissionMatrix;
}

function grant(matrix: PermissionMatrix, module: RouteId, actions: PermissionAction[] = permissionActions) {
  matrix[module] = { ...emptyPerm(), ...matrix[module] };
  actions.forEach(action => { matrix[module][action] = true; });
}

export function defaultPermissionsForRole(role: Role): PermissionMatrix {
  const p = blankPermissionMatrix();
  if (role === "admin") {
    permissionModules.forEach(module => grant(p, module));
    return p;
  }

  grant(p, "dashboard", ["view", "export"]);
  grant(p, "profile", ["view", "edit"]);

  if (role === "sales") {
    ["leads", "parties", "quotations", "proformas", "salesorders"].forEach(m => grant(p, m as RouteId, ["view", "create", "edit", "delete", "print", "export"]));
    grant(p, "reports", ["view", "export"]);
  }

  if (role === "production") {
    grant(p, "bom", ["view", "create", "edit", "delete", "export"]);
    grant(p, "jobcards", ["view", "create", "edit", "delete", "print", "export"]);
    grant(p, "rawissue", ["view", "create", "edit", "print", "export"]);
    grant(p, "production", ["view", "edit", "print", "export"]);
    grant(p, "testing", ["view", "create", "edit", "approve", "print", "export"]);
    grant(p, "inventory", ["view", "export"]);
    grant(p, "reports", ["view", "export"]);
  }

  if (role === "purchase") {
    grant(p, "parties", ["view", "create", "edit", "delete", "export"]);
    grant(p, "purchase", ["view", "create", "edit", "delete", "approve", "print", "export"]);
    grant(p, "grn", ["view", "create", "edit", "delete", "print", "export"]);
    grant(p, "reports", ["view", "export"]);
  }

  if (role === "testing") {
    grant(p, "production", ["view", "edit", "print", "export"]);
    grant(p, "testing", ["view", "create", "edit", "approve", "print", "export"]);
    grant(p, "reports", ["view", "export"]);
  }

  if (role === "store") {
    grant(p, "items", ["view", "create", "edit", "delete", "export"]);
    grant(p, "inventory", ["view", "create", "edit", "export"]);
    grant(p, "rawissue", ["view", "create", "edit", "print", "export"]);
    grant(p, "grn", ["view", "create", "edit", "print", "export"]);
    grant(p, "jobcards", ["view", "edit", "print", "export"]);
    grant(p, "testing", ["view", "print", "export"]);
    grant(p, "challans", ["view", "create", "edit", "delete", "print", "export"]);
    grant(p, "reports", ["view", "export"]);
  }

  return p;
}

export const permissionTemplates: { id: Role; label: string; description: string; permissions: PermissionMatrix }[] = [
  "admin", "sales", "production", "purchase", "testing", "store",
].map(role => ({ id: role as Role, label: roleLabels[role as Role], description: roleDescriptions[role as Role], permissions: defaultPermissionsForRole(role as Role) }));

export function normalizePermissions(user: Pick<User, "role" | "permissions">): PermissionMatrix {
  const base = defaultPermissionsForRole(user.role);
  if (!user.permissions) return base;
  const normalized = blankPermissionMatrix();
  permissionModules.forEach(module => {
    normalized[module] = { ...base[module], ...user.permissions?.[module] };
  });
  return normalized;
}

export function userCan(user: User | null | undefined, module: RouteId, action: PermissionAction = "view") {
  if (!user || !user.active) return false;
  return !!normalizePermissions(user)[module]?.[action];
}

export function canAccessRoute(userOrRole: User | Role | null | undefined, route: RouteId) {
  if (!userOrRole) return false;
  if (typeof userOrRole === "string") return !!defaultPermissionsForRole(userOrRole)[route]?.view;
  return userCan(userOrRole, route, "view");
}

export function getRoleRoutes(role: Role) {
  const matrix = defaultPermissionsForRole(role);
  return permissionModules.filter(module => matrix[module].view);
}