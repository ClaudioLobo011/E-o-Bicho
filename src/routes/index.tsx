import { Navigate, Route, Routes } from "react-router-dom";
import TabsLayout from "../layouts/TabsLayout";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/app/*" element={<TabsLayout />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
