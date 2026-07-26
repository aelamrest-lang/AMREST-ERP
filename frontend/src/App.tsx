import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./lib/store";
import { Login } from "./components/Login";
import { Layout, Route } from "./components/Layout";
import { canAccessRoute, permissionModules } from "./lib/permissions";
import { Dashboard } from "./pages/Dashboard";
import { Parties } from "./pages/Parties";
import { Items } from "./pages/Items";
import { Quotations } from "./pages/Quotations";
import { Proformas } from "./pages/Proformas";
import { SalesOrders } from "./pages/SalesOrders";
import { PurchaseOrders, GRNPage } from "./pages/Procurement";
import { Inventory } from "./pages/Inventory";
import { RawMaterialIssue } from "./pages/RawMaterialIssue";
import { BOMPage } from "./pages/BOM";
import { JobCards, ProductionDashboard } from "./pages/Production";
import { TestingPage } from "./pages/Testing";
import { Challans } from "./pages/Challans";
import { Reports } from "./pages/Reports";
import { TaxDashboard } from "./pages/TaxDashboard";
import { Users } from "./pages/Users";
import { Settings } from "./pages/Settings";
import { DocumentFormatSettings } from "./pages/DocumentFormatSettings";
import { Logs } from "./pages/Logs";
import { Profile } from "./pages/Profile";
import { Leads } from "./pages/Leads";

function Shell() {
  const { currentUser } = useStore();
  const [route, setRoute] = useState<Route>("dashboard");

  useEffect(() => {
    const r = (localStorage.getItem("amrest_route") as Route) || "dashboard";
    setRoute(r);
  }, []);
  useEffect(() => { localStorage.setItem("amrest_route", route); }, [route]);

  if (!currentUser) return <Login />;

  const effective = canAccessRoute(currentUser, route)
    ? route
    : (permissionModules.find(module => canAccessRoute(currentUser, module)) || "profile");

  return (
    <Layout route={effective} setRoute={setRoute}>
      {effective === "dashboard" && <Dashboard />}
      {effective === "leads" && <Leads />}
      {effective === "parties" && <Parties />}
      {effective === "items" && <Items />}
      {effective === "quotations" && <Quotations />}
      {effective === "proformas" && <Proformas />}
      {effective === "salesorders" && <SalesOrders />}
      {effective === "purchase" && <PurchaseOrders />}
      {effective === "grn" && <GRNPage />}
      {effective === "inventory" && <Inventory />}
      {effective === "rawissue" && <RawMaterialIssue />}
      {effective === "bom" && <BOMPage />}
      {effective === "jobcards" && <JobCards />}
      {effective === "production" && <ProductionDashboard />}
      {effective === "testing" && <TestingPage />}
      {effective === "challans" && <Challans />}
      {effective === "reports" && <Reports />}
      {effective === "taxdash" && <TaxDashboard />}
      {effective === "users" && <Users />}
      {effective === "settings" && <Settings />}
      {effective === "docformats" && <DocumentFormatSettings />}
      {effective === "logs" && <Logs />}
      {effective === "profile" && <Profile />}
    </Layout>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
